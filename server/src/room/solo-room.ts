export type RoomStatus = 'forming' | 'active' | 'ended';

export interface RoomOccupant {
  readonly id: string;
  readonly displayName: string;
  readonly isBot: boolean;
}

export interface RoomSeat<TRouteId extends string> {
  readonly index: number;
  readonly heroName: string;
  readonly routeId: TRouteId;
  readonly occupant: RoomOccupant;
}

export interface SoloRoomConfig<TRouteId extends string> {
  readonly seatCount: number;
  readonly heroNames: readonly string[];
  readonly playerDefaultSeat: number;
  readonly playerRoute: TRouteId;
  readonly defaultAssignment: Readonly<Record<TRouteId, number>>;
}

export interface SoloRoomOptions<TRouteId extends string> {
  readonly roomId: string;
  readonly playerId: string;
  readonly playerName: string;
  readonly config: SoloRoomConfig<TRouteId>;
}

export class SoloRoom<TRouteId extends string> {
  readonly id: string;
  readonly seats: readonly RoomSeat<TRouteId>[];
  readonly status: RoomStatus = 'active';

  constructor(options: SoloRoomOptions<TRouteId>) {
    this.validateConfig(options.config);
    this.id = options.roomId;
    this.seats = this.createSeats(options);
  }

  private createSeats(
    options: SoloRoomOptions<TRouteId>,
  ): readonly RoomSeat<TRouteId>[] {
    const { config } = options;
    const botRoutes: TRouteId[] = [];

    for (const [routeId, count] of Object.entries(
      config.defaultAssignment,
    ) as [TRouteId, number][]) {
      for (let index = 0; index < count; index += 1) {
        botRoutes.push(routeId);
      }
    }

    let nextBotRoute = 0;
    return config.heroNames.map((heroName, index) => {
      if (index === config.playerDefaultSeat) {
        return {
          index,
          heroName,
          routeId: config.playerRoute,
          occupant: {
            id: options.playerId,
            displayName: options.playerName,
            isBot: false,
          },
        };
      }

      const routeId = botRoutes[nextBotRoute];
      if (routeId === undefined) {
        throw new Error('AI 队友路线数量不足，无法填满房间席位');
      }
      nextBotRoute += 1;

      return {
        index,
        heroName,
        routeId,
        occupant: {
          id: `${options.roomId}:bot:${index}`,
          displayName: heroName,
          isBot: true,
        },
      };
    });
  }

  private validateConfig(config: SoloRoomConfig<TRouteId>): void {
    if (
      !Number.isInteger(config.seatCount) ||
      config.seatCount <= 0 ||
      config.heroNames.length !== config.seatCount
    ) {
      throw new Error('房间席位数必须与英雄姓名数量一致');
    }
    if (
      !Number.isInteger(config.playerDefaultSeat) ||
      config.playerDefaultSeat < 0 ||
      config.playerDefaultSeat >= config.seatCount
    ) {
      throw new Error('真人默认席位超出房间范围');
    }

    const assignmentCounts = Object.values(
      config.defaultAssignment,
    ) as number[];
    const botSeatCount = assignmentCounts.reduce((total, count) => {
      if (!Number.isInteger(count) || count < 0) {
        throw new Error('AI 队友路线人数必须是非负整数');
      }
      return total + count;
    }, 0);
    if (botSeatCount !== config.seatCount - 1) {
      throw new Error('AI 队友路线人数必须恰好填满真人之外的席位');
    }
    if (!(config.playerRoute in config.defaultAssignment)) {
      throw new Error('真人默认路线必须存在于 AI 布防配置中');
    }
  }
}
