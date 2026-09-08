/**
 * 狼牙山地形高度场（服务端与客户端共用的唯一真源）。
 *
 * 设计约束：
 * - 玩家守在山顶（z ≈ 0），敌人从山下（z 越负越远）向上冲锋，
 *   对应 PRD「玩家在山顶阵地，敌人从山下沿多路向上冲锋」。
 * - 本模块只提供**纯函数**，不依赖 cc / node 任何运行时，
 *   因此 Cocos 客户端与 Node 服务端可以直接 import 同一份实现，
 *   保证「看到的地面」与「打得中的判定」永远一致。
 * - 不修改 protocol.ts：Vector3 早已含 y 字段，通信契约保持不变，
 *   已部署的服务端无需协议层迁移。
 *
 * ⚠️ 本文件存在两份**逐字节相同**的拷贝，不要只改其中一份：
 *   - shared/terrain.ts                       ← 唯一真源，服务端引用
 *   - client/assets/scripts/shared/terrain.ts ← 镜像副本，客户端引用
 *
 * 为什么要有副本：Cocos Creator 的模块解析器只加载 `client/assets/`
 * 目录内的脚本，无法从 assets 之外的 `shared/` 做**值导入**
 * （`import type` 在编译期被擦除，所以 shared/protocol.ts 一直没暴露
 * 这个限制；值导入则会在编辑器里直接报「找不到模块」）。
 * 因此沿用与 shared/config/*.json 完全相同的「真源 + 副本」模式。
 *
 * 改动流程（改真源后必做，否则服务端会拒绝启动）：
 *   node tools/sync-terrain.js          # 真源 → 镜像
 *   node tools/verify-config.js         # 校验两份一致
 *
 * 坐标约定（沿用既有战场布局）：
 * - x：横向，山顶阵地宽度方向，范围约 ±arena.widthM / 2
 * - z：纵深，0 为山顶，负值向山下延伸（最远约 -130，即 C 路线长度）
 * - y：高度，山顶为 HILLTOP_HEIGHT_M，山脚为 0
 */

/** 山顶相对山脚的高差（米）。PRD 标注中段坡地约 +20m。 */
export const HILLTOP_HEIGHT_M = 20;

/**
 * 从山顶到山脚的水平跨度（米）。
 * 取最长路线 C 的长度，保证三条路线全程都落在坡面上。
 */
export const SLOPE_RUN_M = 130;

/**
 * 山顶平台的纵深（米）。
 * 这段区间保持水平，避免玩家在阵地内走动时视角持续起伏。
 */
export const SUMMIT_FLAT_DEPTH_M = 10;

/** 横向坡度：越靠两侧越低，形成山脊感而非一块平板。 */
const RIDGE_FALLOFF_M = 2.5;

/** 山脊横向影响的半宽（米），超出后不再继续下降。 */
const RIDGE_HALF_WIDTH_M = 40;

function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  return value >= 1 ? 1 : value;
}

/**
 * 平滑阶梯：在 0..1 上头尾导数为 0，
 * 让山顶与山脚的衔接不出现折角，AI 爬坡时高度变化连续。
 */
function smoothStep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * 纵深方向的高度比例（0 = 山脚，1 = 山顶）。
 * z >= -SUMMIT_FLAT_DEPTH_M 的区间是山顶平台，恒为 1。
 */
function depthRatio(z: number): number {
  const distanceDownhill = -z - SUMMIT_FLAT_DEPTH_M;
  if (distanceDownhill <= 0) {
    return 1;
  }
  const slopeSpan = SLOPE_RUN_M - SUMMIT_FLAT_DEPTH_M;
  if (slopeSpan <= 0) {
    return 1;
  }
  return 1 - smoothStep(distanceDownhill / slopeSpan);
}

/**
 * 返回地面在 (x, z) 处的高度（米）。
 *
 * 这是整个地形系统的唯一入口：
 * - 服务端用它把敌人/队友/玩家的 y 贴到地面上
 * - 客户端用它生成地面网格与摆放场景装饰
 * 两边调用同一函数，因此不存在「视觉与判定脱节」的可能。
 */
export function terrainHeightAt(x: number, z: number): number {
  const base = HILLTOP_HEIGHT_M * depthRatio(z);

  // 横向从山脊中线向两侧缓降，且只在山顶附近明显，
  // 否则山脚也被削出一条沟，敌人出生点会陷进地面。
  const lateral =
    RIDGE_FALLOFF_M *
    smoothStep(Math.min(Math.abs(x), RIDGE_HALF_WIDTH_M) / RIDGE_HALF_WIDTH_M) *
    depthRatio(z);

  const height = base - lateral;
  return height > 0 ? height : 0;
}

/**
 * 把一个坐标贴合到地面上：保留 x/z，y 换成地面高度 + 指定离地高度。
 * `heightOffsetM` 用于表达身高/眼高等模型偏移，默认贴地。
 */
export function snapToTerrain<T extends { readonly x: number; readonly z: number }>(
  position: T,
  heightOffsetM = 0,
): { readonly x: number; readonly y: number; readonly z: number } {
  return {
    x: position.x,
    y: terrainHeightAt(position.x, position.z) + heightOffsetM,
    z: position.z,
  };
}
