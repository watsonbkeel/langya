import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import enemiesConfig from '../../../../shared/config/enemies.json';
import weaponsConfig from '../../../../shared/config/weapons.json';

import {
  EnemyAgent,
  EnemyController,
  type EnemyTarget,
} from './enemy-controller';

const route = {
  routeId: 'A',
  spawnPosition: { x: 0, y: 0, z: -20 },
  guardPosition: { x: 0, y: 0, z: 0 },
} as const;
const target: EnemyTarget = {
  id: 'ally-1',
  position: { x: 0, y: 0, z: 0 },
  alive: true,
};

function createRifleman(id = 'enemy-1'): EnemyAgent<'A'> {
  return new EnemyAgent({
    id,
    enemyType: 'rifleman',
    route,
    spawnOffset: { x: 0, y: 0, z: 0 },
    behavior: enemiesConfig.units.rifleman,
    shared: enemiesConfig.sharedRules,
    weapon: weaponsConfig.enemy.type38,
    spawnedAtMs: 0,
  });
}

describe('EnemyAgent', () => {
  it('推进状态每 tick 沿预设路线移动', () => {
    const enemy = createRifleman();

    enemy.updateMovement(1);

    assert.equal(enemy.state, 'advance');
    assert.equal(
      enemy.position.z,
      route.spawnPosition.z + enemiesConfig.units.rifleman.moveSpeed,
    );
  });

  it('先发送开火预警，预警结束后才输出攻击意图', () => {
    const enemy = createRifleman();
    const engageAtMs = enemiesConfig.units.rifleman.advanceSec * 1000;
    const warning = enemy.think(engageAtMs, [target]);

    assert.equal(warning?.type, 'fire_warning');
    assert.equal(
      warning?.firesAtMs,
      engageAtMs + enemiesConfig.sharedRules.fireWarningSec * 1000,
    );
    assert.equal(
      enemy.resolvePendingAttack(warning?.firesAtMs ?? 0, [target])
        ?.type,
      'shot',
    );
  });

  it('目标超出最大射程时继续推进且不发出预警', () => {
    const enemy = createRifleman();
    const distantTarget: EnemyTarget = {
      ...target,
      position: {
        x: 0,
        y: 0,
        z:
          route.spawnPosition.z +
          enemiesConfig.sharedRules.maxEngageRangeM +
          1,
      },
    };

    assert.equal(
      enemy.think(
        enemiesConfig.units.rifleman.advanceSec * 1000,
        [distantTarget],
      ),
      undefined,
    );
    assert.equal(enemy.state, 'advance');
  });
});

describe('EnemyController', () => {
  it('所有敌人持续移动，但每 tick 只有一个决策分组', () => {
    const enemies = Array.from(
      { length: enemiesConfig.performance.aiUpdateGroups },
      (_, index) => createRifleman(`enemy-${index}`),
    );
    const controller = new EnemyController(
      enemiesConfig.performance,
      enemies,
    );
    const decisionAtMs =
      enemiesConfig.units.rifleman.advanceSec * 1000;
    const events = controller.update(1, 0, decisionAtMs, [target]);

    assert.equal(
      enemies.every(
        (enemy) =>
          enemy.position.z ===
          route.spawnPosition.z +
            enemiesConfig.units.rifleman.moveSpeed,
      ),
      true,
    );
    assert.equal(
      events.filter((event) => event.type === 'fire_warning').length,
      1,
    );
  });
});
