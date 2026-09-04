import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  MatchReportRepository,
  type MatchReport,
} from './match-report-repository';

const report: MatchReport = {
  matchId: 'match-1',
  result: 'victory',
  reason: 'time_survived',
  startedAtMs: 1_000,
  endedAtMs: 301_000,
  scoreboard: [
    {
      occupantId: 'player-1',
      seatIndex: 0,
      heroName: '马宝玉',
      displayName: '测试玩家',
      isBot: false,
      alive: true,
      kills: 120,
      mgKills: 20,
      headshots: 30,
      shotsFired: 200,
      shotsHit: 140,
      accuracy: 0.7,
      survivalSec: 300,
      damageDealt: 6_000,
      damageTaken: 80,
      medkitUsed: 2,
      killsByWave: [20, 30, 35, 35],
    },
  ],
  mvpPlayerId: 'player-1',
  spawnedEnemies: 200,
  defeatedEnemies: 200,
  totalEnemies: 200,
};

describe('MatchReportRepository', () => {
  it('事务写入并按席位读回完整战报', () => {
    const directory = mkdtempSync(join(tmpdir(), 'langya-report-'));
    const repository = new MatchReportRepository(
      join(directory, 'matches.sqlite'),
    );
    try {
      repository.save(report);
      assert.deepEqual(repository.find(report.matchId), report);
      assert.equal(repository.find('missing'), undefined);
    } finally {
      repository.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('重复保存同一对局时替换结论和席位数据', () => {
    const directory = mkdtempSync(join(tmpdir(), 'langya-report-'));
    const repository = new MatchReportRepository(
      join(directory, 'matches.sqlite'),
    );
    try {
      repository.save(report);
      repository.save({
        matchId: report.matchId,
        result: 'defeat',
        reason: 'player_died',
        startedAtMs: report.startedAtMs,
        endedAtMs: report.endedAtMs,
        scoreboard: [],
        spawnedEnemies: report.spawnedEnemies,
        defeatedEnemies: report.defeatedEnemies,
        totalEnemies: report.totalEnemies,
      });

      const saved = repository.find(report.matchId);
      assert.ok(saved);
      assert.equal(saved.result, 'defeat');
      assert.equal(saved.reason, 'player_died');
      assert.deepEqual(saved.scoreboard, []);
      assert.equal(saved.mvpPlayerId, undefined);
    } finally {
      repository.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
