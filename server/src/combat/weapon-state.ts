export interface WeaponRuntimeConfig {
  readonly fireRate: number;
  readonly magazine: number;
  readonly reserveAmmo: number;
  readonly reloadSec: number;
}

export interface WeaponRuntimeState {
  readonly magazineAmmo: number;
  readonly reserveAmmo: number;
  readonly lastFireAtMs?: number;
  readonly reloadEndsAtMs?: number;
}

export type FireStateResult =
  | {
      readonly accepted: true;
      readonly state: WeaponRuntimeState;
    }
  | {
      readonly accepted: false;
      readonly reason: 'cooldown' | 'empty_magazine' | 'reloading';
      readonly state: WeaponRuntimeState;
    };

export function createWeaponState(
  config: WeaponRuntimeConfig,
): WeaponRuntimeState {
  return {
    magazineAmmo: config.magazine,
    reserveAmmo: config.reserveAmmo,
  };
}

export function completeReload(
  state: WeaponRuntimeState,
  config: WeaponRuntimeConfig,
  nowMs: number,
): WeaponRuntimeState {
  if (state.reloadEndsAtMs === undefined || nowMs < state.reloadEndsAtMs) {
    return state;
  }

  const missingAmmo = config.magazine - state.magazineAmmo;
  const loadedAmmo = Math.min(missingAmmo, state.reserveAmmo);
  const completed: WeaponRuntimeState = {
    magazineAmmo: state.magazineAmmo + loadedAmmo,
    reserveAmmo: state.reserveAmmo - loadedAmmo,
  };

  return state.lastFireAtMs === undefined
    ? completed
    : { ...completed, lastFireAtMs: state.lastFireAtMs };
}

export function tryFire(
  state: WeaponRuntimeState,
  config: WeaponRuntimeConfig,
  nowMs: number,
): FireStateResult {
  const current = completeReload(state, config, nowMs);
  if (
    current.reloadEndsAtMs !== undefined &&
    nowMs < current.reloadEndsAtMs
  ) {
    return { accepted: false, reason: 'reloading', state: current };
  }

  const fireIntervalMs = 1000 / config.fireRate;
  if (
    current.lastFireAtMs !== undefined &&
    nowMs - current.lastFireAtMs < fireIntervalMs
  ) {
    return { accepted: false, reason: 'cooldown', state: current };
  }

  if (current.magazineAmmo === 0) {
    return { accepted: false, reason: 'empty_magazine', state: current };
  }

  return {
    accepted: true,
    state: {
      magazineAmmo: current.magazineAmmo - 1,
      reserveAmmo: current.reserveAmmo,
      lastFireAtMs: nowMs,
    },
  };
}

export function startReload(
  state: WeaponRuntimeState,
  config: WeaponRuntimeConfig,
  nowMs: number,
): WeaponRuntimeState {
  const current = completeReload(state, config, nowMs);
  if (
    current.reloadEndsAtMs !== undefined ||
    current.magazineAmmo >= config.magazine ||
    current.reserveAmmo === 0
  ) {
    return current;
  }

  return {
    ...current,
    reloadEndsAtMs: nowMs + config.reloadSec * 1000,
  };
}
