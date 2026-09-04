#!/usr/bin/env node
/**
 * M3 权威完整单局关键链路自测：
 * join -> 五席/比赛元数据 -> 两座重机枪 -> 移动 -> 上枪 -> 开火扣弹 -> 下枪。
 */

'use strict';

const allies = require('../shared/config/allies.json');
const gameplay = require('../shared/config/gameplay.json');
const waves = require('../shared/config/waves.json');
const weapons = require('../shared/config/weapons.json');

let WebSocket;
try {
  WebSocket = require('ws');
} catch {
  try {
    WebSocket = require('../server/node_modules/ws');
  } catch {
    console.error('❌ 找不到 ws 模块，请先安装服务端依赖');
    process.exit(1);
  }
}

const url = process.argv[2] || 'ws://127.0.0.1:8081/ws';
const machineGunConfig = weapons.emplacement['type92-hmg'];
const timeoutMs = (gameplay.match.deployPhaseSec + 10) * 1000;
const mountDistanceM = Math.max(
  0,
  gameplay.arena.machineGunMountRangeM - 0.5,
);

let clientTick = 0;
let playerId;
let targetMachineGun;
let roomStatePassed = false;
let matchStartPassed = false;
let machineGunsPassed = false;
let movementSent = false;
let movementObserved = false;
let mountSent = false;
let mountAccepted = false;
let mountedSnapshotPassed = false;
let fireSent = false;
let firePassed = false;
let unmountSent = false;
let unmountAccepted = false;
let unmountedSnapshotPassed = false;
let waveStartObserved = false;
let finished = false;

console.log(`→ 正在验证 M3 权威交互链路 ${url} ...`);
const socket = new WebSocket(url);
const timer = setTimeout(() => {
  fail(`M3 权威交互链路验证超时（${timeoutMs}ms）`);
}, timeoutMs);

function nextClientTick() {
  const tick = clientTick;
  clientTick += 1;
  return tick;
}

function send(type, payload) {
  socket.send(JSON.stringify({ type, payload }));
}

function fail(message) {
  if (finished) {
    return;
  }
  finished = true;
  clearTimeout(timer);
  console.error(`❌ ${message}`);
  try {
    socket.terminate();
  } catch {}
  process.exitCode = 1;
}

function finishIfComplete() {
  if (
    finished ||
    !roomStatePassed ||
    !matchStartPassed ||
    !machineGunsPassed ||
    !movementObserved ||
    !mountAccepted ||
    !mountedSnapshotPassed ||
    !firePassed ||
    !unmountAccepted ||
    !unmountedSnapshotPassed
  ) {
    return;
  }

  finished = true;
  clearTimeout(timer);
  console.log(
    `✅ M3 权威交互链路全部通过${waveStartObserved ? '，并观察到首波开始' : ''}`,
  );
  socket.close();
}

function distance(first, second) {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    first.z - second.z,
  );
}

function directionForAim(yawDeg, pitchDeg) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const horizontal = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * horizontal,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * horizontal,
  };
}

socket.on('open', () => {
  send('join', {
    playerName: 'M3 自测',
    protocolVersion: 1,
  });
});

socket.on('message', (data) => {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch {
    fail('服务端返回非 JSON 消息');
    return;
  }

  if (message.type === 'snapshot') {
    playerId = message.payload?.connection?.clientId;
    return;
  }

  if (message.type === 'room_state') {
    const seats = message.payload?.seats;
    if (
      !Array.isArray(seats) ||
      seats.length !== allies.seatCount ||
      seats.some((seat, index) => seat.seatIndex !== index)
    ) {
      fail(`room_state 席位异常：${JSON.stringify(message.payload)}`);
      return;
    }
    if (!roomStatePassed) {
      roomStatePassed = true;
      console.log('✅ room_state 为按 seatIndex 排序的固定五席');
    }
    finishIfComplete();
    return;
  }

  if (message.type === 'match_start') {
    if (
      message.payload?.totalWaves !== waves.waves.length ||
      message.payload?.totalEnemies !== waves.totalEnemies
    ) {
      fail(`match_start 元数据异常：${JSON.stringify(message.payload)}`);
      return;
    }
    matchStartPassed = true;
    console.log(
      `✅ 比赛元数据为 ${message.payload.totalWaves} 波 / ${message.payload.totalEnemies} 人`,
    );
    finishIfComplete();
    return;
  }

  if (message.type === 'wave_start') {
    waveStartObserved = true;
    return;
  }

  if (message.type === 'action_result') {
    const payload = message.payload;
    if (payload?.action === 'mount_mg' && mountSent) {
      if (!payload.accepted) {
        fail(`上重机枪被拒绝：${payload.rejectReason}`);
        return;
      }
      mountAccepted = true;
      console.log('✅ mount_mg 获得服务端接受');
    } else if (payload?.action === 'unmount_mg' && unmountSent) {
      if (!payload.accepted) {
        fail(`下重机枪被拒绝：${payload.rejectReason}`);
        return;
      }
      unmountAccepted = true;
      console.log('✅ unmount_mg 获得服务端接受');
    }
    finishIfComplete();
    return;
  }

  if (message.type === 'fire_result' && fireSent && !firePassed) {
    const payload = message.payload;
    if (
      !payload?.accepted ||
      payload.weaponId !== targetMachineGun?.weaponId ||
      payload.magazineAmmo !== machineGunConfig.beltCapacity - 1 ||
      payload.reserveAmmo !== 0
    ) {
      fail(`重机枪开火裁决异常：${JSON.stringify(payload)}`);
      return;
    }
    firePassed = true;
    console.log(
      `✅ 重机枪权威开火扣弹 ${machineGunConfig.beltCapacity} -> ${payload.magazineAmmo}，备弹为 0`,
    );
    unmountSent = true;
    send('unmount_mg', { clientTick: nextClientTick() });
    finishIfComplete();
    return;
  }

  if (message.type !== 'world_snapshot' || finished) {
    return;
  }

  const payload = message.payload;
  if (
    !Array.isArray(payload?.machineGuns) ||
    payload.machineGuns.length !== machineGunConfig.nestCount
  ) {
    fail(`重机枪位数量异常：${JSON.stringify(payload?.machineGuns)}`);
    return;
  }
  if (!machineGunsPassed) {
    machineGunsPassed = true;
    targetMachineGun = payload.machineGuns[0];
    console.log(`✅ 快照包含 ${payload.machineGuns.length} 座重机枪`);
  }

  const player = payload.allies?.find(
    (ally) => ally.id === playerId || !ally.isBot,
  );
  if (!player || !targetMachineGun) {
    return;
  }

  if (unmountAccepted && player.mountedMgId === undefined) {
    if (!unmountedSnapshotPassed) {
      unmountedSnapshotPassed = true;
      console.log('✅ 权威快照确认已离开重机枪');
    }
    finishIfComplete();
    return;
  }

  if (mountAccepted && player.mountedMgId === targetMachineGun.id) {
    if (!mountedSnapshotPassed) {
      mountedSnapshotPassed = true;
      console.log('✅ 权威快照确认玩家已挂载重机枪');
    }
    if (!fireSent) {
      fireSent = true;
      send('fire', {
        weaponId: targetMachineGun.weaponId,
        originPos: player.position,
        dirVec: directionForAim(targetMachineGun.baseYaw, 0),
        clientTick: nextClientTick(),
      });
    }
    return;
  }

  if (mountSent) {
    return;
  }

  const distanceToGun = distance(
    player.position,
    targetMachineGun.position,
  );
  if (distanceToGun <= mountDistanceM) {
    movementObserved = movementSent;
    send('input_state', {
      clientTick: nextClientTick(),
      moveDir: { x: 0, y: 0 },
      aimYaw: targetMachineGun.baseYaw,
      aimPitch: 0,
      isCrouch: false,
    });
    mountSent = true;
    send('mount_mg', {
      mgId: targetMachineGun.id,
      clientTick: nextClientTick(),
    });
    console.log(
      `✅ 玩家已移动至重机枪交互范围（${distanceToGun.toFixed(2)}m）`,
    );
    return;
  }

  if (!movementSent) {
    const deltaX = targetMachineGun.position.x - player.position.x;
    const deltaZ = targetMachineGun.position.z - player.position.z;
    const length = Math.hypot(deltaX, deltaZ);
    movementSent = true;
    send('input_state', {
      clientTick: nextClientTick(),
      moveDir: {
        x: deltaX / length,
        y: -deltaZ / length,
      },
      aimYaw: 0,
      aimPitch: 0,
      isCrouch: false,
    });
  }
});

socket.on('error', (error) => {
  fail(`连接失败：${error.message}`);
});

socket.on('close', (code) => {
  clearTimeout(timer);
  if (finished && process.exitCode !== 1) {
    process.exit(0);
  }
  if (!finished) {
    fail(`连接提前关闭（code=${code}）`);
  }
});
