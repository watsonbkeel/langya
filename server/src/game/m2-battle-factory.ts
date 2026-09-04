import type { ProjectConfig } from '../config/project-config';
import { createRouteLayouts } from '../ai/route-layout';
import { SeededRandom } from '../ai/seeded-random';
import { findPlayerWeaponConfig } from './m1-battle-factory';
import {
  M2BattleSession,
  type M2BattleConfig,
  type M2EnemyUnitConfig,
  type M2EnemyWeaponConfig,
} from './m2-battle-session';

export type M2RouteId = keyof ProjectConfig['waves']['routes'];
export type M2EnemyType = keyof ProjectConfig['enemies']['units'];

export interface M2BattleRuntime {
  readonly battle: M2BattleSession<M2RouteId, M2EnemyType>;
  readonly tickRateHz: number;
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
    aiUpdateGroups: config.enemies.performance.aiUpdateGroups,
    enemyShared: config.enemies.sharedRules,
    enemySpawnOffsetX: config.enemies.pathing.randomOffsetX,
    enemySpawnOffsetZ: config.enemies.pathing.randomOffsetZ,
    enemyUnits,
    enemyWeapons,
    maxAliveEnemies: config.waves.maxAliveEnemies,
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
