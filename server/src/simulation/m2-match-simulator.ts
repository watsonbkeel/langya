import type { ProjectConfig } from '../config/project-config';
import { SeededRandom, type RandomSource } from '../ai/seeded-random';
import {
  createM2BattleRuntime,
  type M2EnemyType,
  type M2RouteId,
} from '../game/m2-battle-factory';
import { findPlayerWeaponConfig } from '../game/m1-battle-factory';

interface WeightedValue<TValue extends string> {
  readonly value: TValue;
  readonly weight: number;
}

export interface PlannedEnemy {
  readonly spawnAtMs: number;
  readonly enemyType: M2EnemyType;
  readonly routeId: M2RouteId;
  readonly accuracy: number;
}

export interface M2MatchSimulationResult {
  readonly seed: number;
  readonly playerKills: number;
  readonly allyKills: readonly number[];
  readonly totalKills: number;
  readonly enemiesSpawned: number;
  readonly enemiesAlive: number;
  readonly maxAliveEnemies: number;
  readonly allySurvivalSec: readonly number[];
  readonly playerSurvived: boolean;
  readonly cpuMs: number;
  readonly cpuPercentSingleCore: number;
  readonly wallMs: number;
  readonly ticks: number;
}

export function createEnemySpawnPlan(
  config: ProjectConfig,
  random: RandomSource,
): readonly PlannedEnemy[] {
  const routeWeights = Object.entries(config.waves.routes).map(
    ([routeId, route]) => ({
      value: routeId as M2RouteId,
      weight: route.enemyRatio,
    }),
  );
  const plan: PlannedEnemy[] = [];

  for (const wave of config.waves.waves) {
    const enemyTypes = expandWeightedValues(
      wave.enemyCount,
      Object.entries(wave.composition).map(([enemyType, weight]) => ({
        value: enemyType as M2EnemyType,
        weight,
      })),
    );
    const routes = expandWeightedValues(wave.enemyCount, routeWeights);
    shuffleInPlace(enemyTypes, random);
    shuffleInPlace(routes, random);

    for (let index = 0; index < wave.enemyCount; index += 1) {
      const enemyType = enemyTypes[index];
      const routeId = routes[index];
      if (!enemyType || !routeId) {
        throw new Error(`第 ${wave.index} 波生成计划数量不足`);
      }
      plan.push({
        spawnAtMs:
          (wave.startSec +
            Math.floor(index / wave.squadSize) *
              wave.squadIntervalSec) *
          1000,
        enemyType,
        routeId,
        accuracy: wave.accuracy,
      });
    }
  }

  return plan;
}

export function simulateM2Match(
  config: ProjectConfig,
  seed: number,
): M2MatchSimulationResult {
  const { battle, tickRateHz } = createM2BattleRuntime(
    config,
    `calibration-player-${seed}`,
    '校准玩家',
    seed,
  );
  const spawnPlan = createEnemySpawnPlan(
    config,
    new SeededRandom(seed + 1),
  );
  const tickDurationSec = 1 / tickRateHz;
  const tickDurationMs = tickDurationSec * 1000;
  const totalTicks = config.waves.matchDurationSec * tickRateHz;
  const playerWeapon = findPlayerWeaponConfig(
    config,
    config.gameplay.player.defaultLoadout.primary,
  );
  const playerFireIntervalMs = 1000 / playerWeapon.fireRate;
  let nextSpawnIndex = 0;
  let nextPlayerFireAtMs = config.waves.deployPhaseSec * 1000;
  let clientTick = 0;
  let maxAliveEnemies = 0;

  battle.applyInput({
    type: 'input_state',
    payload: {
      clientTick,
      moveDir: { x: 0, y: 0 },
      aimYaw: 0,
      aimPitch: 0,
      isCrouch: true,
    },
  });
  clientTick += 1;

  const cpuStartedAt = process.cpuUsage();
  const wallStartedAt = performance.now();

  for (let tick = 0; tick < totalTicks; tick += 1) {
    const nowMs = (tick + 1) * tickDurationMs;

    while (
      nextSpawnIndex < spawnPlan.length &&
      spawnPlan[nextSpawnIndex]!.spawnAtMs <= nowMs
    ) {
      const planned = spawnPlan[nextSpawnIndex]!;
      const enemyId = battle.spawnEnemy(
        planned.enemyType,
        planned.routeId,
        planned.accuracy,
        nowMs,
      );
      if (!enemyId) {
        break;
      }
      nextSpawnIndex += 1;
    }

    battle.update(tickDurationSec, tick, nowMs);
    maxAliveEnemies = Math.max(maxAliveEnemies, battle.aliveEnemyCount);
    battle.resupplyPlayerAmmo(nowMs);

    if (battle.playerHp <= 0 || nowMs < nextPlayerFireAtMs) {
      continue;
    }

    const weapon = battle.playerWeaponState;
    if (weapon.isReloading) {
      continue;
    }
    if (weapon.magazineAmmo === 0) {
      battle.reload(
        {
          type: 'reload',
          payload: {
            weaponId: weapon.weaponId,
          },
        },
        nowMs,
      );
      continue;
    }

    const targetId = battle.findNearestAliveEnemyId();
    if (!targetId) {
      continue;
    }
    const fireMessage = battle.createFireMessageForEnemy(
      targetId,
      clientTick,
      'head',
    );
    if (!fireMessage) {
      continue;
    }
    clientTick += 1;
    const resolution = battle.fire(fireMessage, nowMs);
    if (resolution.result.payload.accepted) {
      nextPlayerFireAtMs = nowMs + playerFireIntervalMs;
    }
  }

  const cpuUsage = process.cpuUsage(cpuStartedAt);
  const cpuMs = (cpuUsage.user + cpuUsage.system) / 1000;
  const wallMs = performance.now() - wallStartedAt;
  const allyKills = battle.allyKills;
  const totalKills =
    battle.playerKills +
    allyKills.reduce((total, kills) => total + kills, 0);

  return {
    seed,
    playerKills: battle.playerKills,
    allyKills,
    totalKills,
    enemiesSpawned: battle.totalEnemyCount,
    enemiesAlive: battle.aliveEnemyCount,
    maxAliveEnemies,
    allySurvivalSec: battle.allySurvivalSec.map((survivalSec) =>
      Math.min(survivalSec, config.waves.matchDurationSec),
    ),
    playerSurvived: battle.playerHp > 0,
    cpuMs,
    cpuPercentSingleCore:
      (cpuMs / (config.waves.matchDurationSec * 1000)) * 100,
    wallMs,
    ticks: totalTicks,
  };
}

function expandWeightedValues<TValue extends string>(
  total: number,
  weights: readonly WeightedValue<TValue>[],
): TValue[] {
  const allocations = weights.map(({ value, weight }) => {
    const exact = total * weight;
    const count = Math.floor(exact);
    return {
      value,
      count,
      remainder: exact - count,
    };
  });
  let assigned = allocations.reduce(
    (sum, allocation) => sum + allocation.count,
    0,
  );

  allocations.sort((first, second) => second.remainder - first.remainder);
  for (
    let index = 0;
    assigned < total && allocations.length > 0;
    index = (index + 1) % allocations.length
  ) {
    allocations[index]!.count += 1;
    assigned += 1;
  }

  const result: TValue[] = [];
  for (const allocation of allocations) {
    for (let index = 0; index < allocation.count; index += 1) {
      result.push(allocation.value);
    }
  }
  return result;
}

function shuffleInPlace<TValue>(
  values: TValue[],
  random: RandomSource,
): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1));
    const current = values[index]!;
    values[index] = values[swapIndex]!;
    values[swapIndex] = current;
  }
}
