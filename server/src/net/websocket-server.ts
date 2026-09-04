import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

import { WebSocket, WebSocketServer } from 'ws';

import {
  CLIENT_MESSAGE_TYPES,
  SERVER_MESSAGE_TYPES,
  type PongMessage,
  type ServerMessage,
  type SnapshotMessage,
} from '../../../shared/protocol';
import type { RuntimeConfig } from '../config/runtime-config';
import { parseClientMessage } from './message-parser';

interface ClientSession {
  readonly id: string;
  readonly socket: WebSocket;
  playerName?: string;
  joined: boolean;
}

export class GameWebSocketServer {
  private readonly httpServer: Server;
  private readonly websocketServer: WebSocketServer;
  private readonly clients = new Map<WebSocket, ClientSession>();
  private snapshotSequence = 0;

  constructor(private readonly runtimeConfig: RuntimeConfig) {
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
    const session: ClientSession = {
      id: randomUUID(),
      socket,
      joined: false,
    };
    this.clients.set(socket, session);
    this.sendSnapshot(session);

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        socket.close(1003, 'M0 仅接受 JSON 文本消息');
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
          this.broadcastSnapshots();
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
        case CLIENT_MESSAGE_TYPES.fire:
        case CLIENT_MESSAGE_TYPES.reload:
          return;
      }
    });

    socket.on('close', () => {
      this.clients.delete(socket);
      this.broadcastSnapshots();
    });

    socket.on('error', (error) => {
      console.error(`[ws] 客户端 ${session.id} 连接异常`, error);
    });
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
