import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { config as loadEnvFile } from 'dotenv';

export interface RuntimeConfig {
  readonly host: string;
  readonly wsPort: number;
  readonly wsPath: string;
  readonly dbPath: string;
  readonly wsHeartbeatIntervalMs: number;
  readonly wsBackpressureWarnBytes: number;
  readonly wsBackpressureLogIntervalMs: number;
  /** 世界快照允许的发送积压上限（字节），超过就跳过这一帧而不是继续堆。 */
  readonly wsSnapshotDropBytes: number;
  /** 是否开启 permessage-deflate（JSON 快照键名高度重复，压缩率 4–5 倍）。 */
  readonly wsCompression: boolean;
}

function parsePort(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} 必须是有效端口，当前值为 "${rawValue}"`);
  }
  return value;
}

function parsePositiveInteger(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} 必须是正整数，当前值为 "${rawValue}"`);
  }
  return value;
}

export function loadRuntimeConfig(repositoryRoot: string): RuntimeConfig {
  const envPath = join(repositoryRoot, '.env');
  if (existsSync(envPath)) {
    loadEnvFile({ path: envPath });
  }

  const wsPath = process.env.WS_PATH ?? '/ws';
  if (!wsPath.startsWith('/')) {
    throw new Error(`WS_PATH 必须以 "/" 开头，当前值为 "${wsPath}"`);
  }

  return Object.freeze({
    host: process.env.HOST ?? '0.0.0.0',
    wsPort: parsePort('WS_PORT', 8081),
    wsPath,
    dbPath: resolve(
      repositoryRoot,
      process.env.DB_PATH ?? 'data/matches.sqlite',
    ),
    wsHeartbeatIntervalMs: parsePositiveInteger(
      'WS_HEARTBEAT_INTERVAL_MS',
      30_000,
    ),
    wsBackpressureWarnBytes: parsePositiveInteger(
      'WS_BACKPRESSURE_WARN_BYTES',
      262_144,
    ),
    wsBackpressureLogIntervalMs: parsePositiveInteger(
      'WS_BACKPRESSURE_LOG_INTERVAL_MS',
      5_000,
    ),
    // 约 2–3 帧快照。公网链路每帧都可能有几 KB 尚未刷出内核缓冲，
    // 早先「只要 > 0 就丢帧」会把正常在途数据也当积压，造成敌人瞬移。
    wsSnapshotDropBytes: parsePositiveInteger(
      'WS_SNAPSHOT_DROP_BYTES',
      16_384,
    ),
    wsCompression: (process.env.WS_COMPRESSION ?? '1') !== '0',
  });
}
