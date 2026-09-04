import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

import { WebSocket, WebSocketServer } from 'ws';

import {
  CLIENT_MESSAGE_TYPES,
  SERVER_MESSAGE_TYPES,
  type ActionRejectReason,
  type ActionResultMessage,
  type ActionType,
  type AllyCalloutMessage,
  type AllyDamagedMessage,
  type AllyDiedMessage,
  type EnemyDiedMessage,
  type FireMessage,
  type MatchEndMessage,
  type MatchProgressState,
  type MatchStartMessage,
  type PongMessage,
  type ServerMessage,
  type SnapshotMessage,
  type SupplyDropMessage,
  type WaveStartMessage,
} from '../../../shared/protocol';
import type { ProjectConfig } from '../config/project-config';
import type { RuntimeConfig } from '../config/runtime-config';
import { MatchReportRepository } from '../db/match-report-repository';
import { GameLoop } from '../game/game-loop';
import {
  determineMatchEnd,
  type MatchEndState,
} from '../game/match-lifecycle';
import { findPlayerWeaponConfig } from '../game/m1-battle-factory';
import {
  createM3BattleRuntime,
  type M2EnemyType,
  type M2RouteId,
} from '../game/m2-battle-factory';
import {
  type M2BattleEvent,
  type M2BattleSession,
  type M2FireResolution,
} from '../game/m2-battle-session';
import { ClientTickTracker } from './client-tick-tracker';
import { parseClientMessage } from './message-parser';
import {
  createWebSocketLogLine,
  decodeCloseReason,
  describeWebSocketError,
  type WebSocketLogContext,
  type WebSocketLogDetails,
  WebSocketSendMonitor,
} from './websocket-observability';
import type { WaveScheduler } from '../wave/wave-scheduler';

interface ClientSession {
  readonly id: string;
  readonly socket: WebSocket;
  readonly tickTracker: ClientTickTracker;
  battle?: M2BattleSession<M2RouteId, M2EnemyType>;
  waveScheduler?: WaveScheduler<M2EnemyType, M2RouteId>;
  matchStartedAtMs?: number;
  matchEnded: boolean;
  loop: GameLoop | undefined;
  playerName?: string;
  joined: boolean;
  heartbeatAlive: boolean;
}

export class GameWebSocketServer {
  private readonly httpServer: Server;
  private readonly websocketServer: WebSocketServer;
  private readonly reportRepository: MatchReportRepository;
  private readonly clients = new Map<WebSocket, ClientSession>();
  private readonly sendMonitor: WebSocketSendMonitor;
  private heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  private snapshotSequence = 0;

  constructor(
    private readonly runtimeConfig: RuntimeConfig,
    private readonly projectConfig: ProjectConfig,
  ) {
    this.reportRepository = new MatchReportRepository(
      runtimeConfig.dbPath,
    );
    this.sendMonitor = new WebSocketSendMonitor(
      runtimeConfig.wsBackpressureWarnBytes,
      runtimeConfig.wsBackpressureLogIntervalMs,
    );
    this.httpServer = createServer((request, response) => {
      if (request.url === '/healthz') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      response.writeHead(404);
      response.end();
    });

    this.websocketServer = new WebSocketServer({ noServer: true });
    this.httpServer.on('upgrade', (request, socket, head) => {
      const requestPath = new URL(
        request.url ?? '/',
        `http://${request.headers.host ?? 'localhost'}`,
      ).pathname;

      if (requestPath !== this.runtimeConfig.wsPath) {
        socket.destroy();
        return;
      }

      this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        this.websocketServer.emit('connection', websocket, request);
      });
    });

    this.websocketServer.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(
        this.runtimeConfig.wsPort,
        this.runtimeConfig.host,
        () => {
          this.httpServer.off('error', reject);
          this.startHeartbeat();
          resolve();
        },
      );
    });
  }

  stop(): Promise<void> {
    this.stopHeartbeat();
    for (const client of this.clients.values()) {
      client.loop?.stop();
      client.socket.close(1001, '服务器正在停止');
    }

    return new Promise((resolve, reject) => {
      this.websocketServer.close();
      this.httpServer.close((error) => {
        this.reportRepository.close();
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private handleConnection(socket: WebSocket): void {
    const id = randomUUID();
    const session: ClientSession = {
      id,
      socket,
      tickTracker: new ClientTickTracker(),
      matchEnded: false,
      loop: undefined,
      joined: false,
      heartbeatAlive: true,
    };
    this.clients.set(socket, session);
    this.logSocketEvent('info', 'connection_open', session);
    this.sendSnapshot(session);

    socket.on('pong', () => {
      session.heartbeatAlive = true;
    });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        socket.close(1003, '仅接受 JSON 文本消息');
        return;
      }

      const message = parseClientMessage(data.toString());
      if (!message) {
        socket.close(1007, '消息格式或协议版本无效');
        return;
      }

      switch (message.type) {
        case CLIENT_MESSAGE_TYPES.join:
          if (session.joined) {
            socket.close(1008, '不能重复加入房间');
            return;
          }
          session.playerName = message.payload.playerName.trim();
          this.startBattle(session);
          session.joined = true;
          session.loop?.start();
          this.broadcastSnapshots();
          this.send(session.socket, session.battle!.createRoomState());
          this.sendMatchStart(session);
          this.send(
            session.socket,
            session.battle!.createSnapshot(
              session.loop?.currentTick ?? 0,
              Date.now(),
              this.createMatchProgress(session, Date.now()),
            ),
          );
          return;
        case CLIENT_MESSAGE_TYPES.ping: {
          const response: PongMessage = {
            type: SERVER_MESSAGE_TYPES.pong,
            payload: {
              clientTimeMs: message.payload.clientTimeMs,
              serverTimeMs: Date.now(),
            },
          };
          this.send(socket, response);
          return;
        }
        case CLIENT_MESSAGE_TYPES.inputState:
          if (
            !session.joined ||
            session.matchEnded ||
            !session.battle ||
            !this.acceptClientTick(session, message.payload.clientTick) ||
            !session.battle.applyInput(message)
          ) {
            socket.close(1008, '输入状态无效');
          }
          return;
        case CLIENT_MESSAGE_TYPES.fire:
          if (
            !session.joined ||
            session.matchEnded ||
            !session.battle
          ) {
            this.sendFireResolution(
              session,
              this.rejectFireBeforeJoin(message),
            );
            return;
          }
          if (!this.acceptClientTick(session, message.payload.clientTick)) {
            socket.close(1008, 'clientTick 必须严格递增');
            return;
          }
          this.sendFireResolution(
            session,
            session.battle.fire(message, Date.now()),
          );
          return;
        case CLIENT_MESSAGE_TYPES.reload:
          if (
            session.joined &&
            !session.matchEnded &&
            session.battle
          ) {
            session.battle.reload(message, Date.now());
          }
          return;
        case CLIENT_MESSAGE_TYPES.useMedkit:
          if (
            !session.joined ||
            session.matchEnded ||
            !session.battle
          ) {
            this.sendActionResult(
              session,
              message.payload.clientTick,
              'use_medkit',
              'invalid_state',
            );
            return;
          }
          if (!this.acceptClientTick(session, message.payload.clientTick)) {
            socket.close(1008, 'clientTick 必须严格递增');
            return;
          }
          this.sendActionResult(
            session,
            message.payload.clientTick,
            'use_medkit',
            session.battle.tryUsePlayerMedkit(Date.now()),
          );
          return;
        case CLIENT_MESSAGE_TYPES.switchWeapon:
          if (
            !session.joined ||
            session.matchEnded ||
            !session.battle
          ) {
            this.sendActionResult(
              session,
              message.payload.clientTick,
              'switch_weapon',
              'invalid_state',
            );
            return;
          }
          if (!this.acceptClientTick(session, message.payload.clientTick)) {
            socket.close(1008, 'clientTick 必须严格递增');
            return;
          }
          this.sendActionResult(
            session,
            message.payload.clientTick,
            'switch_weapon',
            session.battle.switchPlayerWeapon(
              message.payload.weaponId,
            ),
          );
          return;
        case CLIENT_MESSAGE_TYPES.pickup:
          if (
            !session.joined ||
            session.matchEnded ||
            !session.battle
          ) {
            this.sendActionResult(
              session,
              message.payload.clientTick,
              'pickup',
              'invalid_state',
            );
            return;
          }
          if (!this.acceptClientTick(session, message.payload.clientTick)) {
            socket.close(1008, 'clientTick 必须严格递增');
            return;
          }
          this.sendActionResult(
            session,
            message.payload.clientTick,
            'pickup',
            session.battle.pickupItem(
              message.payload.itemId,
              Date.now(),
            ),
          );
          return;
        case CLIENT_MESSAGE_TYPES.throwGrenade:
          if (
            !session.joined ||
            session.matchEnded ||
            !session.battle
          ) {
            this.sendActionResult(
              session,
              message.payload.clientTick,
              'throw_grenade',
              'invalid_state',
            );
            return;
          }
          if (!this.acceptClientTick(session, message.payload.clientTick)) {
            socket.close(1008, 'clientTick 必须严格递增');
            return;
          }
          this.sendActionResult(
            session,
            message.payload.clientTick,
            'throw_grenade',
            session.battle.throwGrenade(message, Date.now()),
          );
          return;
        case CLIENT_MESSAGE_TYPES.mountMg:
          if (
            !session.joined ||
            session.matchEnded ||
            !session.battle
          ) {
            this.sendActionResult(
              session,
              message.payload.clientTick,
              'mount_mg',
              'invalid_state',
            );
            return;
          }
          if (!this.acceptClientTick(session, message.payload.clientTick)) {
            socket.close(1008, 'clientTick 必须严格递增');
            return;
          }
          this.sendActionResult(
            session,
            message.payload.clientTick,
            'mount_mg',
            session.battle.mountMachineGun(message.payload.mgId),
          );
          return;
        case CLIENT_MESSAGE_TYPES.unmountMg:
          if (
            !session.joined ||
            session.matchEnded ||
            !session.battle
          ) {
            this.sendActionResult(
              session,
              message.payload.clientTick,
              'unmount_mg',
              'invalid_state',
            );
            return;
          }
          if (!this.acceptClientTick(session, message.payload.clientTick)) {
            socket.close(1008, 'clientTick 必须严格递增');
            return;
          }
          this.sendActionResult(
            session,
            message.payload.clientTick,
            'unmount_mg',
            session.battle.unmountMachineGun(),
          );
          return;
      }
    });

    socket.on('close', (code, reason) => {
      this.logSocketEvent('info', 'connection_close', session, {
        code,
        reason: decodeCloseReason(reason),
      });
      session.loop?.stop();
      this.clients.delete(socket);
      this.broadcastSnapshots();
    });

    socket.on('error', (error) => {
      this.logSocketEvent('error', 'connection_error', session, {
        ...describeWebSocketError(error),
      });
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval !== undefined) {
      return;
    }
    this.heartbeatInterval = setInterval(() => {
      this.probeConnections();
    }, this.runtimeConfig.wsHeartbeatIntervalMs);
    this.heartbeatInterval.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval === undefined) {
      return;
    }
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = undefined;
  }

  private probeConnections(): void {
    for (const session of this.clients.values()) {
      if (session.socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      if (!session.heartbeatAlive) {
        this.logSocketEvent('warn', 'heartbeat_timeout', session);
        session.socket.terminate();
        continue;
      }
      session.heartbeatAlive = false;
      try {
        session.socket.ping();
      } catch (error: unknown) {
        this.logSocketEvent('error', 'heartbeat_ping_error', session, {
          ...describeWebSocketError(error),
        });
      }
    }
  }

  private startBattle(session: ClientSession): void {
    const startedAtMs = Date.now();
    const runtime = createM3BattleRuntime(
      this.projectConfig,
      session.id,
      session.playerName ?? session.id,
      startedAtMs,
    );
    session.battle = runtime.battle;
    session.waveScheduler = runtime.waveScheduler;
    session.matchStartedAtMs = runtime.startedAtMs;
    session.matchEnded = false;
    session.loop = new GameLoop({
      tickRateHz: runtime.tickRateHz,
      onTick: ({ tick, deltaSec }) => {
        const battle = session.battle;
        const waveScheduler = session.waveScheduler;
        const matchStartedAtMs = session.matchStartedAtMs;
        if (
          !session.joined ||
          !battle ||
          !waveScheduler ||
          matchStartedAtMs === undefined
        ) {
          return;
        }

        const tickNowMs = Date.now();
        const elapsedMs = tickNowMs - matchStartedAtMs;
        const waveUpdate = waveScheduler.update(
          elapsedMs,
          battle.aliveEnemyCount,
        );
        for (const planned of waveUpdate.enemiesToSpawn) {
          battle.spawnEnemy(
            planned.enemyType,
            planned.routeId,
            planned.accuracy,
            tickNowMs,
          );
        }
        for (const wave of waveUpdate.waveStarts) {
          const message: WaveStartMessage = {
            type: SERVER_MESSAGE_TYPES.waveStart,
            payload: {
              waveIndex: wave.waveIndex,
              enemyCount: wave.enemyCount,
              totalWaves: this.projectConfig.waves.waves.length,
              startedAtMs: matchStartedAtMs + wave.startedAtMs,
            },
          };
          this.send(session.socket, message);
        }
        const events = battle.update(deltaSec, tick, tickNowMs);
        this.sendBattleEvents(session, events);
        const progress = this.createMatchProgress(session, tickNowMs);
        const outcome = determineMatchEnd({
          elapsedSec: elapsedMs / 1000,
          durationSec:
            this.projectConfig.gameplay.match.durationSec,
          allowOvertimeSpawn:
            this.projectConfig.gameplay.match.allowOvertimeSpawn,
          pendingEnemyCount: waveScheduler.getProgress(elapsedMs)
            .pendingEnemies,
          playerAlive: battle.playerAlive,
          aliveDefenderCount: battle.aliveDefenderCount,
        });
        if (outcome) {
          this.finishMatch(
            session,
            tick,
            tickNowMs,
            progress,
            outcome,
          );
          return;
        }
        this.send(
          session.socket,
          battle.createSnapshot(
            tick,
            tickNowMs,
            progress,
          ),
        );
      },
    });
  }

  private sendMatchStart(session: ClientSession): void {
    const startedAtMs = session.matchStartedAtMs;
    if (startedAtMs === undefined) {
      return;
    }
    const message: MatchStartMessage = {
      type: SERVER_MESSAGE_TYPES.matchStart,
      payload: {
        matchId: session.battle?.room.id ?? `${session.id}:solo`,
        startedAtMs,
        deployEndsAtMs:
          startedAtMs +
          this.projectConfig.gameplay.match.deployPhaseSec * 1000,
        endsAtMs:
          startedAtMs +
          this.projectConfig.gameplay.match.durationSec * 1000,
        totalWaves: this.projectConfig.waves.waves.length,
        totalEnemies: this.projectConfig.waves.totalEnemies,
      },
    };
    this.send(session.socket, message);
  }

  private sendActionResult(
    session: ClientSession,
    clientTick: number,
    action: ActionType,
    rejectReason?: ActionRejectReason,
  ): void {
    const message: ActionResultMessage =
      rejectReason === undefined
        ? {
            type: SERVER_MESSAGE_TYPES.actionResult,
            payload: {
              clientTick,
              action,
              accepted: true,
            },
          }
        : {
            type: SERVER_MESSAGE_TYPES.actionResult,
            payload: {
              clientTick,
              action,
              accepted: false,
              rejectReason,
            },
          };
    this.send(session.socket, message);
  }

  private finishMatch(
    session: ClientSession,
    tick: number,
    endedAtMs: number,
    progress: MatchProgressState,
    outcome: MatchEndState,
  ): void {
    const battle = session.battle;
    const startedAtMs = session.matchStartedAtMs;
    if (!battle || startedAtMs === undefined || session.matchEnded) {
      return;
    }

    session.matchEnded = true;
    battle.endMatch();
    const endedAtSec = Math.max(0, (endedAtMs - startedAtMs) / 1000);
    const scoreboard = battle.createScoreboard(endedAtSec);
    const mvpPlayerId = battle.selectMvpPlayerId(endedAtSec);
    const finalProgress: MatchProgressState = {
      ...progress,
      phase: 'ended',
    };
    const message: MatchEndMessage = {
      type: SERVER_MESSAGE_TYPES.matchEnd,
      payload: {
        matchId: battle.room.id,
        result: outcome.result,
        reason: outcome.reason,
        endedAtMs,
        scoreboard,
        ...(mvpPlayerId === undefined ? {} : { mvpPlayerId }),
        spawnedEnemies: finalProgress.spawnedEnemies,
        defeatedEnemies: finalProgress.defeatedEnemies,
        totalEnemies: finalProgress.totalEnemies,
      },
    };
    this.reportRepository.save({
      ...message.payload,
      startedAtMs,
    });

    this.send(session.socket, battle.createRoomState());
    this.send(
      session.socket,
      battle.createSnapshot(tick, endedAtMs, finalProgress),
    );
    this.send(session.socket, message);
    session.loop?.stop();
  }

  private createMatchProgress(
    session: ClientSession,
    nowMs: number,
  ): MatchProgressState {
    const battle = session.battle;
    const waveScheduler = session.waveScheduler;
    const startedAtMs = session.matchStartedAtMs;
    if (!battle || !waveScheduler || startedAtMs === undefined) {
      throw new Error('比赛进度只能在战斗创建后生成');
    }
    const progress = waveScheduler.getProgress(nowMs - startedAtMs);
    const defeatedEnemies =
      battle.totalEnemyCount - battle.aliveEnemyCount;
    return {
      startedAtMs,
      endsAtMs:
        startedAtMs +
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

  private acceptClientTick(
    session: ClientSession,
    clientTick: number,
  ): boolean {
    return session.tickTracker.accept(clientTick);
  }

  private sendFireResolution(
    session: ClientSession,
    resolution: M2FireResolution,
  ): void {
    this.send(session.socket, resolution.result);
    if (resolution.death) {
      this.send(session.socket, resolution.death);
    }
  }

  private rejectFireBeforeJoin(message: FireMessage): M2FireResolution {
    const weaponId = this.projectConfig.gameplay.player.defaultLoadout.primary;
    const weapon = findPlayerWeaponConfig(this.projectConfig, weaponId);
    return {
      result: {
        type: SERVER_MESSAGE_TYPES.fireResult,
        payload: {
          clientTick: message.payload.clientTick,
          weaponId: message.payload.weaponId,
          accepted: false,
          rejectReason: 'not_joined',
          hit: false,
          damage: 0,
          isKill: false,
          magazineAmmo: weapon.magazine,
          reserveAmmo: weapon.reserveAmmo,
        },
      },
    };
  }

  private sendBattleEvents(
    session: ClientSession,
    events: readonly M2BattleEvent<M2RouteId>[],
  ): void {
    let roomStateChanged = false;
    for (const event of events) {
      switch (event.type) {
        case 'enemy_died': {
          const message: EnemyDiedMessage = {
            type: SERVER_MESSAGE_TYPES.enemyDied,
            payload: {
              enemyId: event.enemyId,
              killerId: event.killerId,
              killerIsBot: event.killerIsBot,
            },
          };
          this.send(session.socket, message);
          break;
        }
        case 'ally_callout': {
          const message: AllyCalloutMessage = {
            type: SERVER_MESSAGE_TYPES.allyCallout,
            payload: {
              allyId: event.allyId,
              routeId: event.routeId,
              text: event.text,
            },
          };
          this.send(session.socket, message);
          break;
        }
        case 'ally_damaged': {
          const message: AllyDamagedMessage = {
            type: SERVER_MESSAGE_TYPES.allyDamaged,
            payload: {
              allyId: event.allyId,
              hp: event.hp,
              fromDir: event.fromDir,
            },
          };
          this.send(session.socket, message);
          break;
        }
        case 'ally_died': {
          const message: AllyDiedMessage = {
            type: SERVER_MESSAGE_TYPES.allyDied,
            payload: {
              allyId: event.allyId,
              isBot: event.isBot,
              killerType: event.killerType,
            },
          };
          this.send(session.socket, message);
          roomStateChanged = true;
          break;
        }
        case 'ally_reassigned':
          roomStateChanged = true;
          break;
        case 'supply_drop': {
          const message: SupplyDropMessage = {
            type: SERVER_MESSAGE_TYPES.supplyDrop,
            payload: {
              dropId: event.drop.id,
              position: event.drop.position,
              expiresAtMs: event.drop.expiresAtMs,
              text: event.text,
            },
          };
          this.send(session.socket, message);
          break;
        }
        case 'fire_warning':
        case 'shot':
          break;
      }
    }

    if (roomStateChanged && session.battle) {
      this.send(session.socket, session.battle.createRoomState());
    }
  }

  private broadcastSnapshots(): void {
    for (const client of this.clients.values()) {
      this.sendSnapshot(client);
    }
  }

  private sendSnapshot(session: ClientSession): void {
    const connection = session.playerName
      ? {
          clientId: session.id,
          joined: session.joined,
          playerName: session.playerName,
        }
      : {
          clientId: session.id,
          joined: session.joined,
        };

    const message: SnapshotMessage = {
      type: SERVER_MESSAGE_TYPES.snapshot,
      payload: {
        sequence: this.snapshotSequence,
        serverTimeMs: Date.now(),
        onlineClients: this.clients.size,
        connection,
      },
    };
    this.snapshotSequence += 1;
    this.send(session.socket, message);
  }

  private createLogContext(session: ClientSession): WebSocketLogContext {
    const startedAtMs = session.matchStartedAtMs;
    const waveScheduler = session.waveScheduler;
    let matchPhase = session.joined ? 'starting' : 'not_joined';
    let currentWaveIndex: number | null = null;
    let elapsedSec: number | null = null;

    if (startedAtMs !== undefined && waveScheduler) {
      const elapsedMs = Math.max(0, Date.now() - startedAtMs);
      const progress = waveScheduler.getProgress(elapsedMs);
      matchPhase = session.matchEnded ? 'ended' : progress.phase;
      currentWaveIndex = progress.currentWaveIndex;
      elapsedSec = Math.round(elapsedMs / 100) / 10;
    }

    return {
      clientId: session.id,
      joined: session.joined,
      roomId: session.battle?.room.id ?? null,
      matchPhase,
      currentWaveIndex,
      playerAlive: session.battle?.playerAlive ?? null,
      matchEnded: session.matchEnded,
      elapsedSec,
      bufferedAmount: session.socket.bufferedAmount,
    };
  }

  private logSocketEvent(
    level: 'info' | 'warn' | 'error',
    event: string,
    session: ClientSession,
    details: WebSocketLogDetails = {},
  ): void {
    console[level](
      createWebSocketLogLine(
        event,
        this.createLogContext(session),
        details,
      ),
    );
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    const session = this.clients.get(socket);
    if (!session) {
      return;
    }
    this.sendMonitor.send(
      socket,
      JSON.stringify(message),
      message.type,
      () => this.createLogContext(session),
    );
  }
}
