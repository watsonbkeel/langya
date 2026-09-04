import type { Vector3 } from '../../../shared/protocol';

export interface GrenadeConfig {
  readonly damage: number;
  readonly throwRangeM: number;
  readonly blastRadiusM: number;
  readonly falloffCurve: 'linear';
  readonly fuseSec: number;
}

export interface GrenadeTarget {
  readonly id: string;
  readonly position: Vector3;
  readonly hp: number;
  readonly alive: boolean;
}

export interface GrenadeHit {
  readonly targetId: string;
  readonly damage: number;
  readonly isKill: boolean;
}

export function calculateGrenadeImpact(
  origin: Vector3,
  direction: Vector3,
  force: number,
  config: GrenadeConfig,
): Vector3 {
  const distance = config.throwRangeM * force;
  return {
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
    z: origin.z + direction.z * distance,
  };
}

export function resolveGrenadeBlast(
  impactPosition: Vector3,
  targets: readonly GrenadeTarget[],
  config: GrenadeConfig,
): readonly GrenadeHit[] {
  const hits: GrenadeHit[] = [];
  for (const target of targets) {
    if (!target.alive) {
      continue;
    }
    const distance = distanceBetween(impactPosition, target.position);
    if (distance >= config.blastRadiusM) {
      continue;
    }
    const ratio = 1 - distance / config.blastRadiusM;
    const damage = Math.round(config.damage * ratio);
    if (damage <= 0) {
      continue;
    }
    hits.push({
      targetId: target.id,
      damage,
      isKill: damage >= target.hp,
    });
  }
  return hits;
}

function distanceBetween(first: Vector3, second: Vector3): number {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    first.z - second.z,
  );
}
