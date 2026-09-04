import type { Vector3 } from '../../../shared/protocol';

export interface RouteConfig {
  readonly lengthM: number;
}

export interface ArenaConfig {
  readonly widthM: number;
  readonly depthM: number;
}

export interface RouteLayout<TRouteId extends string> {
  readonly routeId: TRouteId;
  readonly spawnPosition: Vector3;
  readonly guardPosition: Vector3;
  readonly waypoints: readonly Vector3[];
}

export function createRouteLayouts<TRouteId extends string>(
  routes: Readonly<Record<TRouteId, RouteConfig>>,
  arena: ArenaConfig,
): readonly RouteLayout<TRouteId>[] {
  const routeEntries = Object.entries(routes) as [
    TRouteId,
    RouteConfig,
  ][];
  if (routeEntries.length === 0) {
    throw new Error('至少需要配置一条进攻路线');
  }

  const laneSpacing =
    routeEntries.length === 1
      ? 0
      : arena.widthM / routeEntries.length;
  const firstLaneX = -(
    (laneSpacing * (routeEntries.length - 1)) /
    2
  );
  const guardZ = -(arena.depthM / 2);

  return routeEntries.map(([routeId, route], index) => {
    const spawnPosition = {
      x: firstLaneX + laneSpacing * index,
      y: 0,
      z: -route.lengthM,
    };
    const guardPosition = {
      x: firstLaneX + laneSpacing * index,
      y: 0,
      z: guardZ,
    };
    return {
      routeId,
      spawnPosition,
      guardPosition,
      waypoints: [spawnPosition, guardPosition],
    };
  });
}

export function findNearestRoute<TRouteId extends string>(
  position: Vector3,
  layouts: readonly RouteLayout<TRouteId>[],
): TRouteId {
  const first = layouts[0];
  if (!first) {
    throw new Error('无法在空路线列表中定位玩家');
  }

  let nearest = first;
  let nearestDistanceSquared = distanceSquared(
    position,
    first.guardPosition,
  );
  for (let index = 1; index < layouts.length; index += 1) {
    const route = layouts[index];
    if (!route) {
      continue;
    }
    const candidateDistanceSquared = distanceSquared(
      position,
      route.guardPosition,
    );
    if (candidateDistanceSquared < nearestDistanceSquared) {
      nearest = route;
      nearestDistanceSquared = candidateDistanceSquared;
    }
  }

  return nearest.routeId;
}

function distanceSquared(first: Vector3, second: Vector3): number {
  const deltaX = first.x - second.x;
  const deltaZ = first.z - second.z;
  return deltaX * deltaX + deltaZ * deltaZ;
}
