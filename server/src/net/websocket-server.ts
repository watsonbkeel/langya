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
  type ConnectionSnapshot,
  type EnemyDiedMessage,
  type FireMessage,
  type MatchEndMessage,
  type PongMessage,
  type RoomAction,
  type RoomActionResultMessage,
  type RoomStateMessage,
  type ServerMessage,
  type SnapshotMessage,
  type SupplyDropMessage,
} from '../../../shared/protocol';
import type { ProjectConfig } from '../config/project-config';
import type { RuntimeConfig } from '../config/runtime-config';
import { MatchReportRepository } from '../db/match-report-repository';
import { findPlayerWeaponConfig } from '../game/m1-battle-factory';
import type { M2RouteId } from '../game/m2-battle-factory';
import {
  type M2BattleEvent,
  type M2FireResolution,
} from '../game/m2-battle-session';
import {
  RoomBattleRuntime,
  type RoomBattleEndInfo,
} from '../game/room-battle-runtime';
import { ClientTickTracker } from './client-tick-tracker';
import { parseClientMessage } from './message-parser';
import {
  MessageRateLimiter,
  type RateLimitBucket,
} from './message-rate-limiter';
import {
  createWebSocketLogLine,
  decodeCloseReason,
  describeWebSocketError,
  type WebSocketLogContext,
  type WebSocketLogDetails,
  WebSocketSendMonitor,
} from './websocket-observability';
import { RoomManager } from '../room/room-manager';
import type { MultiplayerRoom } from '../room/multiplayer-room';

interface ClientSession {
  /** WebSocket 连接 id，重连后会变。 */
  readonly id: string;
  readonly socket: WebSocket;
  readonly tickTracker: ClientTickTracker;
  /** 稳定的战斗身份，重连后不变，用于向战斗会话报动作。 */
  playerId?: string;
  playerName?: string;
  joined: boolean;
  heartbeatAlive: boolean;
  lastInboundAtMs?: number;
  lastInboundMessageType?: string;
  roomCode?: string;
  reconnectToken?: string;
  /** 滑动窗口内被丢弃的异常输入帧数（见 noteInputAnomaly）。 */
  inputAnomalies?: number;
  /** 当前异常计数窗口的起点。 */
  inputAnomalyWindowStartMs?: number;
}

/**
 * 输入类消息异常的容忍窗口。
 *
 * 正常玩家也会在「重连补发、席位被 AI 托管、结算瞬间」这些边界上发出
 * 服务端当下不接受的输入帧——那不是作弊，直接断开等于把人踢下线。
 * 所以先丢弃该帧并计数，只有在 5 秒窗口内异常帧超过阈值（说明客户端
 * 真的在持续发垃圾）才断开连接。
 */
const INPUT_ANOMALY_WINDOW_MS = 5_000;
const INPUT_ANOMALY_KICK_THRESHOLD = 120;

export class GameWebSocketServer {
  private readonly httpServer: Server;
  private readonly websocketServer: WebSocketServer;
  private readonly reportRepository: MatchReportRepository;
  private readonly clients = new Map<WebSocket, ClientSession>();
  private readonly sendMonitor: WebSocketSendMonitor;
  private readonly roomManager: RoomManager<M2RouteId>;
  /** 房间码 -> 房间级战斗运行时。一个房间只有一份战斗。 */
  private readonly battles = new Map<string, RoomBattleRuntime>();
  /** 全员掉线的房间的延迟回收定时器，宽限期内有人回来就取消。 */
  private readonly idleTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  /** 每连接消息限流（反作弊）。 */
  private readonly rateLimiter: MessageRateLimiter;
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
    this.rateLimiter = new MessageRateLimiter(
      projectConfig.gameplay.antiCheat,
    );
    this.roomManager = new RoomManager({
      seatCount: projectConfig.allies.seatCount,
      heroNames: projectConfig.allies.heroNames,
      playerDefaultSeat: projectConfig.allies.playerDefaultSeat,
      playerRoute: this.findPrimaryRoute(),
      defaultAssignment: projectConfig.allies.deployment.defaultAssignment,
    });
    this.httpServer = createServer((request, response) => {
      if (request.url === '/healthz') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      response.writeHead(404);
      response.end();
    });

    // permessage-deflate：JSON 快照键名高度重复，压缩后约 1/4。1 房 5 人的规模下
    // CPU 开销可忽略，换来公网链路上少积压、少丢帧。用 threshold 让小消息不压。
    this.websocketServer = new WebSocketServer({
      noServer: true,
      perMessageDeflate: runtimeConfig.wsCompression
        ? {
            threshold: 512,
            // 每连接保留压缩上下文，连续帧之间的重复模式能被引用。
            serverNoContextTakeover: false,
            clientNoContextTakeover: false,
            concurrencyLimit: 4,
          }
        : false,
    });
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
    for (const battle of this.battles.values()) {
      battle.stop();
    }
    this.battles.clear();
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    for (const client of this.clients.values()) {
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
      const receivedAtMs = Date.now();
      session.heartbeatAlive = true;
      if (isBinary) {
        socket.close(1003, '仅接受 JSON 文本消息');
        return;
      }

      const message = parseClientMessage(data.toString());
      if (!message) {
        socket.close(1007, '消息格式或协议版本无效');
        return;
      }

      // 反作弊限流：武器冷却能挡住「超射速的有效开火」，但挡不住
      // 「每秒刷几千条消息」——那些消息照样要解析、算射线、广播事件。
      // 这里按类型分桶设上限，超限先丢弃，累计到阈值再断开。
      const verdict = this.rateLimiter.check(
        session.id,
        classifyRateLimitBucket(message.type),
        receivedAtMs,
      );
      if (!verdict.allowed) {
        this.logSocketEvent('warn', 'rate_limited', session, {
          messageType: message.type,
          limit: verdict.reason ?? 'unknown',
          violations: verdict.violations,
        });
        if (verdict.shouldKick) {
          socket.close(1008, '消息频率超限');
        }
        return;
      }

      session.lastInboundAtMs = receivedAtMs;
      session.lastInboundMessageType = message.type;

      switch (message.type) {
        case CLIENT_MESSAGE_TYPES.createRoom:
          this.handleCreateRoom(session, message.payload.playerName);
          return;
        case CLIENT_MESSAGE_TYPES.joinRoom:
          this.handleJoinRoom(
            session,
            message.payload.roomCode,
            message.payload.playerName,
          );
          return;
        case CLIENT_MESSAGE_TYPES.quickMatch:
          this.handleQuickMatch(session, message.payload.playerName);
          return;
        case CLIENT_MESSAGE_TYPES.playerReady:
          this.handlePlayerReady(session);
          return;
        case CLIENT_MESSAGE_TYPES.startMatch:
          this.handleStartMatch(session);
          return;
        case CLIENT_MESSAGE_TYPES.reconnect:
          this.handleReconnect(session, message.payload.reconnectToken);
          return;
        case CLIENT_MESSAGE_TYPES.join:
          if (session.joined) {
            socket.close(1008, '不能重复加入房间');
            return;
          }
          // 快捷单人入口：自建一个只有自己的房间并立即开局。
          // 铁律 3：单人也走服务器房间，只是其他席位全是 AI。
          this.startSoloMatch(session, message.payload.playerName.trim());
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
        case CLIENT_MESSAGE_TYPES.inputState: {
          // 输入帧是「最新状态」而不是增量指令，丢一帧没有任何副作用。
          // 因此任何一种不可接受都只丢弃该帧 + 计数，绝不因为单帧异常踢人：
          // 重连补发、席位被 AI 托管、结算瞬间的在途输入都会落到这里。
          const context = this.getBattleContext(session);
          if (!context) {
            this.noteInputAnomaly(session, 'no_battle_context');
            return;
          }
          if (!this.acceptClientTick(session, message.payload.clientTick)) {
            this.noteInputAnomaly(session, 'stale_client_tick');
            return;
          }
          if (!context.runtime.battle.applyInput(message, context.playerId)) {
            this.noteInputAnomaly(session, 'input_rejected');
            return;
          }
          session.inputAnomalies = 0;
          return;
        }
        case CLIENT_MESSAGE_TYPES.fire: {
          const context = this.getBattleContext(session);
          if (!context) {
            this.sendFireResolution(
              session,
              this.rejectFireBeforeJoin(message),
            );
            return;
          }
          if (!this.acceptClientTick(session, message.payload.clientTick)) {
            // 陈旧 tick 多半是重连/结算边界的在途消息，丢弃即可。
            // 这里刻意不回 fireResult：伪造的回执会把 HUD 的弹药数写花。
            this.noteInputAnomaly(session, 'stale_client_tick_fire');
            return;
          }
          this.sendFireResolution(
            session,
            context.runtime.battle.fire(
              message,
              Date.now(),
              context.playerId,
            ),
          );
          return;
        }
        case CLIENT_MESSAGE_TYPES.reload: {
          const context = this.getBattleContext(session);
          if (context) {
            context.runtime.battle.reload(
              message,
              Date.now(),
              context.playerId,
            );
          }
          return;
        }
        case CLIENT_MESSAGE_TYPES.useMedkit:
          this.handlePlayerAction(
            session,
            message.payload.clientTick,
            'use_medkit',
            (runtime, playerId) =>
              runtime.battle.tryUsePlayerMedkit(playerId),
          );
          return;
        case CLIENT_MESSAGE_TYPES.respawn:
          this.handlePlayerAction(
            session,
            message.payload.clientTick,
            'respawn',
            (runtime, playerId) =>
              runtime.battle.tryRespawnPlayer(playerId),
          );
          return;
        case CLIENT_MESSAGE_TYPES.switchWeapon:
          this.handlePlayerAction(
            session,
            message.payload.clientTick,
            'switch_weapon',
            (runtime, playerId) =>
              runtime.battle.switchPlayerWeapon(
                message.payload.weaponId,
                playerId,
              ),
          );
          return;
        case CLIENT_MESSAGE_TYPES.pickup:
          this.handlePlayerAction(
            session,
            message.payload.clientTick,
            'pickup',
            (runtime, playerId) =>
              runtime.battle.pickupItem(
                message.payload.itemId,
                Date.now(),
                playerId,
              ),
          );
          return;
        case CLIENT_MESSAGE_TYPES.throwGrenade:
          this.handlePlayerAction(
            session,
            message.payload.clientTick,
            'throw_grenade',
            (runtime, playerId) =>
              runtime.battle.throwGrenade(
                message,
                Date.now(),
                playerId,
              ),
          );
          return;
        case CLIENT_MESSAGE_TYPES.mountMg:
          this.handlePlayerAction(
            session,
            message.payload.clientTick,
            'mount_mg',
            (runtime, playerId) =>
              runtime.battle.mountMachineGun(
                message.payload.mgId,
                playerId,
              ),
          );
          return;
        case CLIENT_MESSAGE_TYPES.unmountMg:
          this.handlePlayerAction(
            session,
            message.payload.clientTick,
            'unmount_mg',
            (runtime, playerId) =>
              runtime.battle.unmountMachineGun(playerId),
          );
          return;
      }
    });

    socket.on('close', (code, reason) => {
      this.logSocketEvent('info', 'connection_close', session, {
        code,
        reason: decodeCloseReason(reason),
      });
      this.clients.delete(socket);
      // 限流计数跟着物理连接走，连接没了就清掉，避免长期运行内存增长
      this.rateLimiter.forget(session.id);
      if (session.roomCode) {
        const room = this.roomManager.get(session.roomCode);
        if (room) {
          room.markDisconnected(session.id);
          // 房主掉线时把房主交给还在线的真人，否则留下的人点不了开始。
          room.reassignHostIfNeeded();
          this.broadcastRoomState(room);
          // 还没开局的房间没有战斗运行时，stopBattleIfRoomEmpty 管不到它；
          // 这里单独回收，避免空壳房永久占用房间码并被快速匹配选中。
          this.disposeRoomIfAbandoned(room);
        }
        // PRD 7.3：先给 60 秒重连窗口，角色原地保留；
        // 超时由主循环把席位转给 AI 托管，对局继续。
        const runtime = this.battles.get(session.roomCode);
        if (runtime && session.playerId) {
          runtime.markDisconnected(session.playerId);
        }
        // 房间里没人在线了就停掉主循环，避免空房间白烧 CPU。
        this.stopBattleIfRoomEmpty(session.roomCode);
      }
      this.broadcastSnapshots();
    });

    socket.on('error', (error) => {
      this.logSocketEvent('error', 'connection_error', session, {
        ...describeWebSocketError(error),
      });
    });
  }

  private handleCreateRoom(session: ClientSession, playerName: string): void {
    if (session.joined || session.roomCode) {
      this.sendRoomActionResult(session, 'create_room', false, 'invalid_state');
      return;
    }
    session.playerName = playerName.trim();
    const room = this.roomManager.create(session.id, session.playerName);
    this.attachRoomSession(session, room);
    this.sendRoomActionResult(
      session,
      'create_room',
      true,
      undefined,
      room.id,
      session.reconnectToken,
    );
    this.broadcastRoomState(room);
  }

  private handleJoinRoom(
    session: ClientSession,
    roomCode: string,
    playerName: string,
  ): void {
    if (session.joined || session.roomCode) {
      this.sendRoomActionResult(session, 'join_room', false, 'invalid_state');
      return;
    }
    const room = this.roomManager.get(roomCode);
    if (!room) {
      this.sendRoomActionResult(session, 'join_room', false, 'invalid_room');
      return;
    }
    const result = room.createHuman(session.id, playerName.trim());
    if (!result.accepted) {
      this.sendRoomActionResult(
        session,
        'join_room',
        false,
        result.reason === 'room_full' ? 'room_full' : result.reason,
      );
      return;
    }
    session.playerName = playerName.trim();
    this.attachRoomSession(session, room);
    this.sendRoomActionResult(
      session,
      'join_room',
      true,
      undefined,
      room.id,
      result.reconnectToken,
    );
    this.broadcastRoomState(room);
  }

  private handleQuickMatch(
    session: ClientSession,
    playerName: string,
  ): void {
    if (session.joined || session.roomCode) {
      this.sendRoomActionResult(session, 'quick_match', false, 'invalid_state');
      return;
    }
    // 只匹配「还在组队 + 有空位 + 至少还有一个真人在线」的房间。
    // 少了最后一个条件，房主关掉页面后留下的空壳房会一直被匹配到，
    // 新玩家进去等一个永远不会点开始的房主——这正是「联机用不了」的一种表现。
    const room =
      this.roomManager
        .listActive()
        .find(
          (candidate) =>
            candidate.status === 'forming' &&
            candidate.seats.some((seat) => seat.occupant === null) &&
            candidate.hasConnectedHuman(),
        ) ?? this.roomManager.create(session.id, playerName.trim());
    if (room.hostId !== session.id) {
      const result = room.createHuman(session.id, playerName.trim());
      if (!result.accepted) {
        this.sendRoomActionResult(
          session,
          'quick_match',
          false,
          result.reason === 'room_full' ? 'room_full' : result.reason,
        );
        return;
      }
      if (result.reconnectToken !== undefined) {
        session.reconnectToken = result.reconnectToken;
      }
    }
    session.playerName = playerName.trim();
    this.attachRoomSession(session, room);
    this.sendRoomActionResult(
      session,
      'quick_match',
      true,
      undefined,
      room.id,
      session.reconnectToken,
    );
    this.broadcastRoomState(room);
  }

  private handlePlayerReady(session: ClientSession): void {
    const room = this.getSessionRoom(session);
    if (!room) {
      this.sendRoomActionResult(session, 'player_ready', false, 'invalid_state');
      return;
    }
    const result = room.setReady(session.id, true);
    this.sendRoomActionResult(
      session,
      'player_ready',
      result.accepted,
      result.reason === 'already_started' ? 'already_started' : result.reason,
    );
    this.broadcastRoomState(room);
  }

  private handleStartMatch(session: ClientSession): void {
    const room = this.getSessionRoom(session);
    if (!room) {
      this.sendRoomActionResult(session, 'start_match', false, 'invalid_state');
      return;
    }
    const result = room.start(session.id);
    this.sendRoomActionResult(
      session,
      'start_match',
      result.accepted,
      result.reason === 'not_host' ? 'not_host' : result.reason,
    );
    if (!result.accepted) {
      return;
    }
    // 开局时席位归属固定（PRD 11.2：v1.0 不允许中途加入），
    // 以此为准创建房间唯一的一份战斗。
    this.startRoomBattle(room);
    this.broadcastRoomState(room);
  }

  private handleReconnect(
    session: ClientSession,
    reconnectToken: string,
  ): void {
    if (session.joined || session.roomCode) {
      this.sendRoomActionResult(session, 'reconnect', false, 'invalid_state');
      return;
    }
    const room = this.roomManager.findByReconnectToken(reconnectToken);
    if (!room) {
      this.sendRoomActionResult(session, 'reconnect', false, 'invalid_token');
      return;
    }
    const result = room.reconnect(session.id, reconnectToken);
    if (!result.accepted) {
      this.sendRoomActionResult(session, 'reconnect', false, 'invalid_token');
      return;
    }
    const reconnectedOccupant = room.findSeat(session.id)?.occupant;
    if (reconnectedOccupant) {
      session.playerName = reconnectedOccupant.displayName;
    }
    if (result.reconnectToken !== undefined) {
      session.reconnectToken = result.reconnectToken;
    }
    this.attachRoomSession(session, room);
    this.sendRoomActionResult(
      session,
      'reconnect',
      true,
      undefined,
      room.id,
      result.reconnectToken,
    );
    this.broadcastRoomState(room);
    this.resumeBattleForSession(session, room);
  }

  /** 重连回一局进行中的战斗：补发开局播报、房间状态与当前快照。 */
  private resumeBattleForSession(
    session: ClientSession,
    room: MultiplayerRoom<M2RouteId>,
  ): void {
    const runtime = this.battles.get(room.id);
    if (!runtime || runtime.matchEnded) {
      return;
    }
    // 人回来了，取消这个房间的空房回收。
    const idleTimer = this.idleTimers.get(room.id);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(room.id);
    }
    // 取消重连倒计时；若已超时被 AI 托管，这里把控制权收回来（PRD 7.3）。
    if (session.playerId) {
      const releasedFromAutopilot = runtime.markReconnected(
        session.playerId,
      );
      if (releasedFromAutopilot) {
        this.logSocketEvent('info', 'autopilot_released', session, {
          playerId: session.playerId,
        });
      }
    }
    session.joined = true;
    // 重连是新的 WebSocket 连接，客户端 tick 会从头开始，
    // 沿用旧的递增校验会把人挡在门外。
    session.tickTracker.reset();
    this.send(session.socket, runtime.createMatchStart());
    this.send(session.socket, this.createBattleRoomState(room.id, runtime));
    const nowMs = Date.now();
    this.send(
      session.socket,
      runtime.battle.createSnapshot(
        runtime.currentTick,
        nowMs,
        runtime.createMatchProgress(nowMs),
      ),
    );
  }

  private attachRoomSession(
    session: ClientSession,
    room: MultiplayerRoom<M2RouteId>,
  ): void {
    session.roomCode = room.id;
    const occupant = room.findSeat(session.id)?.occupant;
    if (!occupant) {
      return;
    }
    session.reconnectToken = occupant.reconnectToken;
    // 记住稳定战斗身份：后续所有战斗动作都用它定位到席位，
    // 重连换了连接 id 也能接回原来那个人。
    session.playerId = occupant.id;
    // 入座后立刻补发一次快照，把 playerId 交给客户端。
    // 连接时那次快照还没有席位，客户端拿不到战斗身份就认不出「哪个 ally 是我」；
    // 只靠周期广播会让开局前几帧的自我识别落空。
    this.sendSnapshot(session);
  }

  private getSessionRoom(
    session: ClientSession,
  ): MultiplayerRoom<M2RouteId> | undefined {
    return session.roomCode
      ? this.roomManager.get(session.roomCode)
      : undefined;
  }

  /**
   * 战斗中的 room_state 由 M2BattleSession 生成，它只认席位不认房主，
   * 所以在这里统一补上房主的稳定身份，保证大厅阶段和战斗阶段下发的
   * room_state 字段一致，客户端只按 hostPlayerId 判定房主。
   */
  private createBattleRoomState(
    roomCode: string,
    runtime: RoomBattleRuntime,
  ): RoomStateMessage {
    const message = runtime.battle.createRoomState();
    const hostPlayerId = this.roomManager.get(roomCode)?.hostPlayerId;
    if (hostPlayerId === undefined) {
      return message;
    }
    return {
      type: message.type,
      payload: { ...message.payload, hostPlayerId },
    };
  }

  private broadcastRoomState(room: MultiplayerRoom<M2RouteId>): void {
    const message = room.toRoomState();
    const payload = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.roomCode === room.id) {
        this.sendSerialized(client.socket, message.type, payload);
      }
    }
  }

  private sendRoomActionResult(
    session: ClientSession,
    action: RoomAction,
    accepted: boolean,
    rejectReason?: RoomActionResultMessage['payload']['rejectReason'],
    roomCode?: string,
    reconnectToken?: string,
  ): void {
    const payload: RoomActionResultMessage['payload'] = accepted
      ? {
          action,
          accepted: true,
          ...(roomCode === undefined ? {} : { roomCode }),
          ...(reconnectToken === undefined ? {} : { reconnectToken }),
        }
      : {
          action,
          accepted: false,
          rejectReason: rejectReason ?? 'invalid_state',
        };
    this.send(session.socket, {
      type: SERVER_MESSAGE_TYPES.roomActionResult,
      payload,
    });
  }

  private findPrimaryRoute(): M2RouteId {
    const routeIds = Object.keys(this.projectConfig.waves.routes) as M2RouteId[];
    return routeIds[0] ?? 'A';
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

  /**
   * 单人快捷入口：自建一个只有自己的房间并立刻开局。
   * 铁律 3：单人也走服务器房间，只是其余席位全是 AI。
   */
  private startSoloMatch(session: ClientSession, playerName: string): void {
    session.playerName = playerName;
    const room = this.roomManager.create(session.id, playerName);
    this.attachRoomSession(session, room);
    room.start(session.id);
    const runtime = this.startRoomBattle(room);
    if (!runtime) {
      return;
    }
    session.joined = true;
    // 单人局同样要把重连凭证交给客户端，否则刷新/断线后无法用
    // reconnect 接回原席位，只能从头再来（问题②的一部分）。
    this.sendRoomActionResult(
      session,
      'quick_match',
      true,
      undefined,
      room.id,
      session.reconnectToken,
    );
    this.broadcastSnapshots();
    this.send(session.socket, this.createBattleRoomState(room.id, runtime));
    this.send(session.socket, runtime.createMatchStart());
    const nowMs = Date.now();
    this.send(
      session.socket,
      runtime.battle.createSnapshot(
        runtime.currentTick,
        nowMs,
        runtime.createMatchProgress(nowMs),
      ),
    );
  }

  /**
   * 为房间建立唯一的一份战斗运行时并启动 20Hz 主循环。
   * 同房成员共享世界状态、波次调度和计分，不再各打各的。
   */
  private startRoomBattle(
    room: MultiplayerRoom<M2RouteId>,
  ): RoomBattleRuntime | undefined {
    const existing = this.battles.get(room.id);
    if (existing) {
      return existing;
    }

    const humans = room.listHumanSeats();
    if (humans.length === 0) {
      return undefined;
    }

    const runtime = new RoomBattleRuntime({
      roomId: room.id,
      projectConfig: this.projectConfig,
      humans,
      startedAtMs: Date.now(),
      broadcast: (message) => {
        this.broadcastToRoom(room.id, message);
      },
      onEvents: (events) => {
        this.broadcastBattleEvents(room.id, events);
      },
      onMatchEnd: (info) => {
        this.finishRoomMatch(room, info);
      },
      onAutopilotEngaged: (playerIds) => {
        this.handleAutopilotEngaged(room, playerIds);
      },
    });
    this.battles.set(room.id, runtime);

    // 开局播报统一发一次，之后所有成员共享同一份快照流。
    const matchStart = runtime.createMatchStart();
    for (const client of this.clients.values()) {
      if (client.roomCode !== room.id) {
        continue;
      }
      client.joined = true;
      this.send(client.socket, matchStart);
    }
    runtime.start();
    return runtime;
  }

  /**
   * 掉线超过 60 秒，席位已转 AI 托管（PRD 7.3）。
   * 广播一次房间状态，让还在线的队友看到「谁被托管了」。
   */
  private handleAutopilotEngaged(
    room: MultiplayerRoom<M2RouteId>,
    playerIds: readonly string[],
  ): void {
    const runtime = this.battles.get(room.id);
    if (!runtime) {
      return;
    }
    for (const playerId of playerIds) {
      const seat = room.findSeatByPlayerId(playerId);
      console.info(
        `[autopilot_engaged] room=${room.id} seat=${seat?.index ?? '?'} ` +
          `player=${seat?.occupant?.displayName ?? playerId} ` +
          `graceSec=${this.projectConfig.gameplay.server.reconnectGraceSec}`,
      );
    }
    this.broadcastToRoom(room.id, this.createBattleRoomState(room.id, runtime));
  }

  /** 取会话所在房间的战斗上下文，含稳定战斗身份。 */
  private getBattleContext(
    session: ClientSession,
  ):
    | {
        readonly runtime: RoomBattleRuntime;
        readonly playerId: string;
      }
    | undefined {
    if (!session.joined || !session.roomCode || !session.playerId) {
      return undefined;
    }
    const runtime = this.battles.get(session.roomCode);
    if (!runtime || runtime.matchEnded) {
      return undefined;
    }
    if (!runtime.battle.hasPlayer(session.playerId)) {
      return undefined;
    }
    return { runtime, playerId: session.playerId };
  }

  /** 玩家动作的统一处理：状态校验 + tick 校验 + 结果回执。 */
  private handlePlayerAction(
    session: ClientSession,
    clientTick: number,
    action: ActionType,
    execute: (
      runtime: RoomBattleRuntime,
      playerId: string,
    ) => ActionRejectReason | undefined,
  ): void {
    const context = this.getBattleContext(session);
    if (!context) {
      this.sendActionResult(session, clientTick, action, 'invalid_state');
      return;
    }
    if (!this.acceptClientTick(session, clientTick)) {
      // 动作类消息有独立回执，陈旧 tick 回一条 invalid_state 让客户端自己重试，
      // 比直接断开连接友好得多（重连后客户端 tick 会从小值重新开始）。
      this.noteInputAnomaly(session, 'stale_client_tick_action');
      this.sendActionResult(session, clientTick, action, 'invalid_state');
      return;
    }
    this.sendActionResult(
      session,
      clientTick,
      action,
      execute(context.runtime, context.playerId),
    );
  }

  /**
   * 房间内已无在线连接时的处理。
   *
   * 不能立刻销毁：PRD 7.3 给了 60 秒重连窗口，单人局掉线后如果马上把战斗
   * 拆了，人回来就没得接了。所以这里让主循环继续跑满宽限期，
   * 到点仍无人在线才真正回收（60 秒的空转 CPU 换重连体验，值）。
   */
  private stopBattleIfRoomEmpty(roomCode: string): void {
    const runtime = this.battles.get(roomCode);
    if (!runtime) {
      return;
    }
    if (this.hasOnlineClient(roomCode)) {
      return;
    }
    if (this.idleTimers.has(roomCode)) {
      return;
    }
    const graceMs =
      this.projectConfig.gameplay.server.reconnectGraceSec * 1000;
    const timer = setTimeout(() => {
      this.idleTimers.delete(roomCode);
      // 宽限期内有人回来了就继续打，不回收。
      if (this.hasOnlineClient(roomCode)) {
        return;
      }
      this.disposeBattle(roomCode);
    }, graceMs);
    // 空房回收不该拖住进程退出。
    timer.unref?.();
    this.idleTimers.set(roomCode, timer);
  }

  /**
   * 回收「还没开局就没人了」的房间。
   *
   * stopBattleIfRoomEmpty 只管已开局的房间（它以战斗运行时为入口），
   * 于是 forming 阶段建了又走的房间会永久留在 RoomManager 里：
   * 占用房间码、被快速匹配选中、让后来的人进一个死房。
   * 这里同样给满重连宽限期——玩家刷新页面时会短暂离线，不能立刻拆房。
   */
  private disposeRoomIfAbandoned(room: MultiplayerRoom<M2RouteId>): void {
    if (room.status !== 'forming') {
      return;
    }
    if (this.hasOnlineClient(room.id) || this.idleTimers.has(room.id)) {
      return;
    }
    const graceMs =
      this.projectConfig.gameplay.server.reconnectGraceSec * 1000;
    const timer = setTimeout(() => {
      this.idleTimers.delete(room.id);
      const current = this.roomManager.get(room.id);
      if (!current || current.status !== 'forming') {
        return;
      }
      // 宽限期内有人回来就留着。
      if (this.hasOnlineClient(room.id)) {
        return;
      }
      current.markEnded();
      this.roomManager.delete(room.id);
      console.info(`[room_disposed] room=${room.id} reason=forming_abandoned`);
    }, graceMs);
    timer.unref?.();
    this.idleTimers.set(room.id, timer);
  }

  private hasOnlineClient(roomCode: string): boolean {
    for (const client of this.clients.values()) {
      if (client.roomCode === roomCode) {
        return true;
      }
    }
    return false;
  }

  /** 回收房间战斗：停主循环、清引用、把房间标记为结束。 */
  private disposeBattle(roomCode: string): void {
    const runtime = this.battles.get(roomCode);
    if (runtime) {
      runtime.stop();
      this.battles.delete(roomCode);
    }
    const timer = this.idleTimers.get(roomCode);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(roomCode);
    }
    const room = this.roomManager.get(roomCode);
    if (room) {
      room.markEnded();
      // 房间生命周期到此为止，从管理器移除，避免长期运行后 Map 只增不减。
      this.roomManager.delete(roomCode);
    }
  }

  /**
   * 向房间内全部已入局连接广播同一条消息。
   *
   * 全房间收到的内容完全相同，因此**只序列化一次**再复用给每个连接。
   * 世界快照走的就是这条路径（20Hz × 满员 5 人），按连接各 stringify 一次
   * 会让序列化开销随人数线性上涨，属于 AGENTS.md 明令禁止的热路径浪费。
   */
  private broadcastToRoom(
    roomCode: string,
    message: ServerMessage,
  ): void {
    let payload: string | undefined;
    for (const client of this.clients.values()) {
      if (client.roomCode === roomCode && client.joined) {
        // 懒序列化：房间里一个可发送的连接都没有时不做无用功。
        payload ??= JSON.stringify(message);
        this.sendSerialized(client.socket, message.type, payload);
      }
    }
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

  /** 一局结束：落库战报，向全房广播终局快照与战报。 */
  private finishRoomMatch(
    room: MultiplayerRoom<M2RouteId>,
    info: RoomBattleEndInfo,
  ): void {
    const runtime = this.battles.get(room.id);
    if (!runtime) {
      return;
    }
    const endedAtSec = Math.max(
      0,
      (info.endedAtMs - runtime.startedAtMs) / 1000,
    );
    const scoreboard = runtime.battle.createScoreboard(endedAtSec);
    const mvpPlayerId = runtime.battle.selectMvpPlayerId(endedAtSec);
    const message: MatchEndMessage = {
      type: SERVER_MESSAGE_TYPES.matchEnd,
      payload: {
        matchId: runtime.battle.room.id,
        result: info.outcome.result,
        reason: info.outcome.reason,
        endedAtMs: info.endedAtMs,
        scoreboard,
        ...(mvpPlayerId === undefined ? {} : { mvpPlayerId }),
        spawnedEnemies: info.progress.spawnedEnemies,
        defeatedEnemies: info.progress.defeatedEnemies,
        totalEnemies: info.progress.totalEnemies,
      },
    };
    this.reportRepository.save({
      ...message.payload,
      startedAtMs: runtime.startedAtMs,
    });

    this.broadcastToRoom(room.id, this.createBattleRoomState(room.id, runtime));
    this.broadcastToRoom(
      room.id,
      runtime.battle.createSnapshot(
        info.tick,
        info.endedAtMs,
        info.progress,
      ),
    );
    this.broadcastToRoom(room.id, message);
    room.markEnded();
    this.battles.delete(room.id);
    // 战报已发，重连也没意义了，顺手把空房回收定时器撤掉。
    const idleTimer = this.idleTimers.get(room.id);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(room.id);
    }
  }

  private acceptClientTick(
    session: ClientSession,
    clientTick: number,
  ): boolean {
    return session.tickTracker.accept(clientTick);
  }

  /**
   * 记录一帧被丢弃的异常输入。
   *
   * 设计取舍（问题①的根因修复）：旧实现只要有一帧输入不被接受就
   * `close(1008)`，于是「重连后补发的旧 tick」「席位被 AI 托管期间的输入」
   * 「结算瞬间还在路上的输入」全都会把正常玩家踢下线，表现就是偶发断线。
   * 现在改成：丢弃该帧，并在 5 秒滑动窗口内计数；只有窗口内异常帧数超过
   * 阈值（客户端持续发无效数据）才断开，正常的边界抖动不会触发。
   */
  private noteInputAnomaly(session: ClientSession, reason: string): void {
    const now = Date.now();
    const windowStart = session.inputAnomalyWindowStartMs ?? now;
    if (now - windowStart > INPUT_ANOMALY_WINDOW_MS) {
      session.inputAnomalyWindowStartMs = now;
      session.inputAnomalies = 0;
    } else if (session.inputAnomalyWindowStartMs === undefined) {
      session.inputAnomalyWindowStartMs = now;
    }
    const count = (session.inputAnomalies ?? 0) + 1;
    session.inputAnomalies = count;

    // 日志按次数降频：第 1 次和每到阈值 1/4 时各打一条，避免刷爆日志。
    if (count === 1 || count % Math.floor(INPUT_ANOMALY_KICK_THRESHOLD / 4) === 0) {
      this.logSocketEvent('warn', 'input_dropped', session, {
        reason,
        anomalies: count,
      });
    }

    if (count >= INPUT_ANOMALY_KICK_THRESHOLD) {
      this.logSocketEvent('warn', 'input_anomaly_kick', session, {
        reason,
        anomalies: count,
      });
      session.socket.close(1008, '输入数据持续无效');
    }
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

  /** 把一个 tick 产生的战斗事件广播给全房。 */
  private broadcastBattleEvents(
    roomCode: string,
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
          this.broadcastToRoom(roomCode, message);
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
          this.broadcastToRoom(roomCode, message);
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
          this.broadcastToRoom(roomCode, message);
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
          this.broadcastToRoom(roomCode, message);
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
          this.broadcastToRoom(roomCode, message);
          break;
        }
        case 'fire_warning':
        case 'shot':
          break;
      }
    }

    const runtime = this.battles.get(roomCode);
    if (roomStateChanged && runtime) {
      this.broadcastToRoom(
        roomCode,
        this.createBattleRoomState(roomCode, runtime),
      );
    }
  }

  private broadcastSnapshots(): void {
    for (const client of this.clients.values()) {
      this.sendSnapshot(client);
    }
  }

  private sendSnapshot(session: ClientSession): void {
    // clientId 是连接 id，重连就变；playerId 才是稳定战斗身份。
    // 客户端要认出「哪个 ally 是我」只能靠后者，所以入座后必须一并下发。
    const connection: ConnectionSnapshot = {
      clientId: session.id,
      joined: session.joined,
      ...(session.playerName ? { playerName: session.playerName } : {}),
      ...(session.playerId ? { playerId: session.playerId } : {}),
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
    const nowMs = Date.now();
    const runtime = session.roomCode
      ? this.battles.get(session.roomCode)
      : undefined;
    let matchPhase = session.joined ? 'starting' : 'not_joined';
    let currentWaveIndex: number | null = null;
    let elapsedSec: number | null = null;

    if (runtime) {
      const described = runtime.describeProgress(nowMs);
      matchPhase = described.phase;
      currentWaveIndex = described.currentWaveIndex;
      elapsedSec = described.elapsedSec;
    }

    return {
      clientId: session.id,
      joined: session.joined,
      roomId: session.roomCode ?? null,
      matchPhase,
      currentWaveIndex,
      playerAlive:
        runtime && session.playerId
          ? runtime.battle.isPlayerAlive(session.playerId)
          : null,
      matchEnded: runtime?.matchEnded ?? false,
      elapsedSec,
      bufferedAmount: session.socket.bufferedAmount,
      lastInboundAtMs: session.lastInboundAtMs ?? null,
      lastInboundAgeMs:
        session.lastInboundAtMs === undefined
          ? null
          : Math.max(0, nowMs - session.lastInboundAtMs),
      lastInboundMessageType:
        session.lastInboundMessageType ?? null,
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
    this.sendSerialized(socket, message.type, JSON.stringify(message));
  }

  /**
   * 发送已序列化好的消息体。
   * 广播场景下由调用方复用同一份字符串，避免按连接重复序列化。
   */
  private sendSerialized(
    socket: WebSocket,
    messageType: ServerMessage['type'],
    payload: string,
  ): void {
    const session = this.clients.get(socket);
    if (!session) {
      return;
    }
    this.sendMonitor.send(
      socket,
      payload,
      messageType,
      () => this.createLogContext(session),
      messageType === SERVER_MESSAGE_TYPES.worldSnapshot
        ? this.runtimeConfig.wsSnapshotDropBytes
        : undefined,
    );
  }
}

/**
 * 把消息类型归到限流分桶。
 * 只有输入和开火在热路径上高频出现，需要单独设上限；
 * 其余（建房、加入、准备、ping 等）走总量上限即可。
 */
function classifyRateLimitBucket(messageType: string): RateLimitBucket {
  if (messageType === CLIENT_MESSAGE_TYPES.inputState) {
    return 'input';
  }
  if (
    messageType === CLIENT_MESSAGE_TYPES.fire ||
    messageType === CLIENT_MESSAGE_TYPES.throwGrenade
  ) {
    return 'fire';
  }
  return 'other';
}
