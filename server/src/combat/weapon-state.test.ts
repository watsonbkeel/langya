import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import weaponsConfig from '../../../shared/config/weapons.json';

import {
  completeReload,
  createWeaponState,
  startReload,
  tryFire,
  type WeaponRuntimeConfig,
} from './weapon-state';

const rifle: WeaponRuntimeConfig = weaponsConfig.player.liaoshi13;

describe('weapon state', () => {
  it('按配置初始化弹匣和备弹', () => {
    const state = createWeaponState(rifle);

    assert.equal(state.magazineAmmo, rifle.magazine);
    assert.equal(state.reserveAmmo, rifle.reserveAmmo);
  });

  it('开火消耗一发并执行射速限制', () => {
    const initial = createWeaponState(rifle);
    const first = tryFire(initial, rifle, 0);

    assert.equal(first.accepted, true);
    assert.equal(first.state.magazineAmmo, rifle.magazine - 1);

    const blocked = tryFire(first.state, rifle, 1);
    assert.equal(blocked.accepted, false);
    if (!blocked.accepted) {
      assert.equal(blocked.reason, 'cooldown');
    }

    const intervalMs = 1000 / rifle.fireRate;
    const next = tryFire(first.state, rifle, intervalMs);
    assert.equal(next.accepted, true);
  });

  it('空弹匣拒绝开火', () => {
    const result = tryFire(
      {
        magazineAmmo: 0,
        reserveAmmo: rifle.reserveAmmo,
      },
      rifle,
      0,
    );

    assert.equal(result.accepted, false);
    if (!result.accepted) {
      assert.equal(result.reason, 'empty_magazine');
    }
  });

  it('换弹计时结束后从备弹补满弹匣', () => {
    const started = startReload(
      {
        magazineAmmo: 1,
        reserveAmmo: rifle.reserveAmmo,
      },
      rifle,
      0,
    );

    assert.equal(started.reloadEndsAtMs, rifle.reloadSec * 1000);
    assert.equal(completeReload(started, rifle, 1), started);

    const completed = completeReload(
      started,
      rifle,
      rifle.reloadSec * 1000,
    );
    assert.equal(completed.magazineAmmo, rifle.magazine);
    assert.equal(
      completed.reserveAmmo,
      rifle.reserveAmmo - (rifle.magazine - 1),
    );
    assert.equal(completed.reloadEndsAtMs, undefined);
  });

  it('换弹期间拒绝开火且备弹不足时只装入剩余弹药', () => {
    const started = startReload(
      {
        magazineAmmo: 0,
        reserveAmmo: 2,
      },
      rifle,
      0,
    );
    const blocked = tryFire(started, rifle, 1);

    assert.equal(blocked.accepted, false);
    if (!blocked.accepted) {
      assert.equal(blocked.reason, 'reloading');
    }

    const completed = completeReload(
      started,
      rifle,
      rifle.reloadSec * 1000,
    );
    assert.equal(completed.magazineAmmo, 2);
    assert.equal(completed.reserveAmmo, 0);
  });
});
