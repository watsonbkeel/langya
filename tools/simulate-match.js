#!/usr/bin/env node
/**
 * 单局批量模拟脚本（M2 数值校准用）
 *
 * ⚠️ 这是 Codex 需要实现的骨架，当前为占位。
 *    实现方式：复用 server/src 的战斗逻辑，以无渲染、加速时间步的方式跑完整局。
 *    禁止另写一套简化模型——那样测出来的数不作数（AGENTS.md 铁律：单一真源）。
 *
 * 用途：验证 AI 队友「能帮忙不抢戏」的硬指标。
 *
 * 用法：
 *   node tools/simulate-match.js --runs 10 --output stats.json
 *   node tools/simulate-match.js --runs 30 --seed 42
 *
 * 硬指标（来自 shared/config/allies.json 的 calibration 节）：
 *   - 4 名 AI 队友合计歼敌占比 ≤ 0.5（目标 0.4）
 *   - 队友平均存活 ≥ 180 秒
 *   - 单局服务端 CPU < 20%（单核）
 *   - 200 名敌人必须全部投放完毕
 *
 * 超标处理：按 allies.json 的 calibration.tuningOrder 顺序下调
 *   accuracy → fireRate → reactionDelaySec → medkitCount
 *
 * 退出码：0 = 指标达标，1 = 指标超标或未实现
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------- 参数解析 ----------
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const RUNS = parseInt(arg('runs', '10'), 10);
const OUTPUT = arg('output', '');
const SEED = parseInt(arg('seed', '0'), 10);

// ---------- 加载校准目标 ----------
const alliesPath = path.resolve(__dirname, '..', 'shared', 'config', 'allies.json');
const allies = JSON.parse(fs.readFileSync(alliesPath, 'utf8'));
const CAL = allies.calibration;

// ---------- TODO(Codex, M2)：接入真实战斗内核 ----------
//
// 预期实现：
//   const { createMatch } = require('../server/dist/game/match');
//   const result = createMatch({
//     seats: [{ type: 'bot-player' }, ...4 个 AI 队友],   // 玩家位用行为基准 bot 代替
//     timeScale: 60,          // 加速 60 倍，5 分钟局跑 5 秒
//     headless: true,         // 不发网络包、不做插值
//     seed: SEED + i,
//   }).runToEnd();
//
// 每局需返回：
//   {
//     playerKills, allyKills: [k1,k2,k3,k4], totalKills,
//     enemiesSpawned,          // 必须 == 200
//     allySurvivalSec: [...],  // 每个队友存活秒数
//     playerSurvived: bool,
//     cpuMs,                   // 本局服务端累计 CPU 毫秒
//   }
//
console.error('❌ simulate-match.js 尚未实现（M2 任务）。');
console.error('');
console.error('实现要求：');
console.error('  1. 复用 server/ 的战斗逻辑，禁止另写简化模型');
console.error('  2. 玩家位用固定行为基准 bot 代替，保证多次运行可比');
console.error('  3. 支持 --seed 保证可复现');
console.error('  4. 输出必须包含：队友歼敌占比、队友平均存活、敌人投放总数、CPU 耗时');
console.error('');
console.error('校准目标（来自 shared/config/allies.json）：');
console.error(`  队友歼敌占比 目标 ${CAL.targetKillRatio} / 上限 ${CAL.maxKillRatio}`);
console.error(`  队友平均存活 ≥ ${CAL.minAvgSurvivalSec} 秒`);
console.error(`  调参顺序：${CAL.tuningOrder.join(' → ')}`);
console.error('');
console.error(`（本次请求：runs=${RUNS}, seed=${SEED}, output=${OUTPUT || '(stdout)'}）`);
process.exit(1);

// ---------- 以下为实现后应有的汇总逻辑（保留供参考） ----------
/*
function summarize(results) {
  const n = results.length;
  const avg = (f) => results.reduce((a, r) => a + f(r), 0) / n;

  const allyKillRatio = avg((r) => r.allyKills.reduce((a, b) => a + b, 0) / Math.max(r.totalKills, 1));
  const avgAllySurvival = avg((r) => r.allySurvivalSec.reduce((a, b) => a + b, 0) / r.allySurvivalSec.length);
  const spawnOk = results.every((r) => r.enemiesSpawned === 200);
  const avgCpuMs = avg((r) => r.cpuMs);

  const summary = {
    runs: n,
    allyKillRatio: +allyKillRatio.toFixed(3),
    playerKillRatio: +(1 - allyKillRatio).toFixed(3),
    avgAllySurvivalSec: +avgAllySurvival.toFixed(1),
    allEnemiesSpawned: spawnOk,
    avgCpuMsPerMatch: Math.round(avgCpuMs),
    pass:
      allyKillRatio <= CAL.maxKillRatio &&
      avgAllySurvival >= CAL.minAvgSurvivalSec &&
      spawnOk,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (OUTPUT) fs.writeFileSync(OUTPUT, JSON.stringify({ summary, results }, null, 2));

  if (!summary.pass) {
    console.error('');
    console.error('❌ 指标未达标，按以下顺序下调 allies.json 的 bot 数值：');
    console.error(`   ${CAL.tuningOrder.join(' → ')}`);
    process.exit(1);
  }
  console.log('✅ AI 队友数值达标');
}
*/
