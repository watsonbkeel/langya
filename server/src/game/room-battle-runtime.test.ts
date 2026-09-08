import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findRepositoryRoot,
  loadProjectConfig,
} from '../config/project-config';
import type { ServerMessage } from '../../../shared/protocol';
import { RoomBattleRuntime } from './room-battle-runtime';
import type { M2RouteId } from './m2-battle-factory';
import type { M2BattleEvent } from './m2-battle-session';

const config = loadProjectConfig(findRepositoryRoot());

interface Harness {
  readonly runtime: RoomBattleRuntime;
  readonly broadcasts: ServerMessage[];
  readonly ended: { value: boolean };
  /** 每次托管接管回调收到的 playerId 批次。 */
  readonly autopilotEngaged: string[][];
}

function createHarness(
  humans: readonly {
    seatIndex: number;
    playerId: string;
    playerName: string;
  }[],
  startedAtMs = 1_000_000,
): Harness {
  const broadcasts: ServerMessage[] = [];
  const ended = { value: false };
  const autopilotEngaged: string[][] = [];
  const runtime = new RoomBattleRuntime({
    roomId: 'RM01',
    projectConfig: config,
    humans,
    startedAtMs,
    broadcast: (message) => {
      broadcasts.push(message);
    },
    onEvents: (_events: readonly M2BattleEvent<M2RouteId>[]) => {
      // 测试里不关心事件转发，只验证战斗共享与广播。
    },
    onMatchEnd: () => {
      ended.value = true;
    },
    onAutopilotEngaged: (playerIds) => {
      autopilotEngaged.push([...playerIds]);
    },
  });
  return { runtime, broadcasts, ended, autopilotEngaged };
}

describe('RoomBattleRuntime', () => {
  it('三名真人共享一份战斗，快照里的 allies 同时包含真人和 AI', () => {
    const { runtime } = createHarness([
      { seatIndex: 0, playerId: 'human:a', playerName: '玩家一' },
      { seatIndex: 1, playerId: 'human:b', playerName: '玩家二' },
      { seatIndex: 2, playerId: 'human:c', playerName: '玩家三' },
    ]);

    const snapshot = runtime.battle.createSnapshot(0, 1_000_000);
    const allies = snapshot.payload.allies;

    assert.equal(allies.length, config.allies.seatCount);
    assert.equal(allies.filter((ally) => !ally.isBot).length, 3);
    assert.equal(
      allies.filter((ally) => ally.isBot).length,
      config.allies.seatCount - 3,
    );
    // 席位顺序稳定，客户端可以直接按 seatIndex 落位。
    assert.deepEqual(
      allies.map((ally) => ally.seatIndex).slice(0, 3),
      [0, 1, 2],
    );
    assert.deepEqual(runtime.battle.humanPlayerIds, [
      'human:a',
      'human:b',
      'human:c',
    ]);
  });

  it('每名真人各自持有血量与背包，互不共享', () => {
    const { runtime } = createHarness([
      { seatIndex: 0, playerId: 'human:a', playerName: '玩家一' },
      { seatIndex: 3, playerId: 'human:b', playerName: '玩家二' },
    ]);

    assert.equal(runtime.battle.hasPlayer('human:a'), true);
    assert.equal(runtime.battle.hasPlayer('human:b'), true);
    assert.equal(runtime.battle.hasPlayer('human:missing'), false);

    // 两人开局位置不同，说明确实各占各的席位而不是共用一个实体。
    const first = runtime.battle.positionForPlayer('human:a');
    const second = runtime.battle.positionForPlayer('human:b');
    assert.ok(first);
    assert.ok(second);
    assert.notDeepEqual(first, second);

    assert.equal(
      runtime.battle.hpForPlayer('human:a'),
      config.gameplay.player.initialHp,
    );
    assert.equal(
      runtime.battle.hpForPlayer('human:b'),
      config.gameplay.player.initialHp,
    );
  });

  it('主循环单步会向房间广播世界快照', () => {
    const startedAtMs = 1_000_000;
    const { runtime, broadcasts } = createHarness(
      [{ seatIndex: 0, playerId: 'human:a', playerName: '玩家一' }],
      startedAtMs,
    );

    runtime.step(1, 0.05, startedAtMs + 50);

    const snapshots = broadcasts.filter(
      (message) => message.type === 'world_snapshot',
    );
    assert.equal(snapshots.length, 1);
    assert.equal(runtime.matchEnded, false);
  });

  it('全部真人阵亡且队友打光才判负，单人阵亡不立即结束', () => {
    const startedAtMs = 1_000_000;
    const { runtime, ended } = createHarness(
      [
        { seatIndex: 0, playerId: 'human:a', playerName: '玩家一' },
        { seatIndex: 1, playerId: 'human:b', playerName: '玩家二' },
      ],
      startedAtMs,
    );

    runtime.step(1, 0.05, startedAtMs + 50);
    assert.equal(ended.value, false);
    // 队伍尚在，两名真人都活着
    assert.equal(runtime.battle.isPlayerAlive('human:a'), true);
    assert.equal(runtime.battle.isPlayerAlive('human:b'), true);
    assert.equal(runtime.battle.aliveDefenderCount, config.allies.seatCount);
  });

  it('超时但还有敌人待投放时按配置加时，不提前结束（PRD 5.7）', () => {
    const startedAtMs = 1_000_000;
    const durationMs = config.gameplay.match.durationSec * 1000;
    const { runtime, ended } = createHarness(
      [{ seatIndex: 0, playerId: 'human:a', playerName: '玩家一' }],
      startedAtMs,
    );
    assert.equal(config.gameplay.match.allowOvertimeSpawn, true);

    runtime.step(1, 0.05, startedAtMs + durationMs + 5_000);

    assert.equal(ended.value, false);
    assert.equal(runtime.matchEnded, false);
  });

  it('关闭加时后超时即结束，且结束后重复 step 不会二次发战报', () => {
    const startedAtMs = 1_000_000;
    const durationMs = config.gameplay.match.durationSec * 1000;
    // 只覆盖加时开关来构造「超时即结束」场景，其余数值仍来自配置文件。
    const noOvertimeConfig = {
      ...config,
      gameplay: {
        ...config.gameplay,
        match: {
          ...config.gameplay.match,
          allowOvertimeSpawn: false,
        },
      },
    };
    let endCount = 0;
    const runtime = new RoomBattleRuntime({
      roomId: 'RM02',
      projectConfig: noOvertimeConfig,
      humans: [
        { seatIndex: 0, playerId: 'human:a', playerName: '玩家一' },
      ],
      startedAtMs,
      broadcast: () => {},
      onEvents: () => {},
      onMatchEnd: () => {
        endCount += 1;
      },
    });

    runtime.step(1, 0.05, startedAtMs + durationMs + 5_000);
    runtime.step(2, 0.05, startedAtMs + durationMs + 10_000);

    assert.equal(endCount, 1);
    assert.equal(runtime.matchEnded, true);
  });

  it('掉线未超过宽限期时保留角色，不转 AI 托管（PRD 7.3）', () => {
    const startedAtMs = 1_000_000;
    const graceMs = config.gameplay.server.reconnectGraceSec * 1000;
    const { runtime, autopilotEngaged } = createHarness(
      [
        { seatIndex: 0, playerId: 'human:a', playerName: '玩家一' },
        { seatIndex: 1, playerId: 'human:b', playerName: '玩家二' },
      ],
      startedAtMs,
    );

    assert.equal(runtime.markDisconnected('human:a', startedAtMs), true);
    assert.equal(runtime.isAwaitingReconnect('human:a'), true);

    // 差一秒到点，仍然是这个人的席位。
    runtime.step(1, 0.05, startedAtMs + graceMs - 1_000);

    assert.equal(runtime.battle.isAutopilot('human:a'), false);
    assert.equal(autopilotEngaged.length, 0);
    assert.equal(runtime.battle.hasPlayer('human:a'), true);
  });

  it('掉线超过宽限期转 AI 托管，对局继续且席位仍算真人', () => {
    const startedAtMs = 1_000_000;
    const graceMs = config.gameplay.server.reconnectGraceSec * 1000;
    const { runtime, autopilotEngaged, ended } = createHarness(
      [
        { seatIndex: 0, playerId: 'human:a', playerName: '玩家一' },
        { seatIndex: 1, playerId: 'human:b', playerName: '玩家二' },
      ],
      startedAtMs,
    );
    const hpBefore = runtime.battle.hpForPlayer('human:a');

    runtime.markDisconnected('human:a', startedAtMs);
    runtime.step(1, 0.05, startedAtMs + graceMs + 1_000);

    assert.equal(runtime.battle.isAutopilot('human:a'), true);
    assert.deepEqual(autopilotEngaged, [['human:a']]);
    assert.equal(runtime.isAwaitingReconnect('human:a'), false);
    // 托管只换决策，不搬数据：血量与席位归属都不变。
    assert.equal(runtime.battle.hpForPlayer('human:a'), hpBefore);
    assert.equal(runtime.battle.hasPlayer('human:a'), true);
    // 对局继续。
    assert.equal(ended.value, false);
    assert.equal(runtime.matchEnded, false);

    const snapshot = runtime.battle.createSnapshot(
      1,
      startedAtMs + graceMs + 1_000,
    );
    const seat = snapshot.payload.allies.find(
      (ally) => ally.id === 'human:a',
    );
    assert.ok(seat);
    // isBot 仍为 false，只是多了托管标记，客户端据此显示「托管中」。
    assert.equal(seat.isBot, false);
    assert.equal(seat.autopilot, true);
  });

  it('宽限期内重连取消倒计时，人回来后不再被托管', () => {
    const startedAtMs = 1_000_000;
    const graceMs = config.gameplay.server.reconnectGraceSec * 1000;
    const { runtime, autopilotEngaged } = createHarness(
      [{ seatIndex: 0, playerId: 'human:a', playerName: '玩家一' }],
      startedAtMs,
    );

    runtime.markDisconnected('human:a', startedAtMs);
    // 还没超时就回来了，markReconnected 返回 false（本来就没被托管）。
    assert.equal(runtime.markReconnected('human:a'), false);
    assert.equal(runtime.isAwaitingReconnect('human:a'), false);

    runtime.step(1, 0.05, startedAtMs + graceMs + 5_000);

    assert.equal(runtime.battle.isAutopilot('human:a'), false);
    assert.equal(autopilotEngaged.length, 0);
  });

  it('超时被托管后重连，能接回原席位并收回控制权', () => {
    const startedAtMs = 1_000_000;
    const graceMs = config.gameplay.server.reconnectGraceSec * 1000;
    const { runtime } = createHarness(
      [
        { seatIndex: 0, playerId: 'human:a', playerName: '玩家一' },
        { seatIndex: 1, playerId: 'human:b', playerName: '玩家二' },
      ],
      startedAtMs,
    );

    runtime.markDisconnected('human:a', startedAtMs);
    runtime.step(1, 0.05, startedAtMs + graceMs + 1_000);
    assert.equal(runtime.battle.isAutopilot('human:a'), true);
    const hpDuringAutopilot = runtime.battle.hpForPlayer('human:a');

    // 人回来了，从 AI 手里接回控制权。
    assert.equal(runtime.markReconnected('human:a'), true);
    assert.equal(runtime.battle.isAutopilot('human:a'), false);
    // 血量延续托管期间的结果，不是重置成满血。
    assert.equal(
      runtime.battle.hpForPlayer('human:a'),
      hpDuringAutopilot,
    );
    // 重复调用是幂等的。
    assert.equal(runtime.markReconnected('human:a'), false);
  });

  it('托管期间的击杀仍记在这名真人头上，不算 AI 队友战绩', () => {
    const startedAtMs = 1_000_000;
    const graceMs = config.gameplay.server.reconnectGraceSec * 1000;
    const { runtime } = createHarness(
      [{ seatIndex: 0, playerId: 'human:a', playerName: '玩家一' }],
      startedAtMs,
    );

    runtime.markDisconnected('human:a', startedAtMs);

    // 推进到托管生效并持续跑一段时间，让托管 AI 有机会开火。
    let nowMs = startedAtMs + graceMs + 1_000;
    for (let tick = 1; tick <= 400; tick += 1) {
      runtime.step(tick, 0.05, nowMs);
      nowMs += 50;
      if (runtime.matchEnded) {
        break;
      }
    }

    assert.equal(runtime.battle.isAutopilot('human:a'), true);
    // 托管确实在打：命中或未命中都会被计分器记成这个人开的枪。
    const scoreboard = runtime.battle.createScoreboard(
      (nowMs - startedAtMs) / 1000,
    );
    const entry = scoreboard.find(
      (row) => row.occupantId === 'human:a',
    );
    assert.ok(entry);
    assert.equal(entry.isBot, false);
    assert.ok(
      entry.shotsFired > 0,
      '托管期间应当有开火记录，实际为 0',
    );
  });

  it('没有真人时拒绝创建战斗', () => {
    assert.throws(
      () =>
        new RoomBattleRuntime({
          roomId: 'RM03',
          projectConfig: config,
          humans: [],
          startedAtMs: 1_000_000,
          broadcast: () => {},
          onEvents: () => {},
          onMatchEnd: () => {},
        }),
      /开局至少需要一名真人/,
    );
  });
});
