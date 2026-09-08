import type { Vector3 } from '../../../../shared/protocol';

/**
 * 掉线托管 AI（PRD 7.3）。
 *
 * 与 AllyAgent 的区别：AI 队友自己持有血量、武器与背包，
 * 而托管接手的是「真人席位本身」—— 血量、弹药、背包、战绩都还是那个人的，
 * 这里只负责替他做「往哪走、打谁、什么时候扣扳机」的决策。
 * 这样人回来时把托管一关，状态原样接回去，不需要做任何数据搬迁。
 */
export interface AutopilotConfig {
  /** 锁定目标后的反应延迟，与 AI 队友同源（allies.json）。 */
  readonly reactionDelaySec: number;
  readonly accuracy: number;
  readonly accuracyLongRange: number;
  readonly longRangeThresholdM: number;
  readonly moveSpeed: number;
  /** 血量低于该比例自动用随身血包。 */
  readonly medkitAutoUseThreshold: number;
}

export interface AutopilotTarget<TRouteId extends string> {
  readonly id: string;
  readonly routeId: TRouteId;
  readonly position: Vector3;
  readonly alive: boolean;
}

/** 托管做出的开火决策，命中判定仍由战斗会话统一裁决。 */
export interface AutopilotShotIntent {
  readonly targetId: string;
  readonly targetPosition: Vector3;
  readonly distanceM: number;
  readonly accuracy: number;
}

export class AutopilotBrain<TRouteId extends string> {
  private targetId: string | undefined;
  private targetAcquiredAtMs: number | undefined;

  constructor(private readonly config: AutopilotConfig) {}

  /** 当前锁定的目标，仅供快照里对准朝向。 */
  get lockedTargetId(): string | undefined {
    return this.targetId;
  }

  /** 人回来了，清掉托管期间的目标记忆，避免下次托管沿用旧目标。 */
  reset(): void {
    this.targetId = undefined;
    this.targetAcquiredAtMs = undefined;
  }

  /**
   * 决定这一 tick 是否开火。
   * 返回 undefined 表示「不打」：可能没目标，也可能还在反应延迟内。
   */
  think(
    nowMs: number,
    position: Vector3,
    routeId: TRouteId,
    targets: readonly AutopilotTarget<TRouteId>[],
  ): AutopilotShotIntent | undefined {
    const currentTarget =
      this.targetId === undefined
        ? undefined
        : targets.find(
            (candidate) =>
              candidate.id === this.targetId && candidate.alive,
          );
    const target =
      currentTarget ?? selectTarget(position, routeId, targets);
    if (!target) {
      this.targetId = undefined;
      this.targetAcquiredAtMs = undefined;
      return undefined;
    }

    // 换靶时先记时间，下一 tick 起才允许开火，模拟人的反应延迟。
    if (target.id !== this.targetId) {
      this.targetId = target.id;
      this.targetAcquiredAtMs = nowMs;
      return undefined;
    }
    if (
      this.targetAcquiredAtMs === undefined ||
      nowMs - this.targetAcquiredAtMs <
        this.config.reactionDelaySec * 1000
    ) {
      return undefined;
    }

    const distanceM = distanceBetween(position, target.position);
    return {
      targetId: target.id,
      targetPosition: target.position,
      distanceM,
      accuracy:
        distanceM > this.config.longRangeThresholdM
          ? this.config.accuracyLongRange
          : this.config.accuracy,
    };
  }

  /** 该不该用随身血包。 */
  shouldUseMedkit(hp: number, maxHp: number): boolean {
    if (maxHp <= 0) {
      return false;
    }
    return hp / maxHp < this.config.medkitAutoUseThreshold;
  }

  /** 托管期间往防守位靠拢，一 tick 最多走这么远。 */
  stepTowardGuard(
    position: Vector3,
    guardPosition: Vector3,
    deltaSec: number,
  ): Vector3 {
    return moveToward(
      position,
      guardPosition,
      this.config.moveSpeed * deltaSec,
    );
  }
}

function selectTarget<TRouteId extends string>(
  position: Vector3,
  routeId: TRouteId,
  targets: readonly AutopilotTarget<TRouteId>[],
): AutopilotTarget<TRouteId> | undefined {
  // 先守自己那条路，本路清空了才去支援别的路，与 AI 队友选靶口径一致。
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
  targets: readonly AutopilotTarget<TRouteId>[],
): AutopilotTarget<TRouteId> | undefined {
  let nearest: AutopilotTarget<TRouteId> | undefined;
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
  position: Vector3,
  target: Vector3,
  maxDistance: number,
): Vector3 {
  const deltaX = target.x - position.x;
  const deltaZ = target.z - position.z;
  const distance = Math.hypot(deltaX, deltaZ);
  if (distance === 0 || distance <= maxDistance) {
    return { x: target.x, y: position.y, z: target.z };
  }
  const scale = maxDistance / distance;
  return {
    x: position.x + deltaX * scale,
    y: position.y,
    z: position.z + deltaZ * scale,
  };
}

function distanceBetween(first: Vector3, second: Vector3): number {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    first.z - second.z,
  );
}
