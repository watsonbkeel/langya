#!/usr/bin/env node
/**
 * WebSocket 连通性自测脚本
 *
 * 用途：M0 起每次部署后必跑，验证 WS 服务可握手、可收消息。
 *
 * 用法：
 *   node tools/check-ws.js                                  # 默认 ws://127.0.0.1:8081/ws
 *   node tools/check-ws.js ws://127.0.0.1:8081/ws
 *   node tools/check-ws.js ws://100.126.150.80:8081/ws      # Tailscale 内网验证（关键）
 *
 * 退出码：0 = 成功，1 = 失败（可用于 CI / deploy.sh 中断）
 *
 * 依赖：ws（服务端已依赖，直接复用 server/node_modules）
 */

'use strict';

let WebSocket;
try {
  WebSocket = require('ws');
} catch (e) {
  try {
    WebSocket = require('../server/node_modules/ws');
  } catch (e2) {
    console.error('❌ 找不到 ws 模块。请在 server/ 目录执行 npm install，或在根目录安装 ws。');
    process.exit(1);
  }
}

const url = process.argv[2] || 'ws://127.0.0.1:8081/ws';
const TIMEOUT_MS = 5000;
const PROTOCOL_VERSION = 1;

console.log(`→ 正在连接 ${url} ...`);

const started = Date.now();
const ws = new WebSocket(url);
let receivedSnapshot = false;
let receivedPong = false;
let reportedWorldSnapshot = false;
let finished = false;

const timer = setTimeout(() => {
  console.error(`❌ 连接超时（${TIMEOUT_MS}ms 内未收到服务端消息）`);
  console.error('   排查方向：');
  console.error('   1. 服务是否在跑？ pm2 status');
  console.error('   2. 是否监听 0.0.0.0 而非 127.0.0.1？（Tailscale 访问必须）');
  console.error('   3. Nginx 转发是否配了 Upgrade 头？');
  try { ws.terminate(); } catch (_) {}
  process.exit(1);
}, TIMEOUT_MS);

ws.on('open', () => {
  console.log(`✅ 握手成功（${Date.now() - started}ms）`);
  try {
    ws.send(JSON.stringify({
      type: 'join',
      payload: {
        playerName: 'M0 自测',
        protocolVersion: PROTOCOL_VERSION,
      },
    }));
    ws.send(JSON.stringify({
      type: 'ping',
      payload: {
        clientTimeMs: Date.now(),
      },
    }));
  } catch (_) {}
});

ws.on('message', (data) => {
  const raw = data.toString();
  let message;
  try {
    message = JSON.parse(raw);
  } catch (_) {
    console.error(`❌ 服务端返回了非 JSON 消息：${raw.slice(0, 200)}`);
    process.exit(1);
  }

  if (message.type === 'snapshot') {
    receivedSnapshot = true;
    console.log(`✅ 收到 snapshot（在线连接 ${message.payload.onlineClients}）`);
  } else if (message.type === 'pong') {
    receivedPong = true;
    const latencyMs = Date.now() - message.payload.clientTimeMs;
    console.log(`✅ 收到 pong（往返延迟 ${latencyMs}ms）`);
  } else if (message.type === 'world_snapshot') {
    if (!reportedWorldSnapshot) {
      reportedWorldSnapshot = true;
      console.log(`✅ 收到 world_snapshot（tick ${message.payload.tick}）`);
    }
  } else if (
    message.type === 'room_state' ||
    message.type === 'fire_result' ||
    message.type === 'enemy_died' ||
    message.type === 'ally_callout' ||
    message.type === 'ally_damaged' ||
    message.type === 'ally_died'
  ) {
    // M0 连通性检查只验证握手与心跳，容忍后续里程碑的服务端消息。
  } else {
    console.error(`❌ 收到未知消息类型：${String(message.type)}`);
    process.exit(1);
  }

  if (receivedSnapshot && receivedPong) {
    finished = true;
    console.log(`✅ 全部检查通过（总耗时 ${Date.now() - started}ms）`);
    clearTimeout(timer);
    ws.close();
  }
});

ws.on('error', (err) => {
  clearTimeout(timer);
  console.error(`❌ 连接失败：${err.message}`);
  process.exit(1);
});

ws.on('close', (code) => {
  clearTimeout(timer);
  if (finished) {
    process.exit(0);
  }
  console.error(`❌ 连接被关闭（code=${code}），未收到任何服务端消息`);
  process.exit(1);
});
