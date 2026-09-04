export const PROTOCOL_VERSION = 1 as const;

export const CLIENT_MESSAGE_TYPES = {
  join: 'join',
  ping: 'ping',
  inputState: 'input_state',
  fire: 'fire',
  reload: 'reload',
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

export type ItemState = never;

export interface WorldSnapshotPayload {
  readonly tick: number;
  readonly serverTimeMs: number;
  readonly allies: readonly AllyState[];
  readonly enemies: readonly EnemyState[];
  readonly items: readonly ItemState[];
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

export type ClientMessage =
  | JoinMessage
  | PingMessage
  | InputStateMessage
  | FireMessage
  | ReloadMessage;

export type ServerMessage =
  | SnapshotMessage
  | PongMessage
  | RoomStateMessage
  | WorldSnapshotMessage
  | FireResultMessage
  | EnemyDiedMessage
  | AllyCalloutMessage
  | AllyDamagedMessage
  | AllyDiedMessage;
