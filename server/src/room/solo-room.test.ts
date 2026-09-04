import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SoloRoom, type SoloRoomConfig } from './solo-room';

type TestRouteId = 'A' | 'B' | 'C';

const config: SoloRoomConfig<TestRouteId> = {
  seatCount: 5,
  heroNames: ['马宝玉', '葛振林', '宋学义', '胡德林', '胡福才'],
  playerDefaultSeat: 0,
  playerRoute: 'A',
  defaultAssignment: { A: 1, B: 2, C: 1 },
};

describe('SoloRoom', () => {
  it('创建 1 名真人和 4 名 AI 的固定五席房间', () => {
    const room = new SoloRoom({
      roomId: 'room-1',
      playerId: 'player-1',
      playerName: '测试玩家',
      config,
    });

    assert.equal(room.status, 'active');
    assert.equal(room.seats.length, config.seatCount);
    assert.deepEqual(room.seats[config.playerDefaultSeat], {
      index: 0,
      heroName: '马宝玉',
      routeId: 'A',
      occupant: {
        id: 'player-1',
        displayName: '测试玩家',
        isBot: false,
      },
    });
    assert.equal(
      room.seats.filter((seat) => seat.occupant.isBot).length,
      config.seatCount - 1,
    );
  });

  it('按配置把 AI 队友分配到三条路线', () => {
    const room = new SoloRoom({
      roomId: 'room-2',
      playerId: 'player-2',
      playerName: '测试玩家',
      config,
    });
    const routeCounts = { A: 0, B: 0, C: 0 };

    for (const seat of room.seats) {
      if (seat.occupant.isBot) {
        routeCounts[seat.routeId] += 1;
      }
    }

    assert.deepEqual(routeCounts, config.defaultAssignment);
    assert.deepEqual(
      room.seats
        .filter((seat) => seat.occupant.isBot)
        .map((seat) => seat.occupant.displayName),
      config.heroNames.filter(
        (_, index) => index !== config.playerDefaultSeat,
      ),
    );
  });

  it('拒绝无法填满席位的路线分配', () => {
    assert.throws(
      () =>
        new SoloRoom({
          roomId: 'room-invalid',
          playerId: 'player-invalid',
          playerName: '测试玩家',
          config: {
            ...config,
            defaultAssignment: { A: 1, B: 1, C: 1 },
          },
        }),
      /恰好填满/,
    );
  });
});
