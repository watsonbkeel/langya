import type {
  ClientMessage,
  PongMessage,
} from '../../../../shared/protocol';

import { getWebSocketUrl } from './server-config';

export type ConnectionStatus =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'measuring' }
  | { readonly kind: 'connected'; readonly latencyMs: number }
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'error'; readonly message: string };

type StatusListener = (status: ConnectionStatus) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPongMessage(value: unknown): value is PongMessage {
  if (
    !isRecord(value) ||
    value.type !== 'pong' ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  return (
    typeof value.payload.clientTimeMs === 'number' &&
    Number.isFinite(value.payload.clientTimeMs) &&
    typeof value.payload.serverTimeMs === 'number' &&
    Number.isFinite(value.payload.serverTimeMs)
  );
}

function parsePongMessage(raw: string): PongMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  return isPongMessage(parsed) ? parsed : undefined;
}

export class NetClient {
  private socket: WebSocket | null = null;
  private readonly listener: StatusListener;

  constructor(listener: StatusListener) {
    this.listener = listener;
  }

  async connect(): Promise<void> {
    this.disconnect();
    this.listener({ kind: 'connecting' });

    let url: string;
    try {
      url = await getWebSocketUrl();
    } catch (error: unknown) {
      this.listener({ kind: 'error', message: this.describeError(error) });
      return;
    }

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }

      const pingMessage: ClientMessage = {
        type: 'ping',
        payload: { clientTimeMs: Date.now() },
      };
      socket.send(JSON.stringify(pingMessage));
      this.listener({ kind: 'measuring' });
    });

    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (this.socket !== socket || typeof event.data !== 'string') {
        return;
      }

      const message = parsePongMessage(event.data);
      if (!message) {
        return;
      }

      const latencyMs = Math.max(
        0,
        Math.round(Date.now() - message.payload.clientTimeMs),
      );
      this.listener({ kind: 'connected', latencyMs });
    });

    socket.addEventListener('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.listener({ kind: 'disconnected' });
      }
    });

    socket.addEventListener('error', () => {
      if (this.socket === socket) {
        this.listener({ kind: 'error', message: '无法连接服务器' });
      }
    });
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : '未知错误';
  }
}
