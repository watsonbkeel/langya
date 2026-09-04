import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import gameplayConfig from '../../../shared/config/gameplay.json';
import wavesConfig from '../../../shared/config/waves.json';

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
