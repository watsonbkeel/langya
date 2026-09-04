import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WebSocket } from 'ws';

import {
  createWebSocketLogLine,
  decodeCloseReason,
  type MonitoredWebSocket,
  type WebSocketDiagnosticLogger,
  type WebSocketLogContext,
  WebSocketSendMonitor,
} from './websocket-observability';

const context: WebSocketLogContext = {
  clientId: 'client-1',
  joined: true,
  roomId: 'room-1',
  matchPhase: 'wave',
  currentWaveIndex: 3,
  playerAlive: true,
  matchEnded: false,
  elapsedSec: 170.5,
  bufferedAmount: 0,
};

class RecordingLogger implements WebSocketDiagnosticLogger {
  readonly infoLines: string[] = [];
  readonly warnLines: string[] = [];
  readonly errorLines: string[] = [];

  info(message: string): void {
    this.infoLines.push(message);
  }

  warn(message: string): void {
    this.warnLines.push(message);
  }

  error(message: string): void {
    this.errorLines.push(message);
  }
}

class FakeSocket implements MonitoredWebSocket {
  readyState: number = WebSocket.OPEN;
  bufferedAmount: number = 0;
  readonly sent: string[] = [];
  callbackError: Error | undefined;
  synchronousError: Error | undefined;

  send(data: string, callback: (error?: Error) => void): void {
    if (this.synchronousError) {
      throw this.synchronousError;
    }
    this.sent.push(data);
    callback(this.callbackError);
  }
}

test('正常发送不产生告警', () => {
  const logger = new RecordingLogger();
  const socket = new FakeSocket();
  const monitor = new WebSocketSendMonitor(1_024, 5_000, logger);

  assert.equal(
    monitor.send(socket, '{"type":"snapshot"}', 'snapshot', () => context),
    true,
  );
  assert.deepEqual(socket.sent, ['{"type":"snapshot"}']);
  assert.deepEqual(logger.warnLines, []);
  assert.deepEqual(logger.errorLines, []);
});

test('积压时丢弃可替代快照但继续发送关键消息', () => {
  const logger = new RecordingLogger();
  const socket = new FakeSocket();
  socket.bufferedAmount = 2_048;
  let nowMs = 10_000;
  const monitor = new WebSocketSendMonitor(
    1_024,
    5_000,
    logger,
    () => nowMs,
  );

  assert.equal(
    monitor.send(
      socket,
      'first',
      'world_snapshot',
      () => context,
      true,
    ),
    false,
  );
  nowMs += 1_000;
  assert.equal(
    monitor.send(
      socket,
      'second',
      'world_snapshot',
      () => context,
      true,
    ),
    false,
  );
  nowMs += 5_000;
  assert.equal(
    monitor.send(socket, 'critical', 'match_end', () => context),
    true,
  );

  assert.deepEqual(socket.sent, ['critical']);
  assert.equal(logger.warnLines.length, 2);
  assert.match(logger.warnLines[0] ?? '', /"event":"send_backpressure"/);
  assert.match(logger.warnLines[0] ?? '', /"bufferedAmount":2048/);
  assert.match(logger.warnLines[0] ?? '', /"action":"drop"/);
  assert.match(logger.warnLines[1] ?? '', /"action":"send"/);
});

test('异步和同步发送错误都会记录上下文并按连接节流', () => {
  const logger = new RecordingLogger();
  const asyncSocket = new FakeSocket();
  asyncSocket.callbackError = new Error('write failed');
  const monitor = new WebSocketSendMonitor(1_024, 5_000, logger);

  assert.equal(
    monitor.send(asyncSocket, 'payload', 'world_snapshot', () => context),
    true,
  );
  assert.equal(
    monitor.send(asyncSocket, 'payload-2', 'world_snapshot', () => context),
    true,
  );

  const syncSocket = new FakeSocket();
  syncSocket.synchronousError = new Error('socket closed');
  assert.equal(
    monitor.send(syncSocket, 'payload', 'match_end', () => context),
    false,
  );
  assert.equal(logger.errorLines.length, 2);
  assert.match(logger.errorLines[0] ?? '', /"messageType":"world_snapshot"/);
  assert.match(logger.errorLines[0] ?? '', /"errorMessage":"write failed"/);
  assert.match(logger.errorLines[1] ?? '', /"messageType":"match_end"/);
  assert.match(logger.errorLines[1] ?? '', /"errorMessage":"socket closed"/);
});

test('非 OPEN 连接不发送', () => {
  const logger = new RecordingLogger();
  const socket = new FakeSocket();
  socket.readyState = WebSocket.CLOSED;
  const monitor = new WebSocketSendMonitor(1_024, 5_000, logger);

  assert.equal(monitor.send(socket, 'payload', 'snapshot', () => context), false);
  assert.deepEqual(socket.sent, []);
});

test('关闭原因按字符安全截断，结构化日志保留诊断字段', () => {
  const longReason = Buffer.from('测'.repeat(300));
  const decoded = decodeCloseReason(longReason);
  assert.equal(Array.from(decoded).length, 257);
  assert.equal(decoded.endsWith('…'), true);

  const line = createWebSocketLogLine('connection_close', context, {
    code: 1006,
    reason: decoded,
  });
  assert.match(line, /^\[ws\] /);
  assert.match(line, /"currentWaveIndex":3/);
  assert.match(line, /"playerAlive":true/);
  assert.match(line, /"code":1006/);
});
