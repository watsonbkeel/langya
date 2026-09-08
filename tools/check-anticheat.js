#!/usr/bin/env node
/**
 * 反作弊自测脚本：验证服务端消息限流真的会挡住洪水攻击。
 *
 * 为什么要单独实连测：单元测试只能证明 MessageRateLimiter 这个类算得对，
 * 证明不了它真的被接进了 WebSocket 消息入口。这条链路断了不会有任何报错，
 * 只会安静地失去防护 —— 必须实连打一遍。
 *
 * 验证项：
 *   1. 正常频率的玩家不会被误伤（20Hz 输入连打 2 秒，连接始终存活）
 *   2. 输入洪水会被限流，且累计超限达阈值后连接被服务器断开
 *   3. 开火洪水同样会被限流并踢出
 *   4. 被踢后重新连接仍可正常握手（限流计数跟着连接走，不是永久封禁）
 *
 * 用法：
 *   node tools/check-anticheat.js                             # 默认 ws://127.0.0.1:8081/ws
 *   node tools/check-anticheat.js ws://100.126.150.80:8081/ws
 *
 * 退出码：0 = 成功，1 = 失败
 */

'use strict';

let WebSocket;
try {
  WebSocket = require('ws');
} catch (e) {
  try {
    WebSocket = require('../server/node_modules/ws');
  } catch (e2) {
    console.error('❌ 找不到 ws 模块。请在 server/ 目录执行 npm install。');
    process.exit(1);
  }
}

const path = require('node:path');
const fs = require('node:fs');

// 铁律 2：阈值一律从配置读，不写死在脚本里。
const gameplayConfig = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'shared', 'config', 'gameplay.json'),
    'utf8',
  ),
);
const ANTI_CHEAT = gameplayConfig.antiCheat;
const TICK_RATE_HZ = gameplayConfig.server.tickRateHz;
const DEFAULT_WEAPON_ID = gameplayConfig.player.defaultLoadout.primary;

const url = process.argv[2] || 'ws://127.0.0.1:8081/ws';
const PROTOCOL_VERSION = 1;

const failures = [];

function check(ok, label, detail) {
  if (ok) {
    console.log(`✅ ${label}`);
  } else {
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 一个只关心「连接是否还活着」的极简客户端。 */
class ProbeClient {
  constructor() {
    this.socket = new WebSocket(url);
    this.closed = false;
    this.closeCode = undefined;
    this.closeReason = undefined;
    this.clientTick = 0;
    this.socket.on('close', (code, reason) => {
      this.closed = true;
      this.closeCode = code;
      this.closeReason = reason ? reason.toString() : '';
    });
    // 不处理具体消息，本脚本只关心连接存活状态
    this.socket.on('message', () => {});
    this.socket.on('error', () => {});
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  send(type, payload) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.socket.send(JSON.stringify({ type, payload }));
      return true;
    } catch (_) {
      return false;
    }
  }

  sendInput() {
    this.clientTick += 1;
    return this.send('input_state', {
      clientTick: this.clientTick,
      moveDir: { x: 0, y: 0 },
      aimYaw: 0,
      aimPitch: 0,
      isCrouch: false,
    });
  }

  sendFire() {
    this.clientTick += 1;
    return this.send('fire', {
      weaponId: DEFAULT_WEAPON_ID,
      originPos: { x: 0, y: 0, z: 0 },
      dirVec: { x: 0, y: 0, z: 1 },
      clientTick: this.clientTick,
    });
  }

  join(playerName) {
    return this.send('join', {
      protocolVersion: PROTOCOL_VERSION,
      playerName,
    });
  }

  close() {
    try {
      this.socket.close();
    } catch (_) {
      /* 忽略关闭异常 */
    }
  }
}

/** 等到连接被服务器断开，或超时。返回是否已断开。 */
async function waitForClose(client, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (client.closed) {
      return true;
    }
    await sleep(50);
  }
  return client.closed;
}

async function main() {
  console.log(`🎯 反作弊限流自测：${url}`);
  console.log(
    `   配置阈值：输入 ${ANTI_CHEAT.inputMessagesPerSec}/s、` +
      `开火 ${ANTI_CHEAT.fireMessagesPerSec}/s、` +
      `总量 ${ANTI_CHEAT.totalMessagesPerSec}/s、` +
      `超限 ${ANTI_CHEAT.violationsBeforeKick} 次踢出\n`,
  );

  // ---- 1. 正常玩家不被误伤 ----
  const honest = new ProbeClient();
  await honest.open();
  honest.join('老实玩家');
  await sleep(300);

  const intervalMs = 1000 / TICK_RATE_HZ;
  const honestRounds = TICK_RATE_HZ * 2; // 连打 2 秒
  for (let index = 0; index < honestRounds; index += 1) {
    honest.sendInput();
    await sleep(intervalMs);
  }
  check(
    !honest.closed,
    `正常 ${TICK_RATE_HZ}Hz 输入连打 2 秒不会被误踢`,
    honest.closed ? `被断开，code=${honest.closeCode}` : undefined,
  );
  honest.close();

  // ---- 2. 输入洪水被限流并踢出 ----
  const inputFlooder = new ProbeClient();
  await inputFlooder.open();
  inputFlooder.join('输入洪水');
  await sleep(300);

  // 一口气灌远超上限的输入：上限 + 踢出阈值 + 余量
  const inputBurst =
    ANTI_CHEAT.inputMessagesPerSec + ANTI_CHEAT.violationsBeforeKick + 20;
  for (let index = 0; index < inputBurst; index += 1) {
    inputFlooder.sendInput();
  }
  const inputKicked = await waitForClose(inputFlooder);
  check(
    inputKicked,
    '输入洪水触发限流并被服务器断开',
    inputKicked ? undefined : '连接仍然存活，限流可能没接进消息入口',
  );
  check(
    !inputKicked || inputFlooder.closeCode === 1008,
    '输入洪水的断开码是 1008（策略违规）',
    `实际 code=${inputFlooder.closeCode}`,
  );
  inputFlooder.close();

  // ---- 3. 开火洪水被限流并踢出 ----
  const fireFlooder = new ProbeClient();
  await fireFlooder.open();
  fireFlooder.join('开火洪水');
  await sleep(300);

  const fireBurst =
    ANTI_CHEAT.fireMessagesPerSec + ANTI_CHEAT.violationsBeforeKick + 20;
  for (let index = 0; index < fireBurst; index += 1) {
    fireFlooder.sendFire();
  }
  const fireKicked = await waitForClose(fireFlooder);
  check(
    fireKicked,
    '开火洪水触发限流并被服务器断开',
    fireKicked ? undefined : '连接仍然存活，开火分桶可能没生效',
  );
  fireFlooder.close();

  // ---- 4. 被踢后可以重新连接 ----
  const rejoin = new ProbeClient();
  await rejoin.open();
  rejoin.join('重新连接');
  await sleep(500);
  check(
    !rejoin.closed,
    '被踢的客户端重新连接后仍可正常握手（限流不是永久封禁）',
    rejoin.closed ? `被断开，code=${rejoin.closeCode}` : undefined,
  );
  rejoin.close();

  await sleep(200);

  console.log('');
  if (failures.length > 0) {
    console.error(`❌ 反作弊自测失败 ${failures.length} 项：`);
    for (const failure of failures) {
      console.error(`   - ${failure}`);
    }
    process.exit(1);
  }
  console.log('✅ 反作弊限流自测全部通过');
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ 自测脚本异常：', error && error.message);
  process.exit(1);
});
