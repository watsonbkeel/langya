import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import type alliesJson from '../../../shared/config/allies.json';
import type enemiesJson from '../../../shared/config/enemies.json';
import type gameplayJson from '../../../shared/config/gameplay.json';
import type wavesJson from '../../../shared/config/waves.json';
import type weaponsJson from '../../../shared/config/weapons.json';

export interface ProjectConfig {
  readonly allies: typeof alliesJson;
  readonly enemies: typeof enemiesJson;
  readonly gameplay: typeof gameplayJson;
  readonly waves: typeof wavesJson;
  readonly weapons: typeof weaponsJson;
}

const CONFIG_FILENAMES = {
  allies: 'allies.json',
  enemies: 'enemies.json',
  gameplay: 'gameplay.json',
  waves: 'waves.json',
  weapons: 'weapons.json',
} as const;

function isRepositoryRoot(candidate: string): boolean {
  return (
    existsSync(join(candidate, 'tools', 'verify-config.js')) &&
    existsSync(join(candidate, 'shared', 'config'))
  );
}

function searchParents(startPath: string): string | undefined {
  let current = resolve(startPath);

  while (true) {
    if (isRepositoryRoot(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export function findRepositoryRoot(): string {
  const configuredRoot = process.env.PROJECT_ROOT;
  const starts = configuredRoot
    ? [resolve(process.cwd(), configuredRoot), process.cwd(), __dirname]
    : [process.cwd(), __dirname];

  for (const start of starts) {
    const root = searchParents(start);
    if (root) {
      return root;
    }
  }

  throw new Error('无法定位仓库根目录，未找到 tools/verify-config.js');
}

function validateConfig(repositoryRoot: string): void {
  const validatorPath = join(repositoryRoot, 'tools', 'verify-config.js');
  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`.trim();
    throw new Error(`配置校验失败，服务拒绝启动\n${output}`);
  }

  const output = result.stdout.trim();
  if (output) {
    console.info(output);
  }
}

function loadJson<T>(configDirectory: string, filename: string): T {
  const path = join(configDirectory, filename);
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return parsed as T;
}

export function loadProjectConfig(repositoryRoot: string): ProjectConfig {
  validateConfig(repositoryRoot);

  const configDirectory = join(repositoryRoot, 'shared', 'config');
  return Object.freeze({
    allies: loadJson<typeof alliesJson>(
      configDirectory,
      CONFIG_FILENAMES.allies,
    ),
    enemies: loadJson<typeof enemiesJson>(
      configDirectory,
      CONFIG_FILENAMES.enemies,
    ),
    gameplay: loadJson<typeof gameplayJson>(
      configDirectory,
      CONFIG_FILENAMES.gameplay,
    ),
    waves: loadJson<typeof wavesJson>(configDirectory, CONFIG_FILENAMES.waves),
    weapons: loadJson<typeof weaponsJson>(
      configDirectory,
      CONFIG_FILENAMES.weapons,
    ),
  });
}
