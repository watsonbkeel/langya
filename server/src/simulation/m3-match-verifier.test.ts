import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findRepositoryRoot,
  loadProjectConfig,
} from '../config/project-config';
import { verifyM3Match } from './m3-match-verifier';

const config = loadProjectConfig(findRepositoryRoot());

describe('M3 match verifier', () => {
  it('完整调度 200 人并持久化五席战报', () => {
    const result = verifyM3Match(config, 1);

    assert.equal(result.spawnedEnemies, config.waves.totalEnemies);
    assert.equal(result.pendingEnemies, 0);
    assert.equal(
      result.maxAliveEnemies <= config.waves.maxAliveEnemies,
      true,
    );
    assert.equal(result.waveStarts, config.waves.waves.length);
    assert.equal(result.scoreboardEntries, config.allies.seatCount);
    assert.equal(result.reportPersisted, true);
    assert.equal(result.pass, true);
  });
});
