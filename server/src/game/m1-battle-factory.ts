import type { ProjectConfig } from '../config/project-config';
import type { RouteId } from '../../../shared/protocol';
import {
  BattleSession,
  type BattleSessionConfig,
  type BattleWeaponConfig,
} from './battle-session';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseBattleWeapon(
  weaponId: string,
  value: unknown,
): BattleWeaponConfig {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.damage) ||
    !isFiniteNumber(value.fireRate) ||
    !isFiniteNumber(value.magazine) ||
    !isFiniteNumber(value.reserveAmmo) ||
    !isFiniteNumber(value.reloadSec) ||
    !isFiniteNumber(value.falloffStartM) ||
    !isFiniteNumber(value.falloffMultiplier)
  ) {
    throw new Error(`默认主武器 "${weaponId}" 缺少 M1 战斗字段`);
  }

  return {
    weaponId,
    damage: value.damage,
    fireRate: value.fireRate,
    magazine: value.magazine,
    reserveAmmo: value.reserveAmmo,
    reloadSec: value.reloadSec,
    falloffStartM: value.falloffStartM,
    falloffMultiplier: value.falloffMultiplier,
  };
}

export function findPlayerWeaponConfig(
  config: ProjectConfig,
  weaponId: string,
): BattleWeaponConfig {
  const entry = Object.entries(config.weapons.player).find(
    ([candidateId]) => candidateId === weaponId,
  );
  if (!entry) {
    throw new Error(`默认主武器 "${weaponId}" 不存在`);
  }

  return parseBattleWeapon(weaponId, entry[1]);
}

export interface M1BattleRuntime {
  readonly battle: BattleSession;
  readonly tickRateHz: number;
}

export function createM1BattleRuntime(
  config: ProjectConfig,
  playerId: string,
): M1BattleRuntime {
  const gameplay = config.gameplay;
  const combat = gameplay.combat;
  const weaponId = gameplay.player.defaultLoadout.primary;
  const weapon = findPlayerWeaponConfig(config, weaponId);
  const enemyType = 'rifleman';
  const enemyConfig = config.enemies.units[enemyType];
  const battleConfig: BattleSessionConfig = {
    player: {
      maxHp: gameplay.player.maxHp,
      moveSpeed: gameplay.player.moveSpeed,
      crouchSpeed: gameplay.player.crouchSpeed,
      aimPitchMinDeg: gameplay.player.aimPitchMinDeg,
      aimPitchMaxDeg: gameplay.player.aimPitchMaxDeg,
    },
    arena: {
      widthM: gameplay.arena.widthM,
      depthM: gameplay.arena.depthM,
    },
    validation: {
      fireOriginToleranceM: combat.fireOriginToleranceM,
      directionMagnitudeTolerance: combat.directionMagnitudeTolerance,
    },
    weapon,
    hitPartMultiplier: config.weapons.hitPartMultiplier,
    enemyHitbox: {
      radiusM: combat.enemyHitboxRadiusM,
      heightM: combat.enemyHitboxHeightM,
      headStartM: combat.headHitboxStartM,
      torsoStartM: combat.torsoHitboxStartM,
    },
  };
  const playerHeightM =
    (combat.torsoHitboxStartM + combat.headHitboxStartM) / 2;
  const playerRouteId = findPrimaryRouteId(config);

  return {
    tickRateHz: gameplay.server.tickRateHz,
    battle: new BattleSession({
      playerId,
      playerHeroName:
        config.allies.heroNames[config.allies.playerDefaultSeat]!,
      playerRouteId,
      playerPosition: { x: 0, y: playerHeightM, z: 0 },
      enemy: {
        id: `${playerId}:m1-enemy`,
        enemyType,
        routeId: playerRouteId,
        hp: enemyConfig.hp,
        position: {
          x: 0,
          y: 0,
          z: -gameplay.arena.depthM / 2,
        },
      },
      config: battleConfig,
    }),
  };
}

function findPrimaryRouteId(config: ProjectConfig): RouteId {
  const routes = Object.entries(config.waves.routes) as [
    RouteId,
    ProjectConfig['waves']['routes'][RouteId],
  ][];
  const first = routes[0];
  if (!first) {
    throw new Error('至少需要一条进攻路线');
  }
  return routes.slice(1).reduce(
    (selected, route) =>
      route[1].enemyRatio > selected[1].enemyRatio ? route : selected,
    first,
  )[0];
}
