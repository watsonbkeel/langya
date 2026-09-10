#!/usr/bin/env node
/**
 * 快照带宽 / 频率 / 抖动探针。
 *
 * 用法：node tools/measure-snapshot.js [ws://127.0.0.1:8081/ws] [采样秒数=30]
 *
 * 目的：回答「卡」到底是不是网络侧的问题——
 *   - 每帧 world_snapshot 多大（字节）、每秒多少帧、每秒多少 KB
 *   - 帧间隔抖动（p50 / p95 / max），间隔明显大于 1/tickRate 说明链路或服务端卡
 *   - 同屏实体数量随时间变化（敌人越多快照越大）
 * 只读探针，不改任何状态；跑完自动断开。
 */
'use strict';

const path = require('node:path');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));

const WS_URL = process.argv[2] || 'ws://127.0.0.1:8081/ws';
const SAMPLE_SEC = Number(process.argv[3] || 30);
const gameplay = require(path.join(__dirname, '..', 'shared', 'config', 'gameplay.json'));
const PROTOCOL_VERSION = 1;
const TICK_RATE_HZ = gameplay.server.tickRateHz;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

async function main() {
  console.log(`📡 快照体积/频率探针：${WS_URL}，采样 ${SAMPLE_SEC}s\n`);
  const socket = new WebSocket(WS_URL, { perMessageDeflate: true });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const negotiated = socket.extensions || '(无)';
  console.log(`协商扩展: ${negotiated}`);
  // 压缩开启时，实际线上字节用 socket 层计数器估算（ws 不暴露单帧压缩大小）。
  const rawSocket = socket._socket;
  const bytesReadAtStart = rawSocket ? rawSocket.bytesRead : 0;

  const send = (m) => socket.send(JSON.stringify(m));
  const frames = []; // { t, bytes, enemies, allies, items }
  let lastAt = 0;
  const gaps = [];
  let otherBytes = 0;
  let otherCount = 0;

  socket.on('message', (data) => {
    const raw = data.toString();
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== 'world_snapshot') {
      otherBytes += raw.length;
      otherCount += 1;
      if (msg.type === 'room_action_result' && msg.payload.action === 'create_room') {
        send({ type: 'start_match', payload: {} });
      }
      return;
    }
    const now = performance.now();
    if (lastAt) gaps.push(now - lastAt);
    lastAt = now;
    const p = msg.payload ?? {};
    frames.push({
      t: now,
      bytes: raw.length,
      enemies: (p.enemies ?? []).length,
      allies: (p.allies ?? []).length,
      items: (p.items ?? []).length,
    });
  });

  send({
    type: 'create_room',
    payload: { playerName: '带宽探针', protocolVersion: PROTOCOL_VERSION },
  });

  await new Promise((resolve) => setTimeout(resolve, SAMPLE_SEC * 1000));
  const wireBytes = rawSocket ? rawSocket.bytesRead - bytesReadAtStart : 0;
  socket.close();

  if (frames.length === 0) {
    console.log('❌ 没收到任何 world_snapshot');
    process.exit(1);
  }

  const span = (frames[frames.length - 1].t - frames[0].t) / 1000;
  const totalBytes = frames.reduce((s, f) => s + f.bytes, 0);
  const sizes = frames.map((f) => f.bytes).sort((a, b) => a - b);
  const sortedGaps = gaps.slice().sort((a, b) => a - b);
  const maxEnemies = Math.max(...frames.map((f) => f.enemies));
  const expectedGap = 1000 / TICK_RATE_HZ;

  // 分敌人数量档位看快照大小，说明「敌人越多越大」的斜率。
  const buckets = new Map();
  for (const f of frames) {
    const key = Math.floor(f.enemies / 10) * 10;
    const b = buckets.get(key) ?? { n: 0, bytes: 0 };
    b.n += 1;
    b.bytes += f.bytes;
    buckets.set(key, b);
  }

  console.log(`帧数: ${frames.length}，跨度 ${span.toFixed(1)}s，实测 ${(frames.length / span).toFixed(1)} Hz（配置 ${TICK_RATE_HZ} Hz）`);
  console.log(`单帧字节: p50 ${percentile(sizes, 0.5)}  p95 ${percentile(sizes, 0.95)}  max ${sizes[sizes.length - 1]}`);
  console.log(`下行带宽（解压后）: ${(totalBytes / span / 1024).toFixed(1)} KB/s（快照） + ${(otherBytes / span / 1024).toFixed(2)} KB/s（其他 ${otherCount} 条）`);
  if (wireBytes > 0) {
    console.log(`实际线上字节: ${(wireBytes / span / 1024).toFixed(1)} KB/s（含帧头/TLS；压缩比 ${(wireBytes / (totalBytes + otherBytes)).toFixed(2)}）`);
  }
  console.log(`帧间隔 ms: p50 ${percentile(sortedGaps, 0.5).toFixed(1)}  p95 ${percentile(sortedGaps, 0.95).toFixed(1)}  max ${sortedGaps[sortedGaps.length - 1].toFixed(1)}（期望 ${expectedGap.toFixed(1)}）`);
  console.log(`间隔 > 2×期望 的帧: ${gaps.filter((g) => g > expectedGap * 2).length} / ${gaps.length}`);
  console.log(`同屏敌人峰值: ${maxEnemies}，队友 ${frames[0].allies}，道具 ${Math.max(...frames.map((f) => f.items))}`);
  console.log('\n按敌人数量分档的平均单帧字节:');
  for (const [key, b] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  敌人 ${String(key).padStart(2)}–${key + 9}: ${(b.bytes / b.n).toFixed(0)} B（${b.n} 帧）`);
  }
}

main().catch((error) => {
  console.error('探针失败:', error.message);
  process.exit(1);
});
