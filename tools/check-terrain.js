#!/usr/bin/env node
/**
 * 地形贴合验收探针。
 *
 * 方案 B 把地形做成了服务端权威高度场：山顶 z≈0 高约 20m，山脚 z=-130 为 0m。
 * 这个脚本开一局真实对局，采样服务端下发的权威位置，确认：
 *   1. 玩家/队友确实站在山顶高度，而不是旧的 y≈0 平地；
 *   2. 敌人从山脚向上冲锋，y 呈现由低到高的分布，而不是恒为 0；
 *   3. 每个实体的 y 与 shared/terrain.ts 的高度场吻合（视觉与判定同源）。
 *
 * 之所以要用协议探针而不是浏览器里看：release 构建会压缩混淆类名方法名，
 * 线上根本探测不到内部状态，只有协议层是稳定可观测的。
 */

const path = require('path');

let WebSocket;
try {
  WebSocket = require('ws');
} catch {
  try {
    WebSocket = require(
      path.join(__dirname, '../server/node_modules/ws'),
    );
  } catch {
    console.error('❌ 找不到 ws 模块。请在 server/ 目录执行 npm install。');
    process.exit(1);
  }
}

const WS_URL = process.argv[2] ?? 'ws://127.0.0.1:8081/ws';
const PROTOCOL_VERSION = 1;
const TIMEOUT_MS = 15000;

/**
 * 与 shared/terrain.ts 等价的独立实现。
 * 故意不 import 那个模块：如果两边各自算出同样的数，
 * 才能证明服务端真的在用高度场，而不是恰好共用了一个错误实现。
 */
const HILLTOP_HEIGHT_M = 20;
const SLOPE_RUN_M = 130;
const SUMMIT_FLAT_DEPTH_M = 10;
const RIDGE_FALLOFF_M = 2.5;
const RIDGE_HALF_WIDTH_M = 40;

const clamp01 = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const smoothStep = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const depthRatio = (z) => {
  const downhill = -z - SUMMIT_FLAT_DEPTH_M;
  if (downhill <= 0) return 1;
  return 1 - smoothStep(downhill / (SLOPE_RUN_M - SUMMIT_FLAT_DEPTH_M));
};
const terrainHeightAt = (x, z) => {
  const base = HILLTOP_HEIGHT_M * depthRatio(z);
  const lateral =
    RIDGE_FALLOFF_M *
    smoothStep(Math.min(Math.abs(x), RIDGE_HALF_WIDTH_M) / RIDGE_HALF_WIDTH_M) *
    depthRatio(z);
  return Math.max(0, base - lateral);
};

let passed = 0;
let failed = 0;

function check(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`✅ ${label}`);
  } else {
    failed += 1;
    console.log(`❌ ${label}`);
  }
}

class Client {
  constructor(name) {
    this.name = name;
    this.socket = new WebSocket(WS_URL);
    this.messages = [];
    this.waiters = [];

    this.socket.on('message', (data) => {
      let parsed;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.messages.push(parsed);
      this.waiters = this.waiters.filter((waiter) => {
        if (waiter.predicate(parsed)) {
          waiter.resolve(parsed);
          return false;
        }
        return true;
      });
    });
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  wait(predicate, label) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${this.name} 等待超时：${label}`));
      }, TIMEOUT_MS);
      this.waiters.push({
        predicate,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  waitRoomResult(action) {
    return this.wait(
      (m) => m.type === 'room_action_result' && m.payload.action === action,
      `room_action_result(${action})`,
    );
  }

  close() {
    this.socket.close();
  }
}

/**
 * 收集快照，直到凑齐帧数**且**看到敌人。
 *
 * 开局先是部署阶段，第一波敌人过几秒才下山；
 * 只抓开局那几帧会得到空的 enemies 列表，看不出坡面分布。
 */
async function collectSnapshots(client, frameCount, waitMs) {
  const frames = [];
  const deadline = Date.now() + waitMs;
  let seen = client.messages.filter((m) => m.type === 'world_snapshot').length;
  let sawEnemy = false;

  while (Date.now() < deadline) {
    const all = client.messages.filter((m) => m.type === 'world_snapshot');
    if (all.length > seen) {
      const fresh = all.slice(seen);
      seen = all.length;
      frames.push(...fresh);
      if (fresh.some((f) => (f.payload?.enemies ?? []).length > 0)) {
        sawEnemy = true;
      }
    }
    if (frames.length >= frameCount && sawEnemy) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return frames;
}

async function main() {
  console.log(`⛰️  地形贴合验收：${WS_URL}\n`);

  const host = new Client('房主');
  await host.open();

  host.send({
    type: 'create_room',
    payload: { playerName: '地形探针', protocolVersion: PROTOCOL_VERSION },
  });
  const created = await host.waitRoomResult('create_room');
  check(created.payload.accepted === true, '创建房间成功');

  host.send({ type: 'start_match', payload: {} });
  const started = await host.waitRoomResult('start_match');
  check(started.payload.accepted === true, '开局成功');

  // 真人自己也是一个席位，在快照的 allies 里，靠 playerId 认自己。
  const idSnapshot = await host.wait(
    (m) => m.type === 'snapshot' && m.payload.connection.playerId !== undefined,
    'snapshot(含 playerId)',
  );
  const playerId = idSnapshot.payload.connection.playerId;
  check(typeof playerId === 'string', `拿到自己的 playerId（${playerId}）`);

  // 等到敌人真正下山：部署阶段结束前 enemies 是空的。
  const frames = await collectSnapshots(host, 40, 40000);
  check(frames.length > 0, `收到世界快照（${frames.length} 帧）`);

  const playerYs = [];
  const allyYs = [];
  const enemySamples = [];
  let mismatched = 0;

  for (const frame of frames) {
    const p = frame.payload ?? {};

    for (const ally of p.allies ?? []) {
      if (!ally.position) continue;
      // 自己与 AI 队友分开统计：两者应同样在山顶。
      if (ally.id === playerId) {
        playerYs.push(ally.position.y);
      } else {
        allyYs.push(ally.position.y);
      }
    }

    for (const enemy of p.enemies ?? []) {
      if (!enemy.position) continue;
      const { x, y, z } = enemy.position;
      enemySamples.push({ x, y, z });
      // 敌人脚底应严格落在高度场上（容差留给浮点与插值）。
      if (Math.abs(y - terrainHeightAt(x, z)) > 0.05) mismatched += 1;
    }
  }

  console.log('\n--- 采样 ---');
  console.log(`玩家 y 范围: ${describe(playerYs)}`);
  console.log(`队友 y 范围: ${describe(allyYs)}`);
  console.log(`敌人 y 范围: ${describe(enemySamples.map((s) => s.y))}`);
  console.log(`敌人样本数: ${enemySamples.length}，高度场不吻合: ${mismatched}`);
  console.log('');

  // 注意：空数组的 every() 恒为 true，因此必须先断言有样本，
  // 否则「没采到数据」会伪装成「全部通过」。
  check(playerYs.length > 0, '快照包含玩家位置');
  check(
    playerYs.length > 0 && playerYs.every((y) => y > 15),
    `玩家站在山顶高度（应 >15m，实际最低 ${min(playerYs).toFixed(2)}m）`,
  );

  check(allyYs.length > 0, '快照包含队友位置');
  check(
    allyYs.length > 0 && allyYs.every((y) => y > 15),
    `队友站在山顶高度（应 >15m，实际最低 ${min(allyYs).toFixed(2)}m）`,
  );

  check(enemySamples.length > 0, '快照包含敌人位置');
  const enemyYs = enemySamples.map((s) => s.y);
  check(
    enemyYs.some((y) => y > 0.5),
    '敌人 y 不再恒为 0（旧平地实现下恒为 0）',
  );
  check(
    max(enemyYs) - min(enemyYs) > 1,
    `敌人分布在不同高度（跨度 ${(max(enemyYs) - min(enemyYs)).toFixed(2)}m）`,
  );
  check(
    enemySamples.length > 0 && mismatched === 0,
    `所有敌人脚底都贴合高度场（不吻合 ${mismatched} / ${enemySamples.length}）`,
  );

  host.close();

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
  if (failed === 0) {
    console.log('\n✅ 地形贴合验收全部通过');
  } else {
    console.log('\n❌ 地形贴合验收未通过');
  }
  process.exit(failed === 0 ? 0 : 1);
}

const min = (list) => (list.length ? Math.min(...list) : NaN);
const max = (list) => (list.length ? Math.max(...list) : NaN);
const describe = (list) =>
  list.length
    ? `${min(list).toFixed(2)} .. ${max(list).toFixed(2)} (n=${list.length})`
    : '(无样本)';

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
