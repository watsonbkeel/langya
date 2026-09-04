import type { Vector3 } from '../../../../shared/protocol';
import {
  completeReload,
  createWeaponState,
  startReload,
  tryFire,
  type WeaponRuntimeConfig,
  type WeaponRuntimeState,
} from '../../combat/weapon-state';
import type { RouteLayout } from '../route-layout';

export type AllyAiState =
  | 'deploy'
  | 'guard'
  | 'engage'
  | 'reassign'
  | 'dead';

export interface AllyTarget<TRouteId extends string> {
  readonly id: string;
  readonly routeId: TRouteId;
  readonly position: Vector3;
  readonly alive: boolean;
}

export interface AllyBotConfig {
  readonly hp: number;
  readonly weapon: string;
  readonly fireRate: number;
  readonly accuracy: number;
  readonly accuracyLongRange: number;
  readonly longRangeThresholdM: number;
  readonly reactionDelaySec: number;
  readonly medkitCount: number;
  readonly medkitAutoUseThreshold: number;
  readonly canUseHMG: boolean;
  readonly canPickupSupply: boolean;
  readonly canRespawn: boolean;
  readonly eligibleForMVP: boolean;
  readonly moveSpeed: number;
}

export interface AllyMedkitConfig {
  readonly carriedHeal: number;
  readonly carriedUseSec: number;
}

export interface AllyAgentOptions<TRouteId extends string> {
  readonly id: string;
  readonly heroName: string;
  readonly route: RouteLayout<TRouteId>;
  readonly position: Vector3;
  readonly bot: AllyBotConfig;
  readonly weapon: WeaponRuntimeConfig;
  readonly medkit: AllyMedkitConfig;
}

export interface AllyShotIntent {
  readonly type: 'shot';
  readonly allyId: string;
  readonly targetId: string;
  readonly weaponId: string;
  readonly distanceM: number;
  readonly accuracy: number;
}

interface MutableVector3 {
  x: number;
  y: number;
  z: number;
}

export class AllyAgent<TRouteId extends string> {
  readonly id: string;
  readonly heroName: string;
  readonly position: MutableVector3;
  readonly maxHp: number;
  readonly canUseHMG: boolean;
  readonly canPickupSupply: boolean;
  readonly eligibleForMVP: boolean;
  routeId: TRouteId;
  state: AllyAiState = 'deploy';
  hp: number;
  medkitsRemaining: number;

  private readonly bot: AllyBotConfig;
  private readonly weaponConfig: WeaponRuntimeConfig;
  private readonly medkitConfig: AllyMedkitConfig;
  private guardPosition: Vector3;
  private weapon: WeaponRuntimeState;
  private targetId: string | undefined;
  private targetAcquiredAtMs: number | undefined;
  private medkitEndsAtMs: number | undefined;

  constructor(options: AllyAgentOptions<TRouteId>) {
    this.id = options.id;
    this.heroName = options.heroName;
    this.routeId = options.route.routeId;
    this.position = { ...options.position };
    this.guardPosition = options.route.guardPosition;
    this.bot = options.bot;
    this.weaponConfig = {
      ...options.weapon,
      fireRate: options.bot.fireRate,
    };
    this.medkitConfig = options.medkit;
    this.maxHp = options.bot.hp;
    this.hp = options.bot.hp;
    this.medkitsRemaining = options.bot.medkitCount;
    this.canUseHMG = options.bot.canUseHMG;
    this.canPickupSupply = options.bot.canPickupSupply;
    this.eligibleForMVP = options.bot.eligibleForMVP;
    this.weapon = createWeaponState(this.weaponConfig);
  }

  get isAlive(): boolean {
    return this.hp > 0;
  }

  get isCrouching(): boolean {
    return (
      this.weapon.reloadEndsAtMs !== undefined ||
      this.medkitEndsAtMs !== undefined
    );
  }

  get weaponState(): WeaponRuntimeState {
    return this.weapon;
  }

  update(deltaSec: number, nowMs: number): void {
    if (!this.isAlive) {
      return;
    }

    this.weapon = completeReload(
      this.weapon,
      this.weaponConfig,
      nowMs,
    );
    if (
      this.medkitEndsAtMs !== undefined &&
      nowMs >= this.medkitEndsAtMs
    ) {
      this.hp = Math.min(
        this.maxHp,
        this.hp + this.medkitConfig.carriedHeal,
      );
      this.medkitEndsAtMs = undefined;
    }

    if (this.state === 'deploy' || this.state === 'reassign') {
      const arrived = moveToward(
        this.position,
        this.guardPosition,
        this.bot.moveSpeed * deltaSec,
      );
      if (arrived) {
        this.state = 'guard';
      }
    }
  }

  think(
    nowMs: number,
    targets: readonly AllyTarget<TRouteId>[],
  ): AllyShotIntent | undefined {
    if (!this.isAlive || this.medkitEndsAtMs !== undefined) {
      return undefined;
    }

    const target = selectTarget(this.position, this.routeId, targets);
    if (!target) {
      this.targetId = undefined;
      this.targetAcquiredAtMs = undefined;
      if (this.state === 'engage') {
        this.state = 'guard';
      }
      return undefined;
    }

    if (target.id !== this.targetId) {
      this.targetId = target.id;
      this.targetAcquiredAtMs = nowMs;
      this.state = 'engage';
      return undefined;
    }
    if (
      this.targetAcquiredAtMs === undefined ||
      nowMs - this.targetAcquiredAtMs <
        this.bot.reactionDelaySec * 1000
    ) {
      return undefined;
    }

    const fire = tryFire(this.weapon, this.weaponConfig, nowMs);
    this.weapon = fire.state;
    if (!fire.accepted) {
      if (fire.reason === 'empty_magazine') {
        this.weapon = startReload(
          this.weapon,
          this.weaponConfig,
          nowMs,
        );
      }
      return undefined;
    }

    const distanceM = distanceBetween(this.position, target.position);
    return {
      type: 'shot',
      allyId: this.id,
      targetId: target.id,
      weaponId: this.bot.weapon,
      distanceM,
      accuracy:
        distanceM > this.bot.longRangeThresholdM
          ? this.bot.accuracyLongRange
          : this.bot.accuracy,
    };
  }

  assignRoute(route: RouteLayout<TRouteId>): void {
    if (!this.isAlive || route.routeId === this.routeId) {
      return;
    }

    this.routeId = route.routeId;
    this.guardPosition = route.guardPosition;
    this.targetId = undefined;
    this.targetAcquiredAtMs = undefined;
    this.state = 'reassign';
  }

  takeDamage(damage: number, nowMs: number): boolean {
    if (!this.isAlive || damage <= 0) {
      return false;
    }

    this.hp = Math.max(0, this.hp - damage);
    if (this.hp === 0) {
      this.state = 'dead';
      this.targetId = undefined;
      this.targetAcquiredAtMs = undefined;
      this.medkitEndsAtMs = undefined;
      return true;
    }

    if (
      this.medkitsRemaining > 0 &&
      this.medkitEndsAtMs === undefined &&
      this.hp / this.maxHp < this.bot.medkitAutoUseThreshold
    ) {
      this.medkitsRemaining -= 1;
      this.medkitEndsAtMs =
        nowMs + this.medkitConfig.carriedUseSec * 1000;
    }
    return false;
  }
}

export interface AllyControllerConfig {
  readonly aiUpdateGroups: number;
}

export class AllyController<TRouteId extends string> {
  constructor(
    private readonly config: AllyControllerConfig,
    private readonly allies: readonly AllyAgent<TRouteId>[],
  ) {
    if (
      !Number.isInteger(config.aiUpdateGroups) ||
      config.aiUpdateGroups <= 0
    ) {
      throw new Error('队友 AI 分组数必须是正整数');
    }
  }

  update(
    deltaSec: number,
    tick: number,
    nowMs: number,
    targets: readonly AllyTarget<TRouteId>[],
  ): readonly AllyShotIntent[] {
    for (const ally of this.allies) {
      ally.update(deltaSec, nowMs);
    }

    const shots: AllyShotIntent[] = [];
    const group = tick % this.config.aiUpdateGroups;
    for (
      let index = group;
      index < this.allies.length;
      index += this.config.aiUpdateGroups
    ) {
      const ally = this.allies[index];
      if (!ally) {
        continue;
      }
      const shot = ally.think(nowMs, targets);
      if (shot) {
        shots.push(shot);
      }
    }
    return shots;
  }
}

function selectTarget<TRouteId extends string>(
  position: Vector3,
  routeId: TRouteId,
  targets: readonly AllyTarget<TRouteId>[],
): AllyTarget<TRouteId> | undefined {
  return (
    findNearestTarget(
      position,
      targets.filter(
        (target) => target.alive && target.routeId === routeId,
      ),
    ) ??
    findNearestTarget(
      position,
      targets.filter((target) => target.alive),
    )
  );
}

function findNearestTarget<TRouteId extends string>(
  position: Vector3,
  targets: readonly AllyTarget<TRouteId>[],
): AllyTarget<TRouteId> | undefined {
  let nearest: AllyTarget<TRouteId> | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
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
): boolean {
  const deltaX = target.x - position.x;
  const deltaY = target.y - position.y;
  const deltaZ = target.z - position.z;
  const distance = Math.hypot(deltaX, deltaY, deltaZ);
  if (distance === 0 || distance <= maxDistance) {
    position.x = target.x;
    position.y = target.y;
    position.z = target.z;
    return true;
  }

  const scale = maxDistance / distance;
  position.x += deltaX * scale;
  position.y += deltaY * scale;
  position.z += deltaZ * scale;
  return false;
}

function distanceBetween(first: Vector3, second: Vector3): number {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    first.z - second.z,
  );
}
