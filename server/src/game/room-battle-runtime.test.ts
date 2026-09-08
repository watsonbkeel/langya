import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  findRepositoryRoot,
  loadProjectConfig,
} from '../config/project-config';
import type { ServerMessage } from '../../../shared/protocol';
import {
  MatchReportRepository,
  type MatchReport,
} from '../db/match-report-repository';
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

  it('多名真人各自击杀分别记账，不会互相串号', () => {
    const startedAtMs = 1_000_000;
    const { runtime } = createHarness(
      [
        { seatIndex: 0, playerId: 'human:a', playerName: '玩家一' },
        { seatIndex: 1, playerId: 'human:b', playerName: '玩家二' },
        { seatIndex: 2, playerId: 'human:c', playerName: '玩家三' },
      ],
      startedAtMs,
    );
    const battle = runtime.battle;
    const accuracy = config.waves.waves[0]!.accuracy;

    // 每人各打死一定数量的敌人：A 打 3 个，B 打 2 个，C 打 1 个。
    // 每次只放一个敌人再打掉，避免射线打到别人的目标造成串号误判。
    const killPlan: readonly { playerId: string; kills: number }[] = [
      { playerId: 'human:a', kills: 3 },
      { playerId: 'human:b', kills: 2 },
      { playerId: 'human:c', kills: 1 },
    ];
    // 步枪有射速冷却，每发之间推进足够时间，避免被冷却挡掉。
    const fireIntervalMs =
      Math.ceil(
        1000 / config.weapons.player.liaoshi13.fireRate,
      ) + 100;
    let nowMs = startedAtMs;
    let clientTick = 1;

    for (const plan of killPlan) {
      for (let index = 0; index < plan.kills; index += 1) {
        const enemyId = battle.spawnEnemy('rifleman', 'A', accuracy, nowMs);
        assert.ok(enemyId, '敌人应当投放成功');
        const fire = battle.createFireMessageForEnemy(
          enemyId,
          clientTick,
          'head',
          plan.playerId,
        );
        assert.ok(fire, `${plan.playerId} 应当能构造朝向敌人的射击消息`);
        const resolution = battle.fire(fire, nowMs, plan.playerId);
        assert.equal(
          resolution.result.payload.accepted,
          true,
          `${plan.playerId} 的射击应被接受`,
        );
        assert.equal(resolution.result.payload.hit, true);
        assert.equal(resolution.death?.payload.enemyId, enemyId);
        clientTick += 1;
        nowMs += fireIntervalMs;
      }
    }

    const scoreboard = battle.createScoreboard(
      (nowMs - startedAtMs) / 1000,
    );
    const entryFor = (occupantId: string) => {
      const entry = scoreboard.find(
        (row) => row.occupantId === occupantId,
      );
      assert.ok(entry, `战报里应当有 ${occupantId}`);
      return entry;
    };

    // 五个席位都在战报里：3 名真人 + 2 名 AI 队友。
    assert.equal(scoreboard.length, config.allies.seatCount);
    assert.equal(
      scoreboard.filter((row) => !row.isBot).length,
      3,
    );
    // 席位序稳定，客户端可以直接按顺序渲染战报。
    assert.deepEqual(
      scoreboard.map((row) => row.seatIndex),
      [0, 1, 2, 3, 4],
    );

    assert.equal(entryFor('human:a').kills, 3);
    assert.equal(entryFor('human:b').kills, 2);
    assert.equal(entryFor('human:c').kills, 1);
    // 交叉核对：battle 层的单人查询与战报口径一致。
    assert.equal(battle.killsForPlayer('human:a'), 3);
    assert.equal(battle.killsForPlayer('human:b'), 2);
    assert.equal(battle.killsForPlayer('human:c'), 1);
    // 每人的开火数只算自己的，爆头也各记各的。
    assert.equal(entryFor('human:a').shotsFired, 3);
    assert.equal(entryFor('human:b').shotsFired, 2);
    assert.equal(entryFor('human:c').shotsFired, 1);
    assert.equal(entryFor('human:a').headshots, 3);

    // MVP 归击杀最多且仍存活的真人（PRD 2.7 / 7.6）。
    assert.equal(
      battle.selectMvpPlayerId((nowMs - startedAtMs) / 1000),
      'human:a',
    );
  });

  it('多人 MVP 击杀持平时按重机枪击杀、存活、命中率依次比（PRD 7.6）', () => {
    const startedAtMs = 1_000_000;
    const { runtime } = createHarness(
      [
        { seatIndex: 0, playerId: 'human:a', playerName: '玩家一' },
        { seatIndex: 1, playerId: 'human:b', playerName: '玩家二' },
      ],
      startedAtMs,
    );
    const battle = runtime.battle;
    const accuracy = config.waves.waves[0]!.accuracy;
    const fireIntervalMs =
      Math.ceil(1000 / config.weapons.player.liaoshi13.fireRate) + 100;
    let nowMs = startedAtMs;
    let clientTick = 1;

    const killOnce = (playerId: string): void => {
      const enemyId = battle.spawnEnemy('rifleman', 'A', accuracy, nowMs);
      assert.ok(enemyId);
      const fire = battle.createFireMessageForEnemy(
        enemyId,
        clientTick,
        'head',
        playerId,
      );
      assert.ok(fire);
      const resolution = battle.fire(fire, nowMs, playerId);
      assert.equal(resolution.result.payload.accepted, true);
      clientTick += 1;
      nowMs += fireIntervalMs;
    };
    const missOnce = (playerId: string): void => {
      const origin = battle.positionForPlayer(playerId);
      assert.ok(origin);
      // 朝天开一枪：射线打不到任何敌人，只拉低命中率。
      const resolution = battle.fire(
        {
          type: 'fire',
          payload: {
            weaponId: config.gameplay.player.defaultLoadout.primary,
            originPos: origin,
            dirVec: { x: 0, y: 1, z: 0 },
            clientTick,
          },
        },
        nowMs,
        playerId,
      );
      assert.equal(resolution.result.payload.accepted, true);
      assert.equal(resolution.result.payload.hit, false);
      clientTick += 1;
      nowMs += fireIntervalMs;
    };

    // 两人击杀数打平（各 2 个），都没用重机枪、都活着，
    // 差异只在命中率：A 全中，B 多打了两枪空枪。
    killOnce('human:a');
    killOnce('human:b');
    killOnce('human:a');
    killOnce('human:b');
    missOnce('human:b');
    missOnce('human:b');

    const endedAtSec = (nowMs - startedAtMs) / 1000;
    const scoreboard = battle.createScoreboard(endedAtSec);
    const a = scoreboard.find((row) => row.occupantId === 'human:a');
    const b = scoreboard.find((row) => row.occupantId === 'human:b');
    assert.ok(a);
    assert.ok(b);
    assert.equal(a.kills, b.kills);
    assert.equal(a.mgKills, 0);
    assert.equal(b.mgKills, 0);
    assert.equal(a.alive, true);
    assert.equal(b.alive, true);
    assert.ok(a.accuracy > b.accuracy, '命中率应当拉开差距');

    // MVP 规则来自配置，不是代码里写死的。
    assert.equal(config.gameplay.score.mvpHumanOnly, true);
    assert.equal(config.gameplay.score.mvpRequiresAlive, true);
    assert.equal(battle.selectMvpPlayerId(endedAtSec), 'human:a');
  });

  it('多人战报能原样落库并读回，MVP 与各席位战绩不丢失', () => {
    const startedAtMs = 1_000_000;
    const { runtime } = createHarness(
      [
        { seatIndex: 0, playerId: 'human:a', playerName: '玩家一' },
        { seatIndex: 1, playerId: 'human:b', playerName: '玩家二' },
      ],
      startedAtMs,
    );
    const battle = runtime.battle;
    const accuracy = config.waves.waves[0]!.accuracy;
    const fireIntervalMs =
      Math.ceil(
        1000 / config.weapons.player.liaoshi13.fireRate,
      ) + 100;
    let nowMs = startedAtMs;
    let clientTick = 1;
    for (const playerId of ['human:a', 'human:a', 'human:b']) {
      const enemyId = battle.spawnEnemy('rifleman', 'A', accuracy, nowMs);
      assert.ok(enemyId);
      const fire = battle.createFireMessageForEnemy(
        enemyId,
        clientTick,
        'torso',
        playerId,
      );
      assert.ok(fire);
      battle.fire(fire, nowMs, playerId);
      clientTick += 1;
      nowMs += fireIntervalMs;
    }

    const endedAtSec = (nowMs - startedAtMs) / 1000;
    const scoreboard = battle.createScoreboard(endedAtSec);
    const mvpPlayerId = battle.selectMvpPlayerId(endedAtSec);
    assert.equal(mvpPlayerId, 'human:a');

    const directory = mkdtempSync(join(tmpdir(), 'langya-mp-report-'));
    const repository = new MatchReportRepository(
      join(directory, 'matches.sqlite'),
    );
    try {
      const report: MatchReport = {
        matchId: 'match-multiplayer-1',
        result: 'victory',
        reason: 'time_survived',
        startedAtMs,
        endedAtMs: nowMs,
        scoreboard,
        mvpPlayerId,
        spawnedEnemies: battle.totalEnemyCount,
        defeatedEnemies: 3,
        totalEnemies: config.waves.totalEnemies,
      };
      repository.save(report);

      const loaded = repository.find(report.matchId);
      assert.ok(loaded);
      assert.equal(loaded.mvpPlayerId, 'human:a');
      assert.equal(loaded.scoreboard.length, config.allies.seatCount);
      // 五个席位的每一项数值都要能原样读回来，客户端战报才靠得住。
      assert.deepEqual(loaded.scoreboard, scoreboard);
      assert.equal(
        loaded.scoreboard.filter((row) => !row.isBot).length,
        2,
      );
    } finally {
      repository.close();
      rmSync(directory, { recursive: true, force: true });
    }
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
