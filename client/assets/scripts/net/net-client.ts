import type {
  AllyState,
  ClientMessage,
  EnemyState,
  EnemyDiedMessage,
  FireMessage,
  FireResultMessage,
  InputStateMessage,
  JoinMessage,
  PongMessage,
  ReloadMessage,
  ServerMessage,
  SnapshotMessage,
  Vector2,
  Vector3,
  WeaponState,
  WorldSnapshotMessage,
} from '../../../../shared/protocol';

import { getWebSocketUrl } from './server-config';

export type ConnectionStatus =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'measuring' }
  | { readonly kind: 'connected'; readonly latencyMs: number }
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'error'; readonly message: string };

type StatusListener = (status: ConnectionStatus) => void;

export interface NetClientListener {
  readonly onStatus: StatusListener;
  readonly onSnapshot: (message: SnapshotMessage) => void;
  readonly onWorldSnapshot: (message: WorldSnapshotMessage) => void;
  readonly onFireResult: (message: FireResultMessage) => void;
  readonly onEnemyDied: (message: EnemyDiedMessage) => void;
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
    typeof value.hp === 'number' &&
    typeof value.maxHp === 'number' &&
    isVector3(value.position) &&
    typeof value.aimYaw === 'number' &&
    typeof value.aimPitch === 'number' &&
    typeof value.isCrouch === 'boolean' &&
    isWeaponState(value.weapon)
  );
}

function isEnemyState(value: unknown): value is EnemyState {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.enemyType === 'string' &&
    typeof value.hp === 'number' &&
    typeof value.maxHp === 'number' &&
    isVector3(value.position) &&
    typeof value.alive === 'boolean'
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
    Array.isArray(value.payload.items)
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
    isWorldSnapshotMessage(parsed) ||
    isFireResultMessage(parsed) ||
    isEnemyDiedMessage(parsed)
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
          playerName: 'Mac M1 客户端',
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
        case 'world_snapshot':
          this.listener.onWorldSnapshot(message);
          break;
        case 'fire_result':
          this.listener.onFireResult(message);
          break;
        case 'enemy_died':
          this.listener.onEnemyDied(message);
          break;
      }
    });

    socket.addEventListener('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.listener.onStatus({ kind: 'disconnected' });
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
