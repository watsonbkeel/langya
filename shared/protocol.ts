export const PROTOCOL_VERSION = 1 as const;

export const CLIENT_MESSAGE_TYPES = {
  join: 'join',
  ping: 'ping',
} as const;

export const SERVER_MESSAGE_TYPES = {
  snapshot: 'snapshot',
  pong: 'pong',
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

export type ClientMessage = JoinMessage | PingMessage;
export type ServerMessage = SnapshotMessage | PongMessage;
