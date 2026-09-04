import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import weaponsConfig from '../../../shared/config/weapons.json';
import { MachineGunController } from './machine-gun-controller';

const config = {
  weaponId: 'type92-hmg',
  ...weaponsConfig.emplacement['type92-hmg'],
};
const placements = [
  {
    id: 'mg-1',
    position: { x: 0, y: 0, z: 0 },
    baseYaw: 0,
  },
  {
    id: 'mg-2',
    position: { x: 10, y: 0, z: 0 },
    baseYaw: 0,
  },
];

describe('MachineGunController', () => {
  it('校验距离与占用并允许原占用者下枪', () => {
    const controller = new MachineGunController(config, placements);
    assert.equal(
      controller.mount(
        'mg-1',
        'player-1',
        false,
        { x: 3, y: 0, z: 0 },
        2,
      ),
      'out_of_range',
    );
    assert.equal(
      controller.mount(
        'mg-1',
        'player-1',
        false,
        { x: 0, y: 0, z: 0 },
        2,
      ),
      undefined,
    );
    assert.equal(
      controller.mount(
        'mg-1',
        'player-2',
        false,
        { x: 0, y: 0, z: 0 },
        2,
      ),
      'occupied',
    );
    assert.equal(controller.unmount('player-1'), undefined);
  });

  it('限制射界并按连续射击时长进入强制冷却', () => {
    const controller = new MachineGunController(config, placements);
    controller.mount(
      'mg-1',
      'player-1',
      false,
      { x: 0, y: 0, z: 0 },
      2,
    );
    assert.equal(
      controller.fire(
        'player-1',
        config.weaponId,
        config.yawLimitDeg + 1,
        0,
        0,
      ).accepted,
      false,
    );

    const intervalMs = Math.ceil(1000 / config.fireRate);
    let nowMs = 0;
    let acceptedShots = 0;
    while (!controller.getStates()[0]!.isOverheated) {
      const result = controller.fire(
        'player-1',
        config.weaponId,
        0,
        0,
        nowMs,
      );
      if (result.accepted) {
        acceptedShots += 1;
      }
      nowMs += intervalMs;
    }

    assert.equal(
      acceptedShots >=
        Math.floor(config.fireRate * config.overheatSec),
      true,
    );
    assert.equal(
      controller.fire(
        'player-1',
        config.weaponId,
        0,
        0,
        nowMs,
      ).accepted,
      false,
    );
    controller.update(nowMs + config.cooldownSec * 1000);
    assert.equal(controller.getStates()[0]!.isOverheated, false);
  });

  it('拒绝 AI 占枪并在停止射击后降低热量', () => {
    const controller = new MachineGunController(config, placements);
    assert.equal(
      controller.mount(
        'mg-1',
        'ally-1',
        true,
        { x: 0, y: 0, z: 0 },
        2,
      ),
      'invalid_state',
    );
    assert.equal(
      controller.mount(
        'mg-1',
        'player-1',
        false,
        { x: 0, y: 0, z: 0 },
        2,
      ),
      undefined,
    );
    assert.equal(
      controller.fire('player-1', config.weaponId, 0, 0, 0).accepted,
      true,
    );
    const heatAfterShot = controller.getStates()[0]!.heatRatio;
    controller.update(config.cooldownSec * 1000);
    assert.equal(
      controller.getStates()[0]!.heatRatio < heatAfterShot,
      true,
    );
  });

  it('弹链耗尽后按配置时间自动装填', () => {
    const controller = new MachineGunController(config, placements);
    assert.equal(
      controller.mount(
        'mg-1',
        'player-1',
        false,
        { x: 0, y: 0, z: 0 },
        2,
      ),
      undefined,
    );

    const intervalMs = Math.ceil(1000 / config.fireRate);
    let nowMs = 0;
    while (controller.getStates()[0]!.beltAmmo > 0) {
      const result = controller.fire(
        'player-1',
        config.weaponId,
        0,
        0,
        nowMs,
      );
      if (!result.accepted && result.reason === 'cooldown') {
        const cooldownEndsAtMs =
          controller.getStates()[0]!.cooldownEndsAtMs;
        assert.ok(cooldownEndsAtMs);
        nowMs = cooldownEndsAtMs;
        controller.update(nowMs);
        continue;
      }
      assert.equal(result.accepted, true);
      nowMs += intervalMs;
    }

    const emptyState = controller.getStates()[0]!;
    assert.ok(emptyState.reloadEndsAtMs);
    const rejected = controller.fire(
      'player-1',
      config.weaponId,
      0,
      0,
      nowMs,
    );
    assert.equal(rejected.accepted, false);
    if (!rejected.accepted) {
      assert.equal(rejected.reason, 'reloading');
    }
    controller.update(emptyState.reloadEndsAtMs);
    assert.equal(
      controller.getStates()[0]!.beltAmmo,
      config.beltCapacity,
    );
  });
});
