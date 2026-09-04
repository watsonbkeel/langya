import { performance } from 'node:perf_hooks';

export interface GameTick {
  readonly tick: number;
  readonly deltaSec: number;
  readonly scheduledAtMs: number;
}

export interface GameLoopOptions {
  readonly tickRateHz: number;
  readonly onTick: (tick: GameTick) => void;
  readonly now?: () => number;
  readonly setInterval?: (
    callback: () => void,
    intervalMs: number,
  ) => ReturnType<typeof setInterval>;
  readonly clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

export class GameLoop {
  private readonly stepMs: number;
  private readonly onTick: (tick: GameTick) => void;
  private readonly now: () => number;
  private readonly scheduleInterval: NonNullable<GameLoopOptions['setInterval']>;
  private readonly cancelInterval: NonNullable<GameLoopOptions['clearInterval']>;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private lastFrameAtMs: number | undefined;
  private accumulatorMs = 0;
  private tick = 0;

  constructor(options: GameLoopOptions) {
    if (!Number.isFinite(options.tickRateHz) || options.tickRateHz <= 0) {
      throw new RangeError('tickRateHz 必须是正有限数');
    }

    this.stepMs = 1000 / options.tickRateHz;
    this.onTick = options.onTick;
    this.now = options.now ?? performance.now.bind(performance);
    this.scheduleInterval = options.setInterval ?? setInterval;
    this.cancelInterval = options.clearInterval ?? clearInterval;
  }

  start(): void {
    if (this.intervalHandle !== undefined) {
      return;
    }

    this.lastFrameAtMs = this.now();
    this.intervalHandle = this.scheduleInterval(() => {
      this.advanceTo(this.now());
    }, this.stepMs);
  }

  stop(): void {
    if (this.intervalHandle !== undefined) {
      this.cancelInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    this.lastFrameAtMs = undefined;
    this.accumulatorMs = 0;
  }

  get currentTick(): number {
    return this.tick;
  }

  private advanceTo(nowMs: number): void {
    const previousFrameAtMs = this.lastFrameAtMs;
    this.lastFrameAtMs = nowMs;
    if (previousFrameAtMs === undefined) {
      return;
    }

    this.accumulatorMs += Math.max(0, nowMs - previousFrameAtMs);

    // 调度延迟时补跑固定步长 tick，避免游戏时间随事件循环抖动而变慢。
    while (this.accumulatorMs >= this.stepMs) {
      this.tick += 1;
      this.accumulatorMs -= this.stepMs;
      this.onTick({
        tick: this.tick,
        deltaSec: this.stepMs / 1000,
        scheduledAtMs: nowMs - this.accumulatorMs,
      });
    }
  }
}
