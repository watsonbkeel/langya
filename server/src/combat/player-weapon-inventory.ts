import type {
  ActionRejectReason,
  WeaponState,
} from '../../../shared/protocol';
import {
  completeReload,
  createWeaponState,
  startReload,
  tryFire,
  type FireStateResult,
  type WeaponRuntimeConfig,
  type WeaponRuntimeState,
} from './weapon-state';

export interface InventoryWeaponConfig extends WeaponRuntimeConfig {
  readonly weaponId: string;
}

export class PlayerWeaponInventory<
  TConfig extends InventoryWeaponConfig = InventoryWeaponConfig,
> {
  private readonly configs: Readonly<
    Record<string, TConfig>
  >;
  private readonly states = new Map<string, WeaponRuntimeState>();
  private readonly availableIds = new Set<string>();
  private equippedId: string;

  constructor(
    configs: Readonly<Record<string, TConfig>>,
    initialWeaponId: string,
  ) {
    const initialConfig = configs[initialWeaponId];
    if (!initialConfig) {
      throw new Error(`初始武器 "${initialWeaponId}" 不存在`);
    }
    this.configs = configs;
    this.equippedId = initialWeaponId;
    this.availableIds.add(initialWeaponId);
    this.states.set(initialWeaponId, createWeaponState(initialConfig));
  }

  get currentWeaponId(): string {
    return this.equippedId;
  }

  get availableWeaponIds(): readonly string[] {
    return [...this.availableIds];
  }

  get currentConfig(): TConfig {
    return this.requireConfig(this.equippedId);
  }

  get currentState(): WeaponRuntimeState {
    return this.requireState(this.equippedId);
  }

  pickup(weaponId: string): ActionRejectReason | undefined {
    const config = this.configs[weaponId];
    if (!config) {
      return 'invalid_target';
    }
    if (this.availableIds.has(weaponId)) {
      return 'unavailable';
    }
    this.availableIds.add(weaponId);
    this.states.set(weaponId, createWeaponState(config));
    return undefined;
  }

  switchTo(weaponId: string): ActionRejectReason | undefined {
    if (!this.configs[weaponId]) {
      return 'invalid_target';
    }
    if (!this.availableIds.has(weaponId)) {
      return 'unavailable';
    }
    this.equippedId = weaponId;
    return undefined;
  }

  fire(weaponId: string, nowMs: number): FireStateResult {
    const config = this.requireConfig(this.equippedId);
    const state = this.requireState(this.equippedId);
    if (weaponId !== this.equippedId) {
      return {
        accepted: false,
        reason: 'cooldown',
        state,
      };
    }
    const result = tryFire(state, config, nowMs);
    this.states.set(this.equippedId, result.state);
    return result;
  }

  reload(weaponId: string, nowMs: number): boolean {
    if (weaponId !== this.equippedId) {
      return false;
    }
    const config = this.requireConfig(this.equippedId);
    const state = this.requireState(this.equippedId);
    this.states.set(
      this.equippedId,
      startReload(state, config, nowMs),
    );
    return true;
  }

  update(nowMs: number): void {
    for (const weaponId of this.availableIds) {
      const config = this.requireConfig(weaponId);
      const state = this.requireState(weaponId);
      this.states.set(
        weaponId,
        completeReload(state, config, nowMs),
      );
    }
  }

  resupplyCurrent(): boolean {
    const config = this.currentConfig;
    const state = this.currentState;
    if (state.reserveAmmo >= config.reserveAmmo) {
      return false;
    }
    this.states.set(this.equippedId, {
      ...state,
      reserveAmmo: config.reserveAmmo,
    });
    return true;
  }

  toProtocolState(): WeaponState {
    const state = this.currentState;
    const common = {
      weaponId: this.equippedId,
      magazineAmmo: state.magazineAmmo,
      reserveAmmo: state.reserveAmmo,
      isReloading: state.reloadEndsAtMs !== undefined,
    };
    return state.reloadEndsAtMs === undefined
      ? common
      : { ...common, reloadEndsAtMs: state.reloadEndsAtMs };
  }

  private requireConfig(weaponId: string): TConfig {
    const config = this.configs[weaponId];
    if (!config) {
      throw new Error(`武器配置 "${weaponId}" 不存在`);
    }
    return config;
  }

  private requireState(weaponId: string): WeaponRuntimeState {
    const state = this.states.get(weaponId);
    if (!state) {
      throw new Error(`武器状态 "${weaponId}" 不存在`);
    }
    return state;
  }
}
