import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  MatchEndReason,
  MatchResult,
  ScoreboardEntry,
} from '../../../shared/protocol';

export interface MatchReport {
  readonly matchId: string;
  readonly result: MatchResult;
  readonly reason: MatchEndReason;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly scoreboard: readonly ScoreboardEntry[];
  readonly mvpPlayerId?: string;
  readonly spawnedEnemies: number;
  readonly defeatedEnemies: number;
  readonly totalEnemies: number;
}

interface MatchRow {
  readonly match_id: string;
  readonly result: MatchResult;
  readonly reason: MatchEndReason;
  readonly started_at_ms: number;
  readonly ended_at_ms: number;
  readonly mvp_player_id: string | null;
  readonly spawned_enemies: number;
  readonly defeated_enemies: number;
  readonly total_enemies: number;
}

interface ScoreRow {
  readonly occupant_id: string;
  readonly seat_index: number;
  readonly hero_name: string;
  readonly display_name: string;
  readonly is_bot: number;
  readonly alive: number;
  readonly kills: number;
  readonly mg_kills: number;
  readonly headshots: number;
  readonly shots_fired: number;
  readonly shots_hit: number;
  readonly accuracy: number;
  readonly survival_sec: number;
  readonly damage_dealt: number;
  readonly damage_taken: number;
  readonly medkit_used: number;
  readonly kills_by_wave_json: string;
}

export class MatchReportRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS match_reports (
        match_id TEXT PRIMARY KEY,
        result TEXT NOT NULL,
        reason TEXT NOT NULL,
        started_at_ms INTEGER NOT NULL,
        ended_at_ms INTEGER NOT NULL,
        mvp_player_id TEXT,
        spawned_enemies INTEGER NOT NULL,
        defeated_enemies INTEGER NOT NULL,
        total_enemies INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS match_scores (
        match_id TEXT NOT NULL,
        occupant_id TEXT NOT NULL,
        seat_index INTEGER NOT NULL,
        hero_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        is_bot INTEGER NOT NULL,
        alive INTEGER NOT NULL,
        kills INTEGER NOT NULL,
        mg_kills INTEGER NOT NULL,
        headshots INTEGER NOT NULL,
        shots_fired INTEGER NOT NULL,
        shots_hit INTEGER NOT NULL,
        accuracy REAL NOT NULL,
        survival_sec REAL NOT NULL,
        damage_dealt INTEGER NOT NULL,
        damage_taken INTEGER NOT NULL,
        medkit_used INTEGER NOT NULL,
        kills_by_wave_json TEXT NOT NULL,
        PRIMARY KEY (match_id, occupant_id),
        FOREIGN KEY (match_id)
          REFERENCES match_reports(match_id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS match_reports_ended_at
        ON match_reports(ended_at_ms DESC);
    `);
  }

  save(report: MatchReport): void {
    const insertMatch = this.database.prepare(`
      INSERT OR REPLACE INTO match_reports (
        match_id,
        result,
        reason,
        started_at_ms,
        ended_at_ms,
        mvp_player_id,
        spawned_enemies,
        defeated_enemies,
        total_enemies
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteScores = this.database.prepare(
      'DELETE FROM match_scores WHERE match_id = ?',
    );
    const insertScore = this.database.prepare(`
      INSERT INTO match_scores (
        match_id,
        occupant_id,
        seat_index,
        hero_name,
        display_name,
        is_bot,
        alive,
        kills,
        mg_kills,
        headshots,
        shots_fired,
        shots_hit,
        accuracy,
        survival_sec,
        damage_dealt,
        damage_taken,
        medkit_used,
        kills_by_wave_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.database.exec('BEGIN IMMEDIATE');
    try {
      insertMatch.run(
        report.matchId,
        report.result,
        report.reason,
        report.startedAtMs,
        report.endedAtMs,
        report.mvpPlayerId ?? null,
        report.spawnedEnemies,
        report.defeatedEnemies,
        report.totalEnemies,
      );
      deleteScores.run(report.matchId);
      for (const score of report.scoreboard) {
        insertScore.run(
          report.matchId,
          score.occupantId,
          score.seatIndex,
          score.heroName,
          score.displayName,
          score.isBot ? 1 : 0,
          score.alive ? 1 : 0,
          score.kills,
          score.mgKills,
          score.headshots,
          score.shotsFired,
          score.shotsHit,
          score.accuracy,
          score.survivalSec,
          score.damageDealt,
          score.damageTaken,
          score.medkitUsed,
          JSON.stringify(score.killsByWave),
        );
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  find(matchId: string): MatchReport | undefined {
    const match = this.database
      .prepare('SELECT * FROM match_reports WHERE match_id = ?')
      .get(matchId) as MatchRow | undefined;
    if (!match) {
      return undefined;
    }
    const scoreRows = this.database
      .prepare(
        `SELECT *
         FROM match_scores
         WHERE match_id = ?
         ORDER BY seat_index ASC`,
      )
      .all(matchId) as unknown as ScoreRow[];

    return {
      matchId: match.match_id,
      result: match.result,
      reason: match.reason,
      startedAtMs: match.started_at_ms,
      endedAtMs: match.ended_at_ms,
      scoreboard: scoreRows.map((score) => ({
        occupantId: score.occupant_id,
        seatIndex: score.seat_index,
        heroName: score.hero_name,
        displayName: score.display_name,
        isBot: score.is_bot === 1,
        alive: score.alive === 1,
        kills: score.kills,
        mgKills: score.mg_kills,
        headshots: score.headshots,
        shotsFired: score.shots_fired,
        shotsHit: score.shots_hit,
        accuracy: score.accuracy,
        survivalSec: score.survival_sec,
        damageDealt: score.damage_dealt,
        damageTaken: score.damage_taken,
        medkitUsed: score.medkit_used,
        killsByWave: parseKillsByWave(score.kills_by_wave_json),
      })),
      ...(match.mvp_player_id === null
        ? {}
        : { mvpPlayerId: match.mvp_player_id }),
      spawnedEnemies: match.spawned_enemies,
      defeatedEnemies: match.defeated_enemies,
      totalEnemies: match.total_enemies,
    };
  }

  close(): void {
    this.database.close();
  }
}

function parseKillsByWave(value: string): readonly number[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (count) => !Number.isInteger(count) || count < 0,
    )
  ) {
    throw new Error('战报数据库中的 killsByWave 格式无效');
  }
  return parsed as number[];
}
