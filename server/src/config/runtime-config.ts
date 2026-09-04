import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { config as loadEnvFile } from 'dotenv';

export interface RuntimeConfig {
  readonly host: string;
  readonly wsPort: number;
  readonly wsPath: string;
  readonly dbPath: string;
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
  });
}
