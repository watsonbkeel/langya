import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SeededRandom } from '../ai/seeded-random';
import {
  findRepositoryRoot,
  loadProjectConfig,
} from '../config/project-config';
import { SupplyDropManager } from './supply-drop-manager';

const projectConfig = loadProjectConfig(findRepositoryRoot());

function createManager(): SupplyDropManager {
  return new SupplyDropManager({
    idPrefix: 'match-1',
    config: projectConfig.gameplay.airdrop,
    waves: projectConfig.waves.waves,
    intermissionSec: projectConfig.waves.intermissionSec,
    matchDurationSec: projectConfig.waves.matchDurationSec,
    arenaWidthM: projectConfig.gameplay.arena.widthM,
    random: new SeededRandom(1),
  });
}

describe('SupplyDropManager', () => {
  it('按固定间隔和间歇期触发且不会重复触发同一时刻', () => {
    const manager = createManager();

    assert.equal(manager.update(0, 0).length, 0);
    const intervalEvents = manager.update(
      projectConfig.gameplay.airdrop.intervalSec * 1000,
      0,
    );
    assert.equal(
      intervalEvents.length >=
        projectConfig.gameplay.airdrop.dropsPerTrigger[0]!,
      true,
    );
    assert.equal(
      manager.update(
        projectConfig.gameplay.airdrop.intervalSec * 1000,
        0,
      ).length,
      0,
    );

    const secondWave = projectConfig.waves.waves[1]!;
    const intermissionStartMs =
      (secondWave.startSec - projectConfig.waves.intermissionSec) *
      1000;
    assert.equal(manager.update(intermissionStartMs, 0).length > 0, true);
  });

  it('校验拾取距离并在成功拾取后移除空投', () => {
    const manager = createManager();
    const events = manager.update(
      projectConfig.gameplay.airdrop.intervalSec * 1000,
      0,
    );
    const item = events[0]?.drop;
    assert.ok(item);

    assert.deepEqual(
      manager.pickup(
        item.id,
        {
          x:
            item.position.x +
            projectConfig.gameplay.arena.itemPickupRangeM * 2,
          y: item.position.y,
          z: item.position.z,
        },
        projectConfig.gameplay.arena.itemPickupRangeM,
        projectConfig.gameplay.medkit.airdropHeal,
        item.expiresAtMs - 1,
      ),
      { accepted: false, reason: 'out_of_range' },
    );
    assert.deepEqual(
      manager.pickup(
        item.id,
        item.position,
        projectConfig.gameplay.arena.itemPickupRangeM,
        projectConfig.gameplay.medkit.airdropHeal,
        item.expiresAtMs - 1,
      ),
      {
        accepted: true,
        heal: projectConfig.gameplay.medkit.airdropHeal,
      },
    );
    assert.deepEqual(manager.getItems(item.expiresAtMs - 1), []);
  });

  it('到期后拒绝拾取并从快照移除', () => {
    const manager = createManager();
    const event = manager.update(
      projectConfig.gameplay.airdrop.intervalSec * 1000,
      0,
    )[0];
    assert.ok(event);

    assert.deepEqual(
      manager.pickup(
        event.drop.id,
        event.drop.position,
        projectConfig.gameplay.arena.itemPickupRangeM,
        projectConfig.gameplay.medkit.airdropHeal,
        event.drop.expiresAtMs,
      ),
      { accepted: false, reason: 'unavailable' },
    );
    assert.deepEqual(manager.getItems(event.drop.expiresAtMs), []);
  });
});
