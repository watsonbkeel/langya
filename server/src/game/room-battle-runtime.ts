import {
  SERVER_MESSAGE_TYPES,
  type MatchProgressState,
  type MatchStartMessage,
  type ServerMessage,
  type WaveStartMessage,
} from '../../../shared/protocol';
import type { ProjectConfig } from '../config/project-config';
import { GameLoop } from './game-loop';
import {
  determineMatchEnd,
  type MatchEndState,
} from './match-lifecycle';
import {
  createM3BattleRuntime,
  type M2EnemyType,
  type M2RouteId,
} from './m2-battle-factory';
import type {
  M2BattleEvent,
  M2BattleSession,
} from './m2-battle-session';
import type { WaveScheduler } from '../wave/wave-scheduler';
import type { HumanSeatAssignment } from '../room/solo-room';

/** 战斗运行时向外广播消息的出口，由 websocket 层提供。 */
export type BattleBroadcast = (message: ServerMessage) => void;

/** 一局结束时的回调，交给 websocket 层做落库和收尾。 */
export interface RoomBattleEndInfo {
  readonly tick: number;
  readonly endedAtMs: number;
  readonly progress: MatchProgressState;
  readonly outcome: MatchEndState;
}

export interface RoomBattleRuntimeOptions {
  readonly roomId: string;
  readonly projectConfig: ProjectConfig;
  /** 开局时固定下来的真人席位表。v1.0 不允许中途加入。 */
  readonly humans: readonly HumanSeatAssignment[];
  readonly startedAtMs: number;
  /** 把消息广播给房间内全部在线成员。 */
  readonly broadcast: BattleBroadcast;
  readonly onEvents: (
    events: readonly M2BattleEvent<M2RouteId>[],
  ) => void;
  readonly onMatchEnd: (info: RoomBattleEndInfo) => void;
}

/**
 * 房间级战斗运行时：一个房间一份战斗 + 一个 20Hz 主循环。
 *
 * 改造前每个 WebSocket 连接各自跑一份战斗，房间只是个大厅，
 * 开局后玩家其实还是各打各的。这里把战斗提升到房间层，
 * 同房所有人共享同一份世界状态、同一套波次调度和同一份计分。
 */
export class RoomBattleRuntime {
  readonly battle: M2BattleSession<M2RouteId, M2EnemyType>;
  readonly startedAtMs: number;

  private readonly waveScheduler: WaveScheduler<M2EnemyType, M2RouteId>;
  private readonly loop: GameLoop;
  private readonly projectConfig: ProjectConfig;
  private readonly broadcast: BattleBroadcast;
  private readonly onEvents: RoomBattleRuntimeOptions['onEvents'];
  private readonly onMatchEnd: RoomBattleRuntimeOptions['onMatchEnd'];
  private ended = false;

  constructor(options: RoomBattleRuntimeOptions) {
    const primary = options.humans[0];
    if (!primary) {
      throw new Error('开局至少需要一名真人');
    }

    this.projectConfig = options.projectConfig;
    this.broadcast = options.broadcast;
    this.onEvents = options.onEvents;
    this.onMatchEnd = options.onMatchEnd;
    this.startedAtMs = options.startedAtMs;

    const runtime = createM3BattleRuntime(
      options.projectConfig,
      primary.playerId,
      primary.playerName,
      options.startedAtMs,
      {
        roomId: options.roomId,
        humans: options.humans,
      },
    );
    this.battle = runtime.battle;
    this.waveScheduler = runtime.waveScheduler;
    this.loop = new GameLoop({
      tickRateHz: runtime.tickRateHz,
      onTick: ({ tick, deltaSec }) => {
        this.step(tick, deltaSec);
      },
    });
  }

  get matchEnded(): boolean {
    return this.ended;
  }

  get currentTick(): number {
    return this.loop.currentTick;
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  /** 开局播报，新加入渲染的客户端也要单独补一份。 */
  createMatchStart(): MatchStartMessage {
    const { match } = this.projectConfig.gameplay;
    return {
      type: SERVER_MESSAGE_TYPES.matchStart,
      payload: {
        matchId: this.battle.room.id,
        startedAtMs: this.startedAtMs,
        deployEndsAtMs:
          this.startedAtMs + match.deployPhaseSec * 1000,
        endsAtMs: this.startedAtMs + match.durationSec * 1000,
        totalWaves: this.projectConfig.waves.waves.length,
        totalEnemies: this.projectConfig.waves.totalEnemies,
      },
    };
  }

  createMatchProgress(nowMs: number): MatchProgressState {
    const progress = this.waveScheduler.getProgress(
      nowMs - this.startedAtMs,
    );
    const defeatedEnemies =
      this.battle.totalEnemyCount - this.battle.aliveEnemyCount;
    return {
      startedAtMs: this.startedAtMs,
      endsAtMs:
        this.startedAtMs +
        this.projectConfig.gameplay.match.durationSec * 1000,
      phase: progress.phase,
      currentWaveIndex: progress.currentWaveIndex,
      totalWaves: this.projectConfig.waves.waves.length,
      spawnedEnemies: progress.spawnedEnemies,
      defeatedEnemies,
      remainingEnemies: Math.max(
        0,
        progress.totalEnemies - defeatedEnemies,
      ),
      totalEnemies: progress.totalEnemies,
    };
  }

  /** 供日志使用的当前阶段与波次。 */
  describeProgress(nowMs: number): {
    readonly phase: string;
    readonly currentWaveIndex: number;
    readonly elapsedSec: number;
  } {
    const elapsedMs = Math.max(0, nowMs - this.startedAtMs);
    const progress = this.waveScheduler.getProgress(elapsedMs);
    return {
      phase: this.ended ? 'ended' : progress.phase,
      currentWaveIndex: progress.currentWaveIndex,
      elapsedSec: Math.round(elapsedMs / 100) / 10,
    };
  }

  /** 主循环单步。抽成独立方法便于测试直接驱动，不必真的跑定时器。 */
  step(tick: number, deltaSec: number, nowMs = Date.now()): void {
    if (this.ended) {
      return;
    }

    const elapsedMs = nowMs - this.startedAtMs;
    const waveUpdate = this.waveScheduler.update(
      elapsedMs,
      this.battle.aliveEnemyCount,
    );
    for (const planned of waveUpdate.enemiesToSpawn) {
      this.battle.spawnEnemy(
        planned.enemyType,
        planned.routeId,
        planned.accuracy,
        nowMs,
      );
    }
    for (const wave of waveUpdate.waveStarts) {
      const message: WaveStartMessage = {
        type: SERVER_MESSAGE_TYPES.waveStart,
        payload: {
          waveIndex: wave.waveIndex,
          enemyCount: wave.enemyCount,
          totalWaves: this.projectConfig.waves.waves.length,
          startedAtMs: this.startedAtMs + wave.startedAtMs,
        },
      };
      this.broadcast(message);
    }

    const events = this.battle.update(deltaSec, tick, nowMs);
    this.onEvents(events);

    const progress = this.createMatchProgress(nowMs);
    const outcome = determineMatchEnd({
      elapsedSec: elapsedMs / 1000,
      durationSec: this.projectConfig.gameplay.match.durationSec,
      allowOvertimeSpawn:
        this.projectConfig.gameplay.match.allowOvertimeSpawn,
      pendingEnemyCount:
        this.waveScheduler.getProgress(elapsedMs).pendingEnemies,
      // 多人局的胜负看整支队伍是否还有真人活着，
      // 单个真人阵亡不再直接判负（PRD 7.3 阵亡后转观战）。
      playerAlive: this.anyHumanAlive(),
      aliveDefenderCount: this.battle.aliveDefenderCount,
    });
    if (outcome) {
      this.finish(tick, nowMs, progress, outcome);
      return;
    }

    this.broadcast(
      this.battle.createSnapshot(tick, nowMs, progress),
    );
  }

  /** 队伍里还有真人活着吗。全员阵亡才算真人这条线断了。 */
  private anyHumanAlive(): boolean {
    for (const playerId of this.battle.humanPlayerIds) {
      if (this.battle.isPlayerAlive(playerId)) {
        return true;
      }
    }
    return false;
  }

  private finish(
    tick: number,
    endedAtMs: number,
    progress: MatchProgressState,
    outcome: MatchEndState,
  ): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.battle.endMatch();
    this.loop.stop();
    this.onMatchEnd({
      tick,
      endedAtMs,
      progress: { ...progress, phase: 'ended' },
      outcome,
    });
  }
}
