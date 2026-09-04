import type { Vector3 } from '../../../../shared/protocol';
import type { RouteLayout } from '../route-layout';

export type EnemyAiState = 'advance' | 'engage' | 'dead';

export interface EnemyTarget {
  readonly id: string;
  readonly position: Vector3;
  readonly alive: boolean;
}

export interface EnemyBehaviorConfig {
  readonly moveSpeed: number;
  readonly behavior: string;
  readonly advanceSec?: number;
  readonly engageSec?: number;
  readonly setupSec?: number;
  readonly preferStaticPosition?: boolean;
  readonly engageRangeM?: number;
}

export interface EnemySharedAiConfig {
  readonly fireWarningSec: number;
  readonly maxEngageRangeM: number;
}

export interface EnemyWeaponAiConfig {
  readonly fireRate: number;
}

export interface EnemyAgentOptions<TRouteId extends string> {
  readonly id: string;
  readonly enemyType: string;
  readonly route: RouteLayout<TRouteId>;
  readonly spawnOffset: Vector3;
  readonly behavior: EnemyBehaviorConfig;
  readonly shared: EnemySharedAiConfig;
  readonly weapon: EnemyWeaponAiConfig;
  readonly spawnedAtMs: number;
}

export interface EnemyFireWarning {
  readonly type: 'fire_warning';
  readonly enemyId: string;
  readonly targetId: string;
  readonly firesAtMs: number;
}

export interface EnemyShotIntent {
  readonly type: 'shot';
  readonly enemyId: string;
  readonly targetId: string;
  readonly enemyType: string;
  readonly distanceM: number;
  readonly aimedPosition: Vector3;
}

export type EnemyAiEvent = EnemyFireWarning | EnemyShotIntent;

interface MutableVector3 {
  x: number;
  y: number;
  z: number;
}

const ASSAULT_BEHAVIOR = 'charge';
const MACHINE_GUNNER_BEHAVIOR = 'suppress';

export class EnemyAgent<TRouteId extends string> {
  readonly id: string;
  readonly enemyType: string;
  readonly routeId: TRouteId;
  readonly position: MutableVector3;
  state: EnemyAiState = 'advance';
  fireWarningEndsAtMs: number | undefined;

  private readonly goalPosition: Vector3;
  private readonly behavior: EnemyBehaviorConfig;
  private readonly shared: EnemySharedAiConfig;
  private readonly weapon: EnemyWeaponAiConfig;
  private stateStartedAtMs: number;
  private targetId: string | undefined;
  private aimedPosition: Vector3 | undefined;
  private nextFireAtMs: number;

  constructor(options: EnemyAgentOptions<TRouteId>) {
    this.id = options.id;
    this.enemyType = options.enemyType;
    this.routeId = options.route.routeId;
    this.position = {
      x: options.route.spawnPosition.x + options.spawnOffset.x,
      y: options.route.spawnPosition.y + options.spawnOffset.y,
      z: options.route.spawnPosition.z + options.spawnOffset.z,
    };
    this.goalPosition = {
      x: options.route.guardPosition.x + options.spawnOffset.x,
      y: options.route.guardPosition.y + options.spawnOffset.y,
      z: options.route.guardPosition.z + options.spawnOffset.z,
    };
    this.behavior = options.behavior;
    this.shared = options.shared;
    this.weapon = options.weapon;
    this.stateStartedAtMs = options.spawnedAtMs;
    this.nextFireAtMs = options.spawnedAtMs;
  }

  updateMovement(deltaSec: number): void {
    if (this.state !== 'advance') {
      return;
    }

    moveToward(
      this.position,
      this.goalPosition,
      this.behavior.moveSpeed * deltaSec,
    );
  }

  resolvePendingAttack(
    nowMs: number,
    targets: readonly EnemyTarget[],
  ): EnemyShotIntent | undefined {
    const firesAtMs = this.fireWarningEndsAtMs;
    if (firesAtMs === undefined || nowMs < firesAtMs) {
      return undefined;
    }

    this.fireWarningEndsAtMs = undefined;
    const aimedPosition = this.aimedPosition;
    this.aimedPosition = undefined;
    const target = targets.find(
      (candidate) => candidate.id === this.targetId && candidate.alive,
    );
    this.targetId = undefined;
    this.nextFireAtMs = nowMs + 1000 / this.weapon.fireRate;
    if (!target || !aimedPosition) {
      return undefined;
    }

    return {
      type: 'shot',
      enemyId: this.id,
      targetId: target.id,
      enemyType: this.enemyType,
      distanceM: distanceBetween(this.position, target.position),
      aimedPosition,
    };
  }

  think(
    nowMs: number,
    targets: readonly EnemyTarget[],
  ): EnemyFireWarning | undefined {
    if (this.state === 'dead' || this.fireWarningEndsAtMs !== undefined) {
      return undefined;
    }

    const target = findNearestTarget(this.position, targets);
    if (!target) {
      this.enterState('advance', nowMs);
      return undefined;
    }
    const distanceM = distanceBetween(this.position, target.position);
    if (distanceM > this.shared.maxEngageRangeM) {
      this.enterState('advance', nowMs);
      return undefined;
    }

    this.updateBehaviorState(distanceM, nowMs);
    if (this.state !== 'engage' || nowMs < this.nextFireAtMs) {
      return undefined;
    }

    this.targetId = target.id;
    this.aimedPosition = { ...target.position };
    this.fireWarningEndsAtMs =
      nowMs + this.shared.fireWarningSec * 1000;
    return {
      type: 'fire_warning',
      enemyId: this.id,
      targetId: target.id,
      firesAtMs: this.fireWarningEndsAtMs,
    };
  }

  markDead(): void {
    this.state = 'dead';
    this.fireWarningEndsAtMs = undefined;
    this.targetId = undefined;
    this.aimedPosition = undefined;
  }

  private updateBehaviorState(distanceM: number, nowMs: number): void {
    if (
      this.behavior.behavior === ASSAULT_BEHAVIOR &&
      this.behavior.engageRangeM !== undefined
    ) {
      if (distanceM <= this.behavior.engageRangeM) {
        this.enterState('engage', nowMs);
      } else {
        this.enterState('advance', nowMs);
      }
      return;
    }

    if (
      this.behavior.behavior === MACHINE_GUNNER_BEHAVIOR &&
      this.behavior.preferStaticPosition
    ) {
      const setupMs = (this.behavior.setupSec ?? 0) * 1000;
      if (nowMs - this.stateStartedAtMs >= setupMs) {
        this.enterState('engage', nowMs);
      }
      return;
    }

    const advanceMs = (this.behavior.advanceSec ?? 0) * 1000;
    const engageMs = (this.behavior.engageSec ?? 0) * 1000;
    const stateElapsedMs = nowMs - this.stateStartedAtMs;
    if (this.state === 'advance' && stateElapsedMs >= advanceMs) {
      this.enterState('engage', nowMs);
    } else if (this.state === 'engage' && stateElapsedMs >= engageMs) {
      this.enterState('advance', nowMs);
    }
  }

  private enterState(state: EnemyAiState, nowMs: number): void {
    if (this.state !== state) {
      this.state = state;
      this.stateStartedAtMs = nowMs;
    }
  }
}

export interface EnemyControllerConfig {
  readonly aiUpdateGroups: number;
}

export class EnemyController<TRouteId extends string> {
  constructor(
    private readonly config: EnemyControllerConfig,
    private readonly enemies: readonly EnemyAgent<TRouteId>[],
  ) {
    if (
      !Number.isInteger(config.aiUpdateGroups) ||
      config.aiUpdateGroups <= 0
    ) {
      throw new Error('敌人 AI 分组数必须是正整数');
    }
  }

  update(
    deltaSec: number,
    tick: number,
    nowMs: number,
    targets: readonly EnemyTarget[],
  ): readonly EnemyAiEvent[] {
    const events: EnemyAiEvent[] = [];

    for (const enemy of this.enemies) {
      enemy.updateMovement(deltaSec);
      const shot = enemy.resolvePendingAttack(nowMs, targets);
      if (shot) {
        events.push(shot);
      }
    }

    const group = tick % this.config.aiUpdateGroups;
    for (
      let index = group;
      index < this.enemies.length;
      index += this.config.aiUpdateGroups
    ) {
      const enemy = this.enemies[index];
      if (!enemy) {
        continue;
      }
      const warning = enemy.think(nowMs, targets);
      if (warning) {
        events.push(warning);
      }
    }

    return events;
  }
}

function findNearestTarget(
  position: Vector3,
  targets: readonly EnemyTarget[],
): EnemyTarget | undefined {
  let nearest: EnemyTarget | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const target of targets) {
    if (!target.alive) {
      continue;
    }
    const distance = distanceBetween(position, target.position);
    if (distance < nearestDistance) {
      nearest = target;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function moveToward(
  position: MutableVector3,
  target: Vector3,
  maxDistance: number,
): void {
  const deltaX = target.x - position.x;
  const deltaY = target.y - position.y;
  const deltaZ = target.z - position.z;
  const distance = Math.hypot(deltaX, deltaY, deltaZ);
  if (distance === 0) {
    return;
  }

  const scale = Math.min(1, maxDistance / distance);
  position.x += deltaX * scale;
  position.y += deltaY * scale;
  position.z += deltaZ * scale;
}

function distanceBetween(first: Vector3, second: Vector3): number {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    first.z - second.z,
  );
}
