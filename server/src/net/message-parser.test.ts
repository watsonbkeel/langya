import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseClientMessage } from './message-parser';

function encode(value: unknown): string {
  return JSON.stringify(value);
}

describe('parseClientMessage', () => {
  it('接受合法的 M1 输入、开火和换弹消息', () => {
    const input = parseClientMessage(
      encode({
        type: 'input_state',
        payload: {
          clientTick: 0,
          moveDir: { x: -1, y: 1 },
          aimYaw: 270,
          aimPitch: -30,
          isCrouch: false,
        },
      }),
    );
    const fire = parseClientMessage(
      encode({
        type: 'fire',
        payload: {
          weaponId: 'liaoshi13',
          originPos: { x: 0, y: 1, z: 0 },
          dirVec: { x: 0, y: 0, z: -1 },
          clientTick: 1,
        },
      }),
    );
    const reload = parseClientMessage(
      encode({
        type: 'reload',
        payload: { weaponId: 'liaoshi13' },
      }),
    );

    assert.equal(input?.type, 'input_state');
    assert.equal(fire?.type, 'fire');
    assert.equal(reload?.type, 'reload');
  });

  it('拒绝越界移动方向', () => {
    const message = parseClientMessage(
      encode({
        type: 'input_state',
        payload: {
          clientTick: 0,
          moveDir: { x: 1.01, y: 0 },
          aimYaw: 0,
          aimPitch: 0,
          isCrouch: false,
        },
      }),
    );

    assert.equal(message, undefined);
  });

  it('拒绝负数、小数和超出安全范围的 clientTick', () => {
    for (const clientTick of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const message = parseClientMessage(
        encode({
          type: 'fire',
          payload: {
            weaponId: 'liaoshi13',
            originPos: { x: 0, y: 0, z: 0 },
            dirVec: { x: 0, y: 0, z: -1 },
            clientTick,
          },
        }),
      );

      assert.equal(message, undefined);
    }
  });

  it('拒绝缺少向量分量或空武器 ID 的开火消息', () => {
    const missingVectorComponent = parseClientMessage(
      encode({
        type: 'fire',
        payload: {
          weaponId: 'liaoshi13',
          originPos: { x: 0, y: 0 },
          dirVec: { x: 0, y: 0, z: -1 },
          clientTick: 0,
        },
      }),
    );
    const emptyWeaponId = parseClientMessage(
      encode({
        type: 'fire',
        payload: {
          weaponId: ' ',
          originPos: { x: 0, y: 0, z: 0 },
          dirVec: { x: 0, y: 0, z: -1 },
          clientTick: 0,
        },
      }),
    );

    assert.equal(missingVectorComponent, undefined);
    assert.equal(emptyWeaponId, undefined);
  });

  it('接受合法的 M3 交互与武器消息', () => {
    const messages = [
      {
        type: 'switch_weapon',
        payload: { weaponId: 'zb26', clientTick: 2 },
      },
      {
        type: 'use_medkit',
        payload: { clientTick: 3 },
      },
      {
        type: 'pickup',
        payload: { itemId: 'supply-1', clientTick: 4 },
      },
      {
        type: 'mount_mg',
        payload: { mgId: 'mg-1', clientTick: 5 },
      },
      {
        type: 'unmount_mg',
        payload: { clientTick: 6 },
      },
      {
        type: 'throw_grenade',
        payload: {
          originPos: { x: 0, y: 1, z: 0 },
          dirVec: { x: 0, y: 0, z: -1 },
          force: 0.75,
          clientTick: 7,
        },
      },
    ];

    assert.deepEqual(
      messages.map(
        (message) => parseClientMessage(encode(message))?.type,
      ),
      messages.map((message) => message.type),
    );
  });

  it('拒绝非法 M3 标识、力度和 clientTick', () => {
    const messages = [
      {
        type: 'switch_weapon',
        payload: { weaponId: ' ', clientTick: 2 },
      },
      {
        type: 'pickup',
        payload: { itemId: '', clientTick: 3 },
      },
      {
        type: 'mount_mg',
        payload: { mgId: '', clientTick: 4 },
      },
      {
        type: 'throw_grenade',
        payload: {
          originPos: { x: 0, y: 1, z: 0 },
          dirVec: { x: 0, y: 0, z: -1 },
          force: 1.01,
          clientTick: 5,
        },
      },
      {
        type: 'use_medkit',
        payload: { clientTick: -1 },
      },
    ];

    for (const message of messages) {
      assert.equal(parseClientMessage(encode(message)), undefined);
    }
  });

  it('接受 M5 房间创建、加入、匹配、准备、开局和重连消息', () => {
    const messages = [
      {
        type: 'create_room',
        payload: { playerName: '马宝玉', protocolVersion: 1 },
      },
      {
        type: 'join_room',
        payload: { roomCode: 'AB12', playerName: '葛振林', protocolVersion: 1 },
      },
      {
        type: 'quick_match',
        payload: { playerName: '宋学义', protocolVersion: 1 },
      },
      { type: 'player_ready', payload: {} },
      { type: 'start_match', payload: {} },
      {
        type: 'reconnect',
        payload: { reconnectToken: '0123456789abcdef', protocolVersion: 1 },
      },
    ];

    assert.deepEqual(
      messages.map((message) => parseClientMessage(encode(message))?.type),
      messages.map((message) => message.type),
    );
  });

  it('拒绝不安全的房间码、昵称、协议版本和重连凭证', () => {
    const messages = [
      {
        type: 'join_room',
        payload: { roomCode: 'bad-code', playerName: '玩家', protocolVersion: 1 },
      },
      {
        type: 'create_room',
        payload: { playerName: '', protocolVersion: 1 },
      },
      {
        type: 'quick_match',
        payload: { playerName: '玩家', protocolVersion: 2 },
      },
      {
        type: 'reconnect',
        payload: { reconnectToken: 'short', protocolVersion: 1 },
      },
      { type: 'player_ready', payload: { unexpected: true } },
    ];

    for (const message of messages) {
      assert.equal(parseClientMessage(encode(message)), undefined);
    }
  });
});
