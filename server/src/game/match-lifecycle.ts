import type {
  MatchEndReason,
  MatchResult,
} from '../../../shared/protocol';

export interface MatchEndState {
  readonly result: MatchResult;
  readonly reason: MatchEndReason;
}

export interface MatchEndInput {
  readonly elapsedSec: number;
  readonly durationSec: number;
  readonly allowOvertimeSpawn: boolean;
  readonly pendingEnemyCount: number;
  readonly playerAlive: boolean;
  readonly aliveDefenderCount: number;
}

export function determineMatchEnd(
  input: MatchEndInput,
): MatchEndState | undefined {
  if (input.aliveDefenderCount === 0) {
    return {
      result: 'defeat',
      reason: 'squad_eliminated',
    };
  }
  if (input.elapsedSec < input.durationSec) {
    return undefined;
  }
  if (input.allowOvertimeSpawn && input.pendingEnemyCount > 0) {
    return undefined;
  }
  return input.playerAlive
    ? {
        result: 'victory',
        reason: 'time_survived',
      }
    : {
        result: 'defeat',
        reason: 'player_died',
      };
}
