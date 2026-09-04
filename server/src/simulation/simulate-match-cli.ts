import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  findRepositoryRoot,
  loadProjectConfig,
} from '../config/project-config';
import {
  simulateM2Match,
  type M2MatchSimulationResult,
} from './m2-match-simulator';

interface CliOptions {
  readonly runs: number;
  readonly seed: number;
  readonly output?: string;
}

interface SimulationSummary {
  readonly runs: number;
  readonly avgPlayerKills: number;
  readonly avgAllyKillsTotal: number;
  readonly allyKillRatio: number;
  readonly playerKillRatio: number;
  readonly avgAllySurvivalSec: number;
  readonly allEnemiesSpawned: boolean;
  readonly maxAliveEnemiesObserved: number;
  readonly avgCpuMsPerMatch: number;
  readonly avgCpuPercentSingleCore: number;
  readonly maxCpuPercentSingleCore: number;
  readonly avgWallMsPerMatch: number;
  readonly playerSurvivalRate: number;
  readonly pass: boolean;
}

const repositoryRoot = findRepositoryRoot();
const config = loadProjectConfig(repositoryRoot);
const options = parseOptions(process.argv.slice(2));
const results: M2MatchSimulationResult[] = [];

for (let index = 0; index < options.runs; index += 1) {
  results.push(simulateM2Match(config, options.seed + index));
}

const summary = summarize(results);
const output = { summary, results };
const serialized = `${JSON.stringify(output, null, 2)}\n`;
process.stdout.write(serialized);

if (options.output) {
  writeFileSync(resolve(repositoryRoot, options.output), serialized, 'utf8');
}

if (!summary.pass) {
  process.stderr.write(
    `\n校准未达标，调参顺序：${config.allies.calibration.tuningOrder.join(' -> ')}\n`,
  );
  process.exitCode = 1;
}

function parseOptions(args: readonly string[]): CliOptions {
  const runs = parseIntegerOption(args, 'runs', 10);
  const seed = parseIntegerOption(args, 'seed', 0);
  const output = findOption(args, 'output');

  if (runs <= 0) {
    throw new Error('--runs 必须是正整数');
  }
  if (seed < 0) {
    throw new Error('--seed 必须是非负整数');
  }

  return output ? { runs, seed, output } : { runs, seed };
}

function parseIntegerOption(
  args: readonly string[],
  name: string,
  fallback: number,
): number {
  const raw = findOption(args, name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`--${name} 必须是安全整数`);
  }
  return value;
}

function findOption(
  args: readonly string[],
  name: string,
): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`--${name} 缺少参数`);
  }
  return value;
}

function summarize(
  results: readonly M2MatchSimulationResult[],
): SimulationSummary {
  const totalPlayerKills = sum(results.map((result) => result.playerKills));
  const totalAllyKills = sum(
    results.flatMap((result) => result.allyKills),
  );
  const totalKills = totalPlayerKills + totalAllyKills;
  const average = (
    select: (result: M2MatchSimulationResult) => number,
  ): number => sum(results.map(select)) / results.length;
  const allySurvivalSamples = results.flatMap(
    (result) => result.allySurvivalSec,
  );
  const allyKillRatio =
    totalKills === 0 ? 0 : totalAllyKills / totalKills;
  const playerKillRatio =
    totalKills === 0 ? 0 : totalPlayerKills / totalKills;
  const avgAllySurvivalSec =
    sum(allySurvivalSamples) / allySurvivalSamples.length;
  const allEnemiesSpawned = results.every(
    (result) => result.enemiesSpawned === config.waves.totalEnemies,
  );
  const maxAliveEnemiesObserved = Math.max(
    ...results.map((result) => result.maxAliveEnemies),
  );
  const avgCpuPercentSingleCore = average(
    (result) => result.cpuPercentSingleCore,
  );

  return {
    runs: results.length,
    avgPlayerKills: round(average((result) => result.playerKills), 2),
    avgAllyKillsTotal: round(
      average((result) => sum(result.allyKills)),
      2,
    ),
    allyKillRatio: round(allyKillRatio, 4),
    playerKillRatio: round(playerKillRatio, 4),
    avgAllySurvivalSec: round(avgAllySurvivalSec, 2),
    allEnemiesSpawned,
    maxAliveEnemiesObserved,
    avgCpuMsPerMatch: round(average((result) => result.cpuMs), 2),
    avgCpuPercentSingleCore: round(avgCpuPercentSingleCore, 4),
    maxCpuPercentSingleCore: round(
      Math.max(
        ...results.map((result) => result.cpuPercentSingleCore),
      ),
      4,
    ),
    avgWallMsPerMatch: round(average((result) => result.wallMs), 2),
    playerSurvivalRate: round(
      average((result) => (result.playerSurvived ? 1 : 0)),
      4,
    ),
    pass:
      allyKillRatio <= config.allies.calibration.maxKillRatio &&
      avgAllySurvivalSec >=
        config.allies.calibration.minAvgSurvivalSec &&
      allEnemiesSpawned &&
      maxAliveEnemiesObserved <= config.waves.maxAliveEnemies,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
