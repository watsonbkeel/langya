import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findRepositoryRoot,
  loadProjectConfig,
} from '../config/project-config';
import {
  createM2BattleRuntime,
  populateM2Battlefield,
} from './m2-battle-factory';

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
    assert.deepEqual(
      battle.createRoomState().payload.seats.map((seat) => seat.seatIndex),
      [0, 1, 2, 3, 4],
    );
    assert.equal(
      battle.createRoomState().payload.seats.every(
        (seat) => seat.alive,
      ),
      true,
    );
  });

  it('M2 联调战场按存活敌人的 routeId 提供三路威胁数据', () => {
    const { battle } = createM2BattleRuntime(
      config,
      'player-routes',
      '测试玩家',
      7,
    );
    const spawned = populateM2Battlefield(config, battle, 0);
    const snapshot = battle.createSnapshot(0, 0);
    const threatCounts = snapshot.payload.enemies.reduce(
      (counts, enemy) => {
        counts[enemy.routeId] += 1;
        return counts;
      },
      { A: 0, B: 0, C: 0 },
    );

    assert.equal(spawned, snapshot.payload.enemies.length);
    assert.deepEqual(threatCounts, {
      A: config.allies.callout.enemyThreshold,
      B: config.allies.callout.enemyThreshold,
      C: config.allies.callout.enemyThreshold,
    });
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
    const playerScore = battle
      .createScoreboard()
      .find((entry) => entry.occupantId === 'player-2');
    assert.ok(playerScore);
    assert.equal(playerScore.kills, 1);
    assert.equal(playerScore.headshots, 1);
    assert.equal(playerScore.shotsFired, 1);
    assert.equal(playerScore.shotsHit, 1);
    assert.equal(playerScore.damageDealt, config.enemies.units.rifleman.hp);
    assert.equal(battle.selectMvpPlayerId(), 'player-2');
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

  it('预警使用服务器时间且受击方向从受击者指向攻击者', () => {
    const warningConfig = {
      ...config,
      allies: {
        ...config.allies,
        bot: {
          ...config.allies.bot,
          accuracy: 0,
          accuracyLongRange: 0,
        },
      },
    };
    const { battle, tickRateHz } = createM2BattleRuntime(
      warningConfig,
      'player-warning',
      '测试玩家',
      1,
    );
    battle.spawnEnemy('rifleman', 'A', 1, 0);

    const stepMs = 1000 / tickRateHz;
    let warningChecked = false;
    let directionChecked = false;
    for (let nowMs = 0, tick = 0; nowMs <= 10_000; nowMs += stepMs, tick += 1) {
      const events = battle.update(stepMs / 1000, tick, nowMs);
      const snapshot = battle.createSnapshot(tick, nowMs);
      const warningEnemy = snapshot.payload.enemies.find(
        (enemy) => enemy.fireWarningEndsAtMs !== undefined,
      );
      if (warningEnemy?.fireWarningEndsAtMs !== undefined) {
        assert.equal(warningEnemy.fireWarningEndsAtMs > nowMs, true);
        warningChecked = true;
      }

      const damage = events.find(
        (event) => event.type === 'ally_damaged',
      );
      if (damage?.type === 'ally_damaged') {
        const victim = snapshot.payload.allies.find(
          (ally) => ally.id === damage.allyId,
        );
        const attacker = snapshot.payload.enemies[0];
        assert.ok(victim);
        assert.ok(attacker);
        const expected = normalize({
          x: attacker.position.x - victim.position.x,
          y: attacker.position.y - victim.position.y,
          z: attacker.position.z - victim.position.z,
        });
        assert.ok(Math.abs(vectorLength(damage.fromDir) - 1) < 1e-9);
        assert.ok(dot(damage.fromDir, expected) > 0.999999);
        directionChecked = true;
        break;
      }
    }

    assert.equal(warningChecked, true);
    assert.equal(directionChecked, true);
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

  it('真人血包在阈值等号时接受，立即扣除并回血到上限，且不阻止移动或开火', () => {
    const injuredConfig = {
      ...config,
      gameplay: {
        ...config.gameplay,
        player: {
          ...config.gameplay.player,
          initialHp:
            config.gameplay.player.maxHp -
            config.gameplay.medkit.carriedHeal,
        },
      },
    };
    const { battle } = createM2BattleRuntime(
      injuredConfig,
      'player-6',
      '测试玩家',
      6,
    );
    const before = battle
      .createSnapshot(0, 0)
      .payload.allies.find((ally) => !ally.isBot);
    assert.ok(before);
    assert.equal(
      before.hp,
      config.gameplay.player.maxHp -
        config.gameplay.medkit.carriedHeal,
    );

    assert.equal(battle.tryUsePlayerMedkit(), undefined);
    const healed = battle
      .createSnapshot(1, 0)
      .payload.allies.find((ally) => !ally.isBot);
    assert.ok(healed);
    assert.equal(healed.hp, config.gameplay.player.maxHp);
    assert.equal(healed.hp <= config.gameplay.player.maxHp, true);
    assert.equal(
      healed.medkitsRemaining,
      before.medkitsRemaining - 1,
    );
    assert.equal(healed.medkitEndsAtMs, undefined);

    const startPosition = battle.playerPosition;
    assert.equal(
      battle.applyInput({
        type: 'input_state',
        payload: {
          clientTick: 1,
          moveDir: { x: 1, y: 0 },
          aimYaw: 0,
          aimPitch: 0,
          isCrouch: false,
        },
      }),
      true,
    );
    battle.update(1, 0, 1000);
    assert.notDeepEqual(battle.playerPosition, startPosition);

    const enemyId = battle.spawnEnemy(
      'rifleman',
      'A',
      config.waves.waves[0]!.accuracy,
      1000,
    );
    assert.ok(enemyId);
    const fire = battle.createFireMessageForEnemy(enemyId, 2, 'head');
    assert.ok(fire);
    assert.equal(battle.fire(fire, 1000).result.payload.accepted, true);
  });

  it('真人连续请求血包不会把剩余数量扣成负数', () => {
    const rapidUseConfig = {
      ...config,
      gameplay: {
        ...config.gameplay,
        player: {
          ...config.gameplay.player,
          initialHp:
            config.gameplay.player.maxHp -
            config.gameplay.medkit.carriedHeal -
            config.gameplay.medkit.carriedHeal,
          medkitCount: 1,
        },
      },
    };
    const { battle } = createM2BattleRuntime(
      rapidUseConfig,
      'player-medkit-rapid',
      '测试玩家',
      60,
    );

    assert.equal(battle.tryUsePlayerMedkit(), undefined);
    assert.equal(battle.tryUsePlayerMedkit(), 'no_resource');
    assert.equal(battle.tryUsePlayerMedkit(), 'no_resource');

    const player = battle
      .createSnapshot(2, 0)
      .payload.allies.find((ally) => !ally.isBot);
    assert.ok(player);
    assert.equal(player.medkitsRemaining, 0);
    assert.equal(player.medkitEndsAtMs, undefined);
  });

  it('真人血包拒绝高生命值、耗尽和阵亡状态', () => {
    const highHealthConfig = {
      ...config,
      gameplay: {
        ...config.gameplay,
        player: {
          ...config.gameplay.player,
          initialHp:
            config.gameplay.player.maxHp -
            config.gameplay.medkit.carriedHeal +
            1,
        },
      },
    };
    const highHealth = createM2BattleRuntime(
      highHealthConfig,
      'player-medkit-full',
      '测试玩家',
      61,
    ).battle;
    assert.equal(highHealth.tryUsePlayerMedkit(), 'unavailable');

    const noResourceConfig = {
      ...config,
      gameplay: {
        ...config.gameplay,
        player: {
          ...config.gameplay.player,
          initialHp:
            config.gameplay.player.maxHp -
            config.gameplay.medkit.carriedHeal,
          medkitCount: 0,
        },
      },
    };
    const noResource = createM2BattleRuntime(
      noResourceConfig,
      'player-medkit-empty',
      '测试玩家',
      62,
    ).battle;
    assert.equal(noResource.tryUsePlayerMedkit(), 'no_resource');

    const deadConfig = {
      ...config,
      gameplay: {
        ...config.gameplay,
        player: {
          ...config.gameplay.player,
          initialHp: 0,
        },
      },
    };
    const dead = createM2BattleRuntime(
      deadConfig,
      'player-medkit-dead',
      '测试玩家',
      63,
    ).battle;
    assert.equal(dead.tryUsePlayerMedkit(), 'dead');
  });

  it('武器架拾取后才能切换且快照同步当前装备', () => {
    const { battle } = createM2BattleRuntime(
      config,
      'player-weapons',
      '测试玩家',
      8,
    );
    const rack = battle
      .createSnapshot(0, 0)
      .payload.items.find((item) => item.kind === 'weapon_rack');
    assert.ok(rack);
    assert.equal(
      battle.switchPlayerWeapon(rack.weaponId),
      'unavailable',
    );

    const deltaX = rack.position.x - battle.playerPosition.x;
    battle.applyInput({
      type: 'input_state',
      payload: {
        clientTick: 1,
        moveDir: { x: Math.sign(deltaX), y: 0 },
        aimYaw: 0,
        aimPitch: 0,
        isCrouch: false,
      },
    });
    battle.update(
      Math.abs(deltaX) / config.gameplay.player.moveSpeed,
      0,
      1000,
    );

    assert.equal(battle.pickupItem(rack.id, 1000), undefined);
    assert.equal(battle.switchPlayerWeapon(rack.weaponId), undefined);
    const player = battle
      .createSnapshot(1, 1000)
      .payload.allies.find((ally) => !ally.isBot);
    assert.ok(player);
    assert.equal(player.weapon.weaponId, rack.weaponId);
    assert.equal(
      player.availableWeaponIds.includes(rack.weaponId),
      true,
    );
  });

  it('手榴弹投掷由服务端校验并扣减权威数量', () => {
    const { battle } = createM2BattleRuntime(
      config,
      'player-grenade',
      '测试玩家',
      9,
    );
    const originPos = battle.playerPosition;
    const createMessage = (clientTick: number) => ({
      type: 'throw_grenade' as const,
      payload: {
        originPos,
        dirVec: { x: 0, y: 0, z: -1 },
        force: 1,
        clientTick,
      },
    });

    for (
      let count = 0;
      count < config.gameplay.player.defaultLoadout.throwableCount;
      count += 1
    ) {
      assert.equal(
        battle.throwGrenade(createMessage(count), count * 1000),
        undefined,
      );
    }
    assert.equal(
      battle.throwGrenade(createMessage(5), 5000),
      'no_resource',
    );
    const player = battle
      .createSnapshot(0, 0)
      .payload.allies.find((ally) => !ally.isBot);
    assert.equal(player?.grenadesRemaining, 0);
  });

  it('重机枪挂载后锁定移动、限制射界并记录专属击杀', () => {
    const { battle } = createM2BattleRuntime(
      config,
      'player-mg',
      '测试玩家',
      10,
    );
    const initialSnapshot = battle.createSnapshot(0, 0);
    assert.equal(
      initialSnapshot.payload.machineGuns.length,
      config.weapons.emplacement['type92-hmg'].nestCount,
    );
    const machineGun = initialSnapshot.payload.machineGuns[0];
    assert.ok(machineGun);
    assert.equal(
      battle.mountMachineGun(machineGun.id),
      'out_of_range',
    );

    const deltaX = machineGun.position.x - battle.playerPosition.x;
    battle.applyInput({
      type: 'input_state',
      payload: {
        clientTick: 1,
        moveDir: { x: Math.sign(deltaX), y: 0 },
        aimYaw: 0,
        aimPitch: 0,
        isCrouch: false,
      },
    });
    battle.update(
      Math.abs(deltaX) / config.gameplay.player.moveSpeed,
      0,
      1000,
    );
    assert.equal(battle.mountMachineGun(machineGun.id), undefined);

    const mountedPosition = battle.playerPosition;
    battle.applyInput({
      type: 'input_state',
      payload: {
        clientTick: 2,
        moveDir: { x: 1, y: 1 },
        aimYaw: 0,
        aimPitch: 0,
        isCrouch: true,
      },
    });
    battle.update(1, 1, 2000);
    assert.deepEqual(battle.playerPosition, mountedPosition);
    const mountedPlayer = battle
      .createSnapshot(1, 2000)
      .payload.allies.find((ally) => !ally.isBot);
    assert.equal(mountedPlayer?.mountedMgId, machineGun.id);

    const invalidDirection = battle.fire(
      {
        type: 'fire',
        payload: {
          weaponId: machineGun.weaponId,
          originPos: battle.playerPosition,
          dirVec: { x: 1, y: 0, z: 0 },
          clientTick: 3,
        },
      },
      2000,
    );
    assert.equal(invalidDirection.result.payload.accepted, false);
    if (!invalidDirection.result.payload.accepted) {
      assert.equal(
        invalidDirection.result.payload.rejectReason,
        'invalid_direction',
      );
    }

    const enemyId = battle.spawnEnemy(
      'rifleman',
      'A',
      config.waves.waves[0]!.accuracy,
      2000,
    );
    assert.ok(enemyId);
    const fire = battle.createFireMessageForEnemy(
      enemyId,
      4,
      'head',
    );
    assert.ok(fire);
    const resolution = battle.fire(fire, 2000);
    assert.equal(resolution.result.payload.accepted, true);
    assert.equal(resolution.result.payload.hit, true);
    assert.equal(resolution.death?.payload.enemyId, enemyId);
    assert.equal(resolution.result.payload.reserveAmmo, 0);
    assert.equal(
      resolution.result.payload.magazineAmmo,
      config.weapons.emplacement['type92-hmg'].beltCapacity - 1,
    );
    const playerScore = battle
      .createScoreboard()
      .find((entry) => entry.occupantId === 'player-mg');
    assert.equal(playerScore?.mgKills, 1);

    assert.equal(battle.unmountMachineGun(), undefined);
    const unmountedPlayer = battle
      .createSnapshot(2, 2000)
      .payload.allies.find((ally) => !ally.isBot);
    assert.equal(unmountedPlayer?.mountedMgId, undefined);
  });
});

function normalize(vector: { x: number; y: number; z: number }) {
  const length = vectorLength(vector);
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function vectorLength(vector: { x: number; y: number; z: number }) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function dot(
  first: { x: number; y: number; z: number },
  second: { x: number; y: number; z: number },
) {
  return (
    first.x * second.x +
    first.y * second.y +
    first.z * second.z
  );
}
