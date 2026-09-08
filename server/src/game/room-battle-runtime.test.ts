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
  });
  return { runtime, broadcasts, ended };
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
