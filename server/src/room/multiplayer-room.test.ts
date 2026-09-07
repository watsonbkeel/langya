import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RouteId } from '../../../shared/protocol';
import {
  MultiplayerRoom,
  type MultiplayerRoomConfig,
} from './multiplayer-room';

const config: MultiplayerRoomConfig<RouteId> = {
  seatCount: 5,
  heroNames: ['马宝玉', '葛振林', '宋学义', '胡德林', '胡福才'],
  playerDefaultSeat: 0,
  playerRoute: 'A',
  defaultAssignment: { A: 1, B: 2, C: 1 },
};

describe('MultiplayerRoom', () => {
  it('创建房间时真人占首席，其余席位保留为可顶替 AI', () => {
    const room = new MultiplayerRoom({
      roomCode: 'AB12',
      hostId: 'player-1',
      hostName: '玩家一',
      config,
    });

    assert.equal(room.status, 'forming');
    assert.equal(room.seats.filter((seat) => seat.occupant).length, 1);
    assert.equal(room.findSeat('player-1')?.index, 0);
    assert.equal(room.seats.filter((seat) => !seat.occupant).length, 4);
  });

  it('真人加入时顶替空席位并生成可重连凭证', () => {
    const room = new MultiplayerRoom({
      roomCode: 'AB12',
      hostId: 'player-1',
      hostName: '玩家一',
      config,
    });

    const result = room.createHuman('player-2', '玩家二');
    assert.equal(result.accepted, true);
    assert.equal(typeof result.reconnectToken, 'string');
    assert.equal(room.findSeat('player-2')?.index, 1);
    assert.equal(room.seats[1]?.occupant?.ready, false);
  });

  it('开局后拒绝继续加入和准备，只有房主可开始', () => {
    const room = new MultiplayerRoom({
      roomCode: 'AB12',
      hostId: 'player-1',
      hostName: '玩家一',
      config,
    });

    assert.deepEqual(room.setReady('player-2', true), {
      accepted: false,
      reason: 'invalid_state',
    });
    assert.deepEqual(room.start('player-2'), {
      accepted: false,
      reason: 'not_host',
    });
    assert.deepEqual(room.start('player-1'), { accepted: true });
    assert.deepEqual(room.createHuman('player-2', '玩家二'), {
      accepted: false,
      reason: 'already_started',
    });
  });

  it('断线后可用凭证恢复原席位和连接状态', () => {
    const room = new MultiplayerRoom({
      roomCode: 'AB12',
      hostId: 'player-1',
      hostName: '玩家一',
      config,
    });
    const join = room.createHuman('player-2', '玩家二');
    const token = join.reconnectToken;
    assert.ok(token);
    assert.equal(room.markDisconnected('player-2'), true);
    assert.equal(room.findSeat('player-2')?.occupant?.connected, false);

    const reconnect = room.reconnect('player-2-new-connection', token);
    assert.equal(reconnect.accepted, true);
    assert.equal(
      room.findSeat('player-2-new-connection')?.occupant?.connected,
      true,
    );
    assert.equal(room.seats[1]?.occupant?.displayName, '玩家二');
  });
});
