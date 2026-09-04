import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import alliesConfig from '../../../../shared/config/allies.json';
import enemiesConfig from '../../../../shared/config/enemies.json';
import gameplayConfig from '../../../../shared/config/gameplay.json';
import weaponsConfig from '../../../../shared/config/weapons.json';

import {
  AllyAgent,
  AllyController,
  type AllyTarget,
} from './ally-controller';
import { CalloutController } from './callout-controller';

type TestRouteId = 'A' | 'B' | 'C';

const routes = {
  A: {
    routeId: 'A',
    spawnPosition: { x: 0, y: 0, z: 0 },
    guardPosition: { x: 0, y: 0, z: -10 },
    waypoints: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -10 },
    ],
  },
  B: {
    routeId: 'B',
    spawnPosition: { x: 10, y: 0, z: 0 },
    guardPosition: { x: 10, y: 0, z: -10 },
    waypoints: [
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 0, z: -10 },
    ],
  },
  C: {
    routeId: 'C',
    spawnPosition: { x: 20, y: 0, z: 0 },
    guardPosition: { x: 20, y: 0, z: -10 },
    waypoints: [
      { x: 20, y: 0, z: 0 },
      { x: 20, y: 0, z: -10 },
    ],
  },
} as const;

function createAlly(
  routeId: TestRouteId = 'A',
  weapon = weaponsConfig.player.liaoshi13,
): AllyAgent<TestRouteId> {
  return new AllyAgent({
    id: 'ally-1',
    heroName: '葛振林',
    route: routes[routeId],
    position: routes[routeId].guardPosition,
    bot: alliesConfig.bot,
    weapon,
    medkit: gameplayConfig.medkit,
  });
}

function createTarget(
  routeId: TestRouteId = 'A',
): AllyTarget<TestRouteId> {
  return {
    id: 'enemy-1',
    routeId,
    position: { x: routes[routeId].guardPosition.x, y: 0, z: -20 },
    alive: true,
  };
}

describe('AllyAgent', () => {
  it('优先选择本路线目标并等待配置中的反应延迟', () => {
    const ally = createAlly();
    const ownRouteTarget = createTarget();
    const otherRouteTarget = {
      ...createTarget('B'),
      id: 'enemy-b',
      position: { x: 1, y: 0, z: -10 },
    };

    assert.equal(ally.think(0, [otherRouteTarget, ownRouteTarget]), undefined);
    const shot = ally.think(
      alliesConfig.bot.reactionDelaySec * 1000,
      [otherRouteTarget, ownRouteTarget],
    );

    assert.equal(shot?.targetId, ownRouteTarget.id);
    assert.equal(shot?.accuracy, alliesConfig.bot.accuracy);
    assert.equal(
      ally.weaponState.magazineAmmo,
      weaponsConfig.player.liaoshi13.magazine - 1,
    );
  });

  it('本路线无敌人时支援其他路线', () => {
    const ally = createAlly();
    const target = createTarget('B');

    ally.think(0, [target]);
    const shot = ally.think(
      alliesConfig.bot.reactionDelaySec * 1000,
      [target],
    );

    assert.equal(shot?.targetId, target.id);
  });

  it('弹匣打空后自动换弹并在换弹期间蹲下', () => {
    const ally = createAlly('A', {
      ...weaponsConfig.player.liaoshi13,
      magazine: 1,
      reserveAmmo: 1,
    });
    const target = createTarget();
    const reactionMs = alliesConfig.bot.reactionDelaySec * 1000;
    const fireIntervalMs = 1000 / alliesConfig.bot.fireRate;

    ally.think(0, [target]);
    assert.ok(ally.think(reactionMs, [target]));
    assert.equal(
      ally.think(reactionMs + fireIntervalMs, [target]),
      undefined,
    );
    assert.equal(ally.isCrouching, true);

    ally.update(
      0,
      reactionMs +
        fireIntervalMs +
        weaponsConfig.player.liaoshi13.reloadSec * 1000,
    );
    assert.equal(ally.isCrouching, false);
    assert.equal(ally.weaponState.magazineAmmo, 1);
    assert.equal(ally.weaponState.reserveAmmo, 0);
  });

  it('低于阈值时自动使用唯一血包且阵亡后不复活', () => {
    const ally = createAlly();
    const thresholdHp =
      alliesConfig.bot.hp * alliesConfig.bot.medkitAutoUseThreshold;

    ally.takeDamage(alliesConfig.bot.hp - thresholdHp + 1, 0);
    assert.equal(ally.medkitsRemaining, alliesConfig.bot.medkitCount - 1);
    assert.equal(ally.isCrouching, true);

    ally.update(0, gameplayConfig.medkit.carriedUseSec * 1000);
    assert.equal(
      ally.hp,
      Math.min(
        alliesConfig.bot.hp,
        thresholdHp - 1 + gameplayConfig.medkit.carriedHeal,
      ),
    );
    ally.takeDamage(ally.hp, 10_000);
    ally.update(10, 20_000);
    assert.equal(ally.state, 'dead');
    assert.equal(ally.hp, 0);
  });

  it('重新部署时只移动到新防区而不跟随玩家', () => {
    const ally = createAlly();

    ally.assignRoute(routes.C);
    ally.update(1, 0);

    assert.equal(ally.routeId, 'C');
    assert.equal(ally.state, 'reassign');
    assert.equal(ally.position.x, alliesConfig.bot.moveSpeed);
  });
});

describe('AllyController', () => {
  it('按敌人配置的分组数轮转队友决策', () => {
    const allies = [
      createAlly('A'),
      createAlly('B'),
      createAlly('B'),
      createAlly('C'),
    ];
    const targets = [
      createTarget('A'),
      createTarget('B'),
      createTarget('C'),
    ];
    const controller = new AllyController(
      enemiesConfig.performance,
      allies,
    );
    const reactionMs = alliesConfig.bot.reactionDelaySec * 1000;

    controller.update(0, 0, 0, targets);
    const shots = controller.update(0, 0, reactionMs, targets);

    assert.equal(shots.length, 1);
  });
});

describe('CalloutController', () => {
  it('威胁达到阈值时喊话并遵守同队友冷却', () => {
    const controller = new CalloutController(
      alliesConfig.callout,
      {
        A: '正面陡坡',
        B: '侧翼缓坡',
        C: '背面绕行',
      },
    );
    const allies = [
      {
        id: 'ally-1',
        heroName: '葛振林',
        routeId: 'A' as const,
        alive: true,
      },
    ];
    const enemyCounts = {
      A: alliesConfig.callout.enemyThreshold,
      B: 0,
      C: 0,
    };

    const first = controller.update(0, allies, enemyCounts);
    const duringCooldown = controller.update(
      alliesConfig.callout.cooldownSec * 1000 - 1,
      allies,
      enemyCounts,
    );
    const afterCooldown = controller.update(
      alliesConfig.callout.cooldownSec * 1000,
      allies,
      enemyCounts,
    );

    assert.equal(first?.text, '葛振林：正面陡坡上来了！');
    assert.equal(duringCooldown, undefined);
    assert.equal(afterCooldown?.allyId, 'ally-1');
  });
});
