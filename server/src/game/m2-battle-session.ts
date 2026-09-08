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
  type ThrowGrenadeMessage,
  type Vector3,
  type WeaponRackItemState,
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
  type WeaponRuntimeConfig,
  type WeaponRuntimeState,
} from '../combat/weapon-state';
import {
  calculateGrenadeImpact,
  resolveGrenadeBlast,
  type GrenadeConfig,
} from '../combat/grenade';
import {
  PlayerWeaponInventory,
  type InventoryWeaponConfig,
} from '../combat/player-weapon-inventory';
import {
  MachineGunController,
  type MachineGunConfig,
  type MachineGunPlacement,
} from '../combat/machine-gun-controller';
import {
  SoloRoom,
  type HumanSeatAssignment,
  type SoloRoomConfig,
} from '../room/solo-room';
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
  readonly initialHp: number;
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
  readonly machineGunMountRangeM: number;
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

export interface M2GrenadeConfig extends GrenadeConfig {
  readonly weaponId: string;
}

export interface M2PlayerWeaponConfig
  extends InventoryWeaponConfig,
    Omit<WeaponDamageConfig, 'hitPartMultiplier'> {
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
  readonly playerWeapons: Readonly<
    Record<string, M2PlayerWeaponConfig>
  >;
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
  readonly grenade: M2GrenadeConfig;
  readonly machineGun: MachineGunConfig;
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
  /**
   * 多人开局时的真人席位表。省略时退化为单人（仅 playerId 一人）。
   * v1.0 不允许中途加入，所以名单在开局时就固定下来。
   */
  readonly humans?: readonly HumanSeatAssignment[];
}

interface MutablePlayer {
  readonly id: string;
  readonly name: string;
  readonly seatIndex: number;
  readonly maxHp: number;
  hp: number;
  position: Vector3;
  aimYaw: number;
  aimPitch: number;
  isCrouch: boolean;
  moveDirX: number;
  moveDirY: number;
  readonly weapons: PlayerWeaponInventory<M2PlayerWeaponConfig>;
  grenadesRemaining: number;
  medkitsRemaining: number;
}

interface EnemyRuntime<TRouteId extends string, TEnemyType extends string> {
  readonly agent: EnemyAgent<TRouteId>;
  readonly enemyType: TEnemyType;
  readonly maxHp: number;
  readonly accuracy: number;
  readonly weaponId: string;
  hp: number;
}

interface PendingGrenade {
  /** 投掷者的 playerId，用于把炸死的杀敌数记在正确的人头上。 */
  readonly thrownBy: string;
  readonly impactPosition: Vector3;
  readonly detonatesAtMs: number;
}

/** 供敌人 AI 选靶用的友方目标快照。 */
interface FriendlyTarget {
  readonly id: string;
  readonly position: Vector3;
  readonly alive: boolean;
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
  /** 全部真人参战者，按 playerId 索引；单人模式下只有一项。 */
  private readonly players = new Map<string, MutablePlayer>();
  /** 本会话的首个真人（单人模式即唯一真人），供既有单人 API 复用。 */
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
  private readonly machineGunController: MachineGunController;
  private readonly weaponRacks: readonly WeaponRackItemState[];
  private readonly pendingGrenades: PendingGrenade[] = [];
  /** 复用缓冲：避免每 tick 为敌人选靶重新分配数组。 */
  private readonly friendlyTargetBuffer: FriendlyTarget[] = [];
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
      ...(options.humans === undefined ? {} : { humans: options.humans }),
    });
    const guardPositions = this.createInitialGuardPositions();
    const playerHeightM =
      (options.config.enemyHitbox.torsoStartM +
        options.config.enemyHitbox.headStartM) /
      2;
    // 所有真人席位统一建模：单人时只有一个，联机时最多五个。
    // 每个真人各自持有血量、位置、弹药与背包，互不共享。
    for (const seat of this.room.seats) {
      if (seat.occupant.isBot) {
        continue;
      }
      const guardPosition = guardPositions.get(seat.index);
      if (!guardPosition) {
        throw new Error(`真人席位 ${seat.index} 缺少防守位置`);
      }
      this.players.set(seat.occupant.id, {
        id: seat.occupant.id,
        name: seat.occupant.displayName,
        seatIndex: seat.index,
        maxHp: options.config.player.maxHp,
        hp: options.config.player.initialHp,
        position: {
          ...guardPosition,
          y: playerHeightM,
        },
        aimYaw: 0,
        aimPitch: 0,
        isCrouch: false,
        moveDirX: 0,
        moveDirY: 0,
        weapons: new PlayerWeaponInventory(
          options.config.playerWeapons,
          options.config.playerWeapon.weaponId,
        ),
        grenadesRemaining:
          options.config.player.defaultLoadout.throwableCount,
        medkitsRemaining: options.config.player.medkitCount,
      });
    }

    const primaryPlayer =
      this.players.get(options.playerId) ??
      [...this.players.values()][0];
    if (!primaryPlayer) {
      throw new Error('房间缺少真人席位');
    }
    this.player = primaryPlayer;

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
        displayName: seat.occupant.displayName,
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
    this.machineGunController = new MachineGunController(
      options.config.machineGun,
      createMachineGunPlacements(
        this.room.id,
        options.config.machineGun.nestCount,
        options.config.routes,
        playerHeightM,
      ),
    );
    this.weaponRacks = createWeaponRacks(
      this.room.id,
      options.config.playerWeapons,
      options.config.playerWeapon.weaponId,
      options.config.routes,
    );
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

  /** 全部真人的 playerId（按席位序）。 */
  get humanPlayerIds(): readonly string[] {
    return [...this.players.values()]
      .sort((first, second) => first.seatIndex - second.seatIndex)
      .map((participant) => participant.id);
  }

  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  /** 取真人参战者，不存在则抛错（调用方应先用 hasPlayer 判断）。 */
  private requirePlayer(playerId: string): MutablePlayer {
    const participant = this.players.get(playerId);
    if (!participant) {
      throw new Error(`房间内不存在真人 ${playerId}`);
    }
    return participant;
  }

  get playerKills(): number {
    return this.getKillsFor(this.player.id);
  }

  killsForPlayer(playerId: string): number {
    return this.getKillsFor(playerId);
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

  hpForPlayer(playerId: string): number {
    return this.players.get(playerId)?.hp ?? 0;
  }

  isPlayerAlive(playerId: string): boolean {
    return (this.players.get(playerId)?.hp ?? 0) > 0;
  }

  get aliveDefenderCount(): number {
    let aliveHumans = 0;
    for (const participant of this.players.values()) {
      if (participant.hp > 0) {
        aliveHumans += 1;
      }
    }
    return (
      aliveHumans +
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

  positionForPlayer(playerId: string): Vector3 | undefined {
    return this.players.get(playerId)?.position;
  }

  get playerWeaponState(): WeaponState {
    return this.getPlayerWeaponState();
  }

  applyInput(
    message: InputStateMessage,
    playerId: string = this.player.id,
  ): boolean {
    const participant = this.players.get(playerId);
    if (!participant) {
      return false;
    }
    const { payload } = message;
    if (
      payload.aimPitch < this.config.player.aimPitchMinDeg ||
      payload.aimPitch > this.config.player.aimPitchMaxDeg
    ) {
      return false;
    }

    const moveLength = Math.hypot(payload.moveDir.x, payload.moveDir.y);
    const moveScale = moveLength > 1 ? 1 / moveLength : 1;
    const movementLocked =
      this.machineGunController.locksMovement &&
      this.machineGunController.getMounted(participant.id) !== undefined;
    participant.moveDirX = movementLocked
      ? 0
      : payload.moveDir.x * moveScale;
    participant.moveDirY = movementLocked
      ? 0
      : payload.moveDir.y * moveScale;
    participant.aimYaw = payload.aimYaw;
    participant.aimPitch = payload.aimPitch;
    participant.isCrouch = movementLocked ? false : payload.isCrouch;
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
    this.machineGunController.update(nowMs);
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
        events.push(...this.resolveEnemyShot(event));
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
    events.push(...this.resolvePendingGrenades(nowMs));

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

  reload(
    message: ReloadMessage,
    nowMs: number,
    playerId: string = this.player.id,
  ): void {
    const participant = this.players.get(playerId);
    if (!participant) {
      return;
    }
    if (this.machineGunController.getMounted(participant.id)) {
      return;
    }
    participant.weapons.reload(message.payload.weaponId, nowMs);
  }

  resupplyPlayerAmmo(
    nowMs: number,
    playerId: string = this.player.id,
  ): boolean {
    const participant = this.players.get(playerId);
    if (!participant) {
      return false;
    }
    if (
      this.lastPlayerResupplyAtMs !== undefined &&
      nowMs - this.lastPlayerResupplyAtMs <
        this.config.ammoBoxCooldownSec * 1000
    ) {
      return false;
    }
    if (!participant.weapons.resupplyCurrent()) {
      return false;
    }
    this.lastPlayerResupplyAtMs = nowMs;
    return true;
  }

  switchPlayerWeapon(
    weaponId: string,
    playerId: string = this.player.id,
  ): ActionRejectReason | undefined {
    const participant = this.players.get(playerId);
    if (!participant) {
      return 'invalid_state';
    }
    if (participant.hp === 0) {
      return 'dead';
    }
    if (this.machineGunController.getMounted(participant.id)) {
      return 'invalid_state';
    }
    return participant.weapons.switchTo(weaponId);
  }

  usePlayerMedkit(playerId: string = this.player.id): boolean {
    return this.tryUsePlayerMedkit(playerId) === undefined;
  }

  tryUsePlayerMedkit(
    playerId: string = this.player.id,
  ): ActionRejectReason | undefined {
    const participant = this.players.get(playerId);
    if (!participant) {
      return 'invalid_state';
    }
    if (participant.hp === 0) {
      return 'dead';
    }
    if (participant.medkitsRemaining === 0) {
      return 'no_resource';
    }
    if (
      participant.hp >
      participant.maxHp - this.config.medkit.carriedHeal
    ) {
      return 'unavailable';
    }
    participant.medkitsRemaining -= 1;
    participant.hp = Math.min(
      participant.maxHp,
      participant.hp + this.config.medkit.carriedHeal,
    );
    this.scoreTracker.recordMedkitUsed(participant.id);
    return undefined;
  }

  pickupItem(
    itemId: string,
    nowMs: number,
    playerId: string = this.player.id,
  ): ActionRejectReason | undefined {
    const participant = this.players.get(playerId);
    if (!participant) {
      return 'invalid_state';
    }
    if (participant.hp === 0) {
      return 'dead';
    }
    if (this.machineGunController.getMounted(participant.id)) {
      return 'invalid_state';
    }

    const rack = this.weaponRacks.find(
      (candidate) => candidate.id === itemId,
    );
    if (rack) {
      if (
        distanceBetween(participant.position, rack.position) >
        this.config.arena.itemPickupRangeM
      ) {
        return 'out_of_range';
      }
      return participant.weapons.pickup(rack.weaponId);
    }

    const supply = this.supplyDropManager
      .getItems(nowMs)
      .find((candidate) => candidate.id === itemId);
    if (!supply) {
      return 'invalid_target';
    }
    if (participant.hp === participant.maxHp) {
      return 'unavailable';
    }
    const result = this.supplyDropManager.pickup(
      itemId,
      participant.position,
      this.config.arena.itemPickupRangeM,
      this.config.medkit.airdropHeal,
      nowMs,
    );
    if (!result.accepted) {
      return result.reason;
    }

    participant.hp = Math.min(
      participant.maxHp,
      participant.hp + result.heal,
    );
    this.scoreTracker.recordMedkitUsed(participant.id);
    return undefined;
  }

  throwGrenade(
    message: ThrowGrenadeMessage,
    nowMs: number,
    playerId: string = this.player.id,
  ): ActionRejectReason | undefined {
    const participant = this.players.get(playerId);
    if (!participant) {
      return 'invalid_state';
    }
    if (participant.hp === 0) {
      return 'dead';
    }
    if (this.machineGunController.getMounted(participant.id)) {
      return 'invalid_state';
    }
    if (participant.grenadesRemaining === 0) {
      return 'no_resource';
    }
    const { originPos, dirVec, force } = message.payload;
    if (
      distanceBetween(originPos, participant.position) >
      this.config.validation.fireOriginToleranceM
    ) {
      return 'out_of_range';
    }
    const magnitude = vectorMagnitude(dirVec);
    if (
      !Number.isFinite(magnitude) ||
      Math.abs(magnitude - 1) >
        this.config.validation.directionMagnitudeTolerance ||
      !Number.isFinite(force) ||
      force < 0 ||
      force > 1
    ) {
      return 'invalid_target';
    }

    participant.grenadesRemaining -= 1;
    this.pendingGrenades.push({
      thrownBy: participant.id,
      impactPosition: calculateGrenadeImpact(
        originPos,
        dirVec,
        force,
        this.config.grenade,
      ),
      detonatesAtMs:
        nowMs + this.config.grenade.fuseSec * 1000,
    });
    return undefined;
  }

  mountMachineGun(
    mgId: string,
    playerId: string = this.player.id,
  ): ActionRejectReason | undefined {
    const participant = this.players.get(playerId);
    if (!participant) {
      return 'invalid_state';
    }
    if (participant.hp === 0) {
      return 'dead';
    }
    const rejectReason = this.machineGunController.mount(
      mgId,
      participant.id,
      false,
      participant.position,
      this.config.arena.machineGunMountRangeM,
    );
    if (rejectReason !== undefined) {
      return rejectReason;
    }

    const mounted = this.machineGunController.getMounted(participant.id);
    if (!mounted) {
      throw new Error(`重机枪 ${mgId} 挂载成功后缺少状态`);
    }
    participant.position = mounted.position;
    participant.aimYaw = mounted.baseYaw;
    participant.moveDirX = 0;
    participant.moveDirY = 0;
    participant.isCrouch = false;
    return undefined;
  }

  unmountMachineGun(
    playerId: string = this.player.id,
  ): ActionRejectReason | undefined {
    const participant = this.players.get(playerId);
    if (!participant) {
      return 'invalid_state';
    }
    if (participant.hp === 0) {
      return 'dead';
    }
    return this.machineGunController.unmount(participant.id);
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

  fire(
    message: FireMessage,
    nowMs: number,
    playerId: string = this.player.id,
  ): M2FireResolution {
    const { payload } = message;
    const participant = this.players.get(playerId);
    if (!participant) {
      return this.rejectFire(message, 'dead');
    }
    if (participant.hp === 0) {
      return this.rejectFire(message, 'dead', undefined, participant);
    }
    if (
      distanceBetween(payload.originPos, participant.position) >
      this.config.validation.fireOriginToleranceM
    ) {
      return this.rejectFire(
        message,
        'invalid_origin',
        undefined,
        participant,
      );
    }
    const magnitude = vectorMagnitude(payload.dirVec);
    if (
      !Number.isFinite(magnitude) ||
      Math.abs(magnitude - 1) >
        this.config.validation.directionMagnitudeTolerance
    ) {
      return this.rejectFire(
        message,
        'invalid_direction',
        undefined,
        participant,
      );
    }

    const mounted = this.machineGunController.getMounted(participant.id);
    let isMachineGun = false;
    let damageForHit: (
      hitPart: 'head' | 'torso' | 'limb',
      distanceM: number,
    ) => number;
    let ammoState: Pick<
      WeaponState,
      'magazineAmmo' | 'reserveAmmo'
    >;

    if (mounted) {
      const aim = directionToAim(payload.dirVec);
      const fireState = this.machineGunController.fire(
        participant.id,
        payload.weaponId,
        aim.yaw,
        aim.pitch,
        nowMs,
      );
      ammoState = {
        magazineAmmo: fireState.beltAmmo,
        reserveAmmo: 0,
      };
      if (!fireState.accepted) {
        return this.rejectFire(message, fireState.reason, ammoState);
      }
      isMachineGun = true;
      damageForHit = (hitPart) =>
        Math.round(
          this.config.machineGun.damage *
            this.config.hitPartMultiplier[hitPart],
        );
    } else {
      if (
        payload.weaponId !== participant.weapons.currentWeaponId
      ) {
        return this.rejectFire(
          message,
          'invalid_weapon',
          undefined,
          participant,
        );
      }
      const fireState = participant.weapons.fire(
        payload.weaponId,
        nowMs,
      );
      if (!fireState.accepted) {
        return this.rejectFire(
          message,
          fireState.reason,
          undefined,
          participant,
        );
      }
      const weaponConfig = participant.weapons.currentConfig;
      ammoState = this.getAmmoState(participant);
      damageForHit = (hitPart, distanceM) =>
        calculateDamage(
          {
            ...weaponConfig,
            hitPartMultiplier: this.config.hitPartMultiplier,
          },
          distanceM,
          hitPart,
        ).damage;
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
      this.scoreTracker.recordShot(participant.id, {
        hit: false,
        damage: 0,
        isKill: false,
        isMachineGun,
        waveIndex: this.getCurrentWaveIndex(),
      });
      return {
        result: this.createMissResult(message, ammoState),
      };
    }

    const enemy = this.enemies.find(
      (candidate) => candidate.agent.id === hit.targetId,
    );
    if (!enemy || enemy.hp <= 0) {
      this.scoreTracker.recordShot(participant.id, {
        hit: false,
        damage: 0,
        isKill: false,
        isMachineGun,
        waveIndex: this.getCurrentWaveIndex(),
      });
      return {
        result: this.createMissResult(message, ammoState),
      };
    }

    const hpBeforeDamage = enemy.hp;
    const damage = damageForHit(hit.hitPart, hit.distanceM);
    enemy.hp = Math.max(0, enemy.hp - damage);
    const isKill = enemy.hp === 0;
    if (isKill) {
      enemy.agent.markDead();
    }
    this.scoreTracker.recordShot(participant.id, {
      hit: true,
      damage: hpBeforeDamage - enemy.hp,
      isKill,
      isMachineGun,
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
          ...ammoState,
        },
      },
      ...(isKill
        ? {
            death: {
              type: SERVER_MESSAGE_TYPES.enemyDied,
              payload: {
                enemyId: enemy.agent.id,
                killerId: participant.id,
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
    // PRD 8.2：真人与 AI 队友统一放进 allies[]，用 isBot 区分，
    // 客户端渲染代码单人/联机完全复用。
    const allies: AllyState[] = [
      ...[...this.players.values()]
        .sort((first, second) => first.seatIndex - second.seatIndex)
        .map((participant) => {
          const seat = this.getSeatByOccupantId(participant.id);
          const mountedMachineGun =
            this.machineGunController.getMounted(participant.id);
          return {
            id: participant.id,
            isBot: false,
            seatIndex: seat.index,
            heroName: seat.heroName,
            routeId: findNearestRoute(
              participant.position,
              this.config.routes,
            ),
            hp: participant.hp,
            maxHp: participant.maxHp,
            position: participant.position,
            aimYaw: participant.aimYaw,
            aimPitch: participant.aimPitch,
            isCrouch: participant.isCrouch,
            availableWeaponIds: participant.weapons.availableWeaponIds,
            grenadesRemaining: participant.grenadesRemaining,
            medkitsRemaining: participant.medkitsRemaining,
            ...(mountedMachineGun === undefined
              ? {}
              : { mountedMgId: mountedMachineGun.id }),
            weapon: this.getPlayerWeaponState(participant),
          };
        }),
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
        items: [
          ...this.weaponRacks,
          ...this.supplyDropManager.getItems(serverTimeMs),
        ],
        match:
          matchProgress ?? this.createMatchProgress(serverTimeMs),
        machineGuns: this.machineGunController.getStates(),
      },
    };
  }

  createRoomState(): RoomStateMessage {
    const seats = this.room.seats
      .map((seat) => {
        if (!seat.occupant.isBot) {
          const participant = this.players.get(seat.occupant.id);
          if (!participant) {
            throw new Error(`席位 ${seat.index} 缺少真人参战者`);
          }
          return {
            seatIndex: seat.index,
            heroName: seat.heroName,
            occupantId: seat.occupant.id,
            displayName: participant.name,
            isBot: false,
            alive: participant.hp > 0,
            routeId: findNearestRoute(
              participant.position,
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
        weaponId:
          this.machineGunController.getMounted(this.player.id)
            ?.weaponId ?? this.player.weapons.currentWeaponId,
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

    // 命中真人：按 targetId 找到具体是哪一名，而不是假定只有一个玩家。
    const targetParticipant = this.players.get(shot.targetId);
    if (targetParticipant) {
      if (targetParticipant.hp === 0) {
        return [];
      }
      const hpBeforeDamage = targetParticipant.hp;
      targetParticipant.hp = Math.max(0, targetParticipant.hp - damage);
      this.scoreTracker.recordDamageTaken(
        targetParticipant.id,
        hpBeforeDamage - targetParticipant.hp,
      );
      if (targetParticipant.hp === 0) {
        this.scoreTracker.markDead(targetParticipant.id, this.elapsedSec);
        this.machineGunController.unmount(targetParticipant.id);
      }
      return [
        {
          type: 'ally_damaged',
          allyId: targetParticipant.id,
          hp: targetParticipant.hp,
          fromDir,
        },
        ...(targetParticipant.hp === 0
          ? [
              {
                type: 'ally_died' as const,
                allyId: targetParticipant.id,
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
    const died = ally.takeDamage(damage);
    this.scoreTracker.recordDamageTaken(
      ally.id,
      Math.min(damage, hpBeforeDamage),
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

  private resolvePendingGrenades(
    nowMs: number,
  ): readonly M2BattleEvent<TRouteId>[] {
    const events: M2BattleEvent<TRouteId>[] = [];
    for (
      let index = this.pendingGrenades.length - 1;
      index >= 0;
      index -= 1
    ) {
      const grenade = this.pendingGrenades[index];
      if (!grenade || nowMs < grenade.detonatesAtMs) {
        continue;
      }
      this.pendingGrenades.splice(index, 1);
      const hits = resolveGrenadeBlast(
        grenade.impactPosition,
        this.enemies.map((enemy) => ({
          id: enemy.agent.id,
          position: enemy.agent.position,
          hp: enemy.hp,
          alive: enemy.hp > 0,
        })),
        this.config.grenade,
      );
      for (const hit of hits) {
        const enemy = this.enemies.find(
          (candidate) => candidate.agent.id === hit.targetId,
        );
        if (!enemy || enemy.hp <= 0) {
          continue;
        }
        const hpBeforeDamage = enemy.hp;
        enemy.hp = Math.max(0, enemy.hp - hit.damage);
        const isKill = enemy.hp === 0;
        this.scoreTracker.recordDamage(
          grenade.thrownBy,
          hpBeforeDamage - enemy.hp,
          isKill,
          false,
          this.getCurrentWaveIndex(),
        );
        if (!isKill) {
          continue;
        }
        enemy.agent.markDead();
        events.push({
          type: 'enemy_died',
          enemyId: enemy.agent.id,
          killerId: grenade.thrownBy,
          killerIsBot: false,
        });
      }
    }
    return events;
  }

  /** 逐帧推进全部真人的武器冷却与位移。 */
  private updatePlayer(deltaSec: number, nowMs: number): void {
    for (const participant of this.players.values()) {
      this.updateParticipant(participant, deltaSec, nowMs);
    }
  }

  private updateParticipant(
    participant: MutablePlayer,
    deltaSec: number,
    nowMs: number,
  ): void {
    participant.weapons.update(nowMs);
    if (participant.hp === 0) {
      return;
    }
    if (
      this.machineGunController.locksMovement &&
      this.machineGunController.getMounted(participant.id)
    ) {
      participant.moveDirX = 0;
      participant.moveDirY = 0;
      participant.isCrouch = false;
      return;
    }

    const yawRad = (participant.aimYaw * Math.PI) / 180;
    const speed = participant.isCrouch
      ? this.config.player.crouchSpeed
      : this.config.player.moveSpeed;
    const rightX = Math.cos(yawRad);
    const rightZ = -Math.sin(yawRad);
    const forwardX = -Math.sin(yawRad);
    const forwardZ = -Math.cos(yawRad);
    const halfWidth = this.config.arena.widthM / 2;
    const halfDepth = this.config.arena.depthM / 2;

    participant.position = {
      x: clamp(
        participant.position.x +
          (rightX * participant.moveDirX +
            forwardX * participant.moveDirY) *
            speed *
            deltaSec,
        -halfWidth,
        halfWidth,
      ),
      y: participant.position.y,
      z: clamp(
        participant.position.z +
          (rightZ * participant.moveDirX +
            forwardZ * participant.moveDirY) *
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
    ammoState?: Pick<WeaponState, 'magazineAmmo' | 'reserveAmmo'>,
    participant: MutablePlayer = this.player,
  ): M2FireResolution {
    ammoState ??= this.getFireAmmoState(
      message.payload.weaponId,
      participant,
    );
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
          ...ammoState,
        },
      },
    };
  }

  private createMissResult(
    message: FireMessage,
    ammoState: Pick<
      WeaponState,
      'magazineAmmo' | 'reserveAmmo'
    > = this.getFireAmmoState(message.payload.weaponId),
  ): FireResultMessage {
    return {
      type: SERVER_MESSAGE_TYPES.fireResult,
      payload: {
        clientTick: message.payload.clientTick,
        weaponId: message.payload.weaponId,
        accepted: true,
        hit: false,
        damage: 0,
        isKill: false,
        ...ammoState,
      },
    };
  }

  /**
   * 日军可攻击的目标 = 全部真人 + 全部 AI 队友。
   * 复用同一个数组缓冲，避免 20Hz 主循环每 tick 重新分配（AGENTS.md 性能红线）。
   */
  private getFriendlyTargets(): readonly FriendlyTarget[] {
    this.friendlyTargetBuffer.length = 0;
    for (const participant of this.players.values()) {
      this.friendlyTargetBuffer.push({
        id: participant.id,
        position: participant.position,
        alive: participant.hp > 0,
      });
    }
    for (const ally of this.allies) {
      this.friendlyTargetBuffer.push({
        id: ally.id,
        position: ally.position,
        alive: ally.isAlive,
      });
    }
    return this.friendlyTargetBuffer;
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
    const participant = this.players.get(allyId);
    if (participant) {
      return participant.hp > 0 ? participant.position : undefined;
    }
    const ally = this.allies.find(
      (candidate) => candidate.id === allyId && candidate.isAlive,
    );
    return ally?.position;
  }

  private getFriendlyExposure(allyId: string): number | undefined {
    const coverExposure =
      this.config.defenderCoverExposureMultiplier;
    const participant = this.players.get(allyId);
    if (participant) {
      if (participant.hp === 0) {
        return undefined;
      }
      if (this.machineGunController.getMounted(participant.id)) {
        return (
          coverExposure * this.machineGunController.hitboxMultiplier
        );
      }
      return participant.isCrouch
        ? coverExposure *
            this.config.player.crouchHitboxMultiplier
        : coverExposure;
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

  private getAmmoState(
    participant: MutablePlayer = this.player,
  ): Pick<WeaponState, 'magazineAmmo' | 'reserveAmmo'> {
    const state = participant.weapons.currentState;
    return {
      magazineAmmo: state.magazineAmmo,
      reserveAmmo: state.reserveAmmo,
    };
  }

  private getFireAmmoState(
    weaponId: string,
    participant: MutablePlayer = this.player,
  ): Pick<WeaponState, 'magazineAmmo' | 'reserveAmmo'> {
    const mounted = this.machineGunController.getMounted(participant.id);
    if (mounted && weaponId === mounted.weaponId) {
      return {
        magazineAmmo: mounted.beltAmmo,
        reserveAmmo: 0,
      };
    }
    return this.getAmmoState(participant);
  }

  private getPlayerWeaponState(
    participant: MutablePlayer = this.player,
  ): WeaponState {
    return participant.weapons.toProtocolState();
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

function directionToAim(direction: Vector3): {
  readonly yaw: number;
  readonly pitch: number;
} {
  return {
    yaw:
      (Math.atan2(-direction.x, -direction.z) * 180) / Math.PI,
    pitch: (Math.asin(clamp(direction.y, -1, 1)) * 180) / Math.PI,
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

function createWeaponRacks<TRouteId extends string>(
  roomId: string,
  weapons: Readonly<Record<string, M2PlayerWeaponConfig>>,
  defaultWeaponId: string,
  routes: readonly RouteLayout<TRouteId>[],
): readonly WeaponRackItemState[] {
  if (routes.length === 0) {
    throw new Error('生成武器架至少需要一条防守路线');
  }
  return Object.values(weapons)
    .filter((weapon) => weapon.weaponId !== defaultWeaponId)
    .map((weapon, index) => {
      const route = routes[index % routes.length];
      if (!route) {
        throw new Error('武器架缺少可用防守路线');
      }
      return {
        id: `${roomId}:rack:${weapon.weaponId}`,
        kind: 'weapon_rack',
        weaponId: weapon.weaponId,
        position: route.guardPosition,
        available: true,
      };
    });
}

function createMachineGunPlacements<TRouteId extends string>(
  roomId: string,
  nestCount: number,
  routes: readonly RouteLayout<TRouteId>[],
  playerHeightM: number,
): readonly MachineGunPlacement[] {
  if (routes.length === 0 || nestCount <= 0) {
    throw new Error('生成重机枪位需要防守路线和正数枪位数量');
  }

  return Array.from({ length: nestCount }, (_, index) => {
    const routeIndex =
      nestCount === 1
        ? Math.floor(routes.length / 2)
        : Math.round(
            (index * (routes.length - 1)) / (nestCount - 1),
          );
    const route = routes[routeIndex];
    if (!route) {
      throw new Error(`重机枪位 ${index} 缺少可用防守路线`);
    }
    return {
      id: `${roomId}:mg:${index + 1}`,
      position: {
        ...route.guardPosition,
        y: playerHeightM,
      },
      baseYaw: yawToward(route.guardPosition, route.spawnPosition),
    };
  });
}

function yawToward(origin: Vector3, target: Vector3): number {
  return (
    (Math.atan2(
      -(target.x - origin.x),
      -(target.z - origin.z),
    ) *
      180) /
    Math.PI
  );
}
