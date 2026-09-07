import {
  CLIENT_MESSAGE_TYPES,
  PROTOCOL_VERSION,
  type ClientMessage,
  type CreateRoomMessage,
  type FireMessage,
  type InputStateMessage,
  type JoinMessage,
  type JoinRoomMessage,
  type MountMgMessage,
  type PingMessage,
  type PlayerReadyMessage,
  type PickupMessage,
  type ReloadMessage,
  type QuickMatchMessage,
  type ReconnectMessage,
  type StartMatchMessage,
  type SwitchWeaponMessage,
  type ThrowGrenadeMessage,
  type UnmountMgMessage,
  type UseMedkitMessage,
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

function isPlayerName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 32;
}

function isCreateRoomMessage(value: unknown): value is CreateRoomMessage {
  return isRecord(value) &&
    value.type === CLIENT_MESSAGE_TYPES.createRoom &&
    isRecord(value.payload) &&
    isPlayerName(value.payload.playerName) &&
    value.payload.protocolVersion === PROTOCOL_VERSION;
}

function isJoinRoomMessage(value: unknown): value is JoinRoomMessage {
  return isRecord(value) &&
    value.type === CLIENT_MESSAGE_TYPES.joinRoom &&
    isRecord(value.payload) &&
    typeof value.payload.roomCode === 'string' &&
    /^[A-Z0-9]{4,8}$/.test(value.payload.roomCode) &&
    isPlayerName(value.payload.playerName) &&
    value.payload.protocolVersion === PROTOCOL_VERSION;
}

function isQuickMatchMessage(value: unknown): value is QuickMatchMessage {
  return isRecord(value) &&
    value.type === CLIENT_MESSAGE_TYPES.quickMatch &&
    isRecord(value.payload) &&
    isPlayerName(value.payload.playerName) &&
    value.payload.protocolVersion === PROTOCOL_VERSION;
}

function isEmptyActionMessage(
  value: unknown,
  type: string,
): value is PlayerReadyMessage | StartMatchMessage {
  return isRecord(value) &&
    value.type === type &&
    isRecord(value.payload) &&
    Object.keys(value.payload).length === 0;
}

function isReconnectMessage(value: unknown): value is ReconnectMessage {
  return isRecord(value) &&
    value.type === CLIENT_MESSAGE_TYPES.reconnect &&
    isRecord(value.payload) &&
    typeof value.payload.reconnectToken === 'string' &&
    value.payload.reconnectToken.length >= 16 &&
    value.payload.protocolVersion === PROTOCOL_VERSION;
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

function isSwitchWeaponMessage(
  value: unknown,
): value is SwitchWeaponMessage {
  return (
    isRecord(value) &&
    value.type === CLIENT_MESSAGE_TYPES.switchWeapon &&
    isRecord(value.payload) &&
    isWeaponId(value.payload.weaponId) &&
    isClientTick(value.payload.clientTick)
  );
}

function isUseMedkitMessage(value: unknown): value is UseMedkitMessage {
  return (
    isRecord(value) &&
    value.type === CLIENT_MESSAGE_TYPES.useMedkit &&
    isRecord(value.payload) &&
    isClientTick(value.payload.clientTick)
  );
}

function isPickupMessage(value: unknown): value is PickupMessage {
  return (
    isRecord(value) &&
    value.type === CLIENT_MESSAGE_TYPES.pickup &&
    isRecord(value.payload) &&
    typeof value.payload.itemId === 'string' &&
    value.payload.itemId.trim().length > 0 &&
    isClientTick(value.payload.clientTick)
  );
}

function isMountMgMessage(value: unknown): value is MountMgMessage {
  return (
    isRecord(value) &&
    value.type === CLIENT_MESSAGE_TYPES.mountMg &&
    isRecord(value.payload) &&
    typeof value.payload.mgId === 'string' &&
    value.payload.mgId.trim().length > 0 &&
    isClientTick(value.payload.clientTick)
  );
}

function isUnmountMgMessage(value: unknown): value is UnmountMgMessage {
  return (
    isRecord(value) &&
    value.type === CLIENT_MESSAGE_TYPES.unmountMg &&
    isRecord(value.payload) &&
    isClientTick(value.payload.clientTick)
  );
}

function isThrowGrenadeMessage(
  value: unknown,
): value is ThrowGrenadeMessage {
  return (
    isRecord(value) &&
    value.type === CLIENT_MESSAGE_TYPES.throwGrenade &&
    isRecord(value.payload) &&
    isVector3(value.payload.originPos) &&
    isVector3(value.payload.dirVec) &&
    isFiniteNumber(value.payload.force) &&
    value.payload.force >= 0 &&
    value.payload.force <= 1 &&
    isClientTick(value.payload.clientTick)
  );
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
    isCreateRoomMessage(parsed) ||
    isJoinRoomMessage(parsed) ||
    isQuickMatchMessage(parsed) ||
    isEmptyActionMessage(parsed, CLIENT_MESSAGE_TYPES.playerReady) ||
    isEmptyActionMessage(parsed, CLIENT_MESSAGE_TYPES.startMatch) ||
    isReconnectMessage(parsed) ||
    isPingMessage(parsed) ||
    isInputStateMessage(parsed) ||
    isFireMessage(parsed) ||
    isReloadMessage(parsed) ||
    isSwitchWeaponMessage(parsed) ||
    isUseMedkitMessage(parsed) ||
    isPickupMessage(parsed) ||
    isMountMgMessage(parsed) ||
    isUnmountMgMessage(parsed) ||
    isThrowGrenadeMessage(parsed)
  ) {
    return parsed;
  }

  return undefined;
}
