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
  private currentWaveIndex = 0;
  /**
   * 当前波被提前清空的时刻。
   * 用于把「提前清波」也转成一段完整的间歇期，
   * 让玩家有时间捡血包与空投，而不是被下一波瞬间接上。
   */
  private clearedAtMs: number | null = null;

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
    const forcedWaveIndex = this.findForcedWaveIndex(
      elapsedMs,
      aliveEnemyCount,
    );
    const waveStarts = this.collectWaveStarts(
      elapsedMs,
      forcedWaveIndex,
    );
    if (waveStarts.length > 0) {
      this.currentWaveIndex = Math.max(
        this.currentWaveIndex,
        waveStarts[waveStarts.length - 1]!.waveIndex,
      );
    }
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
      if (
        !planned ||
        (planned.spawnAtMs > elapsedMs &&
          planned.waveIndex !== forcedWaveIndex)
      ) {
        break;
      }
      enemiesToSpawn.push(planned);
      this.nextSpawnIndex += 1;
    }

    return { waveStarts, enemiesToSpawn };
  }

  getProgress(elapsedMs: number): WaveProgress {
    const timeBasedCurrentWaveIndex = this.findCurrentWaveIndex(elapsedMs);
    const currentWaveIndex = Math.max(
      timeBasedCurrentWaveIndex,
      this.currentWaveIndex,
    );
    const timeBasedPhase = this.findPhase(elapsedMs);
    let phase =
      currentWaveIndex > timeBasedCurrentWaveIndex &&
      timeBasedPhase !== 'ended'
        ? 'wave'
        : timeBasedPhase;

    // 提前清波后的宽限期同样算「间歇」，HUD 才不会在无敌人时仍显示战斗中。
    if (
      phase === 'wave' &&
      this.clearedAtMs !== null &&
      elapsedMs - this.clearedAtMs < this.intermissionMs
    ) {
      phase = 'intermission';
    }

    return {
      phase,
      currentWaveIndex,
      spawnedEnemies: this.nextSpawnIndex,
      pendingEnemies: this.plan.length - this.nextSpawnIndex,
      totalEnemies: this.plan.length,
    };
  }

  private collectWaveStarts(
    elapsedMs: number,
    forcedWaveIndex: number | null,
  ): readonly WaveStart[] {
    const starts: WaveStart[] = [];
    while (this.nextWaveStartIndex < this.waves.length) {
      const wave = this.waves[this.nextWaveStartIndex];
      if (
        !wave ||
        (wave.startSec * MILLISECONDS_PER_SECOND > elapsedMs &&
          wave.index !== forcedWaveIndex)
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

  private findForcedWaveIndex(
    elapsedMs: number,
    aliveEnemyCount: number,
  ): number | null {
    if (aliveEnemyCount > 0 || this.nextSpawnIndex === 0) {
      // 场上还有敌人：清空计时作废，下次清空重新开始计时。
      this.clearedAtMs = null;
      return null;
    }

    const firstWave = this.waves[0];
    if (
      !firstWave ||
      elapsedMs < firstWave.startSec * MILLISECONDS_PER_SECOND
    ) {
      return null;
    }

    const nextPlanned = this.plan[this.nextSpawnIndex];
    if (!nextPlanned || nextPlanned.spawnAtMs <= elapsedMs) {
      // 已经到了计划投放时间，走正常时间线，无需强制提前。
      this.clearedAtMs = null;
      return null;
    }

    // 同一波剩余的班组照旧立刻补上：波内节奏不变，
    // 否则「打完一个班组等 20 秒」会让战斗支离破碎。
    if (nextPlanned.waveIndex === this.currentWaveIndex) {
      this.clearedAtMs = null;
      return nextPlanned.waveIndex;
    }

    // 只有跨波才给宽限：整波被提前打完后，
    // 留出一个完整间歇期让玩家捡血包和空投，
    // 而不是让下一波在最后一个敌人倒地的同一帧涌上来。
    if (this.clearedAtMs === null) {
      this.clearedAtMs = elapsedMs;
    }
    if (elapsedMs - this.clearedAtMs < this.intermissionMs) {
      return null;
    }
    return nextPlanned.waveIndex;
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
