import type { HitPart } from '../../../shared/protocol';

export interface WeaponDamageConfig {
  readonly damage: number;
  readonly falloffStartM: number;
  readonly falloffMultiplier: number;
  readonly hitPartMultiplier: Readonly<Record<HitPart, number>>;
}

export interface DamageResult {
  readonly damage: number;
  readonly distanceMultiplier: number;
  readonly hitPartMultiplier: number;
}

export function calculateDamage(
  weapon: WeaponDamageConfig,
  distanceM: number,
  hitPart: HitPart,
): DamageResult {
  if (!Number.isFinite(distanceM) || distanceM < 0) {
    throw new RangeError('射击距离必须是非负有限数');
  }

  const distanceMultiplier =
    distanceM > weapon.falloffStartM ? weapon.falloffMultiplier : 1;
  const hitPartMultiplier = weapon.hitPartMultiplier[hitPart];

  return {
    damage: Math.round(
      weapon.damage * distanceMultiplier * hitPartMultiplier,
    ),
    distanceMultiplier,
    hitPartMultiplier,
  };
}
