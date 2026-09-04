import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  raycastNearestEnemy,
  type EnemyHitboxConfig,
  type RaycastEnemy,
} from './raycast';

const hitbox: EnemyHitboxConfig = {
  radiusM: 0.5,
  heightM: 2,
  headStartM: 1.5,
  torsoStartM: 0.5,
};

const nearEnemy: RaycastEnemy = {
  id: 'near',
  position: { x: 0, y: 0, z: -10 },
  alive: true,
};

const farEnemy: RaycastEnemy = {
  id: 'far',
  position: { x: 0, y: 0, z: -20 },
  alive: true,
};

const enemies: readonly RaycastEnemy[] = [nearEnemy, farEnemy];

describe('raycastNearestEnemy', () => {
  it('返回射线方向上最近的存活敌人', () => {
    const hit = raycastNearestEnemy(
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: -1 },
      enemies,
      hitbox,
    );

    assert.equal(hit?.targetId, 'near');
    assert.equal(hit?.hitPart, 'torso');
  });

  it('按交点高度区分头部、躯干和四肢', () => {
    const head = raycastNearestEnemy(
      { x: 0, y: 1.75, z: 0 },
      { x: 0, y: 0, z: -1 },
      enemies,
      hitbox,
    );
    const torso = raycastNearestEnemy(
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: -1 },
      enemies,
      hitbox,
    );
    const limb = raycastNearestEnemy(
      { x: 0, y: 0.25, z: 0 },
      { x: 0, y: 0, z: -1 },
      enemies,
      hitbox,
    );

    assert.equal(head?.hitPart, 'head');
    assert.equal(torso?.hitPart, 'torso');
    assert.equal(limb?.hitPart, 'limb');
  });

  it('忽略已死亡敌人并允许非单位方向向量', () => {
    const hit = raycastNearestEnemy(
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: -2 },
      [
        { ...nearEnemy, alive: false },
        farEnemy,
      ],
      hitbox,
    );

    assert.equal(hit?.targetId, 'far');
    assert.equal(hit?.distanceM, 19.5);
  });

  it('射线偏离或方向为零时不命中', () => {
    const miss = raycastNearestEnemy(
      { x: 2, y: 1, z: 0 },
      { x: 0, y: 0, z: -1 },
      enemies,
      hitbox,
    );
    const zeroDirection = raycastNearestEnemy(
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 0 },
      enemies,
      hitbox,
    );

    assert.equal(miss, undefined);
    assert.equal(zeroDirection, undefined);
  });
});
