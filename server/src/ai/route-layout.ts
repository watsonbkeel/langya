import type { Vector3 } from '../../../shared/protocol';
import { terrainHeightAt } from '../../../shared/terrain';

/**
 * 冲锋路径的采样间隔（米）。
 *
 * 路线两端直连会让敌人沿直线穿过坡体（山腰陷进地下、山脚浮在空中），
 * 因此按固定间隔在坡面上采样中间点，让预计算路径贴着地形起伏。
 * 间隔取 5m：130m 的最长路线约 26 段，既贴合 14° 的最大坡度，
 * 又不会让每 tick 的路径点推进产生额外开销。
 */
const ROUTE_SAMPLE_STEP_M = 5;

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
    const laneX = firstLaneX + laneSpacing * index;
    const spawnZ = -route.lengthM;
    const spawnPosition = {
      x: laneX,
      y: terrainHeightAt(laneX, spawnZ),
      z: spawnZ,
    };
    const guardPosition = {
      x: laneX,
      y: terrainHeightAt(laneX, guardZ),
      z: guardZ,
    };
    return {
      routeId,
      spawnPosition,
      guardPosition,
      waypoints: sampleSlopeWaypoints(spawnPosition, guardPosition),
    };
  });
}

/**
 * 在山脚与山顶之间沿坡面采样路径点。
 *
 * 首尾必须严格等于传入的出生点与防守点，避免测试与外部逻辑
 * 依赖的端点因采样取整而偏移。
 */
function sampleSlopeWaypoints(
  spawnPosition: Vector3,
  guardPosition: Vector3,
): readonly Vector3[] {
  const spanZ = guardPosition.z - spawnPosition.z;
  const segments = Math.max(
    1,
    Math.round(Math.abs(spanZ) / ROUTE_SAMPLE_STEP_M),
  );

  const waypoints: Vector3[] = [spawnPosition];
  for (let step = 1; step < segments; step += 1) {
    const ratio = step / segments;
    const x =
      spawnPosition.x + (guardPosition.x - spawnPosition.x) * ratio;
    const z = spawnPosition.z + spanZ * ratio;
    waypoints.push({ x, y: terrainHeightAt(x, z), z });
  }
  waypoints.push(guardPosition);
  return waypoints;
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
