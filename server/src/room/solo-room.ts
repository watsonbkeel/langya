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

/** 开局时占据某个席位的真人。v1.0 不允许中途加入，因此开局后席位归属固定。 */
export interface HumanSeatAssignment {
  readonly seatIndex: number;
  readonly playerId: string;
  readonly playerName: string;
}

export interface SoloRoomOptions<TRouteId extends string> {
  readonly roomId: string;
  readonly playerId: string;
  readonly playerName: string;
  readonly config: SoloRoomConfig<TRouteId>;
  /**
   * 多人开局时的真人席位表。省略则退化为单人：
   * 只有 `playerDefaultSeat` 一个真人，其余席位补 AI。
   */
  readonly humans?: readonly HumanSeatAssignment[];
}

export class SoloRoom<TRouteId extends string> {
  readonly id: string;
  readonly seats: readonly RoomSeat<TRouteId>[];
  private currentStatus: RoomStatus = 'active';

  constructor(options: SoloRoomOptions<TRouteId>) {
    this.validateConfig(options.config);
    this.id = options.roomId;
    this.seats = this.createSeats(options);
  }

  get status(): RoomStatus {
    return this.currentStatus;
  }

  markEnded(): void {
    this.currentStatus = 'ended';
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

    // 席位与路线的对应关系是固定的，与「谁来占这个席位」无关。
    // 这样多名真人加入时只是顶替 AI 占位，三路防守布局不会被打乱。
    let nextBotRoute = 0;
    const seatRoutes = config.heroNames.map((_heroName, index) => {
      if (index === config.playerDefaultSeat) {
        return config.playerRoute;
      }
      const routeId = botRoutes[nextBotRoute];
      if (routeId === undefined) {
        throw new Error('AI 队友路线数量不足，无法填满房间席位');
      }
      nextBotRoute += 1;
      return routeId;
    });

    const humansBySeat = this.indexHumans(options);

    return config.heroNames.map((heroName, index) => {
      const routeId = seatRoutes[index]!;
      const human = humansBySeat.get(index);
      if (human) {
        return {
          index,
          heroName,
          routeId,
          occupant: {
            id: human.playerId,
            displayName: human.playerName,
            isBot: false,
          },
        };
      }

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

  /** 归一化真人席位表，未传时退化为单人默认席位。 */
  private indexHumans(
    options: SoloRoomOptions<TRouteId>,
  ): ReadonlyMap<number, HumanSeatAssignment> {
    const assignments: readonly HumanSeatAssignment[] =
      options.humans && options.humans.length > 0
        ? options.humans
        : [
            {
              seatIndex: options.config.playerDefaultSeat,
              playerId: options.playerId,
              playerName: options.playerName,
            },
          ];

    const bySeat = new Map<number, HumanSeatAssignment>();
    const seenIds = new Set<string>();
    for (const assignment of assignments) {
      if (
        !Number.isInteger(assignment.seatIndex) ||
        assignment.seatIndex < 0 ||
        assignment.seatIndex >= options.config.seatCount
      ) {
        throw new Error('真人席位超出房间范围');
      }
      if (bySeat.has(assignment.seatIndex)) {
        throw new Error('同一席位不能分配给多名真人');
      }
      if (seenIds.has(assignment.playerId)) {
        throw new Error('同一真人不能占据多个席位');
      }
      bySeat.set(assignment.seatIndex, assignment);
      seenIds.add(assignment.playerId);
    }
    return bySeat;
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
