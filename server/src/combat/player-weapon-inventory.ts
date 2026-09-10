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
  /** 开局默认装备：第一项为主武器，其余为随身副武器。复活时按这个名单重置。 */
  private readonly loadoutIds: readonly string[];
  private equippedId: string;

  constructor(
    configs: Readonly<Record<string, TConfig>>,
    initialWeaponId: string,
    extraWeaponIds: readonly string[] = [],
  ) {
    if (!configs[initialWeaponId]) {
      throw new Error(`初始武器 "${initialWeaponId}" 不存在`);
    }
    for (const weaponId of extraWeaponIds) {
      if (!configs[weaponId]) {
        throw new Error(`默认副武器 "${weaponId}" 不存在`);
      }
    }
    this.configs = configs;
    this.loadoutIds = [
      initialWeaponId,
      ...extraWeaponIds.filter((id) => id !== initialWeaponId),
    ];
    this.equippedId = initialWeaponId;
    this.reset();
  }

  /**
   * 回到开局装备：丢掉战中捡的枪，默认武器弹药全部装满，切回主武器。
   * 复活时调用（PRD：“点一下就立即满血复活，装备重置”）。
   */
  reset(): void {
    this.states.clear();
    this.availableIds.clear();
    for (const weaponId of this.loadoutIds) {
      this.availableIds.add(weaponId);
      this.states.set(
        weaponId,
        createWeaponState(this.requireConfig(weaponId)),
      );
    }
    this.equippedId = this.loadoutIds[0]!;
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
