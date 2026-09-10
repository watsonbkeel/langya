#!/usr/bin/env python3
"""
裁掉 billboard 贴图四周的透明边距，让「内容底边 = 画布底边」。

背景（2026-09-10 反馈「部署的防御浮在空中」）：
- 场景道具 billboard 由 `createBillboardProp` 以 `centerY: 0` 摆放，
  面片底边被精确贴到 `terrainHeightAt(x, z)`。
- 但 `stone-barricade.webp` / `mg-emplacement.webp` 是 512×512 整图，
  内容居中、上下各有 ~26% 透明边距，于是**内容底边**悬在地面上方
  `padding × height` 米（石垒 ≈ 0.38m，机枪工事 ≈ 0.55m），看起来漂浮。
- `sandbag-wall-straight.webp` 没有边距，所以沙袋一直贴地正确。
- `optimize-textures.py` 只缩放不裁剪，所以边距一直保留到线上。

做法：按 alpha bbox 裁剪（阈值很低，保留柔边），原地覆盖 .webp，
.meta 不动（uuid 不变，引用不漂移）。裁剪后贴图宽高比会变化，
调用方（m4-scene-decorations.ts）的高度常量按「内容高度」重新标定即可。

用法：
    python3 tools/asset-pipeline/crop-transparent-margins.py            # 干跑
    python3 tools/asset-pipeline/crop-transparent-margins.py --apply    # 真正覆盖
    python3 tools/asset-pipeline/crop-transparent-margins.py --apply scene/xxx ...
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "client" / "assets" / "resources"

DEFAULT_TARGETS = [
    "scene/stone-barricade",
    "scene/mg-emplacement",
]

ALPHA_THRESHOLD = 8
QUALITY = 88


def crop_one(rel: str, apply: bool) -> None:
    path = RES / f"{rel}.webp"
    if not path.exists():
        print(f"[skip] 不存在：{path}")
        return
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    mask = im.getchannel("A").point(lambda v: 255 if v > ALPHA_THRESHOLD else 0)
    bbox = mask.getbbox()
    if not bbox:
        print(f"[skip] 全透明：{rel}")
        return
    left, top, right, bottom = bbox
    pad = (left / w, top / h, 1 - right / w, 1 - bottom / h)
    if max(pad) < 0.01:
        print(f"[ok]   {rel} 已无透明边距 {w}x{h}")
        return
    cw, ch = right - left, bottom - top
    print(
        f"[crop] {rel} {w}x{h} -> {cw}x{ch} "
        f"(边距 左{pad[0]:.3f} 上{pad[1]:.3f} 右{pad[2]:.3f} 下{pad[3]:.3f})"
    )
    if not apply:
        return
    im.crop(bbox).save(path, "WEBP", quality=QUALITY, method=6)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("targets", nargs="*", default=DEFAULT_TARGETS)
    args = parser.parse_args()
    for rel in args.targets:
        crop_one(rel, args.apply)
    if not args.apply:
        print("（干跑，加 --apply 才会覆盖文件）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
