/**
 * 每连接消息限流器（反作弊）。
 *
 * 背景：武器冷却（weapon-state.tryFire）已经能拦住「超射速的有效开火」，
 * 但拦不住「客户端每秒刷几千条消息」——那些消息虽然会被冷却拒绝，
 * 却仍然要走 JSON 解析、射线检测和事件广播，足以把 20Hz 主循环拖垮。
 * 所以这里在协议层再加一道闸：按消息类型分桶计数，超限即拒绝。
 *
 * 实现用滑动秒窗（每满 1000ms 清零一次计数），不用令牌桶：
 * 教学项目可读性优先，且这里只需要挡住数量级异常，不需要平滑整形。
 */

export interface MessageRateLimitConfig {
  /** 输入状态消息每秒上限。必须高于服务器 tick 率，否则误伤正常玩家。 */
  readonly inputMessagesPerSec: number;
  /** 开火消息每秒上限。必须高于最快武器射速。 */
  readonly fireMessagesPerSec: number;
  /** 所有消息合计每秒上限。 */
  readonly totalMessagesPerSec: number;
  /** 累计超限多少次后判定为恶意连接，交由调用方断开。 */
  readonly violationsBeforeKick: number;
}

/** 限流分桶。协议里的消息类型很多，只有热路径需要单独设限。 */
export type RateLimitBucket = 'input' | 'fire' | 'other';

export interface RateLimitVerdict {
  /** 是否放行这条消息。 */
  readonly allowed: boolean;
  /** 触发的是哪一条限制，便于日志定位。 */
  readonly reason?: 'input' | 'fire' | 'total';
  /** 该连接累计超限次数。 */
  readonly violations: number;
  /** 是否已达到踢出阈值，调用方应关闭连接。 */
  readonly shouldKick: boolean;
}

interface WindowState {
  /** 当前秒窗的起点毫秒时间戳。 */
  windowStartMs: number;
  input: number;
  fire: number;
  total: number;
}

const WINDOW_MS = 1000;

export class MessageRateLimiter {
  private readonly config: MessageRateLimitConfig;
  private readonly windows = new Map<string, WindowState>();
  private readonly violations = new Map<string, number>();

  constructor(config: MessageRateLimitConfig) {
    assertPositiveInteger(
      config.inputMessagesPerSec,
      'inputMessagesPerSec',
    );
    assertPositiveInteger(config.fireMessagesPerSec, 'fireMessagesPerSec');
    assertPositiveInteger(
      config.totalMessagesPerSec,
      'totalMessagesPerSec',
    );
    assertPositiveInteger(
      config.violationsBeforeKick,
      'violationsBeforeKick',
    );
    if (
      config.totalMessagesPerSec <
      config.inputMessagesPerSec + config.fireMessagesPerSec
    ) {
      throw new RangeError(
        '限流总上限不得小于输入与开火上限之和，否则正常玩家会被误伤',
      );
    }
    this.config = config;
  }

  /**
   * 登记一条入站消息并给出放行结论。
   *
   * @param connectionId WebSocket 连接 id（重连后会变，这正是我们要的：
   *   限流跟着物理连接走，不跟着战斗身份走）
   */
  check(
    connectionId: string,
    bucket: RateLimitBucket,
    nowMs: number,
  ): RateLimitVerdict {
    const window = this.getWindow(connectionId, nowMs);
    window.total += 1;
    if (bucket === 'input') {
      window.input += 1;
    } else if (bucket === 'fire') {
      window.fire += 1;
    }

    const reason = this.findViolation(window, bucket);
    if (!reason) {
      return {
        allowed: true,
        violations: this.violations.get(connectionId) ?? 0,
        shouldKick: false,
      };
    }

    const violations = (this.violations.get(connectionId) ?? 0) + 1;
    this.violations.set(connectionId, violations);
    return {
      allowed: false,
      reason,
      violations,
      shouldKick: violations >= this.config.violationsBeforeKick,
    };
  }

  /** 连接关闭时清理，避免长时间运行后 Map 无限增长。 */
  forget(connectionId: string): void {
    this.windows.delete(connectionId);
    this.violations.delete(connectionId);
  }

  /** 仅用于测试与运维观察。 */
  violationCount(connectionId: string): number {
    return this.violations.get(connectionId) ?? 0;
  }

  private findViolation(
    window: WindowState,
    bucket: RateLimitBucket,
  ): RateLimitVerdict['reason'] {
    if (bucket === 'input' && window.input > this.config.inputMessagesPerSec) {
      return 'input';
    }
    if (bucket === 'fire' && window.fire > this.config.fireMessagesPerSec) {
      return 'fire';
    }
    if (window.total > this.config.totalMessagesPerSec) {
      return 'total';
    }
    return undefined;
  }

  private getWindow(connectionId: string, nowMs: number): WindowState {
    const existing = this.windows.get(connectionId);
    if (!existing) {
      const created: WindowState = {
        windowStartMs: nowMs,
        input: 0,
        fire: 0,
        total: 0,
      };
      this.windows.set(connectionId, created);
      return created;
    }

    if (nowMs - existing.windowStartMs >= WINDOW_MS) {
      existing.windowStartMs = nowMs;
      existing.input = 0;
      existing.fire = 0;
      existing.total = 0;
    }
    return existing;
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`限流配置 ${field} 必须为正整数`);
  }
}
