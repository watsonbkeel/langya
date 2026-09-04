import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SeededRandom } from '../ai/seeded-random';
import {
  findRepositoryRoot,
  loadProjectConfig,
} from '../config/project-config';
import { WaveScheduler } from './wave-scheduler';

const config = loadProjectConfig(findRepositoryRoot());

function createScheduler(seed = 1): WaveScheduler<
  keyof typeof config.enemies.units,
  keyof typeof config.waves.routes
> {
  return new WaveScheduler(
    {
      waves: config.waves.waves,
      routes: config.waves.routes,
      matchDurationSec: config.waves.matchDurationSec,
      intermissionSec: config.waves.intermissionSec,
      maxAliveEnemies: config.waves.maxAliveEnemies,
    },
    new SeededRandom(seed),
  );
}

describe('WaveScheduler', () => {
  it('按配置发出四波事件并生成 30/50/60/60 的完整计划', () => {
    const scheduler = createScheduler();
    const update = scheduler.update(
      config.waves.matchDurationSec * 1000,
      0,
    );

    assert.deepEqual(
      update.waveStarts.map((wave) => [
        wave.waveIndex,
        wave.enemyCount,
      ]),
      config.waves.waves.map((wave) => [
        wave.index,
        wave.enemyCount,
      ]),
    );
    assert.equal(
      update.enemiesToSpawn.length,
      config.waves.maxAliveEnemies,
    );
    assert.equal(
      scheduler.getProgress(config.waves.matchDurationSec * 1000)
        .totalEnemies,
      config.waves.totalEnemies,
    );
  });

  it('同屏达到上限时保留队列并在释放容量后继续投放', () => {
    const scheduler = createScheduler();
    const elapsedMs = config.waves.matchDurationSec * 1000;

    const blocked = scheduler.update(
      elapsedMs,
      config.waves.maxAliveEnemies,
    );
    assert.equal(blocked.enemiesToSpawn.length, 0);
    assert.equal(
      scheduler.getProgress(elapsedMs).pendingEnemies,
      config.waves.totalEnemies,
    );

    let spawned = 0;
    while (scheduler.getProgress(elapsedMs).pendingEnemies > 0) {
      const update = scheduler.update(elapsedMs, 0);
      assert.equal(
        update.enemiesToSpawn.length <= config.waves.maxAliveEnemies,
        true,
      );
      spawned += update.enemiesToSpawn.length;
    }

    assert.equal(spawned, config.waves.totalEnemies);
    assert.equal(scheduler.getProgress(elapsedMs).pendingEnemies, 0);
  });

  it('按部署、战斗、间歇和结束时间返回阶段', () => {
    const scheduler = createScheduler();
    const firstWave = config.waves.waves[0]!;
    const secondWave = config.waves.waves[1]!;

    assert.equal(scheduler.getProgress(0).phase, 'deploy');
    assert.equal(
      scheduler.getProgress(firstWave.startSec * 1000).phase,
      'wave',
    );
    assert.equal(
      scheduler.getProgress(
        (secondWave.startSec - config.waves.intermissionSec) * 1000,
      ).phase,
      'intermission',
    );
    assert.equal(
      scheduler.getProgress(config.waves.matchDurationSec * 1000)
        .phase,
      'ended',
    );
  });

  it('波次事件只发送一次', () => {
    const scheduler = createScheduler();
    const firstWaveStartMs = config.waves.waves[0]!.startSec * 1000;

    assert.equal(
      scheduler.update(firstWaveStartMs, 0).waveStarts.length,
      1,
    );
    assert.equal(
      scheduler.update(firstWaveStartMs, 0).waveStarts.length,
      0,
    );
  });
});
