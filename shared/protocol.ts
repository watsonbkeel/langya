export const PROTOCOL_VERSION = 1 as const;

export const CLIENT_MESSAGE_TYPES = {
  join: 'join',
  ping: 'ping',
  inputState: 'input_state',
  fire: 'fire',
  reload: 'reload',
  switchWeapon: 'switch_weapon',
  useMedkit: 'use_medkit',
  pickup: 'pickup',
  mountMg: 'mount_mg',
  unmountMg: 'unmount_mg',
  throwGrenade: 'throw_grenade',
} as const;

export const SERVER_MESSAGE_TYPES = {
  snapshot: 'snapshot',
  pong: 'pong',
  roomState: 'room_state',
  worldSnapshot: 'world_snapshot',
  fireResult: 'fire_result',
  enemyDied: 'enemy_died',
  allyCallout: 'ally_callout',
  allyDamaged: 'ally_damaged',
  allyDied: 'ally_died',
  actionResult: 'action_result',
  matchStart: 'match_start',
  waveStart: 'wave_start',
  supplyDrop: 'supply_drop',
  matchEnd: 'match_end',
} as const;

export type ClientMessageType =
  (typeof CLIENT_MESSAGE_TYPES)[keyof typeof CLIENT_MESSAGE_TYPES];

export type ServerMessageType =
  (typeof SERVER_MESSAGE_TYPES)[keyof typeof SERVER_MESSAGE_TYPES];

export interface MessageEnvelope<TType extends string, TPayload> {
  readonly type: TType;
  readonly payload: TPayload;
}

export interface JoinPayload {
  readonly playerName: string;
  readonly protocolVersion: typeof PROTOCOL_VERSION;
}

export type JoinMessage = MessageEnvelope<
  typeof CLIENT_MESSAGE_TYPES.join,
  JoinPayload
>;

export interface PingPayload {
  readonly clientTimeMs: number;
}

export type PingMessage = MessageEnvelope<
  typeof CLIENT_MESSAGE_TYPES.ping,
  PingPayload
>;

export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type RouteId = 'A' | 'B' | 'C';
export type AllyAiState =
  | 'deploy'
  | 'guard'
  | 'engage'
  | 'reassign'
  | 'dead';
export type EnemyAiState = 'advance' | 'engage' | 'dead';
export type RoomStatus = 'forming' | 'active' | 'ended';
export type HitPart = 'head' | 'torso' | 'limb';

export type FireRejectReason =
  | 'not_joined'
  | 'invalid_weapon'
  | 'invalid_origin'
  | 'invalid_direction'
  | 'cooldown'
  | 'empty_magazine'
  | 'reloading'
  | 'dead';

export interface InputStatePayload {
  readonly clientTick: number;
  readonly moveDir: Vector2;
  readonly aimYaw: number;
  readonly aimPitch: number;
  readonly isCrouch: boolean;
}

export type InputStateMessage = MessageEnvelope<
  typeof CLIENT_MESSAGE_TYPES.inputState,
  InputStatePayload
>;

export interface FirePayload {
  readonly weaponId: string;
  readonly originPos: Vector3;
  readonly dirVec: Vector3;
  readonly clientTick: number;
}

export type FireMessage = MessageEnvelope<
  typeof CLIENT_MESSAGE_TYPES.fire,
  FirePayload
>;

export interface ReloadPayload {
  readonly weaponId: string;
}

export type ReloadMessage = MessageEnvelope<
  typeof CLIENT_MESSAGE_TYPES.reload,
  ReloadPayload
>;

export interface SwitchWeaponPayload {
  readonly weaponId: string;
  readonly clientTick: number;
}

export type SwitchWeaponMessage = MessageEnvelope<
  typeof CLIENT_MESSAGE_TYPES.switchWeapon,
  SwitchWeaponPayload
>;

export interface UseMedkitPayload {
  readonly clientTick: number;
}

export type UseMedkitMessage = MessageEnvelope<
  typeof CLIENT_MESSAGE_TYPES.useMedkit,
  UseMedkitPayload
>;

export interface PickupPayload {
  readonly itemId: string;
  readonly clientTick: number;
}

export type PickupMessage = MessageEnvelope<
  typeof CLIENT_MESSAGE_TYPES.pickup,
  PickupPayload
>;

export interface MountMgPayload {
  readonly mgId: string;
  readonly clientTick: number;
}

export type MountMgMessage = MessageEnvelope<
  typeof CLIENT_MESSAGE_TYPES.mountMg,
  MountMgPayload
>;

export interface UnmountMgPayload {
  readonly clientTick: number;
}

export type UnmountMgMessage = MessageEnvelope<
  typeof CLIENT_MESSAGE_TYPES.unmountMg,
  UnmountMgPayload
>;

export interface ThrowGrenadePayload {
  readonly originPos: Vector3;
  readonly dirVec: Vector3;
  readonly force: number;
  readonly clientTick: number;
}

export type ThrowGrenadeMessage = MessageEnvelope<
  typeof CLIENT_MESSAGE_TYPES.throwGrenade,
  ThrowGrenadePayload
>;

export interface ConnectionSnapshot {
  readonly clientId: string;
  readonly joined: boolean;
  readonly playerName?: string;
}

export interface SnapshotPayload {
  readonly sequence: number;
  readonly serverTimeMs: number;
  readonly onlineClients: number;
  readonly connection: ConnectionSnapshot;
}

export type SnapshotMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.snapshot,
  SnapshotPayload
>;

export interface PongPayload {
  readonly clientTimeMs: number;
  readonly serverTimeMs: number;
}

export type PongMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.pong,
  PongPayload
>;

export interface RoomSeatState {
  readonly seatIndex: number;
  readonly heroName: string;
  readonly occupantId: string;
  readonly displayName: string;
  readonly isBot: boolean;
  readonly alive: boolean;
  readonly routeId: RouteId;
}

export interface RoomStatePayload {
  readonly roomId: string;
  readonly status: RoomStatus;
  readonly seats: readonly RoomSeatState[];
}

export type RoomStateMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.roomState,
  RoomStatePayload
>;

export interface WeaponState {
  readonly weaponId: string;
  readonly magazineAmmo: number;
  readonly reserveAmmo: number;
  readonly isReloading: boolean;
  readonly reloadEndsAtMs?: number;
}

export interface AllyState {
  readonly id: string;
  readonly isBot: boolean;
  readonly seatIndex: number;
  readonly heroName: string;
  readonly routeId: RouteId;
  readonly aiState?: AllyAiState;
  readonly hp: number;
  readonly maxHp: number;
  readonly position: Vector3;
  readonly aimYaw: number;
  readonly aimPitch: number;
  readonly isCrouch: boolean;
  readonly availableWeaponIds: readonly string[];
  readonly grenadesRemaining: number;
  readonly medkitsRemaining: number;
  /** @deprecated 随身血包已立即生效；服务端保留字段仅用于旧客户端类型兼容且不再发送。 */
  readonly medkitEndsAtMs?: number;
  readonly mountedMgId?: string;
  readonly weapon: WeaponState;
}

export interface EnemyState {
  readonly id: string;
  readonly enemyType: string;
  readonly routeId: RouteId;
  readonly aiState: EnemyAiState;
  readonly fireWarningEndsAtMs?: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly position: Vector3;
  readonly alive: boolean;
}

export interface SupplyItemState {
  readonly id: string;
  readonly kind: 'airdrop_medkit';
  readonly position: Vector3;
  readonly expiresAtMs: number;
  readonly available: boolean;
}

export interface WeaponRackItemState {
  readonly id: string;
  readonly kind: 'weapon_rack';
  readonly weaponId: string;
  readonly position: Vector3;
  readonly available: boolean;
}

export type ItemState = SupplyItemState | WeaponRackItemState;

export type MatchPhase =
  | 'deploy'
  | 'wave'
  | 'intermission'
  | 'ended';

export interface MatchProgressState {
  readonly startedAtMs: number;
  readonly endsAtMs: number;
  readonly phase: MatchPhase;
  readonly currentWaveIndex: number;
  readonly totalWaves: number;
  readonly spawnedEnemies: number;
  readonly defeatedEnemies: number;
  readonly remainingEnemies: number;
  readonly totalEnemies: number;
}

export interface MachineGunState {
  readonly id: string;
  readonly weaponId: string;
  readonly position: Vector3;
  /** 角度制，Cocos 世界坐标 Y 轴旋转角。 */
  readonly baseYaw: number;
  readonly occupantId?: string;
  readonly beltAmmo: number;
  /** 归一化热量，范围 [0, 1]。 */
  readonly heatRatio: number;
  readonly isOverheated: boolean;
  readonly cooldownEndsAtMs?: number;
  readonly reloadEndsAtMs?: number;
}

export interface WorldSnapshotPayload {
  readonly tick: number;
  readonly serverTimeMs: number;
  readonly allies: readonly AllyState[];
  readonly enemies: readonly EnemyState[];
  readonly items: readonly ItemState[];
  readonly match: MatchProgressState;
  readonly machineGuns: readonly MachineGunState[];
}

export type WorldSnapshotMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.worldSnapshot,
  WorldSnapshotPayload
>;

interface FireResultCommon {
  readonly clientTick: number;
  readonly weaponId: string;
  readonly magazineAmmo: number;
  readonly reserveAmmo: number;
}

export interface FireRejectedPayload extends FireResultCommon {
  readonly accepted: false;
  readonly rejectReason: FireRejectReason;
  readonly hit: false;
  readonly damage: 0;
  readonly isKill: false;
}

export interface FireMissPayload extends FireResultCommon {
  readonly accepted: true;
  readonly hit: false;
  readonly damage: 0;
  readonly isKill: false;
}

export interface FireHitPayload extends FireResultCommon {
  readonly accepted: true;
  readonly hit: true;
  readonly targetId: string;
  readonly damage: number;
  readonly isKill: boolean;
  readonly hitPart: HitPart;
}

export type FireResultPayload =
  | FireRejectedPayload
  | FireMissPayload
  | FireHitPayload;

export type FireResultMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.fireResult,
  FireResultPayload
>;

export interface EnemyDiedPayload {
  readonly enemyId: string;
  readonly killerId: string;
  readonly killerIsBot: boolean;
}

export type EnemyDiedMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.enemyDied,
  EnemyDiedPayload
>;

export interface AllyCalloutPayload {
  readonly allyId: string;
  readonly routeId: RouteId;
  readonly text: string;
}

export type AllyCalloutMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.allyCallout,
  AllyCalloutPayload
>;

export interface AllyDamagedPayload {
  readonly allyId: string;
  readonly hp: number;
  readonly fromDir: Vector3;
}

export type AllyDamagedMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.allyDamaged,
  AllyDamagedPayload
>;

export interface AllyDiedPayload {
  readonly allyId: string;
  readonly isBot: boolean;
  readonly killerType: string;
}

export type AllyDiedMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.allyDied,
  AllyDiedPayload
>;

export type ActionType =
  | 'switch_weapon'
  | 'use_medkit'
  | 'pickup'
  | 'mount_mg'
  | 'unmount_mg'
  | 'throw_grenade';

export type ActionRejectReason =
  | 'dead'
  | 'invalid_state'
  | 'invalid_target'
  | 'out_of_range'
  | 'unavailable'
  | 'cooldown'
  | 'no_resource'
  | 'occupied';

interface ActionResultCommon {
  readonly clientTick: number;
  readonly action: ActionType;
}

export interface ActionAcceptedPayload extends ActionResultCommon {
  readonly accepted: true;
}

export interface ActionRejectedPayload extends ActionResultCommon {
  readonly accepted: false;
  readonly rejectReason: ActionRejectReason;
}

export type ActionResultPayload =
  | ActionAcceptedPayload
  | ActionRejectedPayload;

export type ActionResultMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.actionResult,
  ActionResultPayload
>;

export interface MatchStartPayload {
  readonly matchId: string;
  readonly startedAtMs: number;
  readonly deployEndsAtMs: number;
  readonly endsAtMs: number;
  readonly totalWaves: number;
  readonly totalEnemies: number;
}

export type MatchStartMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.matchStart,
  MatchStartPayload
>;

export interface WaveStartPayload {
  readonly waveIndex: number;
  readonly enemyCount: number;
  readonly totalWaves: number;
  readonly startedAtMs: number;
}

export type WaveStartMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.waveStart,
  WaveStartPayload
>;

export interface SupplyDropPayload {
  readonly dropId: string;
  readonly position: Vector3;
  readonly expiresAtMs: number;
  readonly text: string;
}

export type SupplyDropMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.supplyDrop,
  SupplyDropPayload
>;

export type MatchResult = 'victory' | 'defeat';
export type MatchEndReason =
  | 'time_survived'
  | 'player_died'
  | 'squad_eliminated';

export interface ScoreboardEntry {
  readonly occupantId: string;
  readonly seatIndex: number;
  readonly heroName: string;
  readonly displayName: string;
  readonly isBot: boolean;
  readonly alive: boolean;
  readonly kills: number;
  readonly mgKills: number;
  readonly headshots: number;
  readonly shotsFired: number;
  readonly shotsHit: number;
  readonly accuracy: number;
  readonly survivalSec: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly medkitUsed: number;
  readonly killsByWave: readonly number[];
}

export interface MatchEndPayload {
  readonly matchId: string;
  readonly result: MatchResult;
  readonly reason: MatchEndReason;
  readonly endedAtMs: number;
  readonly scoreboard: readonly ScoreboardEntry[];
  readonly mvpPlayerId?: string;
  readonly spawnedEnemies: number;
  readonly defeatedEnemies: number;
  readonly totalEnemies: number;
}

export type MatchEndMessage = MessageEnvelope<
  typeof SERVER_MESSAGE_TYPES.matchEnd,
  MatchEndPayload
>;

export type ClientMessage =
  | JoinMessage
  | PingMessage
  | InputStateMessage
  | FireMessage
  | ReloadMessage
  | SwitchWeaponMessage
  | UseMedkitMessage
  | PickupMessage
  | MountMgMessage
  | UnmountMgMessage
  | ThrowGrenadeMessage;

export type ServerMessage =
  | SnapshotMessage
  | PongMessage
  | RoomStateMessage
  | WorldSnapshotMessage
  | FireResultMessage
  | EnemyDiedMessage
  | AllyCalloutMessage
  | AllyDamagedMessage
  | AllyDiedMessage
  | ActionResultMessage
  | MatchStartMessage
  | WaveStartMessage
  | SupplyDropMessage
  | MatchEndMessage;
