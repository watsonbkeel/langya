import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import weaponsConfig from '../../../shared/config/weapons.json';

import { calculateDamage, type WeaponDamageConfig } from './damage';

const rifle: WeaponDamageConfig = {
  damage: weaponsConfig.player.liaoshi13.damage,
  falloffStartM: weaponsConfig.player.liaoshi13.falloffStartM,
  falloffMultiplier: weaponsConfig.player.liaoshi13.falloffMultiplier,
  hitPartMultiplier: weaponsConfig.hitPartMultiplier,
};

describe('calculateDamage', () => {
  it('按配置计算有效距离内的躯干伤害', () => {
    const result = calculateDamage(rifle, 50, 'torso');

    assert.equal(result.damage, weaponsConfig.player.liaoshi13.damage);
    assert.equal(
      result.hitPartMultiplier,
      weaponsConfig.hitPartMultiplier.torso,
    );
  });

  it('按配置计算爆头与四肢倍率并四舍五入', () => {
    const head = calculateDamage(rifle, 50, 'head');
    const limb = calculateDamage(rifle, 50, 'limb');

    assert.equal(
      head.damage,
      Math.round(
        weaponsConfig.player.liaoshi13.damage *
          weaponsConfig.hitPartMultiplier.head,
      ),
    );
    assert.equal(
      limb.damage,
      Math.round(
        weaponsConfig.player.liaoshi13.damage *
          weaponsConfig.hitPartMultiplier.limb,
      ),
    );
  });

  it('超过衰减起点后应用武器距离衰减', () => {
    const result = calculateDamage(
      rifle,
      weaponsConfig.player.liaoshi13.falloffStartM + 1,
      'torso',
    );

    assert.equal(
      result.damage,
      Math.round(
        weaponsConfig.player.liaoshi13.damage *
          weaponsConfig.player.liaoshi13.falloffMultiplier,
      ),
    );
    assert.equal(
      result.distanceMultiplier,
      weaponsConfig.player.liaoshi13.falloffMultiplier,
    );
  });

  it('衰减起点本身仍使用完整伤害', () => {
    const result = calculateDamage(
      rifle,
      weaponsConfig.player.liaoshi13.falloffStartM,
      'torso',
    );

    assert.equal(result.damage, weaponsConfig.player.liaoshi13.damage);
  });

  it('拒绝负数和非有限距离', () => {
    assert.throws(() => calculateDamage(rifle, -1, 'torso'), RangeError);
    assert.throws(
      () => calculateDamage(rifle, Number.POSITIVE_INFINITY, 'torso'),
      RangeError,
    );
  });
});
