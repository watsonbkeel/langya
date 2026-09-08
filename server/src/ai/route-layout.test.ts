import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import gameplayConfig from '../../../shared/config/gameplay.json';
import wavesConfig from '../../../shared/config/waves.json';
import { terrainHeightAt } from '../../../shared/terrain';

import { createRouteLayouts, findNearestRoute } from './route-layout';

describe('route layout', () => {
  const layouts = createRouteLayouts(
    wavesConfig.routes,
    gameplayConfig.arena,
  );

  it('按配置为每条路线生成固定起点与山顶防守点', () => {
    assert.equal(layouts.length, Object.keys(wavesConfig.routes).length);

    for (const layout of layouts) {
      assert.equal(
        layout.spawnPosition.z,
        -wavesConfig.routes[layout.routeId].lengthM,
      );
      assert.equal(
        layout.guardPosition.z,
        -gameplayConfig.arena.depthM / 2,
      );

      // 起点与防守点的高度由地形高度场决定：山脚低、山顶高。
      assert.equal(
        layout.spawnPosition.y,
        terrainHeightAt(layout.spawnPosition.x, layout.spawnPosition.z),
      );
      assert.equal(
        layout.guardPosition.y,
        terrainHeightAt(layout.guardPosition.x, layout.guardPosition.z),
      );
      assert.equal(
        layout.guardPosition.y > layout.spawnPosition.y,
        true,
      );

      // 路径沿坡面采样，首尾必须严格等于出生点与防守点。
      assert.equal(layout.waypoints.length >= 2, true);
      assert.deepEqual(layout.waypoints[0], layout.spawnPosition);
      assert.deepEqual(
        layout.waypoints[layout.waypoints.length - 1],
        layout.guardPosition,
      );

      // 中间点全部贴合地面，且高度单调不降（一路向上爬）。
      let previousY = Number.NEGATIVE_INFINITY;
      for (const waypoint of layout.waypoints) {
        assert.equal(
          waypoint.y,
          terrainHeightAt(waypoint.x, waypoint.z),
        );
        assert.equal(waypoint.y >= previousY, true);
        previousY = waypoint.y;
      }
    }
  });

  it('路线横向均匀展开且可按最近防守点识别', () => {
    const positions = layouts.map((layout) => layout.guardPosition.x);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));

    for (const layout of layouts) {
      assert.equal(findNearestRoute(layout.guardPosition, layouts), layout.routeId);
    }
  });
});
