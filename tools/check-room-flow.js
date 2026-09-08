#!/usr/bin/env node
/**
 * M5 房间 UI 协议契约自测。
 *
 * 客户端 RoomView / M1Game 的每个按钮最终都会落到一条房间协议消息上。
 * 这个脚本按客户端的真实发送顺序打一遍，确认服务端全部认账，
 * 避免「界面点得动但服务器不认」这种只能靠人肉试玩才发现的问题。
 *
 * 覆盖：创建房间 → 加入房间 → 快速匹配 → 准备 → 非房主开局被拒 →
 *       房主开局 → 断线 → 凭证重连 → 无效凭证被拒。
 */

let WebSocket;
try {
  WebSocket = require('ws');
} catch {
  try {
    WebSocket = require('../server/node_modules/ws');
  } catch {
    console.error('❌ 找不到 ws 模块。请在 server/ 目录执行 npm install。');
    process.exit(1);
  }
}

const WS_URL = process.argv[2] ?? 'ws://127.0.0.1:8081/ws';
const PROTOCOL_VERSION = 1;
const TIMEOUT_MS = 8000;

let passed = 0;
let failed = 0;

function check(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`✅ ${label}`);
  } else {
    failed += 1;
    console.log(`❌ ${label}`);
  }
}

/** 一个连接的轻量封装：收到的消息按类型堆起来，方便按条件等待。 */
class Client {
  constructor(name) {
    this.name = name;
    this.socket = new WebSocket(WS_URL);
    this.messages = [];
    this.waiters = [];
    this.closed = null;

    this.socket.on('message', (data) => {
      let parsed;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.messages.push(parsed);
      this.waiters = this.waiters.filter((waiter) => {
        if (waiter.predicate(parsed)) {
          waiter.resolve(parsed);
          return false;
        }
        return true;
      });
    });

    this.socket.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
    });
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  /** 等一条满足条件的消息；已经收到过的也算，避免竞态。 */
  wait(predicate, label) {
    const existing = this.messages.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${this.name} 等待超时：${label}`));
      }, TIMEOUT_MS);
      this.waiters.push({
        predicate,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  waitRoomResult(action) {
    return this.wait(
      (message) =>
        message.type === 'room_action_result' &&
        message.payload.action === action,
      `room_action_result(${action})`,
    );
  }

  close() {
    this.socket.close();
  }
}

async function main() {
  console.log(`🏠 M5 房间 UI 协议契约自测：${WS_URL}\n`);

  const host = new Client('房主');
  const guest = new Client('队友');
  const rando = new Client('快速匹配玩家');
  await Promise.all([host.open(), guest.open(), rando.open()]);
  check(true, '三个连接握手成功');

  // 客户端连上后只发 ping，不再自动 join —— 大厅必须先出现。
  host.send({ type: 'ping', payload: { clientTimeMs: Date.now() } });
  await host.wait((m) => m.type === 'pong', 'pong');
  const autoJoined = host.messages.some((m) => m.type === 'world_snapshot');
  check(!autoJoined, '连接后不会自动开打，玩家停在大厅');

  // ① 创建房间（对应「创建房间」按钮）
  host.send({
    type: 'create_room',
    payload: { playerName: '房主', protocolVersion: PROTOCOL_VERSION },
  });
  const created = await host.waitRoomResult('create_room');
  check(created.payload.accepted === true, '创建房间被服务端接受');
  const roomCode = created.payload.roomCode;
  check(typeof roomCode === 'string' && roomCode.length > 0, '返回了房间码');
  check(
    typeof created.payload.reconnectToken === 'string',
    '创建房间时下发了重连凭证',
  );

  const hostRoomState = await host.wait(
    (m) => m.type === 'room_state',
    'room_state',
  );
  check(
    hostRoomState.payload.roomId === roomCode,
    'room_state 的房间号与房间码一致',
  );
  check(
    hostRoomState.payload.status === 'forming',
    '新房间处于集结中（forming）状态',
  );
  check(
    hostRoomState.payload.seats.length === 5,
    `席位总数为配置的 5（实际 ${hostRoomState.payload.seats.length}）`,
  );
  const seatFields = hostRoomState.payload.seats.every(
    (seat) =>
      typeof seat.seatIndex === 'number' &&
      typeof seat.heroName === 'string' &&
      typeof seat.occupantId === 'string' &&
      typeof seat.displayName === 'string' &&
      typeof seat.isBot === 'boolean' &&
      typeof seat.routeId === 'string',
  );
  check(seatFields, '席位字段齐全，房间 UI 能直接渲染');

  // ② 用房间码加入（对应「输入房间码加入」）
  guest.send({
    type: 'join_room',
    payload: {
      roomCode,
      playerName: '队友',
      protocolVersion: PROTOCOL_VERSION,
    },
  });
  const joined = await guest.waitRoomResult('join_room');
  check(joined.payload.accepted === true, '凭房间码加入被接受');
  check(
    typeof joined.payload.reconnectToken === 'string',
    '加入房间时下发了重连凭证',
  );

  const afterJoin = await host.wait(
    (m) =>
      m.type === 'room_state' &&
      m.payload.seats.filter((seat) => !seat.isBot).length === 2,
    '房主看到 2 名真人',
  );
  check(
    afterJoin.payload.seats.filter((seat) => !seat.isBot).length === 2,
    '真人加入后顶替了一个 AI 席位',
  );

  // ③ 错误房间码要被拒绝，且理由能对上界面文案
  const badCode = new Client('乱输房间码的人');
  await badCode.open();
  badCode.send({
    type: 'join_room',
    payload: {
      roomCode: 'ZZZZ',
      playerName: '路人',
      protocolVersion: PROTOCOL_VERSION,
    },
  });
  const rejected = await badCode.waitRoomResult('join_room');
  check(rejected.payload.accepted === false, '不存在的房间码被拒绝');
  check(
    rejected.payload.rejectReason === 'invalid_room',
    `拒绝理由是 invalid_room（实际 ${rejected.payload.rejectReason}）`,
  );
  badCode.close();

  // ④ 快速匹配（对应「快速匹配」按钮）
  rando.send({
    type: 'quick_match',
    payload: { playerName: '路人甲', protocolVersion: PROTOCOL_VERSION },
  });
  const quick = await rando.waitRoomResult('quick_match');
  check(quick.payload.accepted === true, '快速匹配被接受');
  check(
    typeof quick.payload.roomCode === 'string',
    '快速匹配返回了房间码',
  );

  // ⑤ 准备（对应「我准备好了」按钮）
  guest.send({ type: 'player_ready', payload: {} });
  const ready = await guest.waitRoomResult('player_ready');
  check(ready.payload.accepted === true, '准备状态被服务端接受');

  // ⑥ 非房主不能开局 —— 界面上开始按钮只对房主可见，这里做服务端兜底
  guest.send({ type: 'start_match', payload: {} });
  const notHost = await guest.waitRoomResult('start_match');
  check(notHost.payload.accepted === false, '非房主开局被拒绝');
  check(
    notHost.payload.rejectReason === 'not_host',
    `拒绝理由是 not_host（实际 ${notHost.payload.rejectReason}）`,
  );

  // ⑦ 房主开局（对应「开始战斗」按钮）
  host.send({ type: 'start_match', payload: {} });
  const started = await host.waitRoomResult('start_match');
  check(started.payload.accepted === true, '房主开局被接受');

  const active = await host.wait(
    (m) => m.type === 'room_state' && m.payload.status === 'active',
    'room_state(active)',
  );
  check(
    active.payload.status === 'active',
    '房间状态转为 active，客户端据此收起大厅',
  );
  await host.wait((m) => m.type === 'world_snapshot', 'world_snapshot');
  check(true, '开局后开始下发世界快照');

  // ⑧ 断线重连（对应大厅的自动重连路径）
  const guestToken = joined.payload.reconnectToken;
  guest.close();
  await new Promise((resolve) => setTimeout(resolve, 300));

  const rejoin = new Client('重连的队友');
  await rejoin.open();
  rejoin.send({
    type: 'reconnect',
    payload: {
      reconnectToken: guestToken,
      protocolVersion: PROTOCOL_VERSION,
    },
  });
  const reconnected = await rejoin.waitRoomResult('reconnect');
  check(reconnected.payload.accepted === true, '凭重连凭证重连成功');
  await rejoin.wait((m) => m.type === 'world_snapshot', '重连后的世界快照');
  check(true, '重连后继续收到世界快照，可直接回到战斗');

  // ⑨ 无效凭证要被拒绝，客户端据此清掉本地凭证回大厅
  const badToken = new Client('凭证失效的人');
  await badToken.open();
  badToken.send({
    type: 'reconnect',
    payload: {
      reconnectToken: 'not-a-real-token',
      protocolVersion: PROTOCOL_VERSION,
    },
  });
  const badResult = await badToken.waitRoomResult('reconnect');
  check(badResult.payload.accepted === false, '无效重连凭证被拒绝');
  check(
    badResult.payload.rejectReason === 'invalid_token',
    `拒绝理由是 invalid_token（实际 ${badResult.payload.rejectReason}）`,
  );
  badToken.close();

  host.close();
  rando.close();
  rejoin.close();

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) {
    console.log('\n❌ 房间 UI 协议契约自测未全部通过');
    process.exit(1);
  }
  console.log('\n✅ M5 房间 UI 协议契约自测全部通过');
  process.exit(0);
}

main().catch((error) => {
  console.error(`\n❌ 自测异常：${error.message}`);
  process.exit(1);
});
