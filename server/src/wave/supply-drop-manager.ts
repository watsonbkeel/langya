import type {
  SupplyItemState,
  Vector3,
} from '../../../shared/protocol';
import type { RandomSource } from '../ai/seeded-random';

const MILLISECONDS_PER_SECOND = 1000;

export interface SupplyDropConfig {
  readonly enabled: boolean;
  readonly triggerOnIntermission: boolean;
  readonly intervalSec: number;
  readonly pointCount: number;
  readonly dropsPerTrigger: readonly number[];
  readonly lifetimeSec: number;
  readonly announceText: string;
}

export interface SupplyWaveTiming {
  readonly startSec: number;
}

export interface SupplyDropManagerOptions {
  readonly idPrefix: string;
  readonly config: SupplyDropConfig;
  readonly waves: readonly SupplyWaveTiming[];
  readonly intermissionSec: number;
  readonly matchDurationSec: number;
  readonly arenaWidthM: number;
  readonly random: RandomSource;
}

export interface SupplyDropEvent {
  readonly type: 'supply_drop';
  readonly drop: SupplyItemState;
  readonly text: string;
}

export type SupplyPickupResult =
  | {
      readonly accepted: true;
      readonly heal: number;
    }
  | {
      readonly accepted: false;
      readonly reason:
        | 'invalid_target'
        | 'unavailable'
        | 'out_of_range';
    };

interface MutableSupplyItem {
  readonly id: string;
  readonly kind: 'airdrop_medkit';
  readonly position: Vector3;
  readonly expiresAtMs: number;
  available: boolean;
}

export class SupplyDropManager {
  private readonly idPrefix: string;
  private readonly config: SupplyDropConfig;
  private readonly random: RandomSource;
  private readonly triggerTimesMs: readonly number[];
  private readonly points: readonly Vector3[];
  private readonly items: MutableSupplyItem[] = [];
  private nextTriggerIndex = 0;
  private sequence = 0;

  constructor(options: SupplyDropManagerOptions) {
    this.idPrefix = options.idPrefix;
    this.config = options.config;
    this.random = options.random;
    this.triggerTimesMs = createTriggerTimesMs(options);
    this.points = createSupplyPoints(
      options.config.pointCount,
      options.arenaWidthM,
    );
  }

  update(
    elapsedMs: number,
    matchStartedAtMs: number,
  ): readonly SupplyDropEvent[] {
    this.removeUnavailableAndExpired(matchStartedAtMs + elapsedMs);
    if (!this.config.enabled) {
      return [];
    }

    const events: SupplyDropEvent[] = [];
    while (
      this.nextTriggerIndex < this.triggerTimesMs.length &&
      this.triggerTimesMs[this.nextTriggerIndex]! <= elapsedMs
    ) {
      events.push(
        ...this.createDrops(matchStartedAtMs + elapsedMs),
      );
      this.nextTriggerIndex += 1;
    }
    return events;
  }

  getItems(nowMs: number): readonly SupplyItemState[] {
    this.removeUnavailableAndExpired(nowMs);
    return this.items.map((item) => ({ ...item }));
  }

  pickup(
    itemId: string,
    playerPosition: Vector3,
    pickupRangeM: number,
    heal: number,
    nowMs: number,
  ): SupplyPickupResult {
    const item = this.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      return { accepted: false, reason: 'invalid_target' };
    }
    if (!item.available || nowMs >= item.expiresAtMs) {
      item.available = false;
      return { accepted: false, reason: 'unavailable' };
    }
    if (distanceBetween(playerPosition, item.position) > pickupRangeM) {
      return { accepted: false, reason: 'out_of_range' };
    }

    item.available = false;
    return { accepted: true, heal };
  }

  private createDrops(nowMs: number): readonly SupplyDropEvent[] {
    const availablePoints = this.points.filter(
      (point) =>
        !this.items.some(
          (item) =>
            item.available &&
            samePosition(item.position, point),
        ),
    );
    const requestedCount = randomInclusive(
      this.config.dropsPerTrigger,
      this.random,
    );
    const dropCount = Math.min(requestedCount, availablePoints.length);
    const events: SupplyDropEvent[] = [];

    for (let index = 0; index < dropCount; index += 1) {
      const pointIndex = Math.floor(
        this.random.next() * availablePoints.length,
      );
      const [position] = availablePoints.splice(pointIndex, 1);
      if (!position) {
        continue;
      }
      const item: MutableSupplyItem = {
        id: `${this.idPrefix}:supply:${this.sequence}`,
        kind: 'airdrop_medkit',
        position,
        expiresAtMs:
          nowMs + this.config.lifetimeSec * MILLISECONDS_PER_SECOND,
        available: true,
      };
      this.sequence += 1;
      this.items.push(item);
      events.push({
        type: 'supply_drop',
        drop: { ...item },
        text: this.config.announceText,
      });
    }
    return events;
  }

  private removeUnavailableAndExpired(nowMs: number): void {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      if (!item || !item.available || nowMs >= item.expiresAtMs) {
        this.items.splice(index, 1);
      }
    }
  }
}

function createTriggerTimesMs(
  options: SupplyDropManagerOptions,
): readonly number[] {
  if (!options.config.enabled) {
    return [];
  }

  const triggerTimes = new Set<number>();
  for (
    let triggerSec = options.config.intervalSec;
    triggerSec < options.matchDurationSec;
    triggerSec += options.config.intervalSec
  ) {
    triggerTimes.add(triggerSec * MILLISECONDS_PER_SECOND);
  }
  if (options.config.triggerOnIntermission) {
    for (const wave of options.waves.slice(1)) {
      triggerTimes.add(
        (wave.startSec - options.intermissionSec) *
          MILLISECONDS_PER_SECOND,
      );
    }
  }
  return [...triggerTimes].sort((first, second) => first - second);
}

function createSupplyPoints(
  pointCount: number,
  arenaWidthM: number,
): readonly Vector3[] {
  const spacing = arenaWidthM / (pointCount + 1);
  return Array.from({ length: pointCount }, (_, index) => ({
    x: -arenaWidthM / 2 + spacing * (index + 1),
    y: 0,
    z: 0,
  }));
}

function randomInclusive(
  range: readonly number[],
  random: RandomSource,
): number {
  const minimum = range[0] ?? 0;
  const maximum = range[1] ?? minimum;
  return (
    minimum +
    Math.floor(random.next() * (maximum - minimum + 1))
  );
}

function samePosition(first: Vector3, second: Vector3): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.z === second.z
  );
}

function distanceBetween(first: Vector3, second: Vector3): number {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    first.z - second.z,
  );
}
