import type { ProjectConfig } from '../config/project-config';
import type { RouteId } from '../../../shared/protocol';
import { createRouteLayouts } from '../ai/route-layout';
import { SeededRandom } from '../ai/seeded-random';
import { findPlayerWeaponConfig } from './m1-battle-factory';
import {
  M2BattleSession,
  type M2BattleConfig,
  type M2EnemyUnitConfig,
  type M2EnemyWeaponConfig,
} from './m2-battle-session';

export type M2RouteId = Extract<
  keyof ProjectConfig['waves']['routes'],
  RouteId
>;
export type M2EnemyType = keyof ProjectConfig['enemies']['units'];

export interface M2BattleRuntime {
  readonly battle: M2BattleSession<M2RouteId, M2EnemyType>;
  readonly tickRateHz: number;
}

export function populateM2Battlefield(
  config: ProjectConfig,
  battle: M2BattleSession<M2RouteId, M2EnemyType>,
  nowMs: number,
): number {
  const firstWave = config.waves.waves[0];
  const routeIds = Object.keys(config.waves.routes) as M2RouteId[];
  if (!firstWave || routeIds.length === 0) {
    throw new Error('M2 战场初始化需要第一波配置和至少一条路线');
  }

  // M2 尚未接入完整波次调度，先按配置生成足以触发三路威胁提示的首批敌人。
  const enemyCount = Math.min(
    config.waves.maxAliveEnemies,
    config.allies.callout.enemyThreshold * routeIds.length,
  );
  const enemyTypes = allocateEnemyTypes(
    enemyCount,
    firstWave.composition,
  );
  let spawned = 0;
  for (let index = 0; index < enemyTypes.length; index += 1) {
    const routeId = routeIds[index % routeIds.length];
    const enemyType = enemyTypes[index];
    if (
      routeId !== undefined &&
      enemyType !== undefined &&
      battle.spawnEnemy(
        enemyType,
        routeId,
        firstWave.accuracy,
        nowMs,
      )
    ) {
      spawned += 1;
    }
  }
  return spawned;
}

export function createM2BattleRuntime(
  config: ProjectConfig,
  playerId: string,
  playerName: string,
  seed: number,
): M2BattleRuntime {
  const routes = createRouteLayouts(
    config.waves.routes,
    config.gameplay.arena,
  );
  const playerRoute = findPrimaryRoute(config);
  const playerWeapon = findPlayerWeaponConfig(
    config,
    config.gameplay.player.defaultLoadout.primary,
  );
  const enemyUnits = createEnemyUnits(config);
  const enemyWeapons = createEnemyWeapons(config);
  const routeNames = Object.fromEntries(
    Object.entries(config.waves.routes).map(([routeId, route]) => [
      routeId,
      route.name,
    ]),
  ) as Record<M2RouteId, string>;

  const battleConfig: M2BattleConfig<M2RouteId, M2EnemyType> = {
    player: config.gameplay.player,
    arena: config.gameplay.arena,
    match: config.gameplay.match,
    waves: config.waves.waves,
    intermissionSec: config.waves.intermissionSec,
    totalEnemies: config.waves.totalEnemies,
    validation: config.gameplay.combat,
    playerWeapon,
    hitPartMultiplier: config.weapons.hitPartMultiplier,
    enemyHitbox: {
      radiusM: config.gameplay.combat.enemyHitboxRadiusM,
      heightM: config.gameplay.combat.enemyHitboxHeightM,
      headStartM: config.gameplay.combat.headHitboxStartM,
      torsoStartM: config.gameplay.combat.torsoHitboxStartM,
    },
    room: {
      seatCount: config.allies.seatCount,
      heroNames: config.allies.heroNames,
      playerDefaultSeat: config.allies.playerDefaultSeat,
      playerRoute,
      defaultAssignment: config.allies.deployment.defaultAssignment,
    },
    bot: config.allies.bot,
    deployment: config.allies.deployment,
    callout: config.allies.callout,
    medkit: config.gameplay.medkit,
    routes,
    routeNames,
    seatSpacingM: config.gameplay.arena.elements.spawnSpacingM,
    defenderCoverExposureMultiplier:
      config.gameplay.combat.defenderCoverExposureMultiplier,
    aiUpdateGroups: config.enemies.performance.aiUpdateGroups,
    enemyShared: config.enemies.sharedRules,
    enemySpawnOffsetX: config.enemies.pathing.randomOffsetX,
    enemySpawnOffsetZ: config.enemies.pathing.randomOffsetZ,
    enemyUnits,
    enemyWeapons,
    maxAliveEnemies: config.waves.maxAliveEnemies,
    ammoBoxCooldownSec: config.gameplay.arena.ammoBoxCooldownSec,
  };

  return {
    tickRateHz: config.gameplay.server.tickRateHz,
    battle: new M2BattleSession({
      roomId: `${playerId}:solo`,
      playerId,
      playerName,
      config: battleConfig,
      random: new SeededRandom(seed),
    }),
  };
}

function allocateEnemyTypes(
  total: number,
  composition: Readonly<Record<M2EnemyType, number>>,
): M2EnemyType[] {
  const allocations = Object.entries(composition).map(
    ([enemyType, ratio]) => {
      const exact = total * ratio;
      const count = Math.floor(exact);
      return {
        enemyType: enemyType as M2EnemyType,
        count,
        remainder: exact - count,
      };
    },
  );
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

  const result: M2EnemyType[] = [];
  for (const allocation of allocations) {
    for (let index = 0; index < allocation.count; index += 1) {
      result.push(allocation.enemyType);
    }
  }
  return result;
}

function findPrimaryRoute(config: ProjectConfig): M2RouteId {
  const entries = Object.entries(config.waves.routes) as [
    M2RouteId,
    ProjectConfig['waves']['routes'][M2RouteId],
  ][];
  const first = entries[0];
  if (!first) {
    throw new Error('至少需要一条进攻路线');
  }

  let primary = first;
  for (const entry of entries.slice(1)) {
    if (entry[1].enemyRatio > primary[1].enemyRatio) {
      primary = entry;
    }
  }
  return primary[0];
}

function createEnemyUnits(
  config: ProjectConfig,
): Readonly<Record<M2EnemyType, M2EnemyUnitConfig>> {
  const units: Partial<Record<M2EnemyType, M2EnemyUnitConfig>> = {};
  for (const [enemyType, unit] of Object.entries(
    config.enemies.units,
  ) as [
    M2EnemyType,
    ProjectConfig['enemies']['units'][M2EnemyType],
  ][]) {
    units[enemyType] = unit;
  }
  return units as Record<M2EnemyType, M2EnemyUnitConfig>;
}

function createEnemyWeapons(
  config: ProjectConfig,
): Readonly<Record<string, M2EnemyWeaponConfig>> {
  const weapons: Record<string, M2EnemyWeaponConfig> = {};
  for (const [weaponId, weapon] of Object.entries(
    config.weapons.enemy,
  )) {
    weapons[weaponId] = weapon;
  }
  return weapons;
}
