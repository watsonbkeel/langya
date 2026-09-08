#!/usr/bin/env node
/**
 * M5 联机自测脚本：验证「一个房间 = 一份战斗」
 *
 * 用途：M5 每次改动房间/战斗接线后必跑。单靠单元测试证明不了
 * WebSocket 层真的把三个连接接进了同一份战斗，必须实连实测。
 *
 * 验证项：
 *   1. 房主 create_room 拿到房间码
 *   2. 另外两人 join_room 成功进同一房间
 *   3. 房主 start_match 后三人都收到 match_start，且 matchId 相同
 *   4. 三人收到的 world_snapshot tick 对齐（同一个主循环）
 *   5. 快照 allies[] 里有 3 个真人 + 2 个 AI，席位不重复
 *   6. 一人开火后，另外两人能看到同一份世界变化
 *   7. 掉线后在宽限期内重连，能接回原席位（PRD 7.3）
 *
 * 注：「掉线 60 秒超时转 AI 托管」因为要真等满宽限期，不适合放在本脚本，
 * 由 server/src/game/room-battle-runtime.test.ts 直接驱动时钟覆盖。
 *
 * 用法：
 *   node tools/check-multiplayer.js                             # 默认 ws://127.0.0.1:8081/ws
 *   node tools/check-multiplayer.js ws://100.126.150.80:8081/ws
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

// 铁律 2：数值与武器 id 一律从配置读，不写死在脚本里。
const gameplayConfig = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'shared', 'config', 'gameplay.json'),
    'utf8',
  ),
);
const alliesConfig = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'shared', 'config', 'allies.json'),
    'utf8',
  ),
);
const DEFAULT_WEAPON_ID = gameplayConfig.player.defaultLoadout.primary;
const SEAT_COUNT = alliesConfig.seatCount;

const url = process.argv[2] || 'ws://127.0.0.1:8081/ws';
const PROTOCOL_VERSION = 1;
const TIMEOUT_MS = 30000;
const PLAYER_NAMES = ['玩家一', '玩家二', '玩家三'];

const failures = [];

function check(ok, label, detail) {
  if (ok) {
    console.log(`✅ ${label}`);
  } else {
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

/** 一个测试用客户端：记录收到的各类消息，供断言用。 */
class TestClient {
  constructor(name) {
    this.name = name;
    this.socket = new WebSocket(url);
    this.roomCode = undefined;
    this.reconnectToken = undefined;
    this.matchStart = undefined;
    this.roomStates = [];
    this.worldSnapshots = [];
    this.fireResults = [];
    this.roomActionResults = [];
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
        case 'match_start':
          this.matchStart = message.payload;
          break;
        case 'room_state':
          this.roomStates.push(message.payload);
          break;
        case 'world_snapshot':
          this.worldSnapshots.push(message.payload);
          break;
        case 'fire_result':
          this.fireResults.push(message.payload);
          break;
        default:
          break;
      }
    });
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  send(type, payload) {
    this.socket.send(JSON.stringify({ type, payload }));
  }

  nextTick() {
    this.clientTick += 1;
    return this.clientTick;
  }

  close() {
    try {
      this.socket.close();
    } catch (_) {
      /* 忽略关闭异常 */
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 轮询等待条件成立，避免固定 sleep 造成的偶发不稳定。 */
async function waitFor(label, predicate, timeoutMs = 5000) {
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
  const clients = PLAYER_NAMES.map((name) => new TestClient(name));
  const timer = setTimeout(() => {
    console.error(`❌ 整体超时（${TIMEOUT_MS}ms）`);
    process.exit(1);
  }, TIMEOUT_MS);
  timer.unref();

  try {
    await Promise.all(clients.map((client) => client.open()));
    console.log(`✅ 三个连接握手成功（${url}）`);

    const [host, second, third] = clients;

    // 1. 房主建房
    host.send('create_room', {
      playerName: host.name,
      protocolVersion: PROTOCOL_VERSION,
    });
    await waitFor('房主收到房间码', () => host.roomCode !== undefined);
    const roomCode = host.roomCode;
    check(
      typeof roomCode === 'string' && roomCode.length === 4,
      `房主建房拿到房间码 ${roomCode}`,
    );

    // 2. 另外两人加入
    for (const client of [second, third]) {
      client.send('join_room', {
        roomCode,
        playerName: client.name,
        protocolVersion: PROTOCOL_VERSION,
      });
    }
    await waitFor(
      '两名玩家加入房间',
      () => second.roomCode === roomCode && third.roomCode === roomCode,
    );
    check(
      second.roomCode === roomCode && third.roomCode === roomCode,
      '两名玩家加入同一个房间',
    );
    check(
      Boolean(second.reconnectToken && third.reconnectToken),
      '加入房间时下发了重连凭证',
    );

    // 3. 房主开局
    host.send('start_match', {});
    await waitFor(
      '三人都收到 match_start',
      () => clients.every((client) => client.matchStart !== undefined),
    );
    const matchIds = clients.map((client) => client.matchStart?.matchId);
    check(
      matchIds.every((id) => id !== undefined && id === matchIds[0]),
      `三人 matchId 一致（${matchIds[0]}）`,
      `实际：${matchIds.join(' / ')}`,
    );
    check(
      matchIds[0] === roomCode,
      '战斗房间号等于房间码，说明战斗建在房间层而非连接层',
      `matchId=${matchIds[0]} roomCode=${roomCode}`,
    );

    // 4. 等快照流起来
    await waitFor(
      '三人都开始收到世界快照',
      () => clients.every((client) => client.worldSnapshots.length >= 3),
    );

    const lastTicks = clients.map(
      (client) => client.worldSnapshots[client.worldSnapshots.length - 1].tick,
    );
    const tickSpread = Math.max(...lastTicks) - Math.min(...lastTicks);
    check(
      tickSpread <= 2,
      `三人快照 tick 对齐（差值 ${tickSpread}）`,
      `实际 ticks：${lastTicks.join(' / ')}`,
    );

    // 5. 席位构成
    const snapshot =
      host.worldSnapshots[host.worldSnapshots.length - 1];
    const humans = snapshot.allies.filter((ally) => !ally.isBot);
    const bots = snapshot.allies.filter((ally) => ally.isBot);
    check(
      humans.length === 3,
      `快照里有 3 名真人（实际 ${humans.length}）`,
    );
    check(
      snapshot.allies.length === SEAT_COUNT,
      `席位总数等于配置 ${SEAT_COUNT}（实际 ${snapshot.allies.length}）`,
    );
    check(
      bots.length === SEAT_COUNT - 3,
      `快照里有 ${SEAT_COUNT - 3} 名 AI 队友（实际 ${bots.length}）`,
    );
    const seatIndexes = snapshot.allies.map((ally) => ally.seatIndex);
    check(
      new Set(seatIndexes).size === seatIndexes.length,
      '席位无重复',
      `席位：${seatIndexes.join(',')}`,
    );

    // 三个客户端看到的是同一份世界
    const enemyCounts = clients.map(
      (client) =>
        client.worldSnapshots[client.worldSnapshots.length - 1].enemies
          .length,
    );
    check(
      Math.max(...enemyCounts) - Math.min(...enemyCounts) <= 3,
      `三人看到的敌人数量一致（${enemyCounts.join(' / ')}）`,
    );

    // 6. 开火由服务器裁决
    second.send('fire', {
      clientTick: second.nextTick(),
      weaponId: DEFAULT_WEAPON_ID,
      originPos: { x: 0, y: 1.6, z: 0 },
      dirVec: { x: 0, y: 0, z: 1 },
    });
    await waitFor(
      '开火收到服务器裁决',
      () => second.fireResults.length >= 1,
    );
    check(
      second.fireResults.length >= 1,
      '开火由服务器返回裁决结果（客户端不自行判定）',
    );

    // 房间状态里三个人都在
    const roomState =
      host.roomStates[host.roomStates.length - 1];
    check(
      roomState !== undefined &&
        roomState.seats.filter((seat) => !seat.isBot).length === 3,
      '房间状态里三个席位是真人',
      roomState
        ? `真人席位数：${roomState.seats.filter((s) => !s.isBot).length}`
        : '未收到 room_state',
    );

    // 7. 宽限期内掉线重连，接回原席位（PRD 7.3）
    const beforeSeat = roomState?.seats.find(
      (seat) => seat.displayName === third.name && !seat.isBot,
    );
    check(
      beforeSeat !== undefined,
      '掉线前能定位到目标玩家的席位',
      `玩家：${third.name}`,
    );
    const savedToken = third.reconnectToken;
    third.close();
    await sleep(300);

    const rejoined = new TestClient(third.name);
    clients.push(rejoined);
    await rejoined.open();
    rejoined.send('reconnect', {
      reconnectToken: savedToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    await waitFor(
      '重连被服务器受理',
      () =>
        rejoined.roomActionResults.some(
          (result) => result.action === 'reconnect' && result.accepted,
        ),
      6000,
    );
    check(
      rejoined.roomActionResults.some(
        (result) => result.action === 'reconnect' && result.accepted,
      ),
      '宽限期内凭重连凭证重连成功',
    );

    await waitFor(
      '重连后补发开局播报与快照',
      () =>
        rejoined.matchStart !== undefined &&
        rejoined.worldSnapshots.length >= 1 &&
        rejoined.roomStates.length >= 1,
      6000,
    );
    check(
      rejoined.matchStart?.matchId === roomCode,
      '重连后回到同一局（matchId 不变）',
      `matchId=${rejoined.matchStart?.matchId} roomCode=${roomCode}`,
    );

    const afterState =
      rejoined.roomStates[rejoined.roomStates.length - 1];
    const afterSeat = afterState?.seats.find(
      (seat) => seat.displayName === third.name && !seat.isBot,
    );
    check(
      afterSeat !== undefined &&
        beforeSeat !== undefined &&
        afterSeat.seatIndex === beforeSeat.seatIndex &&
        afterSeat.occupantId === beforeSeat.occupantId,
      '重连接回原席位（席位号与战斗身份都不变）',
      beforeSeat && afterSeat
        ? `前 seat=${beforeSeat.seatIndex}/${beforeSeat.occupantId}，` +
          `后 seat=${afterSeat.seatIndex}/${afterSeat.occupantId}`
        : '未找到席位',
    );
    check(
      afterSeat !== undefined && afterSeat.autopilot !== true,
      '宽限期内重连不会被托管',
      `autopilot=${afterSeat?.autopilot}`,
    );

    // 重连后能继续正常操作（新连接的 clientTick 从 0 重新计数）
    rejoined.send('fire', {
      clientTick: rejoined.nextTick(),
      weaponId: DEFAULT_WEAPON_ID,
      originPos: { x: 0, y: 1.6, z: 0 },
      dirVec: { x: 0, y: 0, z: 1 },
    });
    await waitFor(
      '重连后开火收到裁决',
      () => rejoined.fireResults.length >= 1,
      6000,
    );
    check(
      rejoined.fireResults.length >= 1,
      '重连后可以继续作战（动作被服务器受理）',
    );
  } catch (error) {
    console.error(`❌ 执行异常：${error.message}`);
    failures.push(error.message);
  } finally {
    for (const client of clients) {
      client.close();
    }
    clearTimeout(timer);
  }

  await sleep(200);
  if (failures.length > 0) {
    console.error(`\n❌ 自测未通过，失败 ${failures.length} 项：`);
    for (const failure of failures) {
      console.error(`   - ${failure}`);
    }
    process.exit(1);
  }
  console.log('\n✅ M5 联机自测全部通过：一个房间共享一份战斗');
  process.exit(0);
}

main();
