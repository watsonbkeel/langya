import type { ProjectConfig } from '../config/project-config';
import { SeededRandom } from '../ai/seeded-random';
import { createRouteLayouts } from '../ai/route-layout';
import {
  createM2BattleRuntime,
} from '../game/m2-battle-factory';
import { findPlayerWeaponConfig } from '../game/m1-battle-factory';
import { createEnemySpawnPlan } from '../wave/enemy-spawn-plan';

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
    config.waves,
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
  let moveDirection = 1;
  const routes = createRouteLayouts(
    config.waves.routes,
    config.gameplay.arena,
  );
  const primaryRoute = routes.reduce((selected, route) =>
    config.waves.routes[route.routeId].enemyRatio >
    config.waves.routes[selected.routeId].enemyRatio
      ? route
      : selected,
  );
  const routeHalfWidth =
    config.gameplay.arena.widthM / routes.length / 2;
  const routeMinX = primaryRoute.guardPosition.x - routeHalfWidth;
  const routeMaxX = primaryRoute.guardPosition.x + routeHalfWidth;

  battle.applyInput({
    type: 'input_state',
    payload: {
      clientTick,
      moveDir: { x: moveDirection, y: 0 },
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

    const playerX = battle.playerPosition.x;
    if (
      (moveDirection > 0 && playerX >= routeMaxX) ||
      (moveDirection < 0 && playerX <= routeMinX)
    ) {
      moveDirection *= -1;
      battle.applyInput({
        type: 'input_state',
        payload: {
          clientTick,
          moveDir: { x: moveDirection, y: 0 },
          aimYaw: 0,
          aimPitch: 0,
          isCrouch: true,
        },
      });
      clientTick += 1;
    }

    battle.update(tickDurationSec, tick, nowMs);
    maxAliveEnemies = Math.max(maxAliveEnemies, battle.aliveEnemyCount);
    battle.resupplyPlayerAmmo(nowMs);
    battle.usePlayerMedkit();

    if (
      battle.playerHp <= 0 ||
      nowMs < nextPlayerFireAtMs
    ) {
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
