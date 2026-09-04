import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import weaponsConfig from '../../../shared/config/weapons.json';
import { PlayerWeaponInventory } from './player-weapon-inventory';

const weapons = {
  liaoshi13: {
    weaponId: 'liaoshi13',
    ...weaponsConfig.player.liaoshi13,
  },
  zb26: {
    weaponId: 'zb26',
    ...weaponsConfig.player.zb26,
  },
};

describe('PlayerWeaponInventory', () => {
  it('初始只持有默认武器，拾取后才能切换', () => {
    const inventory = new PlayerWeaponInventory(
      weapons,
      'liaoshi13',
    );

    assert.deepEqual(inventory.availableWeaponIds, ['liaoshi13']);
    assert.equal(inventory.switchTo('zb26'), 'unavailable');
    assert.equal(inventory.pickup('zb26'), undefined);
    assert.equal(inventory.switchTo('zb26'), undefined);
    assert.equal(inventory.currentWeaponId, 'zb26');
    assert.equal(
      inventory.toProtocolState().magazineAmmo,
      weaponsConfig.player.zb26.magazine,
    );
  });

  it('每把武器独立保存弹药和换弹状态', () => {
    const inventory = new PlayerWeaponInventory(
      weapons,
      'liaoshi13',
    );
    const fired = inventory.fire('liaoshi13', 0);
    assert.equal(fired.accepted, true);
    inventory.pickup('zb26');
    inventory.switchTo('zb26');
    inventory.fire('zb26', 0);
    inventory.switchTo('liaoshi13');

    assert.equal(
      inventory.toProtocolState().magazineAmmo,
      weaponsConfig.player.liaoshi13.magazine - 1,
    );
  });

  it('拒绝伪造非当前武器开火且不消耗弹药', () => {
    const inventory = new PlayerWeaponInventory(
      weapons,
      'liaoshi13',
    );
    inventory.pickup('zb26');

    assert.equal(inventory.fire('zb26', 0).accepted, false);
    assert.equal(
      inventory.toProtocolState().magazineAmmo,
      weaponsConfig.player.liaoshi13.magazine,
    );
  });
});
