import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findRepositoryRoot,
  loadProjectConfig,
} from '../config/project-config';
import { SeededRandom } from '../ai/seeded-random';
import {
  simulateM2Match,
} from './m2-match-simulator';
import { createEnemySpawnPlan } from '../wave/enemy-spawn-plan';

const config = loadProjectConfig(findRepositoryRoot());

describe('M2 match simulator', () => {
  it('按配置生成四波共 200 名敌人的可复现投放计划', () => {
    const first = createEnemySpawnPlan(
      config.waves,
      new SeededRandom(9),
    );
    const second = createEnemySpawnPlan(
      config.waves,
      new SeededRandom(9),
    );

    assert.deepEqual(first, second);
    assert.equal(first.length, config.waves.totalEnemies);
    for (const wave of config.waves.waves) {
      assert.equal(
        first.filter(
          (enemy) =>
            enemy.spawnAtMs >= wave.startSec * 1000 &&
            enemy.spawnAtMs <=
              (wave.startSec +
                Math.floor((wave.enemyCount - 1) / wave.squadSize) *
                  wave.squadIntervalSec) *
                1000,
        ).length,
        wave.enemyCount,
      );
    }
  });

  it('完整模拟复用 M2 战斗会话并遵守同屏上限', () => {
    const result = simulateM2Match(config, 11);

    assert.equal(
      result.ticks,
      config.waves.matchDurationSec *
        config.gameplay.server.tickRateHz,
    );
    assert.equal(
      result.enemiesSpawned <= config.waves.totalEnemies,
      true,
    );
    assert.equal(
      result.maxAliveEnemies <= config.waves.maxAliveEnemies,
      true,
    );
    assert.equal(result.allyKills.length, config.allies.seatCount - 1);
    assert.equal(
      result.allySurvivalSec.every(
        (survivalSec) =>
          survivalSec >= 0 &&
          survivalSec <= config.waves.matchDurationSec,
      ),
      true,
    );
  });
});
