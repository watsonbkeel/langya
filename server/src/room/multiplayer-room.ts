import { randomBytes, randomUUID } from 'node:crypto';

import {
  SERVER_MESSAGE_TYPES,
  type RoomStateMessage,
  type RouteId,
  type RoomStatus,
} from '../../../shared/protocol';

export interface MultiplayerRoomConfig<TRouteId extends RouteId> {
  readonly seatCount: number;
  readonly heroNames: readonly string[];
  readonly playerDefaultSeat: number;
  readonly playerRoute: TRouteId;
  readonly defaultAssignment: Readonly<Record<TRouteId, number>>;
}

export interface HumanOccupant {
  /**
   * 稳定的战斗身份，开局后不再变化。
   * 断线重连会换一条 WebSocket 连接，但席位上的人还是同一个，
   * 所以战斗会话里的 playerId 必须用这个，不能用连接 id。
   */
  readonly id: string;
  /** 当前占用这个席位的 WebSocket 连接 id，重连后会换。 */
  connectionId: string;
  readonly displayName: string;
  readonly reconnectToken: string;
  connected: boolean;
  ready: boolean;
}

export interface MultiplayerSeat<TRouteId extends RouteId> {
  readonly index: number;
  readonly heroName: string;
  readonly routeId: TRouteId;
  occupant: HumanOccupant | null;
  readonly botId: string;
}

export type RoomActionRejectReason =
  | 'room_full'
  | 'already_started'
  | 'not_host'
  | 'invalid_token'
  | 'invalid_state';

export interface RoomActionResult {
  readonly accepted: boolean;
  readonly reason?: RoomActionRejectReason;
  readonly seatIndex?: number;
  readonly reconnectToken?: string;
}

export interface MultiplayerRoomOptions<TRouteId extends RouteId> {
  readonly roomCode: string;
  readonly hostId: string;
  readonly hostName: string;
  readonly config: MultiplayerRoomConfig<TRouteId>;
}

/**
 * M5 的房间层只负责席位和真人连接身份，不运行战斗规则。
 * 战斗会话接入前，先用纯状态对象把“真人顶替 AI / 重连凭证”验证清楚。
 */
export class MultiplayerRoom<TRouteId extends RouteId> {
  readonly id: string;
  hostId: string;
  readonly seats: readonly MultiplayerSeat<TRouteId>[];

  private currentStatus: RoomStatus = 'forming';

  constructor(options: MultiplayerRoomOptions<TRouteId>) {
    validateConfig(options.config);
    this.id = options.roomCode;
    this.hostId = options.hostId;
    this.seats = createSeats(options);
  }

  get status(): RoomStatus {
    return this.currentStatus;
  }

  createHuman(
    playerId: string,
    playerName: string,
  ): RoomActionResult {
    if (this.currentStatus !== 'forming') {
      return { accepted: false, reason: 'already_started' };
    }
    if (this.findHuman(playerId)) {
      return { accepted: false, reason: 'invalid_state' };
    }
    const seat = this.seats.find((candidate) => candidate.occupant === null);
    if (!seat) {
      return { accepted: false, reason: 'room_full' };
    }
    const reconnectToken = createReconnectToken();
    seat.occupant = {
      id: createPlayerId(),
      connectionId: playerId,
      displayName: playerName,
      reconnectToken,
      connected: true,
      ready: false,
    };
    return {
      accepted: true,
      seatIndex: seat.index,
      reconnectToken,
    };
  }

  reconnect(
    playerId: string,
    reconnectToken: string,
  ): RoomActionResult {
    const seat = this.seats.find(
      (candidate) => candidate.occupant?.reconnectToken === reconnectToken,
    );
    if (!seat || !seat.occupant) {
      return { accepted: false, reason: 'invalid_token' };
    }
    // 只换连接 id，保留稳定的战斗身份，这样重连后能接回原席位的血量、弹药和战绩。
    seat.occupant = {
      ...seat.occupant,
      connectionId: playerId,
      connected: true,
    };
    if (seat.index === 0) {
      this.hostId = playerId;
    }
    return {
      accepted: true,
      seatIndex: seat.index,
      reconnectToken: seat.occupant.reconnectToken,
    };
  }

  markDisconnected(playerId: string): boolean {
    const occupant = this.findHuman(playerId);
    if (!occupant) {
      return false;
    }
    occupant.connected = false;
    return true;
  }

  setReady(playerId: string, ready: boolean): RoomActionResult {
    if (this.currentStatus !== 'forming') {
      return { accepted: false, reason: 'already_started' };
    }
    const occupant = this.findHuman(playerId);
    if (!occupant) {
      return { accepted: false, reason: 'invalid_state' };
    }
    occupant.ready = ready;
    const seat = this.findSeat(playerId);
    return seat
      ? { accepted: true, seatIndex: seat.index }
      : { accepted: false, reason: 'invalid_state' };
  }

  start(playerId: string): RoomActionResult {
    if (this.currentStatus !== 'forming') {
      return { accepted: false, reason: 'already_started' };
    }
    if (playerId !== this.hostId) {
      return { accepted: false, reason: 'not_host' };
    }
    this.currentStatus = 'active';
    return { accepted: true };
  }

  markEnded(): void {
    this.currentStatus = 'ended';
  }

  toRoomState(): RoomStateMessage {
    return {
      type: SERVER_MESSAGE_TYPES.roomState,
      payload: {
        roomId: this.id,
        status: this.currentStatus,
        seats: this.seats.map((seat) => ({
          seatIndex: seat.index,
          heroName: seat.heroName,
          // 用稳定战斗身份，保证与战斗快照 allies[] 的 allyId 对得上。
          occupantId: seat.occupant?.id ?? seat.botId,
          displayName: seat.occupant?.displayName ?? seat.heroName,
          isBot: seat.occupant === null,
          alive: true,
          routeId: seat.routeId,
        })),
      },
    };
  }

  /** 按当前 WebSocket 连接 id 查席位。 */
  findSeat(connectionId: string): MultiplayerSeat<TRouteId> | undefined {
    return this.seats.find(
      (seat) => seat.occupant?.connectionId === connectionId,
    );
  }

  /** 按稳定战斗身份查席位，用于把战斗事件对回到席位。 */
  findSeatByPlayerId(
    playerId: string,
  ): MultiplayerSeat<TRouteId> | undefined {
    return this.seats.find((seat) => seat.occupant?.id === playerId);
  }

  /** 开局时的真人席位表，直接交给战斗会话。 */
  listHumanSeats(): readonly {
    readonly seatIndex: number;
    readonly playerId: string;
    readonly playerName: string;
  }[] {
    const humans: {
      seatIndex: number;
      playerId: string;
      playerName: string;
    }[] = [];
    for (const seat of this.seats) {
      if (!seat.occupant) {
        continue;
      }
      humans.push({
        seatIndex: seat.index,
        playerId: seat.occupant.id,
        playerName: seat.occupant.displayName,
      });
    }
    return humans;
  }

  private findHuman(connectionId: string): HumanOccupant | undefined {
    return this.findSeat(connectionId)?.occupant ?? undefined;
  }
}

function createSeats<TRouteId extends RouteId>(
  options: MultiplayerRoomOptions<TRouteId>,
): MultiplayerSeat<TRouteId>[] {
  const botRoutes: TRouteId[] = [];
  for (const routeId of Object.keys(options.config.defaultAssignment) as TRouteId[]) {
    const count = options.config.defaultAssignment[routeId] ?? 0;
    for (let index = 0; index < count; index += 1) {
      botRoutes.push(routeId);
    }
  }

  let nextBotRoute = 0;
  return options.config.heroNames.map((heroName, index) => {
    const isHostSeat = index === options.config.playerDefaultSeat;
    const routeId = isHostSeat
      ? options.config.playerRoute
      : botRoutes[nextBotRoute++]!;
    return {
      index,
      heroName,
      routeId,
      occupant: isHostSeat
        ? {
            id: createPlayerId(),
            connectionId: options.hostId,
            displayName: options.hostName,
            reconnectToken: createReconnectToken(),
            connected: true,
            ready: true,
          }
        : null,
      botId: `${options.roomCode}:bot:${index}`,
    };
  });
}

function createReconnectToken(): string {
  return `${randomUUID()}${randomBytes(8).toString('hex')}`;
}

/** 席位上的稳定战斗身份，与 WebSocket 连接 id 无关。 */
function createPlayerId(): string {
  return `human:${randomUUID()}`;
}

function validateConfig<TRouteId extends RouteId>(
  config: MultiplayerRoomConfig<TRouteId>,
): void {
  if (
    config.seatCount !== config.heroNames.length ||
    config.seatCount < 1 ||
    config.playerDefaultSeat < 0 ||
    config.playerDefaultSeat >= config.seatCount
  ) {
    throw new Error('多人房间席位配置无效');
  }
  let botSeatCount = 0;
  for (const routeId of Object.keys(config.defaultAssignment) as TRouteId[]) {
    const count = config.defaultAssignment[routeId] ?? 0;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('多人房间 AI 路线数量无效');
    }
    botSeatCount += count;
  }
  if (botSeatCount !== config.seatCount - 1) {
    throw new Error('多人房间 AI 路线数量无法填满空席位');
  }
}
