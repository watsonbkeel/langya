import type { Vector3 } from '../../../../shared/protocol';
import {
  findNearestRoute,
  type RouteLayout,
} from '../route-layout';

export interface DeployableAlly<TRouteId extends string> {
  readonly id: string;
  routeId: TRouteId;
}

export interface DeploymentConfig {
  readonly playerRouteDetectSec: number;
  readonly reassignCooldownSec: number;
}

export interface AllyReassignment<TRouteId extends string> {
  readonly allyId: string;
  readonly fromRouteId: TRouteId;
  readonly toRouteId: TRouteId;
}

export class AllyDeploymentManager<TRouteId extends string> {
  private observedPlayerRoute: TRouteId | undefined;
  private observedSinceMs: number | undefined;
  private lastReassignedAtMs: number | undefined;

  constructor(
    private readonly config: DeploymentConfig,
    private readonly layouts: readonly RouteLayout<TRouteId>[],
  ) {}

  update(
    playerPosition: Vector3,
    allies: readonly DeployableAlly<TRouteId>[],
    nowMs: number,
  ): AllyReassignment<TRouteId> | undefined {
    const playerRoute = findNearestRoute(playerPosition, this.layouts);
    if (playerRoute !== this.observedPlayerRoute) {
      this.observedPlayerRoute = playerRoute;
      this.observedSinceMs = nowMs;
      return undefined;
    }

    const observedSinceMs = this.observedSinceMs;
    if (
      observedSinceMs === undefined ||
      nowMs - observedSinceMs < this.config.playerRouteDetectSec * 1000
    ) {
      return undefined;
    }
    if (
      this.lastReassignedAtMs !== undefined &&
      nowMs - this.lastReassignedAtMs <
        this.config.reassignCooldownSec * 1000
    ) {
      return undefined;
    }

    const ally = allies.find(
      (candidate) => candidate.routeId === playerRoute,
    );
    if (!ally) {
      return undefined;
    }

    const destination = this.findLeastCoveredRoute(
      playerRoute,
      allies,
    );
    if (!destination) {
      return undefined;
    }

    const reassignment = {
      allyId: ally.id,
      fromRouteId: ally.routeId,
      toRouteId: destination,
    };
    this.lastReassignedAtMs = nowMs;
    return reassignment;
  }

  private findLeastCoveredRoute(
    playerRoute: TRouteId,
    allies: readonly DeployableAlly<TRouteId>[],
  ): TRouteId | undefined {
    const coverage = new Map<TRouteId, number>();
    for (const layout of this.layouts) {
      if (layout.routeId !== playerRoute) {
        coverage.set(layout.routeId, 0);
      }
    }
    for (const ally of allies) {
      if (coverage.has(ally.routeId)) {
        coverage.set(
          ally.routeId,
          (coverage.get(ally.routeId) ?? 0) + 1,
        );
      }
    }

    let selected: TRouteId | undefined;
    let selectedCount = Number.POSITIVE_INFINITY;
    for (const [routeId, count] of coverage) {
      if (count < selectedCount) {
        selected = routeId;
        selectedCount = count;
      }
    }
    return selected;
  }
}
