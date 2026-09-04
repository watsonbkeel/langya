import { WebSocket } from 'ws';

const CLOSE_REASON_LOG_LIMIT = 256;

export interface WebSocketLogContext {
  readonly clientId: string;
  readonly joined: boolean;
  readonly roomId: string | null;
  readonly matchPhase: string;
  readonly currentWaveIndex: number | null;
  readonly playerAlive: boolean | null;
  readonly matchEnded: boolean;
  readonly elapsedSec: number | null;
  readonly bufferedAmount: number;
}

export type WebSocketLogDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface WebSocketDiagnosticLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface MonitoredWebSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string, callback: (error?: Error) => void): void;
}

export function createWebSocketLogLine(
  event: string,
  context: WebSocketLogContext,
  details: WebSocketLogDetails = {},
): string {
  return `[ws] ${JSON.stringify({
    event,
    ...context,
    ...details,
  })}`;
}

export function decodeCloseReason(reason: Buffer): string {
  const text = reason.toString('utf8');
  const characters = Array.from(text);
  if (characters.length <= CLOSE_REASON_LOG_LIMIT) {
    return text;
  }
  return `${characters.slice(0, CLOSE_REASON_LOG_LIMIT).join('')}…`;
}

export function describeWebSocketError(error: unknown): {
  readonly errorName: string;
  readonly errorMessage: string;
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    };
  }
  return {
    errorName: 'UnknownError',
    errorMessage: String(error),
  };
}

export class WebSocketSendMonitor {
  private readonly lastBackpressureLogAtMs =
    new WeakMap<MonitoredWebSocket, number>();
  private readonly lastSendErrorLogAtMs =
    new WeakMap<MonitoredWebSocket, number>();

  constructor(
    private readonly backpressureWarnBytes: number,
    private readonly backpressureLogIntervalMs: number,
    private readonly logger: WebSocketDiagnosticLogger = console,
    private readonly now: () => number = Date.now,
  ) {
    if (
      !Number.isInteger(backpressureWarnBytes) ||
      backpressureWarnBytes < 1
    ) {
      throw new RangeError('WebSocket 积压告警阈值必须是正整数');
    }
    if (
      !Number.isInteger(backpressureLogIntervalMs) ||
      backpressureLogIntervalMs < 1
    ) {
      throw new RangeError('WebSocket 积压告警间隔必须是正整数');
    }
  }

  send(
    socket: MonitoredWebSocket,
    data: string,
    messageType: string,
    getContext: () => WebSocketLogContext,
    dropWhenBackpressured = false,
  ): boolean {
    if (socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    const bufferedAmount = socket.bufferedAmount;
    if (bufferedAmount >= this.backpressureWarnBytes) {
      const nowMs = this.now();
      const lastLogAtMs = this.lastBackpressureLogAtMs.get(socket);
      if (
        lastLogAtMs === undefined ||
        nowMs - lastLogAtMs >= this.backpressureLogIntervalMs
      ) {
        this.lastBackpressureLogAtMs.set(socket, nowMs);
        this.logger.warn(
          createWebSocketLogLine('send_backpressure', getContext(), {
            messageType,
            bufferedAmount,
            action: dropWhenBackpressured ? 'drop' : 'send',
          }),
        );
      }
    }

    if (dropWhenBackpressured && bufferedAmount >= this.backpressureWarnBytes) {
      return false;
    }

    try {
      socket.send(data, (error) => {
        if (!error) {
          return;
        }
        this.logSendError(socket, messageType, getContext, error);
      });
      return true;
    } catch (error: unknown) {
      this.logSendError(socket, messageType, getContext, error);
      return false;
    }
  }

  private logSendError(
    socket: MonitoredWebSocket,
    messageType: string,
    getContext: () => WebSocketLogContext,
    error: unknown,
  ): void {
    const nowMs = this.now();
    const lastLogAtMs = this.lastSendErrorLogAtMs.get(socket);
    if (
      lastLogAtMs !== undefined &&
      nowMs - lastLogAtMs < this.backpressureLogIntervalMs
    ) {
      return;
    }
    this.lastSendErrorLogAtMs.set(socket, nowMs);
    this.logger.error(
      createWebSocketLogLine('send_error', getContext(), {
        messageType,
        ...describeWebSocketError(error),
      }),
    );
  }
}
