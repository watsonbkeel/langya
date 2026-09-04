import {
  SERVER_MESSAGE_TYPES,
  type AllyState,
  type EnemyDiedMessage,
  type EnemyState,
  type FireMessage,
  type FireRejectReason,
  type FireResultMessage,
  type InputStateMessage,
  type ReloadMessage,
  type RouteId,
  type Vector3,
  type WeaponState,
  type WorldSnapshotMessage,
} from '../../../shared/protocol';
import {
  calculateDamage,
  type WeaponDamageConfig,
} from '../combat/damage';
import {
  raycastNearestEnemy,
  type EnemyHitboxConfig,
  type RaycastEnemy,
} from '../combat/raycast';
import {
  completeReload,
  createWeaponState,
  startReload,
  tryFire,
  type WeaponRuntimeConfig,
  type WeaponRuntimeState,
} from '../combat/weapon-state';

export interface BattlePlayerConfig {
  readonly maxHp: number;
  readonly moveSpeed: number;
  readonly crouchSpeed: number;
  readonly aimPitchMinDeg: number;
  readonly aimPitchMaxDeg: number;
}

export interface BattleArenaConfig {
  readonly widthM: number;
  readonly depthM: number;
}

export interface BattleValidationConfig {
  readonly fireOriginToleranceM: number;
  readonly directionMagnitudeTolerance: number;
}

export interface BattleWeaponConfig
  extends WeaponRuntimeConfig,
    Omit<WeaponDamageConfig, 'hitPartMultiplier'> {
  readonly weaponId: string;
}

export interface BattleSessionConfig {
  readonly player: BattlePlayerConfig;
  readonly arena: BattleArenaConfig;
  readonly validation: BattleValidationConfig;
  readonly weapon: BattleWeaponConfig;
  readonly hitPartMultiplier: WeaponDamageConfig['hitPartMultiplier'];
  readonly enemyHitbox: EnemyHitboxConfig;
}

export interface BattleEnemySeed {
  readonly id: string;
  readonly enemyType: string;
  readonly routeId: RouteId;
  readonly hp: number;
  readonly position: Vector3;
}

export interface BattleSessionOptions {
  readonly playerId: string;
  readonly playerHeroName: string;
  readonly playerRouteId: RouteId;
  readonly playerPosition: Vector3;
  readonly enemy: BattleEnemySeed;
  readonly config: BattleSessionConfig;
}

interface MutablePlayer {
  readonly id: string;
  readonly heroName: string;
  readonly routeId: RouteId;
  readonly hp: number;
  position: Vector3;
  aimYaw: number;
  aimPitch: number;
  isCrouch: boolean;
  moveDirX: number;
  moveDirY: number;
  weapon: WeaponRuntimeState;
}

interface MutableEnemy {
  readonly id: string;
  readonly enemyType: string;
  readonly routeId: RouteId;
  readonly maxHp: number;
  readonly position: Vector3;
  hp: number;
}

export interface FireResolution {
  readonly result: FireResultMessage;
  readonly death?: EnemyDiedMessage;
}

function distanceBetween(first: Vector3, second: Vector3): number {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    first.z - second.z,
  );
}

function directionMagnitude(direction: Vector3): number {
  return Math.hypot(direction.x, direction.y, direction.z);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export class BattleSession {
  private readonly config: BattleSessionConfig;
  private readonly player: MutablePlayer;
  private readonly enemies = new Map<string, MutableEnemy>();

  constructor(options: BattleSessionOptions) {
    this.config = options.config;
    this.player = {
      id: options.playerId,
      heroName: options.playerHeroName,
      routeId: options.playerRouteId,
      hp: options.config.player.maxHp,
      position: options.playerPosition,
      aimYaw: 0,
      aimPitch: 0,
      isCrouch: false,
      moveDirX: 0,
      moveDirY: 0,
      weapon: createWeaponState(options.config.weapon),
    };
    this.enemies.set(options.enemy.id, {
      ...options.enemy,
      maxHp: options.enemy.hp,
    });
  }

  applyInput(message: InputStateMessage): boolean {
    const { payload } = message;
    if (
      payload.aimPitch < this.config.player.aimPitchMinDeg ||
      payload.aimPitch > this.config.player.aimPitchMaxDeg
    ) {
      return false;
    }

    const moveLength = Math.hypot(payload.moveDir.x, payload.moveDir.y);
    const moveScale = moveLength > 1 ? 1 / moveLength : 1;
    this.player.moveDirX = payload.moveDir.x * moveScale;
    this.player.moveDirY = payload.moveDir.y * moveScale;
    this.player.aimYaw = payload.aimYaw;
    this.player.aimPitch = payload.aimPitch;
    this.player.isCrouch = payload.isCrouch;
    return true;
  }

  update(deltaSec: number, nowMs: number): void {
    this.player.weapon = completeReload(
      this.player.weapon,
      this.config.weapon,
      nowMs,
    );

    const yawRad = (this.player.aimYaw * Math.PI) / 180;
    const speed = this.player.isCrouch
      ? this.config.player.crouchSpeed
      : this.config.player.moveSpeed;
    const rightX = Math.cos(yawRad);
    const rightZ = -Math.sin(yawRad);
    const forwardX = -Math.sin(yawRad);
    const forwardZ = -Math.cos(yawRad);
    const deltaX =
      (rightX * this.player.moveDirX +
        forwardX * this.player.moveDirY) *
      speed *
      deltaSec;
    const deltaZ =
      (rightZ * this.player.moveDirX +
        forwardZ * this.player.moveDirY) *
      speed *
      deltaSec;
    const halfWidth = this.config.arena.widthM / 2;
    const halfDepth = this.config.arena.depthM / 2;

    this.player.position = {
      x: clamp(this.player.position.x + deltaX, -halfWidth, halfWidth),
      y: this.player.position.y,
      z: clamp(this.player.position.z + deltaZ, -halfDepth, halfDepth),
    };
  }

  reload(message: ReloadMessage, nowMs: number): void {
    if (message.payload.weaponId !== this.config.weapon.weaponId) {
      return;
    }

    this.player.weapon = startReload(
      this.player.weapon,
      this.config.weapon,
      nowMs,
    );
  }

  fire(message: FireMessage, nowMs: number): FireResolution {
    const { payload } = message;
    if (payload.weaponId !== this.config.weapon.weaponId) {
      return this.rejectFire(message, 'invalid_weapon');
    }
    if (
      distanceBetween(payload.originPos, this.player.position) >
      this.config.validation.fireOriginToleranceM
    ) {
      return this.rejectFire(message, 'invalid_origin');
    }

    const magnitude = directionMagnitude(payload.dirVec);
    if (
      !Number.isFinite(magnitude) ||
      Math.abs(magnitude - 1) >
        this.config.validation.directionMagnitudeTolerance
    ) {
      return this.rejectFire(message, 'invalid_direction');
    }

    const fireState = tryFire(
      this.player.weapon,
      this.config.weapon,
      nowMs,
    );
    this.player.weapon = fireState.state;
    if (!fireState.accepted) {
      return this.rejectFire(message, fireState.reason);
    }

    const enemies: RaycastEnemy[] = [];
    for (const enemy of this.enemies.values()) {
      enemies.push({
        id: enemy.id,
        position: enemy.position,
        alive: enemy.hp > 0,
      });
    }
    const hit = raycastNearestEnemy(
      payload.originPos,
      payload.dirVec,
      enemies,
      this.config.enemyHitbox,
    );
    if (!hit) {
      return {
        result: {
          type: SERVER_MESSAGE_TYPES.fireResult,
          payload: {
            clientTick: payload.clientTick,
            weaponId: payload.weaponId,
            accepted: true,
            hit: false,
            damage: 0,
            isKill: false,
            ...this.getAmmoState(),
          },
        },
      };
    }

    const enemy = this.enemies.get(hit.targetId);
    if (!enemy) {
      return {
        result: {
          type: SERVER_MESSAGE_TYPES.fireResult,
          payload: {
            clientTick: payload.clientTick,
            weaponId: payload.weaponId,
            accepted: true,
            hit: false,
            damage: 0,
            isKill: false,
            ...this.getAmmoState(),
          },
        },
      };
    }

    const damage = calculateDamage(
      {
        ...this.config.weapon,
        hitPartMultiplier: this.config.hitPartMultiplier,
      },
      hit.distanceM,
      hit.hitPart,
    ).damage;
    enemy.hp = Math.max(0, enemy.hp - damage);
    const isKill = enemy.hp === 0;
    if (isKill) {
      this.enemies.delete(enemy.id);
    }

    return {
      result: {
        type: SERVER_MESSAGE_TYPES.fireResult,
        payload: {
          clientTick: payload.clientTick,
          weaponId: payload.weaponId,
          accepted: true,
          hit: true,
          targetId: enemy.id,
          damage,
          isKill,
          hitPart: hit.hitPart,
          ...this.getAmmoState(),
        },
      },
      ...(isKill
        ? {
            death: {
              type: SERVER_MESSAGE_TYPES.enemyDied,
              payload: {
                enemyId: enemy.id,
                killerId: this.player.id,
                killerIsBot: false,
              },
            },
          }
        : {}),
    };
  }

  createSnapshot(tick: number, serverTimeMs: number): WorldSnapshotMessage {
    const ally: AllyState = {
      id: this.player.id,
      isBot: false,
      seatIndex: 0,
      heroName: this.player.heroName,
      routeId: this.player.routeId,
      hp: this.player.hp,
      maxHp: this.config.player.maxHp,
      position: this.player.position,
      aimYaw: this.player.aimYaw,
      aimPitch: this.player.aimPitch,
      isCrouch: this.player.isCrouch,
      weapon: this.getWeaponState(),
    };
    const enemies: EnemyState[] = [];
    for (const enemy of this.enemies.values()) {
      enemies.push({
        id: enemy.id,
        enemyType: enemy.enemyType,
        routeId: enemy.routeId,
        aiState: 'advance',
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        position: enemy.position,
        alive: true,
      });
    }

    return {
      type: SERVER_MESSAGE_TYPES.worldSnapshot,
      payload: {
        tick,
        serverTimeMs,
        allies: [ally],
        enemies,
        items: [],
      },
    };
  }

  rejectFire(
    message: FireMessage,
    rejectReason: FireRejectReason,
  ): FireResolution {
    return {
      result: {
        type: SERVER_MESSAGE_TYPES.fireResult,
        payload: {
          clientTick: message.payload.clientTick,
          weaponId: message.payload.weaponId,
          accepted: false,
          rejectReason,
          hit: false,
          damage: 0,
          isKill: false,
          ...this.getAmmoState(),
        },
      },
    };
  }

  private getAmmoState(): Pick<
    WeaponState,
    'magazineAmmo' | 'reserveAmmo'
  > {
    return {
      magazineAmmo: this.player.weapon.magazineAmmo,
      reserveAmmo: this.player.weapon.reserveAmmo,
    };
  }

  private getWeaponState(): WeaponState {
    const common = {
      weaponId: this.config.weapon.weaponId,
      magazineAmmo: this.player.weapon.magazineAmmo,
      reserveAmmo: this.player.weapon.reserveAmmo,
      isReloading: this.player.weapon.reloadEndsAtMs !== undefined,
    };

    return this.player.weapon.reloadEndsAtMs === undefined
      ? common
      : { ...common, reloadEndsAtMs: this.player.weapon.reloadEndsAtMs };
  }
}
