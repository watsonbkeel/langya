#!/usr/bin/env node
/**
 * M1 权威战斗链路自测：
 * join -> world_snapshot -> fire -> fire_result -> enemy_died -> 敌人移除。
 */

'use strict';

const gameplay = require('../shared/config/gameplay.json');
const weapons = require('../shared/config/weapons.json');

let WebSocket;
try {
  WebSocket = require('ws');
} catch (error) {
  try {
    WebSocket = require('../server/node_modules/ws');
  } catch (fallbackError) {
    console.error('❌ 找不到 ws 模块，请先安装服务端依赖');
    process.exit(1);
  }
}

const url = process.argv[2] || 'ws://127.0.0.1:8081/ws';
const timeoutMs = 8000;
const weaponId = gameplay.player.defaultLoadout.primary;
const weapon = weapons.player[weaponId];

if (!weapon) {
  console.error(`❌ 默认武器 ${weaponId} 不存在`);
  process.exit(1);
}

let targetId;
let shotSent = false;
let receivedKill = false;
let receivedDeath = false;
let observedRemoval = false;
let finished = false;

console.log(`→ 正在验证 M1 战斗链路 ${url} ...`);
const socket = new WebSocket(url);
const timer = setTimeout(() => {
  console.error('❌ M1 战斗链路验证超时');
  socket.terminate();
  process.exit(1);
}, timeoutMs);

function finishIfComplete() {
  if (!receivedKill || !receivedDeath || !observedRemoval || finished) {
    return;
  }

  finished = true;
  clearTimeout(timer);
  console.log('✅ M1 权威战斗链路全部通过');
  socket.close();
}

socket.on('open', () => {
  socket.send(JSON.stringify({
    type: 'join',
    payload: {
      playerName: 'M1 自测',
      protocolVersion: 1,
    },
  }));
});

socket.on('message', (data) => {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch (error) {
    console.error('❌ 服务端返回非 JSON 消息');
    process.exit(1);
  }

  if (message.type === 'world_snapshot') {
    const player = message.payload.allies.find((ally) => !ally.isBot);
    const enemy = targetId
      ? message.payload.enemies.find((item) => item.id === targetId)
      : message.payload.enemies[0];

    if (targetId && !enemy) {
      observedRemoval = true;
      console.log('✅ 后续快照已移除死亡敌人');
      finishIfComplete();
      return;
    }

    if (!shotSent && player && enemy) {
      targetId = enemy.id;
      const target = {
        x: enemy.position.x,
        y:
          enemy.position.y +
          (gameplay.combat.headHitboxStartM +
            gameplay.combat.enemyHitboxHeightM) /
            2,
        z: enemy.position.z,
      };
      const delta = {
        x: target.x - player.position.x,
        y: target.y - player.position.y,
        z: target.z - player.position.z,
      };
      const length = Math.hypot(delta.x, delta.y, delta.z);

      shotSent = true;
      socket.send(JSON.stringify({
        type: 'fire',
        payload: {
          weaponId,
          originPos: player.position,
          dirVec: {
            x: delta.x / length,
            y: delta.y / length,
            z: delta.z / length,
          },
          clientTick: 0,
        },
      }));
    }
    return;
  }

  if (message.type === 'fire_result') {
    const payload = message.payload;
    if (
      !payload.accepted ||
      !payload.hit ||
      !payload.isKill ||
      payload.targetId !== targetId ||
      payload.hitPart !== 'head'
    ) {
      console.error(`❌ 开火裁决不符合预期：${JSON.stringify(payload)}`);
      process.exit(1);
    }

    receivedKill = true;
    console.log(
      `✅ 服务端确认爆头击杀（伤害 ${payload.damage}，弹匣 ${payload.magazineAmmo}）`,
    );
    finishIfComplete();
    return;
  }

  if (message.type === 'enemy_died') {
    if (message.payload.enemyId !== targetId) {
      console.error(`❌ enemy_died 目标不一致：${message.payload.enemyId}`);
      process.exit(1);
    }

    receivedDeath = true;
    console.log('✅ 收到 enemy_died');
    finishIfComplete();
  }
});

socket.on('error', (error) => {
  clearTimeout(timer);
  console.error(`❌ 连接失败：${error.message}`);
  process.exit(1);
});

socket.on('close', (code) => {
  clearTimeout(timer);
  if (finished) {
    process.exit(0);
  }
  console.error(`❌ 连接提前关闭（code=${code}）`);
  process.exit(1);
});
