import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RouteId } from '../../../shared/protocol';
import { RoomManager } from './room-manager';

const config = {
  seatCount: 5,
  heroNames: ['马宝玉', '葛振林', '宋学义', '胡德林', '胡福才'],
  playerDefaultSeat: 0,
  playerRoute: 'A' as RouteId,
  defaultAssignment: { A: 1, B: 2, C: 1 } as Record<RouteId, number>,
};

describe('RoomManager', () => {
  it('创建唯一四位房间码并可大小写不敏感地读取', () => {
    const manager = new RoomManager(config);
    const room = manager.create('player-1', '玩家一');
    assert.match(room.id, /^[A-Z2-9]{4}$/);
    assert.equal(manager.get(room.id.toLowerCase()), room);
    assert.equal(manager.listActive().length, 1);
  });

  it('删除房间后不再出现在活动房间列表', () => {
    const manager = new RoomManager(config);
    const room = manager.create('player-1', '玩家一');
    assert.equal(manager.delete(room.id), true);
    assert.equal(manager.get(room.id), undefined);
    assert.equal(manager.listActive().length, 0);
  });
});
