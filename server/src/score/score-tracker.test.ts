import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import gameplayConfig from '../../../shared/config/gameplay.json';
import wavesConfig from '../../../shared/config/waves.json';
import {
  ScoreTracker,
  type ScoreParticipant,
  type ScoreTiebreakField,
} from './score-tracker';

const participants: readonly ScoreParticipant[] = [
  {
    occupantId: 'player-1',
    seatIndex: 0,
    heroName: '马宝玉',
    displayName: '玩家',
    isBot: false,
  },
  {
    occupantId: 'bot-1',
    seatIndex: 1,
    heroName: '葛振林',
    displayName: '葛振林',
    isBot: true,
  },
  {
    occupantId: 'player-2',
    seatIndex: 2,
    heroName: '宋学义',
    displayName: '玩家二',
    isBot: false,
  },
];

function createTracker(): ScoreTracker {
  return new ScoreTracker(
    {
      totalWaves: wavesConfig.waves.length,
      mvpHumanOnly: gameplayConfig.score.mvpHumanOnly,
      mvpRequiresAlive: gameplayConfig.score.mvpRequiresAlive,
      tiebreakOrder:
        gameplayConfig.score.tiebreakOrder as ScoreTiebreakField[],
    },
    participants,
  );
}

describe('ScoreTracker', () => {
  it('记录命中、重机枪击杀、血包与各波战绩', () => {
    const tracker = createTracker();
    tracker.recordShot('player-1', {
      hit: true,
      damage: 45,
      isKill: true,
      isMachineGun: true,
      hitPart: 'head',
      waveIndex: 2,
    });
    tracker.recordShot('player-1', {
      hit: false,
      damage: 0,
      isKill: false,
      isMachineGun: false,
      waveIndex: 2,
    });
    tracker.recordDamageTaken('player-1', 18);
    tracker.recordMedkitUsed('player-1');

    const player = tracker.createScoreboard(300)[0]!;
    assert.equal(player.kills, 1);
    assert.equal(player.mgKills, 1);
    assert.equal(player.headshots, 1);
    assert.equal(player.shotsFired, 2);
    assert.equal(player.shotsHit, 1);
    assert.equal(player.accuracy, 0.5);
    assert.equal(player.damageDealt, 45);
    assert.equal(player.damageTaken, 18);
    assert.equal(player.medkitUsed, 1);
    assert.deepEqual(player.killsByWave, [0, 1, 0, 0]);
  });

  it('战报按席位排序且阵亡者生存时间固定在阵亡时刻', () => {
    const tracker = createTracker();
    tracker.markDead('player-2', 123.5);

    const scoreboard = tracker.createScoreboard(300);
    assert.deepEqual(
      scoreboard.map((entry) => entry.seatIndex),
      [0, 1, 2],
    );
    assert.equal(scoreboard[2]!.alive, false);
    assert.equal(scoreboard[2]!.survivalSec, 123.5);
    assert.equal(scoreboard[1]!.accuracy, 0);
  });

  it('MVP 排除 AI 与阵亡真人并按配置顺序破同分', () => {
    const tracker = createTracker();
    for (const occupantId of ['player-1', 'bot-1', 'player-2']) {
      tracker.recordShot(occupantId, {
        hit: true,
        damage: 55,
        isKill: true,
        isMachineGun: false,
        hitPart: 'torso',
        waveIndex: 1,
      });
    }
    tracker.recordShot('bot-1', {
      hit: true,
      damage: 55,
      isKill: true,
      isMachineGun: false,
      hitPart: 'torso',
      waveIndex: 1,
    });
    tracker.recordShot('player-2', {
      hit: true,
      damage: 45,
      isKill: true,
      isMachineGun: true,
      hitPart: 'torso',
      waveIndex: 1,
    });
    tracker.recordShot('player-1', {
      hit: true,
      damage: 55,
      isKill: true,
      isMachineGun: false,
      hitPart: 'torso',
      waveIndex: 1,
    });

    assert.equal(tracker.selectMvpPlayerId(300), 'player-2');
    tracker.markDead('player-2', 200);
    assert.equal(tracker.selectMvpPlayerId(300), 'player-1');
  });

  it('拒绝记录不存在的参与者', () => {
    assert.throws(
      () => createTracker().recordMedkitUsed('missing'),
      /不存在/,
    );
  });
});
