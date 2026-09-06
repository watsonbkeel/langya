import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import weaponsConfig from '../../../shared/config/weapons.json';
import {
  calculateGrenadeImpact,
  resolveGrenadeBlast,
} from './grenade';

const grenade = {
  ...weaponsConfig.player.grenade,
  falloffCurve: 'linear' as const,
};

describe('grenade combat', () => {
  it('按归一化力度和配置射程计算落点', () => {
    assert.deepEqual(
      calculateGrenadeImpact(
        { x: 1, y: 2, z: 3 },
        { x: 0, y: 0, z: -1 },
        0.5,
        grenade,
      ),
      {
        x: 1,
        y: 2,
        z: 3 - grenade.throwRangeM / 2,
      },
    );
  });

  it('爆炸范围内按距离线性衰减且忽略范围外目标', () => {
    const hits = resolveGrenadeBlast(
      { x: 0, y: 0, z: 0 },
      [
        {
          id: 'center',
          position: { x: 0, y: 0, z: 0 },
          hp: grenade.damage,
          alive: true,
        },
        {
          id: 'half',
          position: {
            x: grenade.blastRadiusM / 2,
            y: 0,
            z: 0,
          },
          hp: grenade.damage,
          alive: true,
        },
        {
          id: 'outside',
          position: {
            x: grenade.blastRadiusM,
            y: 0,
            z: 0,
          },
          hp: 1,
          alive: true,
        },
      ],
      grenade,
    );

    assert.deepEqual(hits, [
      {
        targetId: 'center',
        damage: grenade.damage,
        isKill: true,
      },
      {
        targetId: 'half',
        damage: Math.round(grenade.damage / 2),
        isKill: false,
      },
    ]);
  });

  it('忽略范围内已经阵亡的目标', () => {
    const hits = resolveGrenadeBlast(
      { x: 0, y: 0, z: 0 },
      [
        {
          id: 'defeated-enemy',
          position: { x: 0, y: 0, z: 0 },
          hp: 1,
          alive: false,
        },
      ],
      grenade,
    );

    assert.deepEqual(hits, []);
  });
});
