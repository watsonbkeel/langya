import type {
  ActionRejectReason,
  FireRejectReason,
  MachineGunState,
  Vector3,
} from '../../../shared/protocol';

const MILLISECONDS_PER_SECOND = 1000;
const DEGREES_PER_HALF_TURN = 180;
const DEGREES_PER_TURN = 360;

export interface MachineGunConfig {
  readonly weaponId: string;
  readonly damage: number;
  readonly fireRate: number;
  readonly beltCapacity: number;
  readonly overheatSec: number;
  readonly cooldownSec: number;
  readonly reloadSec: number;
  readonly yawLimitDeg: number;
  readonly pitchMinDeg: number;
  readonly pitchMaxDeg: number;
  readonly hitboxMultiplier: number;
  readonly lockMovement: boolean;
  readonly allyBotCanUse: boolean;
  readonly nestCount: number;
}

export interface MachineGunPlacement {
  readonly id: string;
  readonly position: Vector3;
  readonly baseYaw: number;
}

export type MachineGunFireResult =
  | {
      readonly accepted: true;
      readonly beltAmmo: number;
    }
  | {
      readonly accepted: false;
      readonly reason: FireRejectReason;
      readonly beltAmmo: number;
    };

interface MutableMachineGun {
  readonly id: string;
  readonly position: Vector3;
  readonly baseYaw: number;
  occupantId: string | undefined;
  beltAmmo: number;
  heatRatio: number;
  isOverheated: boolean;
  cooldownEndsAtMs: number | undefined;
  reloadEndsAtMs: number | undefined;
  lastFireAtMs: number | undefined;
  heatUpdatedAtMs: number | undefined;
}

export class MachineGunController {
  private readonly guns: MutableMachineGun[];

  constructor(
    private readonly config: MachineGunConfig,
    placements: readonly MachineGunPlacement[],
  ) {
    if (placements.length !== config.nestCount) {
      throw new Error('重机枪位数量与配置不一致');
    }
    this.guns = placements.map((placement) => ({
      ...placement,
      occupantId: undefined,
      beltAmmo: config.beltCapacity,
      heatRatio: 0,
      isOverheated: false,
      cooldownEndsAtMs: undefined,
      reloadEndsAtMs: undefined,
      lastFireAtMs: undefined,
      heatUpdatedAtMs: undefined,
    }));
  }

  get weaponId(): string {
    return this.config.weaponId;
  }

  get locksMovement(): boolean {
    return this.config.lockMovement;
  }

  get hitboxMultiplier(): number {
    return this.config.hitboxMultiplier;
  }

  update(nowMs: number): void {
    for (const gun of this.guns) {
      this.updateGun(gun, nowMs);
    }
  }

  mount(
    mgId: string,
    occupantId: string,
    occupantIsBot: boolean,
    playerPosition: Vector3,
    mountRangeM: number,
  ): ActionRejectReason | undefined {
    if (occupantIsBot && !this.config.allyBotCanUse) {
      return 'invalid_state';
    }
    if (this.findMountedBy(occupantId)) {
      return 'invalid_state';
    }
    const gun = this.guns.find((candidate) => candidate.id === mgId);
    if (!gun) {
      return 'invalid_target';
    }
    if (gun.occupantId !== undefined) {
      return 'occupied';
    }
    if (distanceBetween(playerPosition, gun.position) > mountRangeM) {
      return 'out_of_range';
    }
    gun.occupantId = occupantId;
    return undefined;
  }

  unmount(occupantId: string): ActionRejectReason | undefined {
    const gun = this.findMountedBy(occupantId);
    if (!gun) {
      return 'invalid_state';
    }
    gun.occupantId = undefined;
    return undefined;
  }

  fire(
    occupantId: string,
    weaponId: string,
    aimYaw: number,
    aimPitch: number,
    nowMs: number,
  ): MachineGunFireResult {
    const gun = this.findMountedBy(occupantId);
    if (!gun || weaponId !== this.config.weaponId) {
      return {
        accepted: false,
        reason: 'invalid_weapon',
        beltAmmo: gun?.beltAmmo ?? 0,
      };
    }
    this.updateGun(gun, nowMs);
    if (
      Math.abs(shortestAngleDelta(gun.baseYaw, aimYaw)) >
        this.config.yawLimitDeg ||
      aimPitch < this.config.pitchMinDeg ||
      aimPitch > this.config.pitchMaxDeg
    ) {
      return {
        accepted: false,
        reason: 'invalid_direction',
        beltAmmo: gun.beltAmmo,
      };
    }
    if (gun.isOverheated) {
      return {
        accepted: false,
        reason: 'cooldown',
        beltAmmo: gun.beltAmmo,
      };
    }
    if (gun.reloadEndsAtMs !== undefined) {
      return {
        accepted: false,
        reason: 'reloading',
        beltAmmo: gun.beltAmmo,
      };
    }
    const fireIntervalMs =
      MILLISECONDS_PER_SECOND / this.config.fireRate;
    if (
      gun.lastFireAtMs !== undefined &&
      nowMs - gun.lastFireAtMs < fireIntervalMs
    ) {
      return {
        accepted: false,
        reason: 'cooldown',
        beltAmmo: gun.beltAmmo,
      };
    }
    if (gun.beltAmmo === 0) {
      return {
        accepted: false,
        reason: 'empty_magazine',
        beltAmmo: gun.beltAmmo,
      };
    }

    gun.beltAmmo -= 1;
    gun.lastFireAtMs = nowMs;
    gun.heatUpdatedAtMs = nowMs;
    gun.heatRatio = Math.min(
      1,
      gun.heatRatio +
        1 / (this.config.fireRate * this.config.overheatSec),
    );
    if (gun.heatRatio >= 1) {
      gun.isOverheated = true;
      gun.cooldownEndsAtMs =
        nowMs + this.config.cooldownSec * MILLISECONDS_PER_SECOND;
    }
    if (gun.beltAmmo === 0) {
      gun.reloadEndsAtMs =
        nowMs + this.config.reloadSec * MILLISECONDS_PER_SECOND;
    }
    return {
      accepted: true,
      beltAmmo: gun.beltAmmo,
    };
  }

  getMounted(occupantId: string): MachineGunState | undefined {
    const gun = this.findMountedBy(occupantId);
    return gun ? toState(gun, this.config.weaponId) : undefined;
  }

  getStates(): readonly MachineGunState[] {
    return this.guns.map((gun) => toState(gun, this.config.weaponId));
  }

  private findMountedBy(
    occupantId: string,
  ): MutableMachineGun | undefined {
    return this.guns.find((gun) => gun.occupantId === occupantId);
  }

  private updateGun(gun: MutableMachineGun, nowMs: number): void {
    if (
      gun.cooldownEndsAtMs !== undefined &&
      nowMs >= gun.cooldownEndsAtMs
    ) {
      gun.heatRatio = 0;
      gun.isOverheated = false;
      gun.cooldownEndsAtMs = undefined;
      gun.heatUpdatedAtMs = nowMs;
    }
    if (
      !gun.isOverheated &&
      gun.lastFireAtMs !== undefined &&
      gun.heatRatio > 0
    ) {
      const fireIntervalMs =
        MILLISECONDS_PER_SECOND / this.config.fireRate;
      const coolingStartsAtMs = gun.lastFireAtMs + fireIntervalMs;
      const coolingFromMs = Math.max(
        coolingStartsAtMs,
        gun.heatUpdatedAtMs ?? coolingStartsAtMs,
      );
      if (nowMs > coolingFromMs) {
        gun.heatRatio = Math.max(
          0,
          gun.heatRatio -
            (nowMs - coolingFromMs) /
              (this.config.cooldownSec * MILLISECONDS_PER_SECOND),
        );
      }
      gun.heatUpdatedAtMs = nowMs;
    }
    if (
      gun.reloadEndsAtMs !== undefined &&
      nowMs >= gun.reloadEndsAtMs
    ) {
      gun.beltAmmo = this.config.beltCapacity;
      gun.reloadEndsAtMs = undefined;
    }
  }
}

function toState(
  gun: MutableMachineGun,
  weaponId: string,
): MachineGunState {
  return {
    id: gun.id,
    weaponId,
    position: gun.position,
    baseYaw: gun.baseYaw,
    ...(gun.occupantId === undefined
      ? {}
      : { occupantId: gun.occupantId }),
    beltAmmo: gun.beltAmmo,
    heatRatio: gun.heatRatio,
    isOverheated: gun.isOverheated,
    ...(gun.cooldownEndsAtMs === undefined
      ? {}
      : { cooldownEndsAtMs: gun.cooldownEndsAtMs }),
    ...(gun.reloadEndsAtMs === undefined
      ? {}
      : { reloadEndsAtMs: gun.reloadEndsAtMs }),
  };
}

function shortestAngleDelta(baseYaw: number, aimYaw: number): number {
  return (
    ((aimYaw - baseYaw + DEGREES_PER_HALF_TURN) %
      DEGREES_PER_TURN +
      DEGREES_PER_TURN) %
      DEGREES_PER_TURN -
    DEGREES_PER_HALF_TURN
  );
}

function distanceBetween(first: Vector3, second: Vector3): number {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    first.z - second.z,
  );
}
