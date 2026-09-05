import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(clientRoot);
const outputDirectory = join(clientRoot, 'assets', 'resources', 'config');
const filenames = [
  'gameplay.json',
  'weapons.json',
  'waves.json',
  'allies.json',
  'enemies.json',
];
const checkOnly = process.argv.includes('--check');

await mkdir(outputDirectory, { recursive: true });

for (const filename of filenames) {
  const source = join(repositoryRoot, 'shared', 'config', filename);
  const output = join(outputDirectory, filename);

  if (checkOnly) {
    const [sourceContent, outputContent] = await Promise.all([
      readFile(source, 'utf8'),
      readFile(output, 'utf8'),
    ]);
    if (sourceContent !== outputContent) {
      throw new Error(`${filename} 与 shared/config 不一致，请先运行 npm run sync-config`);
    }
    continue;
  }

  await copyFile(source, output);
}

console.info(
  checkOnly
    ? '✅ Cocos 配置副本与 shared/config 一致'
    : '✅ 已将客户端所需配置同步到 Cocos resources',
);
