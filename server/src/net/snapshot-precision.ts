import type { Vector3 } from '../../../shared/protocol';

/**
 * 世界快照的数值精度压缩。
 *
 * 服务端内部用双精度浮点推进（`-89.51994932547211`），原样序列化每个坐标
 * 要 17 个字符；20Hz × 40 敌人下快照能到 10KB/帧，公网链路一抖就积压丢帧
 * （客户端表现为敌人瞬移）。
 *
 * 客户端只拿这些数做渲染插值，厘米级（2 位小数）足够；角度保留 1 位小数
 * （0.1° 在 200m 外的误差是 35cm，远小于敌人贴图宽度）。
 *
 * 只在**出站序列化前**截断，服务端内部状态与裁决（命中、地形贴合）不受影响。
 */

const POSITION_DECIMALS = 2;
const ANGLE_DECIMALS = 1;
const RATIO_DECIMALS = 3;

const POSITION_SCALE = 10 ** POSITION_DECIMALS;
const ANGLE_SCALE = 10 ** ANGLE_DECIMALS;
const RATIO_SCALE = 10 ** RATIO_DECIMALS;

function roundScaled(value: number, scale: number): number {
  // 加上 +0 是为了把 -0 归一成 0，避免序列化出 "-0"。
  return Math.round(value * scale) / scale + 0;
}

export function compactPosition(position: Vector3): Vector3 {
  return {
    x: roundScaled(position.x, POSITION_SCALE),
    y: roundScaled(position.y, POSITION_SCALE),
    z: roundScaled(position.z, POSITION_SCALE),
  };
}

export function compactAngle(degrees: number): number {
  return roundScaled(degrees, ANGLE_SCALE);
}

export function compactRatio(ratio: number): number {
  return roundScaled(ratio, RATIO_SCALE);
}
