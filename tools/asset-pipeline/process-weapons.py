#!/usr/bin/env python3
"""
武器素材加工：抠图去背 -> 裁切 -> 缩放 -> 输出到 client/assets/resources/weapons/

⚠️ 铁则：武器素材/ 是只读的。本脚本只读取，绝不修改、移动、重命名原文件。
⚠️ 目录名一律英文：武器素材/手榴弹/ → weapons/*/grenade

用法：
    python tools/asset-pipeline/process-weapons.py
    python tools/asset-pipeline/process-weapons.py --dry-run

依赖：
    pip install pillow numpy

源文件（实测每个武器目录含）：
    left.png / right.png  侧视图（最大 2277x1055）
    detail.png            细节图（暂不使用）
    icon.png              图标源

产出规格：
    weapons/fp/<name>.png     第一人称手持视图，宽 <= 1024，PNG-32 透明
    weapons/icons/<name>.png  HUD 图标 128x64，PNG-32 透明

第一人称取向：右手持枪，枪口朝右 -> 优先用 right.png；
缺失时用 left.png 水平翻转。
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
    import numpy as np
except ImportError:
    sys.exit("缺少依赖，请先执行：pip install pillow numpy")

ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = ROOT / "武器素材"
OUT_FP = ROOT / "client" / "assets" / "resources" / "weapons" / "fp"
OUT_ICON = ROOT / "client" / "assets" / "resources" / "weapons" / "icons"

# 原目录名 -> 输出文件名（必须与 shared/config/weapons.json 的 assets 路径一致）
MAPPING = {
    "liaoshi13": "liaoshi13",
    "lee-enfield-no4": "lee-enfield",
    "zb26": "zb26",
    "bren": "bren",
    "type38": "type38",
    "type96-lmg": "jp-lmg",
    "type92-hmg": "type92-hmg",
    "手榴弹": "grenade",          # 中文目录必须改英文名
}

FP_MAX_WIDTH = 1024
ICON_SIZE = (128, 64)


def remove_bg(img: Image.Image, tolerance: int = 30) -> Image.Image:
    img = img.convert("RGBA")
    arr = np.array(img)
    corners = [arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]]
    bg = np.mean([c[:3].astype(float) for c in corners], axis=0)
    dist = np.sqrt(np.sum((arr[:, :, :3].astype(int) - bg) ** 2, axis=2))
    arr[:, :, 3] = np.where(dist < tolerance, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def trim(img: Image.Image) -> Image.Image:
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def fit_into(img: Image.Image, size) -> Image.Image:
    """等比缩放后居中放入固定画布（用于图标）。"""
    w, h = size
    img = img.copy()
    img.thumbnail(size, Image.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.paste(img, ((w - img.width) // 2, (h - img.height) // 2))
    return canvas


def pick_side_source(src_dir: Path):
    """第一人称优先 right.png；只有 left.png 时翻转。"""
    r = src_dir / "right.png"
    if r.exists():
        return r, False
    l = src_dir / "left.png"
    if l.exists():
        return l, True
    return None, False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tolerance", type=int, default=30)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not SRC_ROOT.exists():
        sys.exit(f"❌ 找不到源目录：{SRC_ROOT}")

    if not args.dry_run:
        OUT_FP.mkdir(parents=True, exist_ok=True)
        OUT_ICON.mkdir(parents=True, exist_ok=True)

    ok, miss = 0, 0
    for src_name, out_name in MAPPING.items():
        src_dir = SRC_ROOT / src_name
        if not src_dir.exists():
            print(f"⚠️  跳过（源目录不存在）：{src_dir.name}")
            miss += 1
            continue

        # --- 第一人称视图 ---
        side_src, need_flip = pick_side_source(src_dir)
        if side_src is None:
            print(f"⚠️  {src_name}：缺少 right.png / left.png")
            miss += 1
        else:
            dst = OUT_FP / f"{out_name}.png"
            flag = "（水平翻转）" if need_flip else ""
            print(f"→ FP   {side_src.relative_to(ROOT)} → {dst.relative_to(ROOT)} {flag}")
            if not args.dry_run:
                img = remove_bg(Image.open(side_src), args.tolerance)
                img = trim(img)
                if need_flip:
                    img = img.transpose(Image.FLIP_LEFT_RIGHT)
                if img.width > FP_MAX_WIDTH:
                    ratio = FP_MAX_WIDTH / img.width
                    img = img.resize(
                        (FP_MAX_WIDTH, max(1, int(img.height * ratio))), Image.LANCZOS
                    )
                img.save(dst, optimize=True)
            ok += 1

        # --- HUD 图标 ---
        icon_src = src_dir / "icon.png"
        if not icon_src.exists():
            icon_src = side_src  # 退而求其次，用侧视图生成图标
        if icon_src is None:
            print(f"⚠️  {src_name}：无法生成图标")
            miss += 1
        else:
            dst = OUT_ICON / f"{out_name}.png"
            print(f"→ ICON {icon_src.relative_to(ROOT)} → {dst.relative_to(ROOT)} {ICON_SIZE}")
            if not args.dry_run:
                img = remove_bg(Image.open(icon_src), args.tolerance)
                img = fit_into(trim(img), ICON_SIZE)
                img.save(dst, optimize=True)
            ok += 1

    print()
    print(f"完成：{ok} 个输出，{miss} 个问题")
    if not args.dry_run and ok:
        print("下一步：python tools/asset-pipeline/verify-output.py")


if __name__ == "__main__":
    main()
