import type { ProjectConfig } from '../config/project-config';
import { MatchReportRepository } from '../db/match-report-repository';
import {
  determineMatchEnd,
  type MatchEndState,
} from '../game/match-lifecycle';
import {
  createM3BattleRuntime,
} from '../game/m2-battle-factory';
import { findPlayerWeaponConfig } from '../game/m1-battle-factory';

export interface M3MatchVerificationResult {
  readonly seed: number;
  readonly outcome: MatchEndState;
  readonly simulatedSec: number;
  readonly ticks: number;
  readonly spawnedEnemies: number;
  readonly defeatedEnemies: number;
  readonly pendingEnemies: number;
  readonly maxAliveEnemies: number;
  readonly waveStarts: number;
  readonly supplyDrops: number;
  readonly scoreboardEntries: number;
  readonly mvpPlayerId?: string;
  readonly reportPersisted: boolean;
  readonly cpuMs: number;
  readonly cpuPercentSingleCore: number;
  readonly wallMs: number;
  readonly pass: boolean;
}

export function verifyM3Match(
  config: ProjectConfig,
  seed: number,
): M3MatchVerificationResult {
  const playerId = `m3-verifier-player-${seed}`;
  const { battle, waveScheduler, tickRateHz } =
    createM3BattleRuntime(
      config,
      playerId,
      'M3 验收玩家',
      seed,
    );
  const tickDurationSec = 1 / tickRateHz;
  const tickDurationMs = tickDurationSec * 1000;
  const maxSimulatedSec =
    config.gameplay.match.durationSec + config.waves.totalEnemies;
  const maxTicks = maxSimulatedSec * tickRateHz;
  const playerWeapon = findPlayerWeaponConfig(
    config,
    config.gameplay.player.defaultLoadout.primary,
  );
  const playerFireIntervalMs = 1000 / playerWeapon.fireRate;
  const routeMinX = -(config.gameplay.arena.widthM / 2);
  const routeMaxX = config.gameplay.arena.widthM / 2;

  let nextPlayerFireAtMs =
    config.gameplay.match.deployPhaseSec * 1000;
  let clientTick = 0;
  let moveDirection = 1;
  let maxAliveEnemies = 0;
  let waveStarts = 0;
  let supplyDrops = 0;
  let outcome: MatchEndState | undefined;
  let finalTick = 0;
  let finalNowMs = 0;

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

  for (let tick = 0; tick < maxTicks; tick += 1) {
    const nowMs = (tick + 1) * tickDurationMs;
    const waveUpdate = waveScheduler.update(
      nowMs,
      battle.aliveEnemyCount,
    );
    waveStarts += waveUpdate.waveStarts.length;
    for (const planned of waveUpdate.enemiesToSpawn) {
      battle.spawnEnemy(
        planned.enemyType,
        planned.routeId,
        planned.accuracy,
        nowMs,
      );
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

    const events = battle.update(tickDurationSec, tick, nowMs);
    supplyDrops += events.filter(
      (event) => event.type === 'supply_drop',
    ).length;
    maxAliveEnemies = Math.max(
      maxAliveEnemies,
      battle.aliveEnemyCount,
    );
    battle.resupplyPlayerAmmo(nowMs);
    battle.usePlayerMedkit();

    if (
      battle.playerAlive &&
      nowMs >= nextPlayerFireAtMs
    ) {
      const weapon = battle.playerWeaponState;
      if (weapon.magazineAmmo === 0) {
        battle.reload(
          {
            type: 'reload',
            payload: { weaponId: weapon.weaponId },
          },
          nowMs,
        );
      } else if (!weapon.isReloading) {
        const targetId = battle.findNearestAliveEnemyId();
        const fireMessage =
          targetId === undefined
            ? undefined
            : battle.createFireMessageForEnemy(
                targetId,
                clientTick,
                'head',
              );
        if (fireMessage) {
          clientTick += 1;
          const resolution = battle.fire(fireMessage, nowMs);
          if (resolution.result.payload.accepted) {
            nextPlayerFireAtMs = nowMs + playerFireIntervalMs;
          }
        }
      }
    }

    const progress = waveScheduler.getProgress(nowMs);
    outcome = determineMatchEnd({
      elapsedSec: nowMs / 1000,
      durationSec: config.gameplay.match.durationSec,
      allowOvertimeSpawn:
        config.gameplay.match.allowOvertimeSpawn,
      pendingEnemyCount: progress.pendingEnemies,
      playerAlive: battle.playerAlive,
      aliveDefenderCount: battle.aliveDefenderCount,
    });
    finalTick = tick + 1;
    finalNowMs = nowMs;
    if (outcome) {
      break;
    }
  }

  const cpuUsage = process.cpuUsage(cpuStartedAt);
  const cpuMs = (cpuUsage.user + cpuUsage.system) / 1000;
  const wallMs = performance.now() - wallStartedAt;
  if (!outcome) {
    throw new Error(
      `M3 验收在 ${maxSimulatedSec} 秒模拟上限内未结算`,
    );
  }

  battle.endMatch();
  const progress = waveScheduler.getProgress(finalNowMs);
  const defeatedEnemies =
    battle.totalEnemyCount - battle.aliveEnemyCount;
  const scoreboard = battle.createScoreboard(finalNowMs / 1000);
  const mvpPlayerId = battle.selectMvpPlayerId(finalNowMs / 1000);
  const repository = new MatchReportRepository(':memory:');
  const report = {
    matchId: battle.room.id,
    result: outcome.result,
    reason: outcome.reason,
    startedAtMs: 0,
    endedAtMs: finalNowMs,
    scoreboard,
    ...(mvpPlayerId === undefined ? {} : { mvpPlayerId }),
    spawnedEnemies: progress.spawnedEnemies,
    defeatedEnemies,
    totalEnemies: progress.totalEnemies,
  };
  repository.save(report);
  const persisted = repository.find(report.matchId);
  repository.close();

  const simulatedSec = finalNowMs / 1000;
  const cpuPercentSingleCore =
    (cpuMs / (simulatedSec * 1000)) * 100;
  const reportPersisted =
    persisted !== undefined &&
    persisted.scoreboard.length === config.allies.seatCount &&
    persisted.spawnedEnemies === config.waves.totalEnemies;
  const pass =
    outcome.result === 'victory' &&
    outcome.reason === 'time_survived' &&
    progress.spawnedEnemies === config.waves.totalEnemies &&
    progress.pendingEnemies === 0 &&
    maxAliveEnemies <= config.waves.maxAliveEnemies &&
    waveStarts === config.waves.waves.length &&
    reportPersisted &&
    cpuPercentSingleCore <
      config.gameplay.server.maxSingleMatchCpuPercent;

  return {
    seed,
    outcome,
    simulatedSec,
    ticks: finalTick,
    spawnedEnemies: progress.spawnedEnemies,
    defeatedEnemies,
    pendingEnemies: progress.pendingEnemies,
    maxAliveEnemies,
    waveStarts,
    supplyDrops,
    scoreboardEntries: scoreboard.length,
    ...(mvpPlayerId === undefined ? {} : { mvpPlayerId }),
    reportPersisted,
    cpuMs,
    cpuPercentSingleCore,
    wallMs,
    pass,
  };
}
