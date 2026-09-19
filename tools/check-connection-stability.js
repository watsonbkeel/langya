#!/usr/bin/env node
/**
 * 断线与联机可用性回归探针（2026-09-19 修复配套）
 *
 * 这个脚本专门盯两个曾经上线暴雷的问题，check-multiplayer.js 覆盖不到：
 *
 * 问题①「偶发被服务器断开」
 *   旧实现只要有一帧 input_state 不被接受就 close(1008)。重连后补发的旧
 *   tick、席位被 AI 托管期间的输入、结算瞬间还在路上的输入，全都会把正常
 *   玩家踢下线。修复后这些情况只丢弃该帧。
 *   验证项 1-4。
 *
 * 问题②「联机功能用不了」
 *   - 快速匹配在没有可加入房间时服务端让玩家当房主，但不下发房主身份，
 *     客户端按 action 猜成「客人」，开始按钮消失 → 房间开不了局。
 *   - 单人开局从不下发 reconnectToken，刷新即掉局。
 *   验证项 5-8。
 *
 * 用法：
 *   node tools/check-connection-stability.js                        # 默认本地
 *   node tools/check-connection-stability.js wss://langyashan.bkeel.com/ws
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

const gameplayConfig = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'shared', 'config', 'gameplay.json'),
    'utf8',
  ),
);
const DEFAULT_WEAPON_ID = gameplayConfig.player.defaultLoadout.primary;

const url = process.argv[2] || 'ws://127.0.0.1:8081/ws';
const PROTOCOL_VERSION = 1;
const TIMEOUT_MS = 40000;

const failures = [];

function check(ok, label, detail) {
  if (ok) {
    console.log(`✅ ${label}`);
  } else {
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

class Probe {
  constructor(name) {
    this.name = name;
    this.socket = new WebSocket(url);
    this.roomCode = undefined;
    this.reconnectToken = undefined;
    this.playerId = undefined;
    this.roomStates = [];
    this.roomActionResults = [];
    this.worldSnapshots = [];
    this.matchStart = undefined;
    this.closeCode = undefined;
    this.closeReason = undefined;
    this.clientTick = 0;
    this.socket.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch (_) {
        return;
      }
      switch (message.type) {
        case 'room_action_result':
          this.roomActionResults.push(message.payload);
          if (message.payload.accepted) {
            if (message.payload.roomCode) {
              this.roomCode = message.payload.roomCode;
            }
            if (message.payload.reconnectToken) {
              this.reconnectToken = message.payload.reconnectToken;
            }
          }
          break;
        case 'snapshot':
          if (message.payload.connection.playerId) {
            this.playerId = message.payload.connection.playerId;
          }
          break;
        case 'room_state':
          this.roomStates.push(message.payload);
          break;
        case 'world_snapshot':
          this.worldSnapshots.push(message.payload);
          break;
        case 'match_start':
          this.matchStart = message.payload;
          break;
        default:
          break;
      }
    });
    this.socket.on('close', (code, reason) => {
      this.closeCode = code;
      this.closeReason = reason ? reason.toString() : '';
    });
    this.socket.on('error', () => {
      /* 关闭时的异常忽略，断言只看 closeCode */
    });
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  get isOpen() {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send(type, payload) {
    if (!this.isOpen) {
      return;
    }
    this.socket.send(JSON.stringify({ type, payload }));
  }

  sendInput(clientTick, aimPitch = 0) {
    this.send('input_state', {
      clientTick,
      moveDir: { x: 0, y: 0 },
      aimYaw: 0,
      aimPitch,
      isCrouch: false,
    });
  }

  nextTick() {
    this.clientTick += 1;
    return this.clientTick;
  }

  latestRoomState() {
    return this.roomStates[this.roomStates.length - 1];
  }

  close() {
    try {
      this.socket.close();
    } catch (_) {
      /* 忽略 */
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 只等待、不记失败的轮询。用于「先后顺序不稳定、但迟早会到」的消息：
 * 等不到时把判定交给后面的 check，让它报出更具体的原因。
 */
async function poll(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await sleep(50);
  }
  return false;
}

async function waitFor(label, predicate, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await sleep(50);
  }
  console.error(`❌ 等待超时：${label}`);
  failures.push(`等待超时：${label}`);
  return false;
}

async function main() {
  const timer = setTimeout(() => {
    console.error(`❌ 整体超时（${TIMEOUT_MS}ms）`);
    process.exit(1);
  }, TIMEOUT_MS);
  timer.unref();

  const probes = [];
  const spawn = (name) => {
    const probe = new Probe(name);
    probes.push(probe);
    return probe;
  };

  try {
    // ── 场景一：单人局的输入健壮性（问题①） ──────────────────
    const solo = spawn('单人');
    await solo.open();
    solo.send('join', {
      playerName: solo.name,
      protocolVersion: PROTOCOL_VERSION,
    });
    await waitFor('单人局开局', () => solo.matchStart !== undefined);
    // room_action_result 与 match_start 的到达先后不稳定：本地直连时
    // 前者先到，走 WSS + 中转 Nginx 时后者可能先到。凭证是否下发与它们的
    // 顺序无关，所以这里单独再等一次，避免把「还没到」误判成「没下发」。
    await poll(() => solo.reconnectToken !== undefined, 3000);

    // 1. 单人开局必须下发重连凭证，否则刷新页面这一局就找不回来了
    check(
      typeof solo.reconnectToken === 'string' && solo.reconnectToken.length > 0,
      '单人开局下发了重连凭证',
      `token=${solo.reconnectToken}`,
    );

    await waitFor('单人局收到世界快照', () => solo.worldSnapshots.length > 0);

    // 2. 重复/倒退的 clientTick 不能导致断线（旧实现直接 close 1008）
    solo.sendInput(50);
    await sleep(120);
    solo.sendInput(50); // 重复
    solo.sendInput(10); // 倒退
    solo.sendInput(1);
    await sleep(600);
    check(
      solo.isOpen,
      '重复与倒退的 clientTick 不会断开连接',
      `closeCode=${solo.closeCode} reason=${solo.closeReason}`,
    );

    // 3. 越界的瞄准俯仰角只丢弃该帧，不踢人
    //    （协议解析放行、但 applyInput 会判定越界返回 false 的那一类）
    solo.sendInput(200, 89);
    await sleep(500);
    check(
      solo.isOpen,
      '越界的瞄准角度只丢弃该帧，不断开连接',
      `closeCode=${solo.closeCode}`,
    );

    // 4. 丢弃异常帧之后仍能正常作战（连接没被弄坏，tick 追踪器没卡死）
    const beforeSnapshots = solo.worldSnapshots.length;
    for (let i = 0; i < 5; i += 1) {
      solo.sendInput(1000 + i);
      await sleep(60);
    }
    solo.send('fire', {
      clientTick: 2000,
      weaponId: DEFAULT_WEAPON_ID,
      originPos: { x: 0, y: 1.6, z: 0 },
      dirVec: { x: 0, y: 0, z: 1 },
    });
    await sleep(500);
    check(
      solo.isOpen && solo.worldSnapshots.length > beforeSnapshots,
      '丢弃异常帧后仍能继续收发（连接与主循环都健在）',
      `open=${solo.isOpen} snapshots=${solo.worldSnapshots.length}`,
    );

    solo.close();
    await sleep(200);

    // ── 场景二：快速匹配的房主身份（问题②） ──────────────────
    const first = spawn('匹配一');
    await first.open();
    first.send('quick_match', {
      playerName: first.name,
      protocolVersion: PROTOCOL_VERSION,
    });
    await waitFor(
      '第一位快速匹配的玩家进入房间',
      () => first.roomCode !== undefined && first.latestRoomState() !== undefined,
    );

    // 5. 快速匹配没有可加入的房间时，服务端让玩家当房主 —— 必须把这件事
    //    通过 room_state.hostPlayerId 明确告诉客户端，否则开始按钮不会出现
    const firstState = first.latestRoomState();
    check(
      typeof firstState?.hostPlayerId === 'string',
      'room_state 下发了房主的稳定身份 hostPlayerId',
      `hostPlayerId=${firstState?.hostPlayerId}`,
    );
    check(
      firstState?.hostPlayerId === first.playerId,
      '快速匹配开出新房的玩家被标记为房主',
      `host=${firstState?.hostPlayerId} self=${first.playerId}`,
    );

    // 6. 第二个人快速匹配进同一个房间，且不被误标成房主
    const second = spawn('匹配二');
    await second.open();
    second.send('quick_match', {
      playerName: second.name,
      protocolVersion: PROTOCOL_VERSION,
    });
    await waitFor(
      '第二位玩家完成快速匹配',
      () => second.roomCode !== undefined && second.latestRoomState() !== undefined,
    );
    check(
      second.roomCode === first.roomCode,
      '第二位玩家匹配进了同一个房间',
      `${second.roomCode} vs ${first.roomCode}`,
    );
    const secondState = second.latestRoomState();
    check(
      secondState?.hostPlayerId === first.playerId &&
        secondState?.hostPlayerId !== second.playerId,
      '后加入者看到的房主仍是开房的那个人',
      `host=${secondState?.hostPlayerId} self=${second.playerId}`,
    );

    // 7. 房主真能开局（hostId 与客户端看到的房主是同一个人）
    first.send('start_match', {});
    await waitFor(
      '房主开局后双方都收到 match_start',
      () => first.matchStart !== undefined && second.matchStart !== undefined,
    );
    check(
      first.matchStart !== undefined && second.matchStart !== undefined,
      '被标记为房主的玩家确实能开局',
    );

    // 8. 战斗中的 room_state 也要带房主身份，刷新重连后按钮才不会错乱
    await waitFor(
      '战斗中收到 room_state',
      () => first.roomStates.some((state) => state.status === 'active'),
    );
    const battleState = first.roomStates
      .filter((state) => state.status === 'active')
      .pop();
    check(
      battleState?.hostPlayerId === first.playerId,
      '战斗中的 room_state 同样带着房主身份',
      `host=${battleState?.hostPlayerId}`,
    );
  } catch (error) {
    console.error(`❌ 执行异常：${error.message}`);
    failures.push(error.message);
  } finally {
    for (const probe of probes) {
      probe.close();
    }
    clearTimeout(timer);
  }

  await sleep(200);
  if (failures.length > 0) {
    console.error(`\n❌ 回归探针未通过，失败 ${failures.length} 项：`);
    for (const failure of failures) {
      console.error(`   - ${failure}`);
    }
    process.exit(1);
  }
  console.log('\n✅ 断线与联机可用性回归探针全部通过');
  process.exit(0);
}

main();
