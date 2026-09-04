import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

import { WebSocket, WebSocketServer } from 'ws';

import {
  CLIENT_MESSAGE_TYPES,
  SERVER_MESSAGE_TYPES,
  type AllyCalloutMessage,
  type AllyDamagedMessage,
  type AllyDiedMessage,
  type EnemyDiedMessage,
  type FireMessage,
  type PongMessage,
  type ServerMessage,
  type SnapshotMessage,
} from '../../../shared/protocol';
import type { ProjectConfig } from '../config/project-config';
import type { RuntimeConfig } from '../config/runtime-config';
import { GameLoop } from '../game/game-loop';
import { findPlayerWeaponConfig } from '../game/m1-battle-factory';
import {
  createM2BattleRuntime,
  populateM2Battlefield,
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

interface ClientSession {
  readonly id: string;
  readonly socket: WebSocket;
  readonly tickTracker: ClientTickTracker;
  battle?: M2BattleSession<M2RouteId, M2EnemyType>;
  loop: GameLoop | undefined;
  playerName?: string;
  joined: boolean;
}

export class GameWebSocketServer {
  private readonly httpServer: Server;
  private readonly websocketServer: WebSocketServer;
  private readonly clients = new Map<WebSocket, ClientSession>();
  private snapshotSequence = 0;

  constructor(
    private readonly runtimeConfig: RuntimeConfig,
    private readonly projectConfig: ProjectConfig,
  ) {
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
          resolve();
        },
      );
    });
  }

  stop(): Promise<void> {
    for (const client of this.clients.values()) {
      client.loop?.stop();
      client.socket.close();
    }

    return new Promise((resolve, reject) => {
      this.websocketServer.close();
      this.httpServer.close((error) => {
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
      loop: undefined,
      joined: false,
    };
    this.clients.set(socket, session);
    this.sendSnapshot(session);

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
          this.send(
            session.socket,
            session.battle!.createSnapshot(
              session.loop?.currentTick ?? 0,
              Date.now(),
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
            !session.battle ||
            !this.acceptClientTick(session, message.payload.clientTick) ||
            !session.battle.applyInput(message)
          ) {
            socket.close(1008, '输入状态无效');
          }
          return;
        case CLIENT_MESSAGE_TYPES.fire:
          if (!session.joined || !session.battle) {
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
          if (session.joined && session.battle) {
            session.battle.reload(message, Date.now());
          }
          return;
      }
    });

    socket.on('close', () => {
      session.loop?.stop();
      this.clients.delete(socket);
      this.broadcastSnapshots();
    });

    socket.on('error', (error) => {
      console.error(`[ws] 客户端 ${session.id} 连接异常`, error);
    });
  }

  private startBattle(session: ClientSession): void {
    const runtime = createM2BattleRuntime(
      this.projectConfig,
      session.id,
      session.playerName ?? session.id,
      Date.now(),
    );
    const nowMs = Date.now();
    populateM2Battlefield(this.projectConfig, runtime.battle, nowMs);
    session.battle = runtime.battle;
    session.loop = new GameLoop({
      tickRateHz: runtime.tickRateHz,
      onTick: ({ tick, deltaSec }) => {
        const battle = session.battle;
        if (!session.joined || !battle) {
          return;
        }

        const tickNowMs = Date.now();
        const events = battle.update(deltaSec, tick, tickNowMs);
        this.sendBattleEvents(session, events);
        this.send(
          session.socket,
          battle.createSnapshot(tick, tickNowMs),
        );
      },
    });
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

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}
