import type { ProjectConfig } from '../config/project-config';
import type { RouteId } from '../../../shared/protocol';
import { createRouteLayouts } from '../ai/route-layout';
import { SeededRandom } from '../ai/seeded-random';
import type { ScoreTiebreakField } from '../score/score-tracker';
import type { MachineGunConfig } from '../combat/machine-gun-controller';
import { WaveScheduler } from '../wave/wave-scheduler';
import { findPlayerWeaponConfig } from './m1-battle-factory';
import {
  M2BattleSession,
  type M2BattleConfig,
  type M2EnemyUnitConfig,
  type M2EnemyWeaponConfig,
  type M2PlayerWeaponConfig,
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

export interface M3BattleRuntime extends M2BattleRuntime {
  readonly startedAtMs: number;
  readonly waveScheduler: WaveScheduler<M2EnemyType, M2RouteId>;
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
  const playerWeapons = createPlayerWeapons(config);
  const playerWeapon =
    playerWeapons[config.gameplay.player.defaultLoadout.primary];
  if (!playerWeapon) {
    throw new Error('默认玩家武器不存在');
  }
  const enemyUnits = createEnemyUnits(config);
  const enemyWeapons = createEnemyWeapons(config);
  const routeNames = Object.fromEntries(
    Object.entries(config.waves.routes).map(([routeId, route]) => [
      routeId,
      route.name,
    ]),
  ) as Record<M2RouteId, string>;
  const machineGun = createMachineGunConfig(config);

  const battleConfig: M2BattleConfig<M2RouteId, M2EnemyType> = {
    player: config.gameplay.player,
    arena: config.gameplay.arena,
    match: config.gameplay.match,
    waves: config.waves.waves,
    intermissionSec: config.waves.intermissionSec,
    totalEnemies: config.waves.totalEnemies,
    validation: config.gameplay.combat,
    playerWeapon,
    playerWeapons,
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
    score: {
      totalWaves: config.waves.waves.length,
      mvpHumanOnly: config.gameplay.score.mvpHumanOnly,
      mvpRequiresAlive: config.gameplay.score.mvpRequiresAlive,
      tiebreakOrder:
        config.gameplay.score.tiebreakOrder as ScoreTiebreakField[],
    },
    airdrop: config.gameplay.airdrop,
    grenade: {
      weaponId: config.gameplay.player.defaultLoadout.throwable,
      ...config.weapons.player.grenade,
      falloffCurve:
        config.weapons.player.grenade.falloffCurve as 'linear',
    },
    machineGun,
  };

  return {
    tickRateHz: config.gameplay.server.tickRateHz,
    battle: new M2BattleSession({
      roomId: `${playerId}:solo`,
      playerId,
      playerName,
      config: battleConfig,
      random: new SeededRandom(seed),
      supplyRandom: new SeededRandom(seed + 2),
    }),
  };
}

export function createM3BattleRuntime(
  config: ProjectConfig,
  playerId: string,
  playerName: string,
  startedAtMs: number,
): M3BattleRuntime {
  const runtime = createM2BattleRuntime(
    config,
    playerId,
    playerName,
    startedAtMs,
  );
  return {
    ...runtime,
    startedAtMs,
    waveScheduler: new WaveScheduler(
      {
        waves: config.waves.waves,
        routes: config.waves.routes,
        matchDurationSec: config.waves.matchDurationSec,
        intermissionSec: config.waves.intermissionSec,
        maxAliveEnemies: config.waves.maxAliveEnemies,
      },
      new SeededRandom(startedAtMs + 1),
    ),
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

function createPlayerWeapons(
  config: ProjectConfig,
): Readonly<Record<string, M2PlayerWeaponConfig>> {
  const weapons: Record<string, M2PlayerWeaponConfig> = {};
  for (const [weaponId, weapon] of Object.entries(
    config.weapons.player,
  )) {
    if (!('fireRate' in weapon)) {
      continue;
    }
    weapons[weaponId] = findPlayerWeaponConfig(config, weaponId);
  }
  return weapons;
}

function createMachineGunConfig(
  config: ProjectConfig,
): MachineGunConfig {
  const entries = Object.entries(config.weapons.emplacement);
  const entry = entries[0];
  if (!entry) {
    throw new Error('至少需要配置一种阵地重机枪');
  }
  if (entries.length !== 1) {
    throw new Error('M3 当前只支持一种阵地重机枪配置');
  }
  const [weaponId, weapon] = entry;
  if (
    weapon.nestCount !== config.gameplay.arena.elements.mgNests
  ) {
    throw new Error('重机枪武器配置与场景枪位数量不一致');
  }
  return {
    weaponId,
    damage: weapon.damage,
    fireRate: weapon.fireRate,
    beltCapacity: weapon.beltCapacity,
    overheatSec: weapon.overheatSec,
    cooldownSec: weapon.cooldownSec,
    reloadSec: weapon.reloadSec,
    yawLimitDeg: weapon.yawLimitDeg,
    pitchMinDeg: weapon.pitchMinDeg,
    pitchMaxDeg: weapon.pitchMaxDeg,
    hitboxMultiplier: weapon.hitboxMultiplier,
    lockMovement: weapon.lockMovement,
    allyBotCanUse: weapon.allyBotCanUse,
    nestCount: weapon.nestCount,
  };
}
