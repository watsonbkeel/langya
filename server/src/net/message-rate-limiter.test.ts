import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MessageRateLimiter,
  type MessageRateLimitConfig,
} from './message-rate-limiter';

const CONFIG: MessageRateLimitConfig = {
  inputMessagesPerSec: 40,
  fireMessagesPerSec: 25,
  totalMessagesPerSec: 120,
  violationsBeforeKick: 20,
};

function createLimiter(
  overrides: Partial<MessageRateLimitConfig> = {},
): MessageRateLimiter {
  return new MessageRateLimiter({ ...CONFIG, ...overrides });
}

describe('MessageRateLimiter', () => {
  it('正常频率的输入全部放行', () => {
    const limiter = createLimiter();
    // 20Hz tick 下一秒 20 条输入，远低于 40 的上限
    for (let index = 0; index < 20; index += 1) {
      const verdict = limiter.check('conn-1', 'input', 1000 + index * 50);
      assert.equal(verdict.allowed, true, `第 ${index} 条应放行`);
    }
    assert.equal(limiter.violationCount('conn-1'), 0);
  });

  it('输入超过每秒上限后被拒绝', () => {
    const limiter = createLimiter();
    for (let index = 0; index < CONFIG.inputMessagesPerSec; index += 1) {
      assert.equal(limiter.check('conn-1', 'input', 1000).allowed, true);
    }

    const verdict = limiter.check('conn-1', 'input', 1000);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, 'input');
    assert.equal(verdict.violations, 1);
    assert.equal(verdict.shouldKick, false);
  });

  it('开火超过每秒上限后被拒绝', () => {
    const limiter = createLimiter();
    for (let index = 0; index < CONFIG.fireMessagesPerSec; index += 1) {
      assert.equal(limiter.check('conn-1', 'fire', 5000).allowed, true);
    }

    const verdict = limiter.check('conn-1', 'fire', 5000);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, 'fire');
  });

  it('跨秒后计数清零，正常玩家不会被持续误伤', () => {
    const limiter = createLimiter();
    for (let index = 0; index < CONFIG.inputMessagesPerSec; index += 1) {
      limiter.check('conn-1', 'input', 1000);
    }
    assert.equal(limiter.check('conn-1', 'input', 1000).allowed, false);

    // 下一秒窗口重新开始
    assert.equal(limiter.check('conn-1', 'input', 2000).allowed, true);
  });

  it('总量上限能挡住混合类型的洪水', () => {
    const limiter = createLimiter();
    // 用 other 桶灌满总量：other 没有单独上限，只受 total 约束
    for (let index = 0; index < CONFIG.totalMessagesPerSec; index += 1) {
      assert.equal(limiter.check('conn-1', 'other', 3000).allowed, true);
    }

    const verdict = limiter.check('conn-1', 'other', 3000);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, 'total');
  });

  it('累计超限达到阈值后要求断开连接', () => {
    const limiter = createLimiter({ violationsBeforeKick: 3 });
    for (let index = 0; index < CONFIG.fireMessagesPerSec; index += 1) {
      limiter.check('conn-1', 'fire', 7000);
    }

    assert.equal(limiter.check('conn-1', 'fire', 7000).shouldKick, false);
    assert.equal(limiter.check('conn-1', 'fire', 7000).shouldKick, false);
    const third = limiter.check('conn-1', 'fire', 7000);
    assert.equal(third.violations, 3);
    assert.equal(third.shouldKick, true);
  });

  it('长时间没再超限后累计次数衰减，偶发抖动不会攒成踢出', () => {
    const limiter = createLimiter({ violationsBeforeKick: 3 });

    // 第 1 秒：卡一次，攒下 1 次超限
    for (let index = 0; index < CONFIG.inputMessagesPerSec; index += 1) {
      limiter.check('conn-1', 'input', 1000);
    }
    assert.equal(limiter.check('conn-1', 'input', 1000).violations, 1);

    // 隔了很久（超过衰减时长）才再卡一次，应重新从 1 开始计，而不是累加到 2
    const laterMs = 1000 + 60_000;
    for (let index = 0; index < CONFIG.inputMessagesPerSec; index += 1) {
      limiter.check('conn-1', 'input', laterMs);
    }
    const verdict = limiter.check('conn-1', 'input', laterMs);
    assert.equal(verdict.violations, 1);
    assert.equal(verdict.shouldKick, false);
  });

  it('持续洪水不受衰减影响，仍会被踢出', () => {
    const limiter = createLimiter({ violationsBeforeKick: 3 });
    // 连续三秒每秒都灌爆输入桶：每次超限间隔仅 1 秒，远小于衰减时长
    for (let second = 0; second < 3; second += 1) {
      const nowMs = 1000 + second * 1000;
      for (let index = 0; index < CONFIG.inputMessagesPerSec; index += 1) {
        limiter.check('conn-1', 'input', nowMs);
      }
      const verdict = limiter.check('conn-1', 'input', nowMs);
      assert.equal(verdict.violations, second + 1);
      assert.equal(verdict.shouldKick, second === 2);
    }
  });

  it('不同连接的计数互相隔离', () => {
    const limiter = createLimiter();
    for (let index = 0; index < CONFIG.inputMessagesPerSec; index += 1) {
      limiter.check('conn-1', 'input', 1000);
    }
    assert.equal(limiter.check('conn-1', 'input', 1000).allowed, false);
    // 另一条连接不受影响
    assert.equal(limiter.check('conn-2', 'input', 1000).allowed, true);
  });

  it('forget 清掉连接状态，避免长期运行内存增长', () => {
    const limiter = createLimiter();
    for (let index = 0; index < CONFIG.inputMessagesPerSec; index += 1) {
      limiter.check('conn-1', 'input', 1000);
    }
    limiter.check('conn-1', 'input', 1000);
    assert.equal(limiter.violationCount('conn-1'), 1);

    limiter.forget('conn-1');
    assert.equal(limiter.violationCount('conn-1'), 0);
    assert.equal(limiter.check('conn-1', 'input', 1000).allowed, true);
  });

  it('总上限小于分桶上限之和时直接拒绝构造', () => {
    assert.throws(
      () => createLimiter({ totalMessagesPerSec: 10 }),
      /限流总上限/,
    );
  });

  it('非正整数配置直接拒绝构造', () => {
    assert.throws(
      () => createLimiter({ fireMessagesPerSec: 0 }),
      /必须为正整数/,
    );
    assert.throws(
      () => createLimiter({ inputMessagesPerSec: 1.5 }),
      /必须为正整数/,
    );
  });
});
