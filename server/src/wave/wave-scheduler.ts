import type { RandomSource } from '../ai/seeded-random';
import {
  createEnemySpawnPlan,
  type EnemySpawnPlanConfig,
  type EnemyWaveConfig,
  type PlannedEnemy,
} from './enemy-spawn-plan';

const MILLISECONDS_PER_SECOND = 1000;

export type WavePhase = 'deploy' | 'wave' | 'intermission' | 'ended';

export interface WaveStart {
  readonly waveIndex: number;
  readonly enemyCount: number;
  readonly startedAtMs: number;
}

export interface WaveSchedulerUpdate<
  TEnemyType extends string,
  TRouteId extends string,
> {
  readonly waveStarts: readonly WaveStart[];
  readonly enemiesToSpawn: readonly PlannedEnemy<TEnemyType, TRouteId>[];
}

export interface WaveProgress {
  readonly phase: WavePhase;
  readonly currentWaveIndex: number;
  readonly spawnedEnemies: number;
  readonly pendingEnemies: number;
  readonly totalEnemies: number;
}

export interface WaveSchedulerConfig<
  TEnemyType extends string,
  TRouteId extends string,
> extends EnemySpawnPlanConfig<TEnemyType, TRouteId> {
  readonly matchDurationSec: number;
  readonly intermissionSec: number;
  readonly maxAliveEnemies: number;
}

export class WaveScheduler<
  TEnemyType extends string,
  TRouteId extends string,
> {
  private readonly plan: readonly PlannedEnemy<TEnemyType, TRouteId>[];
  private readonly waves: readonly EnemyWaveConfig<TEnemyType>[];
  private readonly matchDurationMs: number;
  private readonly intermissionMs: number;
  private readonly maxAliveEnemies: number;
  private nextSpawnIndex = 0;
  private nextWaveStartIndex = 0;

  constructor(
    config: WaveSchedulerConfig<TEnemyType, TRouteId>,
    random: RandomSource,
  ) {
    this.plan = createEnemySpawnPlan(config, random);
    this.waves = config.waves;
    this.matchDurationMs =
      config.matchDurationSec * MILLISECONDS_PER_SECOND;
    this.intermissionMs =
      config.intermissionSec * MILLISECONDS_PER_SECOND;
    this.maxAliveEnemies = config.maxAliveEnemies;
  }

  update(
    elapsedMs: number,
    aliveEnemyCount: number,
  ): WaveSchedulerUpdate<TEnemyType, TRouteId> {
    const waveStarts = this.collectWaveStarts(elapsedMs);
    const availableSlots = Math.max(
      0,
      this.maxAliveEnemies - aliveEnemyCount,
    );
    const enemiesToSpawn: PlannedEnemy<TEnemyType, TRouteId>[] = [];

    // 只消费已经到点且有同屏容量的条目；容量不足时索引不前移，敌人继续排队。
    while (
      enemiesToSpawn.length < availableSlots &&
      this.nextSpawnIndex < this.plan.length
    ) {
      const planned = this.plan[this.nextSpawnIndex];
      if (!planned || planned.spawnAtMs > elapsedMs) {
        break;
      }
      enemiesToSpawn.push(planned);
      this.nextSpawnIndex += 1;
    }

    return { waveStarts, enemiesToSpawn };
  }

  getProgress(elapsedMs: number): WaveProgress {
    return {
      phase: this.findPhase(elapsedMs),
      currentWaveIndex: this.findCurrentWaveIndex(elapsedMs),
      spawnedEnemies: this.nextSpawnIndex,
      pendingEnemies: this.plan.length - this.nextSpawnIndex,
      totalEnemies: this.plan.length,
    };
  }

  private collectWaveStarts(elapsedMs: number): readonly WaveStart[] {
    const starts: WaveStart[] = [];
    while (this.nextWaveStartIndex < this.waves.length) {
      const wave = this.waves[this.nextWaveStartIndex];
      if (
        !wave ||
        wave.startSec * MILLISECONDS_PER_SECOND > elapsedMs
      ) {
        break;
      }
      starts.push({
        waveIndex: wave.index,
        enemyCount: wave.enemyCount,
        startedAtMs: wave.startSec * MILLISECONDS_PER_SECOND,
      });
      this.nextWaveStartIndex += 1;
    }
    return starts;
  }

  private findPhase(elapsedMs: number): WavePhase {
    const firstWave = this.waves[0];
    if (
      !firstWave ||
      elapsedMs <
        firstWave.startSec * MILLISECONDS_PER_SECOND
    ) {
      return 'deploy';
    }
    if (elapsedMs >= this.matchDurationMs) {
      return 'ended';
    }

    for (let index = 1; index < this.waves.length; index += 1) {
      const nextWave = this.waves[index];
      if (!nextWave) {
        continue;
      }
      const nextStartMs =
        nextWave.startSec * MILLISECONDS_PER_SECOND;
      if (
        elapsedMs >= nextStartMs - this.intermissionMs &&
        elapsedMs < nextStartMs
      ) {
        return 'intermission';
      }
    }
    return 'wave';
  }

  private findCurrentWaveIndex(elapsedMs: number): number {
    let currentWaveIndex = 0;
    for (const wave of this.waves) {
      if (
        wave.startSec * MILLISECONDS_PER_SECOND >
        elapsedMs
      ) {
        break;
      }
      currentWaveIndex = wave.index;
    }
    return currentWaveIndex;
  }
}
