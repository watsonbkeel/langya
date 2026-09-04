import type {
  HitPart,
  ScoreboardEntry,
} from '../../../shared/protocol';

export type ScoreTiebreakField =
  | 'kills'
  | 'mgKills'
  | 'survivalSec'
  | 'accuracy';

export interface ScoreTrackerConfig {
  readonly totalWaves: number;
  readonly mvpHumanOnly: boolean;
  readonly mvpRequiresAlive: boolean;
  readonly tiebreakOrder: readonly ScoreTiebreakField[];
}

export interface ScoreParticipant {
  readonly occupantId: string;
  readonly seatIndex: number;
  readonly heroName: string;
  readonly displayName: string;
  readonly isBot: boolean;
}

export interface RecordedShot {
  readonly hit: boolean;
  readonly damage: number;
  readonly isKill: boolean;
  readonly isMachineGun: boolean;
  readonly hitPart?: HitPart;
  readonly waveIndex: number;
}

interface MutableScore {
  readonly participant: ScoreParticipant;
  readonly killsByWave: number[];
  alive: boolean;
  kills: number;
  mgKills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  damageTaken: number;
  medkitUsed: number;
  deathAtSec: number | undefined;
}

export class ScoreTracker {
  private readonly config: ScoreTrackerConfig;
  private readonly scores = new Map<string, MutableScore>();

  constructor(
    config: ScoreTrackerConfig,
    participants: readonly ScoreParticipant[],
  ) {
    this.config = config;
    for (const participant of participants) {
      if (this.scores.has(participant.occupantId)) {
        throw new Error(`重复的计分参与者 ${participant.occupantId}`);
      }
      this.scores.set(participant.occupantId, {
        participant,
        killsByWave: Array.from(
          { length: config.totalWaves },
          () => 0,
        ),
        alive: true,
        kills: 0,
        mgKills: 0,
        headshots: 0,
        shotsFired: 0,
        shotsHit: 0,
        damageDealt: 0,
        damageTaken: 0,
        medkitUsed: 0,
        deathAtSec: undefined,
      });
    }
  }

  recordShot(occupantId: string, shot: RecordedShot): void {
    const score = this.requireScore(occupantId);
    score.shotsFired += 1;
    if (!shot.hit) {
      return;
    }

    score.shotsHit += 1;
    score.damageDealt += Math.max(0, shot.damage);
    if (shot.hitPart === 'head') {
      score.headshots += 1;
    }
    if (!shot.isKill) {
      return;
    }

    score.kills += 1;
    if (shot.isMachineGun) {
      score.mgKills += 1;
    }
    const waveOffset = shot.waveIndex - 1;
    if (waveOffset >= 0 && waveOffset < score.killsByWave.length) {
      score.killsByWave[waveOffset] =
        (score.killsByWave[waveOffset] ?? 0) + 1;
    }
  }

  recordDamageTaken(occupantId: string, damage: number): void {
    this.requireScore(occupantId).damageTaken += Math.max(0, damage);
  }

  recordMedkitUsed(occupantId: string): void {
    this.requireScore(occupantId).medkitUsed += 1;
  }

  markDead(occupantId: string, deathAtSec: number): void {
    const score = this.requireScore(occupantId);
    if (!score.alive) {
      return;
    }
    score.alive = false;
    score.deathAtSec = Math.max(0, deathAtSec);
  }

  createScoreboard(endedAtSec: number): readonly ScoreboardEntry[] {
    return [...this.scores.values()]
      .sort(
        (first, second) =>
          first.participant.seatIndex - second.participant.seatIndex,
      )
      .map((score) => this.toScoreboardEntry(score, endedAtSec));
  }

  selectMvpPlayerId(endedAtSec: number): string | undefined {
    const candidates = this.createScoreboard(endedAtSec).filter(
      (entry) =>
        (!this.config.mvpHumanOnly || !entry.isBot) &&
        (!this.config.mvpRequiresAlive || entry.alive),
    );
    candidates.sort((first, second) =>
      this.compareCandidates(first, second),
    );
    return candidates[0]?.occupantId;
  }

  private toScoreboardEntry(
    score: MutableScore,
    endedAtSec: number,
  ): ScoreboardEntry {
    return {
      ...score.participant,
      alive: score.alive,
      kills: score.kills,
      mgKills: score.mgKills,
      headshots: score.headshots,
      shotsFired: score.shotsFired,
      shotsHit: score.shotsHit,
      accuracy:
        score.shotsFired === 0
          ? 0
          : score.shotsHit / score.shotsFired,
      survivalSec: Math.min(
        Math.max(0, endedAtSec),
        score.deathAtSec ?? Math.max(0, endedAtSec),
      ),
      damageDealt: score.damageDealt,
      damageTaken: score.damageTaken,
      medkitUsed: score.medkitUsed,
      killsByWave: [...score.killsByWave],
    };
  }

  private compareCandidates(
    first: ScoreboardEntry,
    second: ScoreboardEntry,
  ): number {
    for (const field of this.config.tiebreakOrder) {
      const difference = second[field] - first[field];
      if (difference !== 0) {
        return difference;
      }
    }
    return first.seatIndex - second.seatIndex;
  }

  private requireScore(occupantId: string): MutableScore {
    const score = this.scores.get(occupantId);
    if (!score) {
      throw new Error(`计分参与者 ${occupantId} 不存在`);
    }
    return score;
  }
}
