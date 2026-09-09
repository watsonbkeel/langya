#!/usr/bin/env python3
"""把 M7 环境素材（image-agent 下载的 RGB 图）处理成可入库的 PNG。

规则：
- sky-*：全景图不抠底，只限宽后直接落到 scene/。
- 其余：从四边做洪水填充去掉"假透明"棋盘格（只删与边缘连通的浅灰区域，
  不会误伤物件内部的浅色），裁到内容包围盒，按目标尺寸等比缩放。

只写 client/assets/resources/scene/<name>.png，不动其它目录。
用法：python3 process-environment.py <下载目录> [name ...]
"""

from collections import deque
from pathlib import Path
import sys

from PIL import Image
import numpy as np

# 目标最长边（像素）。远山横向宽幅保留原比例，小件按 billboard 大小分级。
TARGET_MAX_EDGE = {
    "mountain-layer-far": 1536,
    "mountain-layer-near": 1536,
    "sandbag-wall-straight": 768,
    "sandbag-wall-corner": 768,
    "wooden-fence-broken": 640,
    "wooden-fence-intact": 640,
    "dead-tree-tall": 768,
    "dead-tree-short": 640,
    "shrub-dry-a": 448,
    "shrub-dry-b": 448,
    "rock-pile-large": 640,
    "rock-pile-small": 448,
    "fp-rifle-hands-idle": 1536,
    "fp-rifle-hands-fire": 1536,
}
SKY_MAX_WIDTH = 2048
# 第一人称带手臂图：不裁包围盒（idle/fire 两帧要保持同一坐标系），
# 落到武器 fp 目录下以武器 id 命名。
FIRST_PERSON_TARGETS = {
    "fp-rifle-hands-idle": "liaoshi13-hands",
    "fp-rifle-hands-fire": "liaoshi13-hands-fire",
}


def _label_components(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """4 连通分量标号（纯 numpy/BFS，避免依赖 scipy）。"""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    current = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if labels[y0, x0]:
            continue
        current += 1
        labels[y0, x0] = current
        queue: deque[tuple[int, int]] = deque([(y0, x0)])
        while queue:
            y, x = queue.popleft()
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = current
                    queue.append((ny, nx))
    return labels, current


def background_mask(rgb: np.ndarray) -> np.ndarray:
    """假透明棋盘格 = 中性浅色的连通块，且满足以下任一：
    - 触到图像边缘；
    - 块内有明显的双亮度分布（棋盘格明/暗两格），面积 ≥ 64px。
    这样既能删被枝干围住的"孤岛"棋盘格，又不会误删物件上的小片浅色高光。
    """
    r = rgb.astype(np.int16)
    neutral = (r.max(axis=2) - r.min(axis=2)) <= 22
    bright = r.min(axis=2) >= 200
    candidate = neutral & bright
    labels, count = _label_components(candidate)
    if count == 0:
        return candidate
    h, w = candidate.shape
    brightness = r.max(axis=2)
    edge_labels = set(np.unique(labels[0, :]).tolist()) | set(np.unique(labels[-1, :]).tolist())
    edge_labels |= set(np.unique(labels[:, 0]).tolist()) | set(np.unique(labels[:, -1]).tolist())
    edge_labels.discard(0)
    keep = np.zeros(count + 1, dtype=bool)
    for label in edge_labels:
        keep[label] = True
    flat_labels = labels.ravel()
    flat_bright = brightness.ravel()
    areas = np.bincount(flat_labels, minlength=count + 1)
    sums = np.bincount(flat_labels, weights=flat_bright, minlength=count + 1)
    sq = np.bincount(flat_labels, weights=flat_bright.astype(np.float64) ** 2, minlength=count + 1)
    for label in range(1, count + 1):
        if keep[label] or areas[label] < 64:
            continue
        mean = sums[label] / areas[label]
        std = float(np.sqrt(max(sq[label] / areas[label] - mean * mean, 0.0)))
        # 棋盘格两级亮度差约 20+，标准差通常 ≥ 6；单一高光块标准差很小
        if std >= 5.0:
            keep[label] = True
    return keep[labels]


def soften_edge(alpha: np.ndarray, rgb: np.ndarray) -> np.ndarray:
    """边缘 1px 内按亮度做半透明，避免锯齿白边。"""
    r = rgb.astype(np.int16)
    edge_ring = np.zeros_like(alpha, dtype=bool)
    opaque = alpha > 0
    shifted = [
        np.roll(opaque, 1, 0), np.roll(opaque, -1, 0),
        np.roll(opaque, 1, 1), np.roll(opaque, -1, 1),
    ]
    neighbor_bg = ~np.logical_and.reduce(shifted)
    edge_ring = opaque & neighbor_bg
    brightness = r.max(axis=2)
    # 越接近棋盘格亮度越透明（220 → 0.35，190 → 1.0）
    factor = np.clip((236 - brightness) / 46.0, 0.35, 1.0)
    out = alpha.astype(np.float32)
    out[edge_ring] = out[edge_ring] * factor[edge_ring]
    return out.astype(np.uint8)


def process_prop(
    source: Path, destination: Path, max_edge: int, crop: bool = True
) -> tuple[int, int]:
    image = Image.open(source).convert("RGB")
    rgb = np.array(image)
    bg = background_mask(rgb)
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    alpha = soften_edge(alpha, rgb)
    rgba = np.dstack([rgb, alpha])
    result = Image.fromarray(rgba, "RGBA")
    box = result.getchannel("A").getbbox() if crop else None
    if box:
        result = result.crop(box)
    result.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    destination.parent.mkdir(parents=True, exist_ok=True)
    result.save(destination, optimize=True)
    return result.size


def process_sky(source: Path, destination: Path) -> tuple[int, int]:
    image = Image.open(source).convert("RGB")
    if image.width > SKY_MAX_WIDTH:
        ratio = SKY_MAX_WIDTH / image.width
        image = image.resize((SKY_MAX_WIDTH, round(image.height * ratio)), Image.Resampling.LANCZOS)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)
    return image.size


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    source_root = Path(sys.argv[1])
    only = set(sys.argv[2:])
    workspace = Path(__file__).resolve().parents[2]
    scene_dir = workspace / "client" / "assets" / "resources" / "scene"
    weapon_dir = workspace / "client" / "assets" / "resources" / "weapons"
    for source in sorted(source_root.glob("*.png")):
        stem = source.stem
        if only and stem not in only:
            continue
        if stem.startswith("sky-"):
            size = process_sky(source, scene_dir / f"{stem}.png")
        elif stem in FIRST_PERSON_TARGETS:
            size = process_prop(
                source,
                weapon_dir / "fp" / f"{FIRST_PERSON_TARGETS[stem]}.png",
                TARGET_MAX_EDGE[stem],
                crop=False,
            )
        elif stem in TARGET_MAX_EDGE:
            size = process_prop(source, scene_dir / f"{stem}.png", TARGET_MAX_EDGE[stem])
        else:
            print(f"跳过未知素材 {stem}")
            continue
        print(f"{stem}: {size[0]}x{size[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
