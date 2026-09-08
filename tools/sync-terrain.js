#!/usr/bin/env node
/**
 * 地形高度场镜像同步脚本
 *
 * 背景：
 *   Cocos Creator 的模块解析器只加载 `client/assets/` 目录内的脚本。
 *   `shared/terrain.ts` 位于 assets 之外，客户端对它做**值导入**时
 *   编辑器会报「找不到模块 ../../../../shared/terrain」。
 *   （`import type` 在编译期被擦除，所以 shared/protocol.ts 一直没暴露这个问题。）
 *
 *   因此沿用与 shared/config/*.json 完全相同的「真源 + 副本」模式：
 *     真源：shared/terrain.ts                        ← 服务端直接引用
 *     副本：client/assets/scripts/shared/terrain.ts  ← 客户端引用
 *
 * 用法：
 *   node tools/sync-terrain.js          # 把真源同步到客户端副本
 *   node tools/sync-terrain.js --check  # 只校验一致，不写文件（CI / 启动前用）
 *
 * 退出码：0 = 一致（或同步成功），1 = 不一致（--check 模式）
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'shared', 'terrain.ts');
const MIRROR = path.join(
  ROOT,
  'client',
  'assets',
  'scripts',
  'shared',
  'terrain.ts',
);

const checkOnly = process.argv.includes('--check');

function rel(p) {
  return path.relative(ROOT, p);
}

if (!fs.existsSync(SOURCE)) {
  console.error(`❌ 找不到地形真源：${rel(SOURCE)}`);
  process.exit(1);
}

const source = fs.readFileSync(SOURCE);
const mirrorExists = fs.existsSync(MIRROR);
const mirror = mirrorExists ? fs.readFileSync(MIRROR) : null;
const identical = mirrorExists && Buffer.compare(source, mirror) === 0;

if (identical) {
  console.log(`✅ 地形镜像与真源一致：${rel(MIRROR)}`);
  process.exit(0);
}

if (checkOnly) {
  console.error('');
  console.error('❌ 地形镜像与真源不一致');
  console.error(`   真源：${rel(SOURCE)}`);
  console.error(`   镜像：${rel(MIRROR)}${mirrorExists ? '' : '（不存在）'}`);
  console.error('');
  console.error('   两份实现不同会让「客户端看到的地面」与');
  console.error('   「服务端判定的地面」脱节，必须先同步：');
  console.error('       node tools/sync-terrain.js');
  console.error('');
  process.exit(1);
}

fs.mkdirSync(path.dirname(MIRROR), { recursive: true });
fs.writeFileSync(MIRROR, source);
console.log(`✅ 已同步地形镜像：${rel(SOURCE)} → ${rel(MIRROR)}`);
process.exit(0);
