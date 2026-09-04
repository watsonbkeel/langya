#!/usr/bin/env node
/**
 * M2 权威 AI 链路自测：
 * join -> room_state -> 5 席快照 -> 三路敌情 -> 开火预警。
 * 喊话受实时战况影响，收到时校验服务端文案；阈值与冷却由确定性单测覆盖。
 */

'use strict';

const gameplay = require('../shared/config/gameplay.json');
const allies = require('../shared/config/allies.json');
const waves = require('../shared/config/waves.json');

let WebSocket;
try {
  WebSocket = require('ws');
} catch {
  try {
    WebSocket = require('../server/node_modules/ws');
  } catch {
    console.error('❌ 找不到 ws 模块，请先安装服务端依赖');
    process.exit(1);
  }
}

const url = process.argv[2] || 'ws://127.0.0.1:8081/ws';
const firstWave = waves.waves[0];
const timeoutMs =
  ((firstWave?.startSec ?? gameplay.match.deployPhaseSec) +
    (firstWave?.squadIntervalSec ?? waves.intermissionSec) * 2 +
    allies.callout.cooldownSec +
    gameplay.match.deployPhaseSec) *
  1000;
const expectedRoutes = Object.keys(waves.routes).sort();
let roomStatePassed = false;
let snapshotPassed = false;
let snapshotLogged = false;
let warningPassed = false;
let warningLogged = false;
let calloutPassed = false;
let finished = false;

console.log(`→ 正在验证 M2 AI 链路 ${url} ...`);
const socket = new WebSocket(url);
const timer = setTimeout(() => {
  console.error('❌ M2 AI 链路验证超时');
  socket.terminate();
  process.exit(1);
}, timeoutMs);

function finishIfComplete() {
  if (
    finished ||
    !roomStatePassed ||
    !snapshotPassed ||
    !warningPassed
  ) {
    return;
  }

  finished = true;
  clearTimeout(timer);
  console.log('✅ M2 权威 AI 链路全部通过');
  socket.close();
}

socket.on('open', () => {
  socket.send(JSON.stringify({
    type: 'join',
    payload: {
      playerName: 'M2 自测',
      protocolVersion: 1,
    },
  }));
});

socket.on('message', (data) => {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch {
    console.error('❌ 服务端返回非 JSON 消息');
    process.exit(1);
  }

  if (message.type === 'room_state') {
    const seats = message.payload?.seats;
    if (
      !Array.isArray(seats) ||
      seats.length !== allies.seatCount ||
      seats.some((seat, index) => seat.seatIndex !== index)
    ) {
      console.error(`❌ room_state 席位异常：${JSON.stringify(message.payload)}`);
      process.exit(1);
    }
    if (!roomStatePassed) {
      roomStatePassed = true;
      console.log('✅ room_state 为按 seatIndex 排序的固定五席');
    }
    finishIfComplete();
    return;
  }

  if (message.type === 'ally_callout') {
    if (
      typeof message.payload?.text !== 'string' ||
      message.payload.text.length === 0
    ) {
      console.error('❌ ally_callout 缺少服务端文案');
      process.exit(1);
    }
    if (!calloutPassed) {
      calloutPassed = true;
      console.log(`✅ 收到服务端喊话：${message.payload.text}`);
    }
    finishIfComplete();
    return;
  }

  if (message.type !== 'world_snapshot') {
    return;
  }

  const payload = message.payload;
  if (
    !Array.isArray(payload?.allies) ||
    payload.allies.length !== allies.seatCount ||
    !Array.isArray(payload.enemies)
  ) {
    console.error('❌ world_snapshot 缺少五席或敌人状态');
    process.exit(1);
  }

  const threatCounts = Object.fromEntries(
    expectedRoutes.map((routeId) => [routeId, 0]),
  );
  for (const enemy of payload.enemies) {
    if (enemy.alive && enemy.routeId in threatCounts) {
      threatCounts[enemy.routeId] += 1;
    }
    if (
      typeof enemy.fireWarningEndsAtMs === 'number' &&
      enemy.fireWarningEndsAtMs > payload.serverTimeMs
    ) {
      warningPassed = true;
    }
  }
  if (
    expectedRoutes.every(
      (routeId) => threatCounts[routeId] > 0,
    )
  ) {
    snapshotPassed = true;
  }

  if (snapshotPassed && !snapshotLogged) {
    snapshotLogged = true;
    console.log(
      `✅ 五席快照与三路威胁通过：${JSON.stringify(threatCounts)}`,
    );
  }
  if (warningPassed && !warningLogged) {
    warningLogged = true;
    console.log('✅ 开火预警截止时间基于 world_snapshot.serverTimeMs');
  }
  finishIfComplete();
});

socket.on('error', (error) => {
  clearTimeout(timer);
  console.error(`❌ 连接失败：${error.message}`);
  process.exit(1);
});

socket.on('close', (code) => {
  clearTimeout(timer);
  if (finished) {
    process.exit(0);
  }
  console.error(`❌ 连接提前关闭（code=${code}）`);
  process.exit(1);
});
