import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import gameplayConfig from '../../../shared/config/gameplay.json';
import weaponsConfig from '../../../shared/config/weapons.json';

import {
  BattleSession,
  type BattleSessionConfig,
} from './battle-session';

const config: BattleSessionConfig = {
  player: {
    maxHp: gameplayConfig.player.maxHp,
    moveSpeed: gameplayConfig.player.moveSpeed,
    crouchSpeed: gameplayConfig.player.crouchSpeed,
    aimPitchMinDeg: gameplayConfig.player.aimPitchMinDeg,
    aimPitchMaxDeg: gameplayConfig.player.aimPitchMaxDeg,
  },
  arena: {
    widthM: gameplayConfig.arena.widthM,
    depthM: gameplayConfig.arena.depthM,
  },
  validation: {
    fireOriginToleranceM: gameplayConfig.combat.fireOriginToleranceM,
    directionMagnitudeTolerance:
      gameplayConfig.combat.directionMagnitudeTolerance,
  },
  weapon: {
    weaponId: 'liaoshi13',
    ...weaponsConfig.player.liaoshi13,
  },
  hitPartMultiplier: weaponsConfig.hitPartMultiplier,
  enemyHitbox: {
    radiusM: gameplayConfig.combat.enemyHitboxRadiusM,
    heightM: gameplayConfig.combat.enemyHitboxHeightM,
    headStartM: gameplayConfig.combat.headHitboxStartM,
    torsoStartM: gameplayConfig.combat.torsoHitboxStartM,
  },
};

function createSession(enemyHp = 100): BattleSession {
  return new BattleSession({
    playerId: 'player-1',
    playerPosition: { x: 0, y: 1, z: 0 },
    enemy: {
      id: 'enemy-1',
      enemyType: 'rifleman',
      hp: enemyHp,
      position: { x: 0, y: 0, z: -10 },
    },
    config,
  });
}

describe('BattleSession', () => {
  it('把本地移动方向按 aimYaw 转成世界方向并限制在阵地内', () => {
    const session = createSession();
    const accepted = session.applyInput({
      type: 'input_state',
      payload: {
        clientTick: 0,
        moveDir: { x: 0, y: 1 },
        aimYaw: 0,
        aimPitch: 0,
        isCrouch: false,
      },
    });

    session.update(1, 0);
    const snapshot = session.createSnapshot(1, 0);

    assert.equal(accepted, true);
    assert.equal(
      snapshot.payload.allies[0]?.position.z,
      -gameplayConfig.player.moveSpeed,
    );

    session.update(100, 0);
    const clamped = session.createSnapshot(2, 0);
    assert.equal(
      clamped.payload.allies[0]?.position.z,
      -gameplayConfig.arena.depthM / 2,
    );
  });

  it('拒绝超出俯仰范围的输入', () => {
    const session = createSession();

    const accepted = session.applyInput({
      type: 'input_state',
      payload: {
        clientTick: 0,
        moveDir: { x: 0, y: 0 },
        aimYaw: 0,
        aimPitch: config.player.aimPitchMaxDeg + 1,
        isCrouch: false,
      },
    });

    assert.equal(accepted, false);
  });

  it('由服务端射线裁决命中、扣血和死亡移除', () => {
    const session = createSession(
      weaponsConfig.player.liaoshi13.damage,
    );
    const resolution = session.fire(
      {
        type: 'fire',
        payload: {
          weaponId: 'liaoshi13',
          originPos: { x: 0, y: 1, z: 0 },
          dirVec: { x: 0, y: 0, z: -1 },
          clientTick: 1,
        },
      },
      0,
    );

    assert.equal(resolution.result.payload.accepted, true);
    assert.equal(resolution.result.payload.hit, true);
    if (resolution.result.payload.hit) {
      assert.equal(resolution.result.payload.targetId, 'enemy-1');
      assert.equal(resolution.result.payload.hitPart, 'torso');
      assert.equal(resolution.result.payload.isKill, true);
    }
    assert.equal(resolution.death?.payload.enemyId, 'enemy-1');
    assert.equal(
      session.createSnapshot(1, 0).payload.enemies.length,
      0,
    );
  });

  it('拒绝超出容差的原点和非单位方向且不消耗弹药', () => {
    const session = createSession();
    const invalidOrigin = session.fire(
      {
        type: 'fire',
        payload: {
          weaponId: 'liaoshi13',
          originPos: {
            x: config.validation.fireOriginToleranceM + 1,
            y: 1,
            z: 0,
          },
          dirVec: { x: 0, y: 0, z: -1 },
          clientTick: 1,
        },
      },
      0,
    );
    const invalidDirection = session.fire(
      {
        type: 'fire',
        payload: {
          weaponId: 'liaoshi13',
          originPos: { x: 0, y: 1, z: 0 },
          dirVec: { x: 0, y: 0, z: -2 },
          clientTick: 2,
        },
      },
      0,
    );

    assert.equal(invalidOrigin.result.payload.accepted, false);
    if (!invalidOrigin.result.payload.accepted) {
      assert.equal(
        invalidOrigin.result.payload.rejectReason,
        'invalid_origin',
      );
    }
    assert.equal(invalidDirection.result.payload.accepted, false);
    if (!invalidDirection.result.payload.accepted) {
      assert.equal(
        invalidDirection.result.payload.rejectReason,
        'invalid_direction',
      );
    }
    assert.equal(
      invalidDirection.result.payload.magazineAmmo,
      weaponsConfig.player.liaoshi13.magazine,
    );
  });

  it('同步权威弹药并在换弹结束后补充弹匣', () => {
    const session = createSession();
    const first = session.fire(
      {
        type: 'fire',
        payload: {
          weaponId: 'liaoshi13',
          originPos: { x: 0, y: 1, z: 0 },
          dirVec: { x: 1, y: 0, z: 0 },
          clientTick: 1,
        },
      },
      0,
    );
    session.reload({
      type: 'reload',
      payload: { weaponId: 'liaoshi13' },
    }, 0);

    const reloading = session.createSnapshot(1, 0);
    session.update(0, weaponsConfig.player.liaoshi13.reloadSec * 1000);
    const completed = session.createSnapshot(
      2,
      weaponsConfig.player.liaoshi13.reloadSec * 1000,
    );

    assert.equal(first.result.payload.magazineAmmo, config.weapon.magazine - 1);
    assert.equal(reloading.payload.allies[0]?.weapon.isReloading, true);
    assert.equal(
      completed.payload.allies[0]?.weapon.magazineAmmo,
      config.weapon.magazine,
    );
    assert.equal(completed.payload.allies[0]?.weapon.isReloading, false);
  });
});
