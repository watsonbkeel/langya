import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findRepositoryRoot,
  loadProjectConfig,
} from '../config/project-config';
import { createM2BattleRuntime } from './m2-battle-factory';

const config = loadProjectConfig(findRepositoryRoot());

describe('M2BattleSession', () => {
  it('创建真人加四名 AI 队友并按配置限制同屏敌人数', () => {
    const { battle } = createM2BattleRuntime(
      config,
      'player-1',
      '测试玩家',
      1,
    );
    const routeIds = Object.keys(
      config.waves.routes,
    ) as (keyof typeof config.waves.routes)[];

    for (
      let index = 0;
      index < config.waves.maxAliveEnemies + 1;
      index += 1
    ) {
      battle.spawnEnemy(
        'rifleman',
        routeIds[index % routeIds.length]!,
        config.waves.waves[0]!.accuracy,
        0,
      );
    }
    const snapshot = battle.createSnapshot(0, 0);

    assert.equal(snapshot.payload.allies.length, config.allies.seatCount);
    assert.equal(
      snapshot.payload.allies.filter((ally) => ally.isBot).length,
      config.allies.seatCount - 1,
    );
    assert.equal(
      snapshot.payload.enemies.length,
      config.waves.maxAliveEnemies,
    );
  });

  it('真人射击继续使用服务端射线和伤害裁决', () => {
    const { battle } = createM2BattleRuntime(
      config,
      'player-2',
      '测试玩家',
      2,
    );
    const enemyId = battle.spawnEnemy(
      'rifleman',
      'A',
      config.waves.waves[0]!.accuracy,
      0,
    );
    assert.ok(enemyId);
    const fire = battle.createFireMessageForEnemy(enemyId, 1, 'head');
    assert.ok(fire);

    const resolution = battle.fire(fire, 0);

    assert.equal(resolution.result.payload.accepted, true);
    assert.equal(resolution.result.payload.hit, true);
    if (resolution.result.payload.hit) {
      assert.equal(resolution.result.payload.isKill, true);
    }
    assert.equal(resolution.death?.payload.enemyId, enemyId);
    assert.equal(battle.playerKills, 1);
  });

  it('敌我 AI 共用 tick 更新并产生预警、伤害和喊话事件', () => {
    const { battle, tickRateHz } = createM2BattleRuntime(
      config,
      'player-3',
      '测试玩家',
      3,
    );
    const firstWave = config.waves.waves[0]!;
    for (let index = 0; index < config.allies.callout.enemyThreshold; index += 1) {
      battle.spawnEnemy('rifleman', 'A', 1, 0);
    }

    const events = [];
    const stepMs = 1000 / tickRateHz;
    const endMs =
      (config.enemies.units.rifleman.advanceSec +
        config.enemies.sharedRules.fireWarningSec +
        1) *
      1000;
    for (let nowMs = 0, tick = 0; nowMs <= endMs; nowMs += stepMs, tick += 1) {
      events.push(...battle.update(stepMs / 1000, tick, nowMs));
    }

    assert.equal(
      events.some((event) => event.type === 'fire_warning'),
      true,
    );
    assert.equal(
      events.some((event) => event.type === 'ally_damaged'),
      true,
    );
    assert.equal(
      events.some((event) => 'text' in event),
      true,
    );
    assert.equal(firstWave.accuracy > 0, true);
  });

  it('存活队友的生存时长按当前模拟时间结算', () => {
    const { battle, tickRateHz } = createM2BattleRuntime(
      config,
      'player-4',
      '测试玩家',
      4,
    );
    const elapsedSec = config.allies.calibration.minAvgSurvivalSec;

    battle.update(1 / tickRateHz, 0, 1000 / tickRateHz);
    battle.update(1 / tickRateHz, 1, elapsedSec * 1000);

    assert.deepEqual(
      battle.allySurvivalSec,
      Array.from(
        { length: config.allies.seatCount - 1 },
        () => elapsedSec,
      ),
    );
  });

  it('按弹药箱冷却补充真人备弹', () => {
    const { battle } = createM2BattleRuntime(
      config,
      'player-5',
      '测试玩家',
      5,
    );
    const enemyId = battle.spawnEnemy(
      'rifleman',
      'A',
      config.waves.waves[0]!.accuracy,
      0,
    );
    assert.ok(enemyId);
    const fire = battle.createFireMessageForEnemy(enemyId, 1, 'head');
    assert.ok(fire);
    battle.fire(fire, 0);
    battle.reload(
      {
        type: 'reload',
        payload: {
          weaponId:
            config.gameplay.player.defaultLoadout.primary,
        },
      },
      0,
    );
    battle.update(
      config.weapons.player.liaoshi13.reloadSec,
      1,
      config.weapons.player.liaoshi13.reloadSec * 1000,
    );

    assert.equal(
      battle.playerWeaponState.reserveAmmo <
        config.weapons.player.liaoshi13.reserveAmmo,
      true,
    );
    assert.equal(
      battle.resupplyPlayerAmmo(
        config.weapons.player.liaoshi13.reloadSec * 1000,
      ),
      true,
    );
    assert.equal(
      battle.playerWeaponState.reserveAmmo,
      config.weapons.player.liaoshi13.reserveAmmo,
    );
    assert.equal(
      battle.resupplyPlayerAmmo(
        (config.weapons.player.liaoshi13.reloadSec +
          config.gameplay.arena.ammoBoxCooldownSec / 2) *
          1000,
      ),
      false,
    );
  });
});
