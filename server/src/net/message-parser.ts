import {
  CLIENT_MESSAGE_TYPES,
  PROTOCOL_VERSION,
  type ClientMessage,
  type FireMessage,
  type InputStateMessage,
  type JoinMessage,
  type PingMessage,
  type ReloadMessage,
  type Vector2,
  type Vector3,
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isClientTick(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isVector2(value: unknown): value is Vector2 {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y)
  );
}

function isMoveDirection(value: unknown): value is Vector2 {
  return (
    isVector2(value) &&
    value.x >= -1 &&
    value.x <= 1 &&
    value.y >= -1 &&
    value.y <= 1
  );
}

function isVector3(value: unknown): value is Vector3 {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z)
  );
}

function isWeaponId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isInputStateMessage(value: unknown): value is InputStateMessage {
  if (
    !isRecord(value) ||
    value.type !== CLIENT_MESSAGE_TYPES.inputState ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  return (
    isClientTick(value.payload.clientTick) &&
    isMoveDirection(value.payload.moveDir) &&
    isFiniteNumber(value.payload.aimYaw) &&
    isFiniteNumber(value.payload.aimPitch) &&
    typeof value.payload.isCrouch === 'boolean'
  );
}

function isFireMessage(value: unknown): value is FireMessage {
  if (
    !isRecord(value) ||
    value.type !== CLIENT_MESSAGE_TYPES.fire ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  return (
    isWeaponId(value.payload.weaponId) &&
    isVector3(value.payload.originPos) &&
    isVector3(value.payload.dirVec) &&
    isClientTick(value.payload.clientTick)
  );
}

function isReloadMessage(value: unknown): value is ReloadMessage {
  if (
    !isRecord(value) ||
    value.type !== CLIENT_MESSAGE_TYPES.reload ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  return isWeaponId(value.payload.weaponId);
}

export function parseClientMessage(raw: string): ClientMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (
    isJoinMessage(parsed) ||
    isPingMessage(parsed) ||
    isInputStateMessage(parsed) ||
    isFireMessage(parsed) ||
    isReloadMessage(parsed)
  ) {
    return parsed;
  }

  return undefined;
}
