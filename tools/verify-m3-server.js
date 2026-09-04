#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const executable = path.join(
  repositoryRoot,
  'server',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
);
const cli = path.join(
  repositoryRoot,
  'server',
  'src',
  'simulation',
  'verify-m3-cli.ts',
);
const result = spawnSync(executable, [cli, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`无法启动 M3 验收器：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
