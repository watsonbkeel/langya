import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import alliesConfig from '../../../../shared/config/allies.json';
import gameplayConfig from '../../../../shared/config/gameplay.json';
import wavesConfig from '../../../../shared/config/waves.json';

import { createRouteLayouts } from '../route-layout';
import {
  AllyDeploymentManager,
  type DeployableAlly,
} from './deployment-manager';

type TestRouteId = keyof typeof wavesConfig.routes;

function createManager(): AllyDeploymentManager<TestRouteId> {
  return new AllyDeploymentManager(
    alliesConfig.deployment,
    createRouteLayouts(wavesConfig.routes, gameplayConfig.arena),
  );
}

function createAllies(): DeployableAlly<TestRouteId>[] {
  return [
    { id: 'ally-a', routeId: 'A' },
    { id: 'ally-b-1', routeId: 'B' },
    { id: 'ally-b-2', routeId: 'B' },
    { id: 'ally-c', routeId: 'C' },
  ];
}

describe('AllyDeploymentManager', () => {
  const layouts = createRouteLayouts(
    wavesConfig.routes,
    gameplayConfig.arena,
  );
  const routeA = layouts.find((route) => route.routeId === 'A');

  it('玩家未达到驻守时间时保持默认布防', () => {
    assert.ok(routeA);
    const manager = createManager();
    const allies = createAllies();

    manager.update(routeA.guardPosition, allies, 0);
    const reassignment = manager.update(
      routeA.guardPosition,
      allies,
      alliesConfig.deployment.playerRouteDetectSec * 1000 - 1,
    );

    assert.equal(reassignment, undefined);
    assert.deepEqual(
      allies.map((ally) => ally.routeId),
      ['A', 'B', 'B', 'C'],
    );
  });

  it('玩家持续驻守后把同路线队友调往覆盖最少的路线', () => {
    assert.ok(routeA);
    const manager = createManager();
    const allies = createAllies();
    const thresholdMs =
      alliesConfig.deployment.playerRouteDetectSec * 1000;

    manager.update(routeA.guardPosition, allies, 0);
    const reassignment = manager.update(
      routeA.guardPosition,
      allies,
      thresholdMs,
    );

    assert.deepEqual(reassignment, {
      allyId: 'ally-a',
      fromRouteId: 'A',
      toRouteId: 'C',
    });
    allies[0]!.routeId = reassignment.toRouteId;
    assert.deepEqual(
      allies.map((ally) => ally.routeId),
      ['C', 'B', 'B', 'C'],
    );
  });

  it('重新分配遵守冷却且不会从玩家路线之外抓取队友', () => {
    assert.ok(routeA);
    const manager = createManager();
    const allies = createAllies();
    const thresholdMs =
      alliesConfig.deployment.playerRouteDetectSec * 1000;

    manager.update(routeA.guardPosition, allies, 0);
    const first = manager.update(routeA.guardPosition, allies, thresholdMs);
    assert.ok(first);
    allies[0]!.routeId = first.toRouteId;
    const duringCooldown = manager.update(
      routeA.guardPosition,
      allies,
      thresholdMs +
        alliesConfig.deployment.reassignCooldownSec * 1000 -
        1,
    );
    const afterCooldown = manager.update(
      routeA.guardPosition,
      allies,
      thresholdMs +
        alliesConfig.deployment.reassignCooldownSec * 1000,
    );

    assert.equal(duringCooldown, undefined);
    assert.equal(afterCooldown, undefined);
  });
});
