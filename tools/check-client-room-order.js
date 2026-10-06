#!/usr/bin/env node
'use strict';

// 直接执行真实客户端方法，不启动 Cocos、浏览器或网络；--baseline 只读 HEAD。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('../client/node_modules/typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = 'client/assets/scripts/core/m1-game.ts';
const baseline = process.argv.includes('--baseline');
const source = baseline
  ? execFileSync('git', ['show', `HEAD:${sourcePath}`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, sourcePath), 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: sourcePath,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const storage = new Map();
const cancelledTimers = [];
const moduleStub = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleStub,
  exports: moduleStub.exports,
  // 构造器不会运行，渲染相关模块只需要可导入。
  require: () => ({}),
  window: {
    sessionStorage: {
      setItem: (key, value) => storage.set(key, value),
      getItem: (key) => storage.get(key) ?? null,
      removeItem: (key) => storage.delete(key),
    },
  },
  clearTimeout: (timer) => cancelledTimers.push(timer),
}, { filename: sourcePath });
const { M1Game } = moduleStub.exports;

function fixture() {
  storage.clear();
  cancelledTimers.length = 0;
  const calls = { stages: [], focus: [], lobby: [], cries: [], hideBanner: 0 };
  const roomView = {
    stage: 'entry',
    hint: '',
    notice: '',
    setStage(stage) { this.stage = stage; calls.stages.push(stage); },
    setHint(hint) { this.hint = hint; },
    setHost() {},
    setReconnectNotice(notice) { this.notice = notice; },
    renderRoomState() {},
  };
  const game = Object.assign(Object.create(M1Game.prototype), {
    roomView,
    matchStarted: false,
    battleCryShown: false,
    reconnectPending: false,
    reconnectRetryTimer: null,
    combatDisconnectedAtMs: null,
    lobbyHintPendingRestore: false,
    roomCode: null,
    reconnectToken: null,
    hostPlayerId: null,
    playerId: 'human:test',
    isHost: false,
    controller: { setLobbyMode: (value) => calls.lobby.push(value) },
    hud: {
      setCombatFocus: (...args) => calls.focus.push(args),
      showBattleCry: (seconds) => calls.cries.push(seconds),
      hideDisconnectBanner: () => { calls.hideBanner += 1; },
    },
    // 调试快照依赖完整渲染器，与房间状态切换无关。
    publishDebugState() {},
  });
  return { game, roomView, calls };
}

function receipt(action) {
  return { type: 'room_action_result', payload: {
    accepted: true, action, roomCode: '123456', reconnectToken: `token:${action}`,
  } };
}

function room(status) {
  return { type: 'room_state', payload: {
    roomId: '123456', status, seats: [], hostPlayerId: 'human:test',
  } };
}

const start = { type: 'match_start', payload: { startedAtMs: 1000, deployEndsAtMs: 11000 } };
function checkCredentials(game, action) {
  assert.equal(game.roomCode, '123456', '必须保存房间码');
  assert.equal(game.reconnectToken, `token:${action}`, '必须保存内存重连凭证');
  assert.equal(storage.get('langyashan.reconnectToken'), `token:${action}`, '必须保存会话重连凭证');
}

let passed = 0;
let failed = 0;
function test(name, run) {
  try {
    run();
    passed += 1;
    console.log(`通过 ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`失败 ${name}: ${error.message}`);
  }
}

const orders = [
  ['receipt', 'active', 'start'], ['receipt', 'start', 'active'],
  ['active', 'receipt', 'start'], ['start', 'receipt', 'active'],
  ['active', 'start', 'receipt'], ['start', 'active', 'receipt'],
];
for (const action of ['create_room', 'join_room', 'quick_match']) {
  for (const order of orders) {
    test(`${action}: ${order.join(' → ')}`, () => {
      const { game, roomView, calls } = fixture();
      let entered = false;
      for (const event of order) {
        const stageOffset = calls.stages.length;
        if (event === 'receipt') game.onRoomActionResult(receipt(action));
        if (event === 'active') game.onRoomState(room('active'));
        if (event === 'start') game.onMatchStart(start);
        if (event !== 'receipt') entered = true;
        if (entered) {
          assert.equal(roomView.stage, 'hidden', `${event} 后大厅必须隐藏`);
          assert.equal(game.matchStarted, true);
          assert.ok(calls.stages.slice(stageOffset).every((stage) => stage === 'hidden'),
            `${event} 处理期间也不能短暂重显大厅`);
        } else {
          assert.equal(roomView.stage, 'room', '未开局时必须显示等待房间');
          assert.equal(game.matchStarted, false);
        }
        if (event === 'receipt') checkCredentials(game, action);
      }
      checkCredentials(game, action);
      assert.equal(calls.focus.length, 1, '开局焦点只能初始化一次');
      assert.deepEqual(calls.lobby, [false], '战斗输入只接管一次');
      assert.deepEqual(calls.cries, [10], '真实 match_start 必须执行开局提示');
    });
  }
  test(`${action}: forming 房间保持等待`, () => {
    const { game, roomView, calls } = fixture();
    game.onRoomActionResult(receipt(action));
    game.onRoomState(room('forming'));
    assert.equal(roomView.stage, 'room');
    assert.equal(game.matchStarted, false);
    assert.equal(calls.focus.length, 0);
    checkCredentials(game, action);
  });
}

test('enterCombat 重复调用修复遮挡但不重置焦点', () => {
  const { game, roomView, calls } = fixture();
  game.enterCombat();
  roomView.setStage('room');
  game.enterCombat();
  assert.equal(roomView.stage, 'hidden', '重复进入必须重新隐藏大厅');
  game.enterCombat();
  assert.equal(calls.focus.length, 1);
  assert.deepEqual(calls.lobby, [false]);
});

for (const inCombat of [false, true]) {
  test(`reconnect 成功收尾不被跳过（${inCombat ? '战斗中' : '等待中'}）`, () => {
    const { game, roomView, calls } = fixture();
    if (inCombat) game.enterCombat();
    game.reconnectPending = true;
    game.reconnectRetryTimer = 42;
    game.combatDisconnectedAtMs = 123;
    roomView.notice = '重连中';
    game.onRoomActionResult(receipt('reconnect'));
    checkCredentials(game, 'reconnect');
    assert.equal(game.reconnectPending, false);
    assert.equal(game.reconnectRetryTimer, null);
    assert.deepEqual(cancelledTimers, [42]);
    assert.equal(game.combatDisconnectedAtMs, null);
    assert.equal(roomView.notice, '');
    assert.equal(calls.hideBanner, 1);
    assert.equal(game.battleCryShown, true);
    assert.equal(roomView.stage, inCombat ? 'hidden' : 'room');
    if (inCombat) {
      assert.equal(calls.focus.length, 2, '重连必须执行自己的战斗焦点恢复');
      assert.match(calls.focus[1][1], /已回到阵地/);
      game.onMatchStart(start);
      assert.equal(calls.cries.length, 0, '重连补发不能重复开局提示');
    } else {
      assert.equal(game.matchStarted, false);
      assert.equal(game.lobbyHintPendingRestore, true);
      game.onRoomState(room('forming'));
      assert.equal(roomView.stage, 'room');
      assert.equal(game.lobbyHintPendingRestore, false);
      assert.doesNotMatch(roomView.hint, /恢复房间状态/);
      assert.equal(calls.focus.length, 0);
    }
  });
}

console.log(`${baseline ? 'HEAD 基线' : '工作区'}：${passed} 通过，${failed} 失败`);
process.exitCode = failed > 0 ? 1 : 0;
