import {
  CLIENT_MESSAGE_TYPES,
  PROTOCOL_VERSION,
  type ClientMessage,
  type JoinMessage,
  type PingMessage,
} from '../../../shared/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJoinMessage(value: unknown): value is JoinMessage {
  if (
    !isRecord(value) ||
    value.type !== CLIENT_MESSAGE_TYPES.join ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  return (
    typeof value.payload.playerName === 'string' &&
    value.payload.playerName.trim().length > 0 &&
    value.payload.protocolVersion === PROTOCOL_VERSION
  );
}

function isPingMessage(value: unknown): value is PingMessage {
  if (
    !isRecord(value) ||
    value.type !== CLIENT_MESSAGE_TYPES.ping ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  return (
    typeof value.payload.clientTimeMs === 'number' &&
    Number.isFinite(value.payload.clientTimeMs)
  );
}

export function parseClientMessage(raw: string): ClientMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (isJoinMessage(parsed) || isPingMessage(parsed)) {
    return parsed;
  }

  return undefined;
}
