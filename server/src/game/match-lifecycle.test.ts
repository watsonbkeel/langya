import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { determineMatchEnd } from './match-lifecycle';

const baseInput = {
  elapsedSec: 300,
  durationSec: 300,
  allowOvertimeSpawn: true,
  pendingEnemyCount: 0,
  playerAlive: true,
  aliveDefenderCount: 5,
} as const;

describe('determineMatchEnd', () => {
  it('玩家存活到时限后胜利', () => {
    assert.deepEqual(determineMatchEnd(baseInput), {
      result: 'victory',
      reason: 'time_survived',
    });
  });

  it('玩家阵亡但仍有队友时持续到时限再失败', () => {
    assert.equal(
      determineMatchEnd({
        ...baseInput,
        elapsedSec: 120,
        playerAlive: false,
        aliveDefenderCount: 4,
      }),
      undefined,
    );
    assert.deepEqual(
      determineMatchEnd({
        ...baseInput,
        playerAlive: false,
        aliveDefenderCount: 4,
      }),
      {
        result: 'defeat',
        reason: 'player_died',
      },
    );
  });

  it('五名成员全部阵亡时立即失败', () => {
    assert.deepEqual(
      determineMatchEnd({
        ...baseInput,
        elapsedSec: 120,
        playerAlive: false,
        aliveDefenderCount: 0,
      }),
      {
        result: 'defeat',
        reason: 'squad_eliminated',
      },
    );
  });

  it('允许延迟投放时等待排队敌人全部进入战场', () => {
    assert.equal(
      determineMatchEnd({
        ...baseInput,
        pendingEnemyCount: 1,
      }),
      undefined,
    );
    assert.deepEqual(
      determineMatchEnd({
        ...baseInput,
        allowOvertimeSpawn: false,
        pendingEnemyCount: 1,
      }),
      {
        result: 'victory',
        reason: 'time_survived',
      },
    );
  });
});
