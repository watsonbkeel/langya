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
}
