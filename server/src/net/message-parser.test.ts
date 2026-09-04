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
});
