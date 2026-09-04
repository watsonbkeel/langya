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

console.log(`→ 正在连接 ${url} ...`);

const started = Date.now();
const ws = new WebSocket(url);

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
  // 主动发一条 ping，服务端应回 pong 或推送 snapshot
  try {
    ws.send(JSON.stringify({ t: 'ping', ts: Date.now() }));
  } catch (_) {}
});

ws.on('message', (data) => {
  const raw = data.toString();
  console.log(`✅ 收到服务端消息：${raw.slice(0, 200)}${raw.length > 200 ? ' ...' : ''}`);
  console.log(`✅ 全部检查通过（总耗时 ${Date.now() - started}ms）`);
  clearTimeout(timer);
  ws.close();
  process.exit(0);
});

ws.on('error', (err) => {
  clearTimeout(timer);
  console.error(`❌ 连接失败：${err.message}`);
  process.exit(1);
});

ws.on('close', (code) => {
  // 正常路径在 message 回调里已 exit(0)，走到这里说明没收到消息就断了
  clearTimeout(timer);
  console.error(`❌ 连接被关闭（code=${code}），未收到任何服务端消息`);
  process.exit(1);
});
