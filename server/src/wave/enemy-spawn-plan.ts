import type { RandomSource } from '../ai/seeded-random';

const MILLISECONDS_PER_SECOND = 1000;

interface WeightedValue<TValue extends string> {
  readonly value: TValue;
  readonly weight: number;
}

export interface EnemyWaveConfig<TEnemyType extends string> {
  readonly index: number;
  readonly enemyCount: number;
  readonly startSec: number;
  readonly squadSize: number;
  readonly squadIntervalSec: number;
  readonly accuracy: number;
  readonly composition: Readonly<Record<TEnemyType, number>>;
}

export interface EnemyRouteConfig {
  readonly enemyRatio: number;
}

export interface EnemySpawnPlanConfig<
  TEnemyType extends string,
  TRouteId extends string,
> {
  readonly waves: readonly EnemyWaveConfig<TEnemyType>[];
  readonly routes: Readonly<Record<TRouteId, EnemyRouteConfig>>;
}

export interface PlannedEnemy<
  TEnemyType extends string,
  TRouteId extends string,
> {
  readonly waveIndex: number;
  readonly spawnAtMs: number;
  readonly enemyType: TEnemyType;
  readonly routeId: TRouteId;
  readonly accuracy: number;
}

export function createEnemySpawnPlan<
  TEnemyType extends string,
  TRouteId extends string,
>(
  config: EnemySpawnPlanConfig<TEnemyType, TRouteId>,
  random: RandomSource,
): readonly PlannedEnemy<TEnemyType, TRouteId>[] {
  const routeWeights = (
    Object.entries(config.routes) as [
      TRouteId,
      EnemyRouteConfig,
    ][]
  ).map(([routeId, route]) => ({
      value: routeId as TRouteId,
      weight: route.enemyRatio,
    }));
  const plan: PlannedEnemy<TEnemyType, TRouteId>[] = [];

  for (const wave of config.waves) {
    const enemyTypes = expandWeightedValues(
      wave.enemyCount,
      (
        Object.entries(wave.composition) as [TEnemyType, number][]
      ).map(([enemyType, weight]) => ({
        value: enemyType,
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
        waveIndex: wave.index,
        spawnAtMs:
          (wave.startSec +
            Math.floor(index / wave.squadSize) *
              wave.squadIntervalSec) *
          MILLISECONDS_PER_SECOND,
        enemyType,
        routeId,
        accuracy: wave.accuracy,
      });
    }
  }

  return plan;
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
