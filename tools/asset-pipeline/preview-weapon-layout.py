#!/usr/bin/env python3
"""
第一视角武器构图预览：按 weapon-view.ts 里同一套公式把贴图摆到 1280x720 画布上，
叠上准心，输出 PNG 供肉眼核对「枪口离准心多远、枪身从哪里出屏」。

用法：
  python3 tools/asset-pipeline/preview-weapon-layout.py [输出目录]

参数表直接抄自 client/assets/scripts/weapon/weapon-view.ts（改代码后同步改这里）。
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
FP_DIR = ROOT / "client/assets/resources/weapons/fp"
DESIGN_W, DESIGN_H = 1280, 720
CROSSHAIR_SIZE, CROSSHAIR_GAP = 10, 6

HANDS = {
    "liaoshi13": dict(heightRatio=0.78, muzzleU=0.49, muzzleV=0.299),
    # 重机枪后视图：生图后用 --measure 实测 muzzleU/V 再回填 weapon-view.ts
    "type92-hmg": dict(heightRatio=0.72, muzzleU=0.5, muzzleV=0.299),
}
# 整幅图模式的贴图文件名（不含扩展名）
HANDS_FILES = {
    "liaoshi13": "liaoshi13-hands",
    "type92-hmg": "type92-hmg-hands",
}
HANDHELD = {
    "liaoshi13": dict(tiltDeg=-42, widthRatio=0.64, muzzleV=0.138),
    "lee-enfield": dict(tiltDeg=-42, widthRatio=0.66, muzzleV=0.199),
    "zb26": dict(tiltDeg=-38, widthRatio=0.66, muzzleV=0.397),
    "bren": dict(tiltDeg=-38, widthRatio=0.66, muzzleV=0.402),
}
EMPLACEMENT = {
    "type92-hmg": dict(
        tiltDeg=-36, bodyHeightRatio=0.16, bodyTopV=0.04, bodyBottomV=0.33, muzzleV=0.143
    ),
}


def to_canvas(x: float, y: float) -> tuple[float, float]:
    """Cocos 画布坐标（中心原点，Y 向上）→ PIL（左上原点，Y 向下）。"""
    return DESIGN_W / 2 + x, DESIGN_H / 2 - y


def new_canvas() -> Image.Image:
    im = Image.new("RGBA", (DESIGN_W, DESIGN_H), (78, 92, 70, 255))
    d = ImageDraw.Draw(im)
    # 地平线示意
    d.rectangle([0, DESIGN_H * 0.45, DESIGN_W, DESIGN_H], fill=(96, 88, 64, 255))
    return im


def draw_crosshair(im: Image.Image) -> None:
    d = ImageDraw.Draw(im)
    cx, cy = DESIGN_W / 2, DESIGN_H / 2
    s, g = CROSSHAIR_SIZE, CROSSHAIR_GAP
    col = (255, 255, 255, 255)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        d.line([(cx + dx * g, cy + dy * g), (cx + dx * (g + s), cy + dy * (g + s))], fill=col, width=2)
    # 参考圈：离准心 60/120px 的辅助圆，方便量化枪口距离
    for r in (60, 120):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 220, 120, 120), width=1)


def paste_centered_rotated(
    canvas: Image.Image, sprite: Image.Image, root_xy: tuple[float, float], tilt_deg: float, mirror: bool
) -> None:
    """sprite 以自身中心为原点挂在 root 下，root 有旋转 tilt_deg（逆时针为正，Cocos 口径）。"""
    if mirror:
        sprite = sprite.transpose(Image.FLIP_LEFT_RIGHT)
    # PIL rotate 与 Cocos Z 轴旋转在屏幕上都是「逆时针为正」，直接同号传入。
    rotated = sprite.rotate(tilt_deg, expand=True, resample=Image.BICUBIC)
    rx, ry = to_canvas(*root_xy)
    canvas.alpha_composite(rotated, (int(round(rx - rotated.width / 2)), int(round(ry - rotated.height / 2))))


def open_hands_source(name: str) -> Image.Image:
    """优先 webp（入库后），其次 png（刚生图还没转格式）。"""
    stem = HANDS_FILES[name]
    for ext in ("webp", "png"):
        path = FP_DIR / f"{stem}.{ext}"
        if path.exists():
            return Image.open(path).convert("RGBA")
    raise FileNotFoundError(f"{stem}.webp/.png 不存在，先生图并跑 process-environment.py")


def measure_muzzle(name: str) -> tuple[float, float]:
    """实测枪口归一化坐标：取不透明像素的最高一行（后视图枪口在最上方），
    在该行附近 8px 内取不透明像素的横向中位。"""
    import numpy as np

    a = np.array(open_hands_source(name).getchannel("A")) > 64
    rows = np.nonzero(a.any(axis=1))[0]
    top = int(rows.min())
    band = a[top : top + 8]
    xs = np.nonzero(band.any(axis=0))[0]
    u = float(np.median(xs)) / a.shape[1]
    v = top / a.shape[0]
    return u, v


def layout_hands(name: str, gap_x: float, gap_y: float, out: Path) -> tuple[float, float]:
    comp = HANDS[name]
    src = open_hands_source(name)
    scale = DESIGN_H * comp["heightRatio"] / src.height
    sw, sh = src.width * scale, src.height * scale
    sprite = src.resize((int(sw), int(sh)), Image.LANCZOS)
    muzzle_lx = (comp["muzzleU"] - 0.5) * sw
    muzzle_ly = (0.5 - comp["muzzleV"]) * sh
    center_y = -DESIGN_H / 2 + sh / 2
    muzzle_y = center_y + muzzle_ly
    # 与 weapon-view.ts layoutHands 一致：纵向也把枪口推到目标高度（可上可下）。
    lift = gap_y - muzzle_y
    root = (gap_x - muzzle_lx, center_y + lift)
    canvas = new_canvas()
    paste_centered_rotated(canvas, sprite, root, 0, False)
    draw_crosshair(canvas)
    mx, my = root[0] + muzzle_lx, root[1] + muzzle_ly
    mark(canvas, mx, my)
    canvas.save(out)
    return mx, my


def layout_pinned(
    name: str, comp: dict, scale: float, gap_x: float, gap_y: float, mirror: bool, out: Path
) -> tuple[float, float]:
    src = Image.open(FP_DIR / f"{name}.webp").convert("RGBA")
    sw, sh = src.width * scale, src.height * scale
    sprite = src.resize((int(sw), int(sh)), Image.LANCZOS)
    local_x, local_y = -sw / 2, (0.5 - comp["muzzleV"]) * sh
    rad = math.radians(comp["tiltDeg"])
    rx = local_x * math.cos(rad) - local_y * math.sin(rad)
    ry = local_x * math.sin(rad) + local_y * math.cos(rad)
    root = (gap_x - rx, gap_y - ry)
    canvas = new_canvas()
    paste_centered_rotated(canvas, sprite, root, comp["tiltDeg"], mirror)
    draw_crosshair(canvas)
    mark(canvas, gap_x, gap_y)
    canvas.save(out)
    return gap_x, gap_y


def mark(canvas: Image.Image, x: float, y: float) -> None:
    px, py = to_canvas(x, y)
    ImageDraw.Draw(canvas).ellipse([px - 5, py - 5, px + 5, py + 5], outline=(255, 80, 80, 255), width=2)


def main() -> None:
    if len(sys.argv) > 2 and sys.argv[1] == "--measure":
        u, v = measure_muzzle(sys.argv[2])
        print(f"{sys.argv[2]}: muzzleU={u:.3f} muzzleV={v:.3f}")
        return
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/weapon-layout")
    out_dir.mkdir(parents=True, exist_ok=True)
    # (gapX, gapY) 旧值 / 新值：从 weapon-view.ts 抄
    gaps = {
        "hands:liaoshi13": {"old": (18, -10), "new": (150, -60)},
        "hands:type92-hmg": {"a": (0, -90)},
        "handheld:liaoshi13": {"old": (20, -12), "new": (140, -100)},
        "handheld:lee-enfield": {"old": (20, -12), "new": (140, -100)},
        "handheld:zb26": {"old": (22, -14), "new": (140, -96)},
        "emplacement:type92-hmg": {"old": (26, -18), "new": (120, -90)},
    }
    for key, gv in gaps.items():
        kind, name = key.split(":")
        for tag, (gx, gy) in gv.items():
            out = out_dir / f"{kind}-{name}-{tag}.png"
            if kind == "hands":
                try:
                    mx, my = layout_hands(name, gx, gy, out)
                except FileNotFoundError as error:
                    print(f"{key:26s} {tag:3s} 跳过：{error}")
                    continue
            elif kind == "handheld":
                comp = HANDHELD[name]
                src_w = Image.open(FP_DIR / f"{name}.webp").width
                scale = DESIGN_W * comp["widthRatio"] / src_w
                mx, my = layout_pinned(name, comp, scale, gx, gy, False, out)
            else:
                comp = EMPLACEMENT[name]
                src_h = Image.open(FP_DIR / f"{name}.webp").height
                body_px = src_h * (comp["bodyBottomV"] - comp["bodyTopV"])
                scale = DESIGN_H * comp["bodyHeightRatio"] / body_px
                mx, my = layout_pinned(name, comp, scale, gx, gy, True, out)
            print(f"{key:26s} {tag:3s} muzzle=({mx:6.1f},{my:6.1f}) dist={math.hypot(mx,my):5.1f}px -> {out}")


if __name__ == "__main__":
    main()
