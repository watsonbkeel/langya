import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GameLoop, type GameTick } from './game-loop';

interface FakeTimer {
  readonly callback: () => void;
  readonly intervalMs: number;
}

describe('GameLoop', () => {
  it('按配置频率产生固定步长 tick', () => {
    let nowMs = 0;
    let timer: FakeTimer | undefined;
    const ticks: GameTick[] = [];
    const loop = new GameLoop({
      tickRateHz: 20,
      onTick: (tick) => ticks.push(tick),
      now: () => nowMs,
      setInterval: (callback, intervalMs) => {
        timer = { callback, intervalMs };
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => undefined,
    });

    loop.start();
    assert.equal(timer?.intervalMs, 50);

    nowMs = 50;
    timer?.callback();

    assert.equal(ticks.length, 1);
    assert.equal(ticks[0]?.tick, 1);
    assert.equal(ticks[0]?.deltaSec, 0.05);
  });

  it('事件循环延迟时补偿遗漏的固定步长 tick', () => {
    let nowMs = 0;
    let callback: (() => void) | undefined;
    const ticks: GameTick[] = [];
    const loop = new GameLoop({
      tickRateHz: 20,
      onTick: (tick) => ticks.push(tick),
      now: () => nowMs,
      setInterval: (scheduledCallback) => {
        callback = scheduledCallback;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => undefined,
    });

    loop.start();
    nowMs = 125;
    callback?.();

    assert.equal(ticks.length, 2);
    assert.deepEqual(
      ticks.map((tick) => tick.tick),
      [1, 2],
    );
    assert.deepEqual(
      ticks.map((tick) => tick.scheduledAtMs),
      [50, 100],
    );
  });

  it('重复启动不创建多个计时器，停止后可重新启动', () => {
    let scheduledCount = 0;
    let clearedCount = 0;
    const loop = new GameLoop({
      tickRateHz: 20,
      onTick: () => undefined,
      now: () => 0,
      setInterval: () => {
        scheduledCount += 1;
        return scheduledCount as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {
        clearedCount += 1;
      },
    });

    loop.start();
    loop.start();
    assert.equal(scheduledCount, 1);

    loop.stop();
    assert.equal(clearedCount, 1);

    loop.start();
    assert.equal(scheduledCount, 2);
  });

  it('拒绝无效 tick 频率', () => {
    assert.throws(
      () =>
        new GameLoop({
          tickRateHz: 0,
          onTick: () => undefined,
        }),
      RangeError,
    );
  });
});
