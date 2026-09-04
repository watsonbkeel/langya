import {
  SERVER_MESSAGE_TYPES,
  type ActionRejectReason,
  type AllyState,
  type EnemyDiedMessage,
  type EnemyState,
  type FireMessage,
  type FireRejectReason,
  type FireResultMessage,
  type InputStateMessage,
  type MatchProgressState,
  type ReloadMessage,
  type RoomStateMessage,
  type RouteId,
  type ScoreboardEntry,
  type Vector3,
  type WeaponState,
  type WorldSnapshotMessage,
} from '../../../shared/protocol';
import {
  AllyAgent,
  AllyController,
  type AllyBotConfig,
  type AllyMedkitConfig,
  type AllyShotIntent,
} from '../ai/ally/ally-controller';
import {
  CalloutController,
  type AllyCallout,
  type CalloutConfig,
} from '../ai/ally/callout-controller';
import {
  AllyDeploymentManager,
  type AllyReassignment,
  type DeploymentConfig,
} from '../ai/ally/deployment-manager';
import {
  EnemyAgent,
  EnemyController,
  type EnemyAiEvent,
  type EnemyBehaviorConfig,
  type EnemySharedAiConfig,
  type EnemyShotIntent,
} from '../ai/enemy/enemy-controller';
import type { RandomSource } from '../ai/seeded-random';
import {
  findNearestRoute,
  type RouteLayout,
} from '../ai/route-layout';
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
import { SoloRoom, type SoloRoomConfig } from '../room/solo-room';
import {
  ScoreTracker,
  type ScoreTrackerConfig,
} from '../score/score-tracker';
import {
  SupplyDropManager,
  type SupplyDropConfig,
  type SupplyDropEvent,
} from '../wave/supply-drop-manager';

export interface M2PlayerConfig {
  readonly maxHp: number;
  readonly moveSpeed: number;
  readonly crouchSpeed: number;
  readonly crouchHitboxMultiplier: number;
  readonly medkitCount: number;
  readonly defaultLoadout: {
    readonly primary: string;
    readonly throwable: string;
    readonly throwableCount: number;
  };
  readonly aimPitchMinDeg: number;
  readonly aimPitchMaxDeg: number;
}

export interface M2ArenaConfig {
  readonly widthM: number;
  readonly depthM: number;
  readonly itemPickupRangeM: number;
}

export interface M2MatchConfig {
  readonly durationSec: number;
  readonly deployPhaseSec: number;
  readonly allowOvertimeSpawn: boolean;
}

export interface M2WaveTimingConfig {
  readonly index: number;
  readonly startSec: number;
}

export interface M2ValidationConfig {
  readonly fireOriginToleranceM: number;
  readonly directionMagnitudeTolerance: number;
}

export interface M2MedkitConfig extends AllyMedkitConfig {
  readonly airdropHeal: number;
}

export interface M2PlayerWeaponConfig
  extends WeaponRuntimeConfig,
    Omit<WeaponDamageConfig, 'hitPartMultiplier'> {
  readonly weaponId: string;
}

export interface M2EnemyWeaponConfig
  extends Omit<WeaponDamageConfig, 'hitPartMultiplier'> {
  readonly fireRate: number;
}

export interface M2EnemyUnitConfig extends EnemyBehaviorConfig {
  readonly hp: number;
  readonly weapon: string;
}

export interface M2BattleConfig<
  TRouteId extends RouteId,
  TEnemyType extends string,
> {
  readonly player: M2PlayerConfig;
  readonly arena: M2ArenaConfig;
  readonly match: M2MatchConfig;
  readonly waves: readonly M2WaveTimingConfig[];
  readonly intermissionSec: number;
  readonly totalEnemies: number;
  readonly validation: M2ValidationConfig;
  readonly playerWeapon: M2PlayerWeaponConfig;
  readonly hitPartMultiplier: WeaponDamageConfig['hitPartMultiplier'];
  readonly enemyHitbox: EnemyHitboxConfig;
  readonly room: SoloRoomConfig<TRouteId>;
  readonly bot: AllyBotConfig;
  readonly deployment: DeploymentConfig;
  readonly callout: CalloutConfig;
  readonly medkit: M2MedkitConfig;
  readonly routes: readonly RouteLayout<TRouteId>[];
  readonly routeNames: Readonly<Record<TRouteId, string>>;
  readonly seatSpacingM: number;
  readonly defenderCoverExposureMultiplier: number;
  readonly aiUpdateGroups: number;
  readonly enemyShared: EnemySharedAiConfig;
  readonly enemySpawnOffsetX: number;
  readonly enemySpawnOffsetZ: number;
  readonly enemyUnits: Readonly<Record<TEnemyType, M2EnemyUnitConfig>>;
  readonly enemyWeapons: Readonly<Record<string, M2EnemyWeaponConfig>>;
  readonly maxAliveEnemies: number;
  readonly ammoBoxCooldownSec: number;
  readonly score: ScoreTrackerConfig;
  readonly airdrop: SupplyDropConfig;
}

export interface M2BattleSessionOptions<
  TRouteId extends RouteId,
  TEnemyType extends string,
> {
  readonly roomId: string;
  readonly playerId: string;
  readonly playerName: string;
  readonly config: M2BattleConfig<TRouteId, TEnemyType>;
  readonly random: RandomSource;
  readonly supplyRandom: RandomSource;
}

interface MutablePlayer {
  readonly id: string;
  readonly name: string;
  readonly maxHp: number;
  hp: number;
  position: Vector3;
  aimYaw: number;
  aimPitch: number;
  isCrouch: boolean;
  moveDirX: number;
  moveDirY: number;
  weapon: WeaponRuntimeState;
  grenadesRemaining: number;
  medkitsRemaining: number;
  medkitEndsAtMs: number | undefined;
}

interface EnemyRuntime<TRouteId extends string, TEnemyType extends string> {
  readonly agent: EnemyAgent<TRouteId>;
  readonly enemyType: TEnemyType;
  readonly maxHp: number;
  readonly accuracy: number;
  readonly weaponId: string;
  hp: number;
}

export type M2BattleEvent<TRouteId extends RouteId> =
  | EnemyAiEvent
  | AllyCallout<TRouteId>
  | SupplyDropEvent
  | {
      readonly type: 'ally_damaged';
      readonly allyId: string;
      readonly hp: number;
      readonly fromDir: Vector3;
    }
  | {
      readonly type: 'ally_died';
      readonly allyId: string;
      readonly isBot: boolean;
      readonly killerType: string;
    }
  | {
      readonly type: 'enemy_died';
      readonly enemyId: string;
      readonly killerId: string;
      readonly killerIsBot: boolean;
    }
  | ({ readonly type: 'ally_reassigned' } & AllyReassignment<TRouteId>);

export interface M2FireResolution {
  readonly result: FireResultMessage;
  readonly death?: EnemyDiedMessage;
}

export class M2BattleSession<
  TRouteId extends RouteId,
  TEnemyType extends string,
> {
  readonly room: SoloRoom<TRouteId>;

  private readonly config: M2BattleConfig<TRouteId, TEnemyType>;
  private readonly random: RandomSource;
  private readonly player: MutablePlayer;
  private readonly allies: AllyAgent<TRouteId>[] = [];
  private readonly enemies: EnemyRuntime<TRouteId, TEnemyType>[] = [];
  private readonly enemyAgents: EnemyAgent<TRouteId>[] = [];
  private readonly allyController: AllyController<TRouteId>;
  private readonly enemyController: EnemyController<TRouteId>;
  private readonly deploymentManager: AllyDeploymentManager<TRouteId>;
  private readonly calloutController: CalloutController<TRouteId>;
  private readonly scoreTracker: ScoreTracker;
  private readonly supplyDropManager: SupplyDropManager;
  private enemySequence = 0;
  private elapsedSec = 0;
  private startedAtMs: number | undefined;
  private lastPlayerResupplyAtMs: number | undefined;

  constructor(options: M2BattleSessionOptions<TRouteId, TEnemyType>) {
    this.config = options.config;
    this.random = options.random;
    this.room = new SoloRoom({
      roomId: options.roomId,
      playerId: options.playerId,
      playerName: options.playerName,
      config: options.config.room,
    });
    const guardPositions = this.createInitialGuardPositions();
    const playerHeightM =
      (options.config.enemyHitbox.torsoStartM +
        options.config.enemyHitbox.headStartM) /
      2;
    const playerSeat = this.room.seats.find(
      (seat) => seat.occupant.id === options.playerId,
    );
    if (!playerSeat) {
      throw new Error('单人房间缺少真人席位');
    }
    const playerPosition = guardPositions.get(playerSeat.index);
    if (!playerPosition) {
      throw new Error('真人席位缺少防守位置');
    }
    this.player = {
      id: options.playerId,
      name: options.playerName,
      maxHp: options.config.player.maxHp,
      hp: options.config.player.maxHp,
      position: {
        ...playerPosition,
        y: playerHeightM,
      },
      aimYaw: 0,
      aimPitch: 0,
      isCrouch: false,
      moveDirX: 0,
      moveDirY: 0,
      weapon: createWeaponState(options.config.playerWeapon),
      grenadesRemaining:
        options.config.player.defaultLoadout.throwableCount,
      medkitsRemaining: options.config.player.medkitCount,
      medkitEndsAtMs: undefined,
    };

    for (const seat of this.room.seats) {
      if (!seat.occupant.isBot) {
        continue;
      }
      const route = this.getRoute(seat.routeId);
      const guardPosition = guardPositions.get(seat.index);
      if (!guardPosition) {
        throw new Error(`AI 席位 ${seat.index} 缺少防守位置`);
      }
      this.allies.push(
        new AllyAgent({
          id: seat.occupant.id,
          heroName: seat.heroName,
          route: { ...route, guardPosition },
          position: guardPosition,
          bot: options.config.bot,
          weapon: options.config.playerWeapon,
          medkit: options.config.medkit,
        }),
      );
    }

    this.allyController = new AllyController(
      { aiUpdateGroups: options.config.aiUpdateGroups },
      this.allies,
    );
    this.enemyController = new EnemyController(
      { aiUpdateGroups: options.config.aiUpdateGroups },
      this.enemyAgents,
    );
    this.deploymentManager = new AllyDeploymentManager(
      options.config.deployment,
      options.config.routes,
    );
    this.calloutController = new CalloutController(
      options.config.callout,
      options.config.routeNames,
    );
    this.scoreTracker = new ScoreTracker(
      options.config.score,
      this.room.seats.map((seat) => ({
        occupantId: seat.occupant.id,
        seatIndex: seat.index,
        heroName: seat.heroName,
        displayName: seat.occupant.isBot
          ? seat.occupant.displayName
          : options.playerName,
        isBot: seat.occupant.isBot,
      })),
    );
    this.supplyDropManager = new SupplyDropManager({
      idPrefix: this.room.id,
      config: options.config.airdrop,
      waves: options.config.waves,
      intermissionSec: options.config.intermissionSec,
      matchDurationSec: options.config.match.durationSec,
      arenaWidthM: options.config.arena.widthM,
      random: options.supplyRandom,
    });
  }

  get aliveEnemyCount(): number {
    return this.enemies.reduce(
      (count, enemy) => count + (enemy.hp > 0 ? 1 : 0),
      0,
    );
  }

  get totalEnemyCount(): number {
    return this.enemies.length;
  }

  get playerKills(): number {
    return this.getKillsFor(this.player.id);
  }

  get allyKills(): readonly number[] {
    return this.allies.map((ally) => this.getKillsFor(ally.id));
  }

  get allySurvivalSec(): readonly number[] {
    const scoreboard = this.createScoreboard();
    return this.allies.map(
      (ally) =>
        scoreboard.find((entry) => entry.occupantId === ally.id)
          ?.survivalSec ?? 0,
    );
  }

  get playerHp(): number {
    return this.player.hp;
  }

  get playerAlive(): boolean {
    return this.player.hp > 0;
  }

  get aliveDefenderCount(): number {
    return (
      (this.player.hp > 0 ? 1 : 0) +
      this.allies.reduce(
        (count, ally) => count + (ally.isAlive ? 1 : 0),
        0,
      )
    );
  }

  endMatch(): void {
    this.room.markEnded();
  }

  get playerPosition(): Vector3 {
    return this.player.position;
  }

  get playerWeaponState(): WeaponState {
    return this.getPlayerWeaponState();
  }

  get playerIsUsingMedkit(): boolean {
    return this.player.medkitEndsAtMs !== undefined;
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

  update(
    deltaSec: number,
    tick: number,
    nowMs: number,
  ): readonly M2BattleEvent<TRouteId>[] {
    if (this.startedAtMs === undefined) {
      this.startedAtMs = nowMs - deltaSec * 1000;
    }
    this.elapsedSec = Math.max(
      this.elapsedSec,
      (nowMs - this.startedAtMs) / 1000,
    );
    this.updatePlayer(deltaSec, nowMs);
    const events: M2BattleEvent<TRouteId>[] = [
      ...this.supplyDropManager.update(
        this.elapsedSec * 1000,
        this.startedAtMs,
      ),
    ];

    const reassignment = this.deploymentManager.update(
      this.player.position,
      this.allies,
      nowMs,
    );
    if (reassignment) {
      const ally = this.allies.find(
        (candidate) => candidate.id === reassignment.allyId,
      );
      if (ally) {
        ally.assignRoute(
          this.createReassignmentRoute(
            reassignment.toRouteId,
            ally.id,
          ),
        );
      }
      events.push({ type: 'ally_reassigned', ...reassignment });
    }

    const enemyTargets = this.getFriendlyTargets();
    const enemyEvents = this.enemyController.update(
      deltaSec,
      tick,
      nowMs,
      enemyTargets,
    );
    const allyShots = this.allyController.update(
      deltaSec,
      tick,
      nowMs,
      this.getEnemyTargets(),
    );

    for (const event of enemyEvents) {
      if (event.type === 'shot') {
        events.push(...this.resolveEnemyShot(event, nowMs));
      } else {
        events.push(event);
      }
    }
    for (const shot of allyShots) {
      const death = this.resolveAllyShot(shot);
      if (death) {
        events.push(death);
      }
    }

    const callout = this.calloutController.update(
      nowMs,
      this.allies.map((ally) => ({
        id: ally.id,
        heroName: ally.heroName,
        routeId: ally.routeId,
        alive: ally.isAlive,
      })),
      this.countEnemiesByRoute(),
    );
    if (callout) {
      events.push(callout);
    }
    return events;
  }

  spawnEnemy(
    enemyType: TEnemyType,
    routeId: TRouteId,
    accuracy: number,
    nowMs: number,
  ): string | undefined {
    if (this.aliveEnemyCount >= this.config.maxAliveEnemies) {
      return undefined;
    }

    const unit = this.config.enemyUnits[enemyType];
    const weapon = this.config.enemyWeapons[unit.weapon];
    if (!weapon) {
      throw new Error(`日军武器 "${unit.weapon}" 不存在`);
    }
    const route = this.getRoute(routeId);
    const id = `${this.room.id}:enemy:${this.enemySequence}`;
    this.enemySequence += 1;
    const randomOffsetX =
      (this.random.next() - 0.5) * this.config.enemySpawnOffsetX;
    const randomOffsetZ =
      (this.random.next() - 0.5) * this.config.enemySpawnOffsetZ;
    const agent = new EnemyAgent({
      id,
      enemyType,
      route,
      spawnOffset: { x: randomOffsetX, y: 0, z: randomOffsetZ },
      behavior: unit,
      shared: this.config.enemyShared,
      weapon,
      spawnedAtMs: nowMs,
    });
    this.enemyAgents.push(agent);
    this.enemies.push({
      agent,
      enemyType,
      hp: unit.hp,
      maxHp: unit.hp,
      accuracy,
      weaponId: unit.weapon,
    });
    return id;
  }

  reload(message: ReloadMessage, nowMs: number): void {
    if (message.payload.weaponId !== this.config.playerWeapon.weaponId) {
      return;
    }
    this.player.weapon = startReload(
      this.player.weapon,
      this.config.playerWeapon,
      nowMs,
    );
  }

  resupplyPlayerAmmo(nowMs: number): boolean {
    if (
      this.lastPlayerResupplyAtMs !== undefined &&
      nowMs - this.lastPlayerResupplyAtMs <
        this.config.ammoBoxCooldownSec * 1000
    ) {
      return false;
    }
    if (
      this.player.weapon.reserveAmmo >=
      this.config.playerWeapon.reserveAmmo
    ) {
      return false;
    }

    this.player.weapon = {
      ...this.player.weapon,
      reserveAmmo: this.config.playerWeapon.reserveAmmo,
    };
    this.lastPlayerResupplyAtMs = nowMs;
    return true;
  }

  usePlayerMedkit(nowMs: number): boolean {
    return this.tryUsePlayerMedkit(nowMs) === undefined;
  }

  tryUsePlayerMedkit(
    nowMs: number,
  ): ActionRejectReason | undefined {
    if (this.player.hp === 0) {
      return 'dead';
    }
    if (this.player.medkitsRemaining === 0) {
      return 'no_resource';
    }
    if (this.player.medkitEndsAtMs !== undefined) {
      return 'invalid_state';
    }
    if (
      this.player.hp >
      this.player.maxHp - this.config.medkit.carriedHeal
    ) {
      return 'unavailable';
    }
    this.player.medkitsRemaining -= 1;
    this.player.medkitEndsAtMs =
      nowMs + this.config.medkit.carriedUseSec * 1000;
    this.scoreTracker.recordMedkitUsed(this.player.id);
    return undefined;
  }

  pickupSupply(
    itemId: string,
    nowMs: number,
  ): ActionRejectReason | undefined {
    if (this.player.hp === 0) {
      return 'dead';
    }
    if (this.player.hp === this.player.maxHp) {
      return 'unavailable';
    }
    const result = this.supplyDropManager.pickup(
      itemId,
      this.player.position,
      this.config.arena.itemPickupRangeM,
      this.config.medkit.airdropHeal,
      nowMs,
    );
    if (!result.accepted) {
      return result.reason;
    }

    this.player.hp = Math.min(
      this.player.maxHp,
      this.player.hp + result.heal,
    );
    this.scoreTracker.recordMedkitUsed(this.player.id);
    return undefined;
  }

  createScoreboard(
    endedAtSec: number = this.elapsedSec,
  ): readonly ScoreboardEntry[] {
    return this.scoreTracker.createScoreboard(endedAtSec);
  }

  selectMvpPlayerId(
    endedAtSec: number = this.elapsedSec,
  ): string | undefined {
    return this.scoreTracker.selectMvpPlayerId(endedAtSec);
  }

  fire(message: FireMessage, nowMs: number): M2FireResolution {
    const { payload } = message;
    if (this.player.hp === 0) {
      return this.rejectFire(message, 'dead');
    }
    if (
      this.config.medkit.carriedBlocksFire &&
      this.player.medkitEndsAtMs !== undefined
    ) {
      return this.rejectFire(message, 'cooldown');
    }
    if (payload.weaponId !== this.config.playerWeapon.weaponId) {
      return this.rejectFire(message, 'invalid_weapon');
    }
    if (
      distanceBetween(payload.originPos, this.player.position) >
      this.config.validation.fireOriginToleranceM
    ) {
      return this.rejectFire(message, 'invalid_origin');
    }
    const magnitude = vectorMagnitude(payload.dirVec);
    if (
      !Number.isFinite(magnitude) ||
      Math.abs(magnitude - 1) >
        this.config.validation.directionMagnitudeTolerance
    ) {
      return this.rejectFire(message, 'invalid_direction');
    }

    const fireState = tryFire(
      this.player.weapon,
      this.config.playerWeapon,
      nowMs,
    );
    this.player.weapon = fireState.state;
    if (!fireState.accepted) {
      return this.rejectFire(message, fireState.reason);
    }

    const raycastEnemies: RaycastEnemy[] = this.enemies.map((enemy) => ({
      id: enemy.agent.id,
      position: enemy.agent.position,
      alive: enemy.hp > 0,
    }));
    const hit = raycastNearestEnemy(
      payload.originPos,
      payload.dirVec,
      raycastEnemies,
      this.config.enemyHitbox,
    );
    if (!hit) {
      this.scoreTracker.recordShot(this.player.id, {
        hit: false,
        damage: 0,
        isKill: false,
        isMachineGun: false,
        waveIndex: this.getCurrentWaveIndex(),
      });
      return { result: this.createMissResult(message) };
    }

    const enemy = this.enemies.find(
      (candidate) => candidate.agent.id === hit.targetId,
    );
    if (!enemy || enemy.hp <= 0) {
      this.scoreTracker.recordShot(this.player.id, {
        hit: false,
        damage: 0,
        isKill: false,
        isMachineGun: false,
        waveIndex: this.getCurrentWaveIndex(),
      });
      return { result: this.createMissResult(message) };
    }

    const hpBeforeDamage = enemy.hp;
    const damage = calculateDamage(
      {
        ...this.config.playerWeapon,
        hitPartMultiplier: this.config.hitPartMultiplier,
      },
      hit.distanceM,
      hit.hitPart,
    ).damage;
    enemy.hp = Math.max(0, enemy.hp - damage);
    const isKill = enemy.hp === 0;
    if (isKill) {
      enemy.agent.markDead();
    }
    this.scoreTracker.recordShot(this.player.id, {
      hit: true,
      damage: hpBeforeDamage - enemy.hp,
      isKill,
      isMachineGun: false,
      hitPart: hit.hitPart,
      waveIndex: this.getCurrentWaveIndex(),
    });

    return {
      result: {
        type: SERVER_MESSAGE_TYPES.fireResult,
        payload: {
          clientTick: payload.clientTick,
          weaponId: payload.weaponId,
          accepted: true,
          hit: true,
          targetId: enemy.agent.id,
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
                enemyId: enemy.agent.id,
                killerId: this.player.id,
                killerIsBot: false,
              },
            },
          }
        : {}),
    };
  }

  createSnapshot(
    tick: number,
    serverTimeMs: number,
    matchProgress?: MatchProgressState,
  ): WorldSnapshotMessage {
    const playerSeat = this.getSeatByOccupantId(this.player.id);
    const allies: AllyState[] = [
      {
        id: this.player.id,
        isBot: false,
        seatIndex: playerSeat.index,
        heroName: playerSeat.heroName,
        routeId: findNearestRoute(
          this.player.position,
          this.config.routes,
        ),
        hp: this.player.hp,
        maxHp: this.player.maxHp,
        position: this.player.position,
        aimYaw: this.player.aimYaw,
        aimPitch: this.player.aimPitch,
        isCrouch: this.player.isCrouch,
        availableWeaponIds: [this.config.playerWeapon.weaponId],
        grenadesRemaining: this.player.grenadesRemaining,
        medkitsRemaining: this.player.medkitsRemaining,
        ...(this.player.medkitEndsAtMs === undefined
          ? {}
          : { medkitEndsAtMs: this.player.medkitEndsAtMs }),
        weapon: this.getPlayerWeaponState(),
      },
      ...this.allies.map((ally) => {
        const seat = this.getSeatByOccupantId(ally.id);
        return {
          id: ally.id,
          isBot: true,
          seatIndex: seat.index,
          heroName: ally.heroName,
          routeId: ally.routeId,
          aiState: ally.state,
          hp: ally.hp,
          maxHp: ally.maxHp,
          position: ally.position,
          aimYaw: 0,
          aimPitch: 0,
          isCrouch: ally.isCrouching,
          availableWeaponIds: [this.config.bot.weapon],
          grenadesRemaining: 0,
          medkitsRemaining: ally.medkitsRemaining,
          ...(ally.medkitUseEndsAtMs === undefined
            ? {}
            : { medkitEndsAtMs: ally.medkitUseEndsAtMs }),
          weapon: this.getAllyWeaponState(ally),
        };
      }),
    ];
    const enemies: EnemyState[] = this.enemies
      .filter((enemy) => enemy.hp > 0)
      .map((enemy) => ({
        id: enemy.agent.id,
        enemyType: enemy.enemyType,
        routeId: enemy.agent.routeId,
        aiState: enemy.agent.state,
        ...(enemy.agent.fireWarningEndsAtMs === undefined
          ? {}
          : {
              fireWarningEndsAtMs:
                enemy.agent.fireWarningEndsAtMs,
            }),
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        position: enemy.agent.position,
        alive: true,
      }));

    return {
      type: SERVER_MESSAGE_TYPES.worldSnapshot,
      payload: {
        tick,
        serverTimeMs,
        allies,
        enemies,
        items: this.supplyDropManager.getItems(serverTimeMs),
        match:
          matchProgress ?? this.createMatchProgress(serverTimeMs),
        machineGuns: [],
      },
    };
  }

  createRoomState(): RoomStateMessage {
    const seats = this.room.seats
      .map((seat) => {
        if (!seat.occupant.isBot) {
          return {
            seatIndex: seat.index,
            heroName: seat.heroName,
            occupantId: seat.occupant.id,
            displayName: this.player.name,
            isBot: false,
            alive: this.player.hp > 0,
            routeId: findNearestRoute(
              this.player.position,
              this.config.routes,
            ),
          };
        }

        const ally = this.allies.find(
          (candidate) => candidate.id === seat.occupant.id,
        );
        if (!ally) {
          throw new Error(`席位 ${seat.index} 缺少 AI 队友`);
        }
        return {
          seatIndex: seat.index,
          heroName: seat.heroName,
          occupantId: seat.occupant.id,
          displayName: seat.occupant.displayName,
          isBot: true,
          alive: ally.isAlive,
          routeId: ally.routeId,
        };
      })
      .sort((first, second) => first.seatIndex - second.seatIndex);

    return {
      type: SERVER_MESSAGE_TYPES.roomState,
      payload: {
        roomId: this.room.id,
        status: this.room.status,
        seats,
      },
    };
  }

  createFireMessageForEnemy(
    enemyId: string,
    clientTick: number,
    hitPart: 'head' | 'torso' | 'limb',
  ): FireMessage | undefined {
    const enemy = this.enemies.find(
      (candidate) => candidate.agent.id === enemyId && candidate.hp > 0,
    );
    if (!enemy) {
      return undefined;
    }

    const targetY =
      hitPart === 'head'
        ? (this.config.enemyHitbox.headStartM +
            this.config.enemyHitbox.heightM) /
          2
        : hitPart === 'torso'
          ? (this.config.enemyHitbox.torsoStartM +
              this.config.enemyHitbox.headStartM) /
            2
          : this.config.enemyHitbox.torsoStartM / 2;
    const direction = normalizeVector({
      x: enemy.agent.position.x - this.player.position.x,
      y: enemy.agent.position.y + targetY - this.player.position.y,
      z: enemy.agent.position.z - this.player.position.z,
    });
    return {
      type: 'fire',
      payload: {
        weaponId: this.config.playerWeapon.weaponId,
        originPos: this.player.position,
        dirVec: direction,
        clientTick,
      },
    };
  }

  findNearestAliveEnemyId(): string | undefined {
    let nearestId: string | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) {
        continue;
      }
      const distance = distanceBetween(
        this.player.position,
        enemy.agent.position,
      );
      if (distance < nearestDistance) {
        nearestId = enemy.agent.id;
        nearestDistance = distance;
      }
    }
    return nearestId;
  }

  private resolveAllyShot(
    shot: AllyShotIntent,
  ): M2BattleEvent<TRouteId> | undefined {
    const enemy = this.enemies.find(
      (candidate) => candidate.agent.id === shot.targetId,
    );
    if (
      !enemy ||
      enemy.hp <= 0 ||
      this.random.next() > shot.accuracy
    ) {
      this.scoreTracker.recordShot(shot.allyId, {
        hit: false,
        damage: 0,
        isKill: false,
        isMachineGun: false,
        waveIndex: this.getCurrentWaveIndex(),
      });
      return undefined;
    }

    const hpBeforeDamage = enemy.hp;
    const damage = calculateDamage(
      {
        ...this.config.playerWeapon,
        hitPartMultiplier: this.config.hitPartMultiplier,
      },
      shot.distanceM,
      'torso',
    ).damage;
    enemy.hp = Math.max(0, enemy.hp - damage);
    const isKill = enemy.hp === 0;
    this.scoreTracker.recordShot(shot.allyId, {
      hit: true,
      damage: hpBeforeDamage - enemy.hp,
      isKill,
      isMachineGun: false,
      hitPart: 'torso',
      waveIndex: this.getCurrentWaveIndex(),
    });
    if (!isKill) {
      return undefined;
    }

    enemy.agent.markDead();
    return {
      type: 'enemy_died',
      enemyId: enemy.agent.id,
      killerId: shot.allyId,
      killerIsBot: true,
    };
  }

  private resolveEnemyShot(
    shot: EnemyShotIntent,
    nowMs: number,
  ): readonly M2BattleEvent<TRouteId>[] {
    const enemy = this.enemies.find(
      (candidate) => candidate.agent.id === shot.enemyId,
    );
    if (!enemy || enemy.hp <= 0) {
      return [];
    }
    const targetPosition = this.getFriendlyPosition(shot.targetId);
    if (
      !targetPosition ||
      distanceBetween(shot.aimedPosition, targetPosition) >
        this.config.enemyHitbox.radiusM
    ) {
      return [];
    }
    const targetExposure = this.getFriendlyExposure(shot.targetId);
    if (
      targetExposure === undefined ||
      this.random.next() > enemy.accuracy * targetExposure
    ) {
      return [];
    }
    const weapon = this.config.enemyWeapons[enemy.weaponId];
    if (!weapon) {
      return [];
    }
    const damage = calculateDamage(
      {
        ...weapon,
        hitPartMultiplier: this.config.hitPartMultiplier,
      },
      shot.distanceM,
      'torso',
    ).damage;
    const fromDir = directionFromAttacker(
      enemy.agent.position,
      targetPosition,
    );

    if (shot.targetId === this.player.id) {
      if (this.player.hp === 0) {
        return [];
      }
      const hpBeforeDamage = this.player.hp;
      this.player.hp = Math.max(0, this.player.hp - damage);
      this.scoreTracker.recordDamageTaken(
        this.player.id,
        hpBeforeDamage - this.player.hp,
      );
      if (this.player.hp === 0) {
        this.scoreTracker.markDead(this.player.id, this.elapsedSec);
      }
      return [
        {
          type: 'ally_damaged',
          allyId: this.player.id,
          hp: this.player.hp,
          fromDir,
        },
        ...(this.player.hp === 0
          ? [
              {
                type: 'ally_died' as const,
                allyId: this.player.id,
                isBot: false,
                killerType: shot.enemyType,
              },
            ]
          : []),
      ];
    }

    const ally = this.allies.find(
      (candidate) => candidate.id === shot.targetId,
    );
    if (!ally) {
      return [];
    }
    if (!ally.isAlive) {
      return [];
    }
    const hpBeforeDamage = ally.hp;
    const medkitsBeforeDamage = ally.medkitsRemaining;
    const died = ally.takeDamage(damage, nowMs);
    this.scoreTracker.recordDamageTaken(
      ally.id,
      hpBeforeDamage - ally.hp,
    );
    if (ally.medkitsRemaining < medkitsBeforeDamage) {
      this.scoreTracker.recordMedkitUsed(ally.id);
    }
    if (died) {
      this.scoreTracker.markDead(ally.id, this.elapsedSec);
    }
    return [
      {
        type: 'ally_damaged',
        allyId: ally.id,
        hp: ally.hp,
        fromDir,
      },
      ...(died
        ? [
            {
              type: 'ally_died' as const,
              allyId: ally.id,
              isBot: true,
              killerType: shot.enemyType,
            },
          ]
        : []),
    ];
  }

  private updatePlayer(deltaSec: number, nowMs: number): void {
    this.player.weapon = completeReload(
      this.player.weapon,
      this.config.playerWeapon,
      nowMs,
    );
    if (
      this.player.medkitEndsAtMs !== undefined &&
      nowMs >= this.player.medkitEndsAtMs
    ) {
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + this.config.medkit.carriedHeal,
      );
      this.player.medkitEndsAtMs = undefined;
    }
    if (this.player.hp === 0) {
      return;
    }

    const yawRad = (this.player.aimYaw * Math.PI) / 180;
    const speed = this.player.isCrouch
      ? this.config.player.crouchSpeed
      : this.config.player.moveSpeed;
    const rightX = Math.cos(yawRad);
    const rightZ = -Math.sin(yawRad);
    const forwardX = -Math.sin(yawRad);
    const forwardZ = -Math.cos(yawRad);
    const halfWidth = this.config.arena.widthM / 2;
    const halfDepth = this.config.arena.depthM / 2;

    this.player.position = {
      x: clamp(
        this.player.position.x +
          (rightX * this.player.moveDirX +
            forwardX * this.player.moveDirY) *
            speed *
            deltaSec,
        -halfWidth,
        halfWidth,
      ),
      y: this.player.position.y,
      z: clamp(
        this.player.position.z +
          (rightZ * this.player.moveDirX +
            forwardZ * this.player.moveDirY) *
            speed *
            deltaSec,
        -halfDepth,
        halfDepth,
      ),
    };
  }

  private rejectFire(
    message: FireMessage,
    rejectReason: FireRejectReason,
  ): M2FireResolution {
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

  private createMissResult(message: FireMessage): FireResultMessage {
    return {
      type: SERVER_MESSAGE_TYPES.fireResult,
      payload: {
        clientTick: message.payload.clientTick,
        weaponId: message.payload.weaponId,
        accepted: true,
        hit: false,
        damage: 0,
        isKill: false,
        ...this.getAmmoState(),
      },
    };
  }

  private getFriendlyTargets() {
    return [
      {
        id: this.player.id,
        position: this.player.position,
        alive: this.player.hp > 0,
      },
      ...this.allies.map((ally) => ({
        id: ally.id,
        position: ally.position,
        alive: ally.isAlive,
      })),
    ];
  }

  private getEnemyTargets() {
    return this.enemies.map((enemy) => ({
      id: enemy.agent.id,
      routeId: enemy.agent.routeId,
      position: enemy.agent.position,
      alive: enemy.hp > 0,
    }));
  }

  private getCurrentWaveIndex(): number {
    let waveIndex = 0;
    for (const wave of this.config.waves) {
      if (this.elapsedSec < wave.startSec) {
        break;
      }
      waveIndex = wave.index;
    }
    return waveIndex;
  }

  private countEnemiesByRoute(): Readonly<Record<TRouteId, number>> {
    const counts = Object.fromEntries(
      this.config.routes.map((route) => [route.routeId, 0]),
    ) as Record<TRouteId, number>;
    for (const enemy of this.enemies) {
      if (enemy.hp > 0) {
        counts[enemy.agent.routeId] += 1;
      }
    }
    return counts;
  }

  private getRoute(routeId: TRouteId): RouteLayout<TRouteId> {
    const route = this.config.routes.find(
      (candidate) => candidate.routeId === routeId,
    );
    if (!route) {
      throw new Error(`路线 "${routeId}" 不存在`);
    }
    return route;
  }

  private getSeatByOccupantId(occupantId: string) {
    const seat = this.room.seats.find(
      (candidate) => candidate.occupant.id === occupantId,
    );
    if (!seat) {
      throw new Error(`房间缺少成员 ${occupantId} 的席位`);
    }
    return seat;
  }

  private createInitialGuardPositions(): ReadonlyMap<number, Vector3> {
    const positions = new Map<number, Vector3>();
    for (const route of this.config.routes) {
      const routeSeats = this.room.seats.filter(
        (seat) => seat.routeId === route.routeId,
      );
      const firstOffset =
        -(this.config.seatSpacingM * (routeSeats.length - 1)) / 2;
      routeSeats.forEach((seat, index) => {
        positions.set(seat.index, {
          ...route.guardPosition,
          x:
            route.guardPosition.x +
            firstOffset +
            index * this.config.seatSpacingM,
        });
      });
    }
    return positions;
  }

  private createReassignmentRoute(
    routeId: TRouteId,
    reassignedAllyId: string,
  ): RouteLayout<TRouteId> {
    const route = this.getRoute(routeId);
    const occupiedCount = this.allies.filter(
      (ally) =>
        ally.id !== reassignedAllyId &&
        ally.isAlive &&
        ally.routeId === routeId,
    ).length;
    const direction = occupiedCount % 2 === 0 ? 1 : -1;
    const offsetSlots = Math.floor(occupiedCount / 2) + 1;
    return {
      ...route,
      guardPosition: {
        ...route.guardPosition,
        x:
          route.guardPosition.x +
          direction * offsetSlots * this.config.seatSpacingM,
      },
    };
  }

  private getFriendlyPosition(allyId: string): Vector3 | undefined {
    if (allyId === this.player.id) {
      return this.player.hp > 0 ? this.player.position : undefined;
    }
    const ally = this.allies.find(
      (candidate) => candidate.id === allyId && candidate.isAlive,
    );
    return ally?.position;
  }

  private getFriendlyExposure(allyId: string): number | undefined {
    const coverExposure =
      this.config.defenderCoverExposureMultiplier;
    if (allyId === this.player.id) {
      return this.player.hp > 0
        ? this.player.isCrouch
          ? coverExposure *
            this.config.player.crouchHitboxMultiplier
          : coverExposure
        : undefined;
    }
    const ally = this.allies.find((candidate) => candidate.id === allyId);
    if (!ally?.isAlive) {
      return undefined;
    }
    return ally.isCrouching
      ? coverExposure *
          this.config.player.crouchHitboxMultiplier
      : coverExposure;
  }

  private getKillsFor(occupantId: string): number {
    return (
      this.createScoreboard().find(
        (entry) => entry.occupantId === occupantId,
      )?.kills ?? 0
    );
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

  private getPlayerWeaponState(): WeaponState {
    return toProtocolWeaponState(
      this.config.playerWeapon.weaponId,
      this.player.weapon,
    );
  }

  private getAllyWeaponState(ally: AllyAgent<TRouteId>): WeaponState {
    return toProtocolWeaponState(
      this.config.bot.weapon,
      ally.weaponState,
    );
  }

  private createMatchProgress(serverTimeMs: number): MatchProgressState {
    if (this.startedAtMs === undefined) {
      this.startedAtMs = serverTimeMs;
    }
    const elapsedSec = Math.max(
      0,
      (serverTimeMs - this.startedAtMs) / 1000,
    );
    const defeatedEnemies =
      this.totalEnemyCount - this.aliveEnemyCount;
    let currentWaveIndex = 0;
    let phase: MatchProgressState['phase'] = 'deploy';

    for (let index = 0; index < this.config.waves.length; index += 1) {
      const wave = this.config.waves[index];
      if (!wave || elapsedSec < wave.startSec) {
        break;
      }
      currentWaveIndex = wave.index;
      phase = 'wave';
      const nextWave = this.config.waves[index + 1];
      if (
        nextWave &&
        elapsedSec >= nextWave.startSec - this.config.intermissionSec
      ) {
        phase = 'intermission';
      }
    }
    if (elapsedSec >= this.config.match.durationSec) {
      phase = 'ended';
    }

    return {
      startedAtMs: this.startedAtMs,
      endsAtMs:
        this.startedAtMs + this.config.match.durationSec * 1000,
      phase,
      currentWaveIndex,
      totalWaves: this.config.waves.length,
      spawnedEnemies: this.totalEnemyCount,
      defeatedEnemies,
      remainingEnemies: Math.max(
        0,
        this.config.totalEnemies - defeatedEnemies,
      ),
      totalEnemies: this.config.totalEnemies,
    };
  }
}

function toProtocolWeaponState(
  weaponId: string,
  weapon: WeaponRuntimeState,
): WeaponState {
  const common = {
    weaponId,
    magazineAmmo: weapon.magazineAmmo,
    reserveAmmo: weapon.reserveAmmo,
    isReloading: weapon.reloadEndsAtMs !== undefined,
  };
  return weapon.reloadEndsAtMs === undefined
    ? common
    : { ...common, reloadEndsAtMs: weapon.reloadEndsAtMs };
}

function directionFromAttacker(
  attacker: Vector3,
  target: Vector3,
): Vector3 {
  return normalizeVector({
    x: attacker.x - target.x,
    y: attacker.y - target.y,
    z: attacker.z - target.z,
  });
}

function normalizeVector(vector: Vector3): Vector3 {
  const magnitude = vectorMagnitude(vector);
  if (magnitude === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  };
}

function vectorMagnitude(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function distanceBetween(first: Vector3, second: Vector3): number {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    first.z - second.z,
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
