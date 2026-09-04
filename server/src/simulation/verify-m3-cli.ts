import {
  findRepositoryRoot,
  loadProjectConfig,
} from '../config/project-config';
import { verifyM3Match } from './m3-match-verifier';

const repositoryRoot = findRepositoryRoot();
const config = loadProjectConfig(repositoryRoot);
const seed = parseSeed(process.argv.slice(2));
const result = verifyM3Match(config, seed);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.pass) {
  process.exitCode = 1;
}

function parseSeed(args: readonly string[]): number {
  const index = args.indexOf('--seed');
  if (index < 0) {
    return 0;
  }
  const raw = args[index + 1];
  const seed = Number(raw);
  if (!raw || !Number.isSafeInteger(seed) || seed < 0) {
    throw new Error('--seed 必须是非负安全整数');
  }
  return seed;
}
