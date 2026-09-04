import type {
  AllyAiState,
  AllyCalloutMessage,
  AllyDamagedMessage,
  AllyDiedMessage,
  AllyState,
  ActionResultMessage,
  ClientMessage,
  EnemyState,
  EnemyDiedMessage,
  FireMessage,
  FireResultMessage,
  InputStateMessage,
  ItemState,
  JoinMessage,
  MachineGunState,
  MatchEndMessage,
  MatchProgressState,
  MatchStartMessage,
  MountMgMessage,
  PickupMessage,
  PongMessage,
  ReloadMessage,
  RoomSeatState,
  RoomStateMessage,
  RouteId,
  ServerMessage,
  SnapshotMessage,
  SupplyDropMessage,
  SwitchWeaponMessage,
  ThrowGrenadeMessage,
  UnmountMgMessage,
  UseMedkitMessage,
  Vector2,
  Vector3,
  WeaponState,
  WorldSnapshotMessage,
  WaveStartMessage,
} from '../../../../shared/protocol';

import { getWebSocketUrl } from './server-config';

export type ConnectionStatus =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'measuring' }
  | { readonly kind: 'connected'; readonly latencyMs: number }
  | {
      readonly kind: 'disconnected';
      readonly code: number;
      readonly reason: string;
    }
  | { readonly kind: 'error'; readonly message: string };

type StatusListener = (status: ConnectionStatus) => void;

export interface NetClientListener {
  readonly onStatus: StatusListener;
  readonly onSnapshot: (message: SnapshotMessage) => void;
  readonly onRoomState: (message: RoomStateMessage) => void;
  readonly onWorldSnapshot: (message: WorldSnapshotMessage) => void;
  readonly onFireResult: (message: FireResultMessage) => void;
  readonly onEnemyDied: (message: EnemyDiedMessage) => void;
  readonly onAllyCallout: (message: AllyCalloutMessage) => void;
  readonly onAllyDamaged: (message: AllyDamagedMessage) => void;
  readonly onAllyDied: (message: AllyDiedMessage) => void;
  readonly onActionResult: (message: ActionResultMessage) => void;
  readonly onMatchStart: (message: MatchStartMessage) => void;
  readonly onWaveStart: (message: WaveStartMessage) => void;
  readonly onSupplyDrop: (message: SupplyDropMessage) => void;
  readonly onMatchEnd: (message: MatchEndMessage) => void;
}

export interface InputState {
  readonly moveDir: Vector2;
  readonly aimYaw: number;
  readonly aimPitch: number;
  readonly isCrouch: boolean;
}

const PROTOCOL_VERSION: JoinMessage['payload']['protocolVersion'] = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRouteId(value: unknown): value is RouteId {
  return value === 'A' || value === 'B' || value === 'C';
}

function isAllyAiState(value: unknown): value is AllyAiState {
  return (
    value === 'deploy' ||
    value === 'guard' ||
    value === 'engage' ||
    value === 'reassign' ||
    value === 'dead'
  );
}

function isPongMessage(value: unknown): value is PongMessage {
  if (
    !isRecord(value) ||
    value.type !== 'pong' ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  return (
    typeof value.payload.clientTimeMs === 'number' &&
    Number.isFinite(value.payload.clientTimeMs) &&
    typeof value.payload.serverTimeMs === 'number' &&
    Number.isFinite(value.payload.serverTimeMs)
  );
}

function isVector3(value: unknown): value is Vector3 {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y) &&
    typeof value.z === 'number' &&
    Number.isFinite(value.z)
  );
}

function isWeaponState(value: unknown): value is WeaponState {
  return (
    isRecord(value) &&
    typeof value.weaponId === 'string' &&
    typeof value.magazineAmmo === 'number' &&
    typeof value.reserveAmmo === 'number' &&
    typeof value.isReloading === 'boolean'
  );
}

function isAllyState(value: unknown): value is AllyState {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.isBot === 'boolean' &&
    Number.isSafeInteger(value.seatIndex) &&
    typeof value.heroName === 'string' &&
    isRouteId(value.routeId) &&
    (value.aiState === undefined || isAllyAiState(value.aiState)) &&
    typeof value.hp === 'number' &&
    typeof value.maxHp === 'number' &&
    isVector3(value.position) &&
    typeof value.aimYaw === 'number' &&
    typeof value.aimPitch === 'number' &&
    typeof value.isCrouch === 'boolean' &&
    Array.isArray(value.availableWeaponIds) &&
    value.availableWeaponIds.every((weaponId) =>
      typeof weaponId === 'string'
    ) &&
    isFiniteNumber(value.grenadesRemaining) &&
    isFiniteNumber(value.medkitsRemaining) &&
    (value.medkitEndsAtMs === undefined ||
      isFiniteNumber(value.medkitEndsAtMs)) &&
    (value.mountedMgId === undefined ||
      typeof value.mountedMgId === 'string') &&
    isWeaponState(value.weapon)
  );
}

function isEnemyState(value: unknown): value is EnemyState {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.enemyType === 'string' &&
    isRouteId(value.routeId) &&
    (value.aiState === 'advance' ||
      value.aiState === 'engage' ||
      value.aiState === 'dead') &&
    (value.fireWarningEndsAtMs === undefined ||
      isFiniteNumber(value.fireWarningEndsAtMs)) &&
    typeof value.hp === 'number' &&
    typeof value.maxHp === 'number' &&
    isVector3(value.position) &&
    typeof value.alive === 'boolean'
  );
}

function isRoomSeatState(value: unknown): value is RoomSeatState {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.seatIndex) &&
    typeof value.heroName === 'string' &&
    typeof value.occupantId === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.isBot === 'boolean' &&
    typeof value.alive === 'boolean' &&
    isRouteId(value.routeId)
  );
}

function isRoomStateMessage(value: unknown): value is RoomStateMessage {
  return (
    isRecord(value) &&
    value.type === 'room_state' &&
    isRecord(value.payload) &&
    typeof value.payload.roomId === 'string' &&
    (value.payload.status === 'forming' ||
      value.payload.status === 'active' ||
      value.payload.status === 'ended') &&
    Array.isArray(value.payload.seats) &&
    value.payload.seats.every(isRoomSeatState)
  );
}

function isSnapshotMessage(value: unknown): value is SnapshotMessage {
  return (
    isRecord(value) &&
    value.type === 'snapshot' &&
    isRecord(value.payload) &&
    typeof value.payload.sequence === 'number' &&
    typeof value.payload.serverTimeMs === 'number' &&
    typeof value.payload.onlineClients === 'number' &&
    isRecord(value.payload.connection) &&
    typeof value.payload.connection.clientId === 'string' &&
    typeof value.payload.connection.joined === 'boolean'
  );
}

function isWorldSnapshotMessage(
  value: unknown,
): value is WorldSnapshotMessage {
  return (
    isRecord(value) &&
    value.type === 'world_snapshot' &&
    isRecord(value.payload) &&
    typeof value.payload.tick === 'number' &&
    typeof value.payload.serverTimeMs === 'number' &&
    Array.isArray(value.payload.allies) &&
    value.payload.allies.every(isAllyState) &&
    Array.isArray(value.payload.enemies) &&
    value.payload.enemies.every(isEnemyState) &&
    Array.isArray(value.payload.items) &&
    value.payload.items.every(isItemState) &&
    isMatchProgressState(value.payload.match) &&
    Array.isArray(value.payload.machineGuns) &&
    value.payload.machineGuns.every(isMachineGunState)
  );
}

function isItemState(value: unknown): value is ItemState {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isVector3(value.position) ||
    typeof value.available !== 'boolean'
  ) {
    return false;
  }
  if (value.kind === 'airdrop_medkit') {
    return isFiniteNumber(value.expiresAtMs);
  }
  return value.kind === 'weapon_rack' && typeof value.weaponId === 'string';
}

function isMatchProgressState(value: unknown): value is MatchProgressState {
  return (
    isRecord(value) &&
    isFiniteNumber(value.startedAtMs) &&
    isFiniteNumber(value.endsAtMs) &&
    (value.phase === 'deploy' ||
      value.phase === 'wave' ||
      value.phase === 'intermission' ||
      value.phase === 'ended') &&
    isFiniteNumber(value.currentWaveIndex) &&
    isFiniteNumber(value.totalWaves) &&
    isFiniteNumber(value.spawnedEnemies) &&
    isFiniteNumber(value.defeatedEnemies) &&
    isFiniteNumber(value.remainingEnemies) &&
    isFiniteNumber(value.totalEnemies)
  );
}

function isMachineGunState(value: unknown): value is MachineGunState {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.weaponId === 'string' &&
    isVector3(value.position) &&
    isFiniteNumber(value.baseYaw) &&
    (value.occupantId === undefined || typeof value.occupantId === 'string') &&
    isFiniteNumber(value.beltAmmo) &&
    isFiniteNumber(value.heatRatio) &&
    typeof value.isOverheated === 'boolean' &&
    (value.cooldownEndsAtMs === undefined ||
      isFiniteNumber(value.cooldownEndsAtMs)) &&
    (value.reloadEndsAtMs === undefined ||
      isFiniteNumber(value.reloadEndsAtMs))
  );
}

function isFireResultMessage(value: unknown): value is FireResultMessage {
  if (
    !isRecord(value) ||
    value.type !== 'fire_result' ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  const payload = value.payload;
  if (
    typeof payload.clientTick !== 'number' ||
    typeof payload.weaponId !== 'string' ||
    typeof payload.magazineAmmo !== 'number' ||
    typeof payload.reserveAmmo !== 'number' ||
    typeof payload.accepted !== 'boolean' ||
    typeof payload.hit !== 'boolean' ||
    typeof payload.damage !== 'number' ||
    typeof payload.isKill !== 'boolean'
  ) {
    return false;
  }

  if (!payload.accepted) {
    return typeof payload.rejectReason === 'string' && !payload.hit;
  }
  if (!payload.hit) {
    return payload.damage === 0 && !payload.isKill;
  }
  return (
    typeof payload.targetId === 'string' &&
    (payload.hitPart === 'head' ||
      payload.hitPart === 'torso' ||
      payload.hitPart === 'limb')
  );
}

function isEnemyDiedMessage(value: unknown): value is EnemyDiedMessage {
  return (
    isRecord(value) &&
    value.type === 'enemy_died' &&
    isRecord(value.payload) &&
    typeof value.payload.enemyId === 'string' &&
    typeof value.payload.killerId === 'string' &&
    typeof value.payload.killerIsBot === 'boolean'
  );
}

function isAllyCalloutMessage(value: unknown): value is AllyCalloutMessage {
  return (
    isRecord(value) &&
    value.type === 'ally_callout' &&
    isRecord(value.payload) &&
    typeof value.payload.allyId === 'string' &&
    isRouteId(value.payload.routeId) &&
    typeof value.payload.text === 'string'
  );
}

function isAllyDamagedMessage(value: unknown): value is AllyDamagedMessage {
  return (
    isRecord(value) &&
    value.type === 'ally_damaged' &&
    isRecord(value.payload) &&
    typeof value.payload.allyId === 'string' &&
    isFiniteNumber(value.payload.hp) &&
    isVector3(value.payload.fromDir)
  );
}

function isAllyDiedMessage(value: unknown): value is AllyDiedMessage {
  return (
    isRecord(value) &&
    value.type === 'ally_died' &&
    isRecord(value.payload) &&
    typeof value.payload.allyId === 'string' &&
    typeof value.payload.isBot === 'boolean' &&
    typeof value.payload.killerType === 'string'
  );
}

function isActionResultMessage(value: unknown): value is ActionResultMessage {
  return (
    isRecord(value) &&
    value.type === 'action_result' &&
    isRecord(value.payload) &&
    Number.isSafeInteger(value.payload.clientTick) &&
    typeof value.payload.action === 'string' &&
    typeof value.payload.accepted === 'boolean' &&
    (value.payload.accepted || typeof value.payload.rejectReason === 'string')
  );
}

function isMatchStartMessage(value: unknown): value is MatchStartMessage {
  return (
    isRecord(value) &&
    value.type === 'match_start' &&
    isRecord(value.payload) &&
    typeof value.payload.matchId === 'string' &&
    isFiniteNumber(value.payload.startedAtMs) &&
    isFiniteNumber(value.payload.deployEndsAtMs) &&
    isFiniteNumber(value.payload.endsAtMs) &&
    isFiniteNumber(value.payload.totalWaves) &&
    isFiniteNumber(value.payload.totalEnemies)
  );
}

function isWaveStartMessage(value: unknown): value is WaveStartMessage {
  return (
    isRecord(value) &&
    value.type === 'wave_start' &&
    isRecord(value.payload) &&
    isFiniteNumber(value.payload.waveIndex) &&
    isFiniteNumber(value.payload.enemyCount) &&
    isFiniteNumber(value.payload.totalWaves) &&
    isFiniteNumber(value.payload.startedAtMs)
  );
}

function isSupplyDropMessage(value: unknown): value is SupplyDropMessage {
  return (
    isRecord(value) &&
    value.type === 'supply_drop' &&
    isRecord(value.payload) &&
    typeof value.payload.dropId === 'string' &&
    isVector3(value.payload.position) &&
    isFiniteNumber(value.payload.expiresAtMs) &&
    typeof value.payload.text === 'string'
  );
}

function isMatchEndMessage(value: unknown): value is MatchEndMessage {
  return (
    isRecord(value) &&
    value.type === 'match_end' &&
    isRecord(value.payload) &&
    typeof value.payload.matchId === 'string' &&
    (value.payload.result === 'victory' ||
      value.payload.result === 'defeat') &&
    (value.payload.reason === 'time_survived' ||
      value.payload.reason === 'player_died' ||
      value.payload.reason === 'squad_eliminated') &&
    isFiniteNumber(value.payload.endedAtMs) &&
    Array.isArray(value.payload.scoreboard) &&
    value.payload.scoreboard.every(isScoreboardEntry) &&
    (value.payload.mvpPlayerId === undefined ||
      typeof value.payload.mvpPlayerId === 'string') &&
    isFiniteNumber(value.payload.spawnedEnemies) &&
    isFiniteNumber(value.payload.defeatedEnemies) &&
    isFiniteNumber(value.payload.totalEnemies)
  );
}

function isScoreboardEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.occupantId === 'string' &&
    Number.isSafeInteger(value.seatIndex) &&
    typeof value.heroName === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.isBot === 'boolean' &&
    typeof value.alive === 'boolean' &&
    isFiniteNumber(value.kills) &&
    isFiniteNumber(value.mgKills) &&
    isFiniteNumber(value.headshots) &&
    isFiniteNumber(value.shotsFired) &&
    isFiniteNumber(value.shotsHit) &&
    isFiniteNumber(value.accuracy) &&
    isFiniteNumber(value.survivalSec) &&
    isFiniteNumber(value.damageDealt) &&
    isFiniteNumber(value.damageTaken) &&
    isFiniteNumber(value.medkitUsed) &&
    Array.isArray(value.killsByWave) &&
    value.killsByWave.every(isFiniteNumber)
  );
}

function parseServerMessage(raw: string): ServerMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (
    isPongMessage(parsed) ||
    isSnapshotMessage(parsed) ||
    isRoomStateMessage(parsed) ||
    isWorldSnapshotMessage(parsed) ||
    isFireResultMessage(parsed) ||
    isEnemyDiedMessage(parsed) ||
    isAllyCalloutMessage(parsed) ||
    isAllyDamagedMessage(parsed) ||
    isAllyDiedMessage(parsed) ||
    isActionResultMessage(parsed) ||
    isMatchStartMessage(parsed) ||
    isWaveStartMessage(parsed) ||
    isSupplyDropMessage(parsed) ||
    isMatchEndMessage(parsed)
  ) {
    return parsed;
  }

  return undefined;
}

export class NetClient {
  private socket: WebSocket | null = null;
  private nextClientTick = 0;
  private readonly listener: NetClientListener;

  constructor(listener: NetClientListener) {
    this.listener = listener;
  }

  async connect(): Promise<void> {
    this.disconnect();
    this.nextClientTick = 0;
    this.listener.onStatus({ kind: 'connecting' });

    let url: string;
    try {
      url = await getWebSocketUrl();
    } catch (error: unknown) {
      this.listener.onStatus({
        kind: 'error',
        message: this.describeError(error),
      });
      return;
    }

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }

      const joinMessage: JoinMessage = {
        type: 'join',
        payload: {
          playerName: 'Mac M2 客户端',
          protocolVersion: PROTOCOL_VERSION,
        },
      };
      this.send(joinMessage);

      const pingMessage: ClientMessage = {
        type: 'ping',
        payload: { clientTimeMs: Date.now() },
      };
      this.send(pingMessage);
      this.listener.onStatus({ kind: 'measuring' });
    });

    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (this.socket !== socket || typeof event.data !== 'string') {
        return;
      }

      const message = parseServerMessage(event.data);
      if (!message) {
        return;
      }

      switch (message.type) {
        case 'pong': {
          const latencyMs = Math.max(
            0,
            Math.round(Date.now() - message.payload.clientTimeMs),
          );
          this.listener.onStatus({ kind: 'connected', latencyMs });
          break;
        }
        case 'snapshot':
          this.listener.onSnapshot(message);
          break;
        case 'room_state':
          this.listener.onRoomState(message);
          break;
        case 'world_snapshot':
          this.listener.onWorldSnapshot(message);
          break;
        case 'fire_result':
          this.listener.onFireResult(message);
          break;
        case 'enemy_died':
          this.listener.onEnemyDied(message);
          break;
        case 'ally_callout':
          this.listener.onAllyCallout(message);
          break;
        case 'ally_damaged':
          this.listener.onAllyDamaged(message);
          break;
        case 'ally_died':
          this.listener.onAllyDied(message);
          break;
        case 'action_result':
          this.listener.onActionResult(message);
          break;
        case 'match_start':
          this.listener.onMatchStart(message);
          break;
        case 'wave_start':
          this.listener.onWaveStart(message);
          break;
        case 'supply_drop':
          this.listener.onSupplyDrop(message);
          break;
        case 'match_end':
          this.listener.onMatchEnd(message);
          break;
      }
    });

    socket.addEventListener('close', (event) => {
      if (this.socket === socket) {
        this.socket = null;
        this.listener.onStatus({
          kind: 'disconnected',
          code: event.code,
          reason: event.reason,
        });
      }
    });

    socket.addEventListener('error', () => {
      if (this.socket === socket) {
        this.listener.onStatus({
          kind: 'error',
          message: '无法连接服务器',
        });
      }
    });
  }

  sendInput(state: InputState): number | undefined {
    const clientTick = this.allocateClientTick();
    const message: InputStateMessage = {
      type: 'input_state',
      payload: { clientTick, ...state },
    };
    return this.send(message) ? clientTick : undefined;
  }

  fire(
    weaponId: string,
    originPos: Vector3,
    dirVec: Vector3,
  ): number | undefined {
    const clientTick = this.allocateClientTick();
    const message: FireMessage = {
      type: 'fire',
      payload: { weaponId, originPos, dirVec, clientTick },
    };
    return this.send(message) ? clientTick : undefined;
  }

  reload(weaponId: string): boolean {
    const message: ReloadMessage = {
      type: 'reload',
      payload: { weaponId },
    };
    return this.send(message);
  }

  switchWeapon(weaponId: string): number | undefined {
    const clientTick = this.allocateClientTick();
    const message: SwitchWeaponMessage = {
      type: 'switch_weapon',
      payload: { weaponId, clientTick },
    };
    return this.send(message) ? clientTick : undefined;
  }

  useMedkit(): number | undefined {
    const clientTick = this.allocateClientTick();
    const message: UseMedkitMessage = {
      type: 'use_medkit',
      payload: { clientTick },
    };
    return this.send(message) ? clientTick : undefined;
  }

  pickup(itemId: string): number | undefined {
    const clientTick = this.allocateClientTick();
    const message: PickupMessage = {
      type: 'pickup',
      payload: { itemId, clientTick },
    };
    return this.send(message) ? clientTick : undefined;
  }

  mountMachineGun(mgId: string): number | undefined {
    const clientTick = this.allocateClientTick();
    const message: MountMgMessage = {
      type: 'mount_mg',
      payload: { mgId, clientTick },
    };
    return this.send(message) ? clientTick : undefined;
  }

  unmountMachineGun(): number | undefined {
    const clientTick = this.allocateClientTick();
    const message: UnmountMgMessage = {
      type: 'unmount_mg',
      payload: { clientTick },
    };
    return this.send(message) ? clientTick : undefined;
  }

  throwGrenade(
    originPos: Vector3,
    dirVec: Vector3,
    force: number,
  ): number | undefined {
    const clientTick = this.allocateClientTick();
    const message: ThrowGrenadeMessage = {
      type: 'throw_grenade',
      payload: { originPos, dirVec, force, clientTick },
    };
    return this.send(message) ? clientTick : undefined;
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private allocateClientTick(): number {
    const tick = this.nextClientTick;
    this.nextClientTick += 1;
    return tick;
  }

  private send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : '未知错误';
  }
}
