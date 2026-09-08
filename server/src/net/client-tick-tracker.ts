export class ClientTickTracker {
  private lastClientTick: number | undefined;

  accept(clientTick: number): boolean {
    if (
      this.lastClientTick !== undefined &&
      clientTick <= this.lastClientTick
    ) {
      return false;
    }

    this.lastClientTick = clientTick;
    return true;
  }

  /**
   * 清空递增基线。
   * 断线重连是一条新的 WebSocket 连接，客户端 tick 会从头计数，
   * 若沿用旧基线会把所有输入判成「不递增」而误踢玩家。
   */
  reset(): void {
    this.lastClientTick = undefined;
  }
}
