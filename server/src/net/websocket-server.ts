import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

import { WebSocket, WebSocketServer } from 'ws';

import {
  CLIENT_MESSAGE_TYPES,
  SERVER_MESSAGE_TYPES,
  type FireMessage,
  type PongMessage,
  type ServerMessage,
  type SnapshotMessage,
} from '../../../shared/protocol';
import type { ProjectConfig } from '../config/project-config';
import type { RuntimeConfig } from '../config/runtime-config';
import { BattleSession } from '../game/battle-session';
import { GameLoop } from '../game/game-loop';
import { createM1BattleRuntime } from '../game/m1-battle-factory';
import { ClientTickTracker } from './client-tick-tracker';
import { parseClientMessage } from './message-parser';

interface ClientSession {
  readonly id: string;
  readonly socket: WebSocket;
  readonly battle: BattleSession;
  readonly tickTracker: ClientTickTracker;
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
    const runtime = createM1BattleRuntime(this.projectConfig, id);
    const session: ClientSession = {
      id,
      socket,
      battle: runtime.battle,
      tickTracker: new ClientTickTracker(),
      loop: undefined,
      joined: false,
    };
    session.loop = new GameLoop({
      tickRateHz: runtime.tickRateHz,
      onTick: ({ tick, deltaSec }) => {
        if (!session.joined) {
          return;
        }

        const nowMs = Date.now();
        session.battle.update(deltaSec, nowMs);
        this.send(
          session.socket,
          session.battle.createSnapshot(tick, nowMs),
        );
      },
    });
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
          session.playerName = message.payload.playerName.trim();
          session.joined = true;
          session.loop?.start();
          this.broadcastSnapshots();
          this.send(
            session.socket,
            session.battle.createSnapshot(
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
            !this.acceptClientTick(session, message.payload.clientTick) ||
            !session.battle.applyInput(message)
          ) {
            socket.close(1008, '输入状态无效');
          }
          return;
        case CLIENT_MESSAGE_TYPES.fire:
          if (!session.joined) {
            this.sendFireResolution(
              session,
              session.battle.rejectFire(message, 'not_joined'),
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
          if (session.joined) {
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

  private acceptClientTick(
    session: ClientSession,
    clientTick: number,
  ): boolean {
    return session.tickTracker.accept(clientTick);
  }

  private sendFireResolution(
    session: ClientSession,
    resolution: ReturnType<BattleSession['fire']>,
  ): void {
    this.send(session.socket, resolution.result);
    if (resolution.death) {
      this.send(session.socket, resolution.death);
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
