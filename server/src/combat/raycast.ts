import type { HitPart, Vector3 } from '../../../shared/protocol';

export interface EnemyHitboxConfig {
  readonly radiusM: number;
  readonly heightM: number;
  readonly headStartM: number;
  readonly torsoStartM: number;
}

export interface RaycastEnemy {
  readonly id: string;
  readonly position: Vector3;
  readonly alive: boolean;
}

export interface RaycastHit {
  readonly targetId: string;
  readonly distanceM: number;
  readonly hitPart: HitPart;
}

interface AxisInterval {
  readonly near: number;
  readonly far: number;
}

function getAxisInterval(
  origin: number,
  direction: number,
  minimum: number,
  maximum: number,
): AxisInterval | undefined {
  if (direction === 0) {
    return origin >= minimum && origin <= maximum
      ? { near: Number.NEGATIVE_INFINITY, far: Number.POSITIVE_INFINITY }
      : undefined;
  }

  const first = (minimum - origin) / direction;
  const second = (maximum - origin) / direction;
  return {
    near: Math.min(first, second),
    far: Math.max(first, second),
  };
}

function getDirectionLength(direction: Vector3): number {
  return Math.hypot(direction.x, direction.y, direction.z);
}

function getHitPart(
  impactHeightM: number,
  hitbox: EnemyHitboxConfig,
): HitPart {
  if (impactHeightM >= hitbox.headStartM) {
    return 'head';
  }
  if (impactHeightM >= hitbox.torsoStartM) {
    return 'torso';
  }
  return 'limb';
}

function raycastEnemy(
  origin: Vector3,
  direction: Vector3,
  directionLength: number,
  enemy: RaycastEnemy,
  hitbox: EnemyHitboxConfig,
): RaycastHit | undefined {
  // M1 使用竖直包围盒：position 表示敌人脚底中心，命中高度决定部位。
  const intervals = [
    getAxisInterval(
      origin.x,
      direction.x,
      enemy.position.x - hitbox.radiusM,
      enemy.position.x + hitbox.radiusM,
    ),
    getAxisInterval(
      origin.y,
      direction.y,
      enemy.position.y,
      enemy.position.y + hitbox.heightM,
    ),
    getAxisInterval(
      origin.z,
      direction.z,
      enemy.position.z - hitbox.radiusM,
      enemy.position.z + hitbox.radiusM,
    ),
  ];

  if (intervals.some((interval) => interval === undefined)) {
    return undefined;
  }

  let near = Number.NEGATIVE_INFINITY;
  let far = Number.POSITIVE_INFINITY;
  for (const interval of intervals) {
    if (!interval) {
      return undefined;
    }
    near = Math.max(near, interval.near);
    far = Math.min(far, interval.far);
  }

  if (far < 0 || near > far) {
    return undefined;
  }

  const rayParameter = near >= 0 ? near : far;
  const impactHeightM =
    origin.y + direction.y * rayParameter - enemy.position.y;

  return {
    targetId: enemy.id,
    distanceM: rayParameter * directionLength,
    hitPart: getHitPart(impactHeightM, hitbox),
  };
}

export function raycastNearestEnemy(
  origin: Vector3,
  direction: Vector3,
  enemies: readonly RaycastEnemy[],
  hitbox: EnemyHitboxConfig,
): RaycastHit | undefined {
  const directionLength = getDirectionLength(direction);
  if (!Number.isFinite(directionLength) || directionLength === 0) {
    return undefined;
  }

  let nearest: RaycastHit | undefined;
  for (const enemy of enemies) {
    if (!enemy.alive) {
      continue;
    }

    const hit = raycastEnemy(
      origin,
      direction,
      directionLength,
      enemy,
      hitbox,
    );
    if (hit && (!nearest || hit.distanceM < nearest.distanceM)) {
      nearest = hit;
    }
  }

  return nearest;
}
