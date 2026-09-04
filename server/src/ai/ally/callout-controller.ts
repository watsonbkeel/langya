export interface CalloutConfig {
  readonly enabled: boolean;
  readonly enemyThreshold: number;
  readonly cooldownSec: number;
  readonly templates: {
    readonly routeThreat: string;
  };
}

export interface CalloutAlly<TRouteId extends string> {
  readonly id: string;
  readonly heroName: string;
  readonly routeId: TRouteId;
  readonly alive: boolean;
}

export interface AllyCallout<TRouteId extends string> {
  readonly type: 'ally_callout';
  readonly allyId: string;
  readonly routeId: TRouteId;
  readonly text: string;
}

export class CalloutController<TRouteId extends string> {
  private readonly lastCalloutAtMs = new Map<string, number>();

  constructor(
    private readonly config: CalloutConfig,
    private readonly routeNames: Readonly<Record<TRouteId, string>>,
  ) {}

  update(
    nowMs: number,
    allies: readonly CalloutAlly<TRouteId>[],
    enemyCounts: Readonly<Record<TRouteId, number>>,
  ): AllyCallout<TRouteId> | undefined {
    if (!this.config.enabled) {
      return undefined;
    }

    for (const ally of allies) {
      if (
        !ally.alive ||
        enemyCounts[ally.routeId] < this.config.enemyThreshold
      ) {
        continue;
      }
      const lastCalloutAtMs = this.lastCalloutAtMs.get(ally.id);
      if (
        lastCalloutAtMs !== undefined &&
        nowMs - lastCalloutAtMs < this.config.cooldownSec * 1000
      ) {
        continue;
      }

      this.lastCalloutAtMs.set(ally.id, nowMs);
      return {
        type: 'ally_callout',
        allyId: ally.id,
        routeId: ally.routeId,
        text: this.config.templates.routeThreat
          .replace('{name}', ally.heroName)
          .replace('{route}', this.routeNames[ally.routeId]),
      };
    }

    return undefined;
  }
}
