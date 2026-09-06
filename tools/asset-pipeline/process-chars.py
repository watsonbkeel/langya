#!/usr/bin/env python3
"""
军服素材加工：抠图去背 -> 裁切 -> 缩放 -> 输出到 client/assets/resources/chars/

⚠️ 铁则：军服素材/ 是只读的。本脚本只读取，绝不修改、移动、重命名原文件。

用法：
    python tools/asset-pipeline/process-chars.py
    python tools/asset-pipeline/process-chars.py --tolerance 35   # 抠图阈值
    python tools/asset-pipeline/process-chars.py --dry-run        # 只打印计划不写文件

依赖：
    pip install pillow numpy

产出规格（见 skills/asset-pipeline/SKILL.md）：
    chars/cn-soldier/idle.png      512x512  PNG-32 透明
    chars/cn-soldier/side.png      512x512
    chars/cn-soldier/portrait.png  128x128
    chars/jp-soldier/*             同上

    run.png / fire.png 由 image-agent.py 下载后交给 clean-generated.py 清理，
    与 idle.png 使用相同的 512x512 RGBA 规格。

脚本必须幂等：重复运行结果一致。
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
SRC_ROOT = ROOT / "军服素材"
OUT_ROOT = ROOT / "client" / "assets" / "resources" / "chars"

# 原目录名 -> 输出目录名（一律英文）
MAPPING = {
    "national-army-soldier": "cn-soldier",
    "japanese-army-soldier": "jp-soldier",
}

# 源文件名 -> (输出文件名, 目标尺寸)
FILE_SPEC = {
    "front": ("idle.png", 512),
    "side": ("side.png", 512),
    "portrait": ("portrait.png", 128),
}


def remove_bg(img: Image.Image, tolerance: int = 30) -> Image.Image:
    """颜色阈值去背：取四角像素均值作为背景基准色。

    注意：钢盔/军服可能有接近背景灰的区域，阈值不宜过大，
    加工后必须目视检查是否把角色身上抠出了洞。
    """
    img = img.convert("RGBA")
    arr = np.array(img)

    corners = [arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]]
    bg = np.mean([c[:3].astype(float) for c in corners], axis=0)

    dist = np.sqrt(np.sum((arr[:, :, :3].astype(int) - bg) ** 2, axis=2))
    arr[:, :, 3] = np.where(dist < tolerance, 0, 255).astype(np.uint8)

    return Image.fromarray(arr)


def trim_and_resize(img: Image.Image, size: int) -> Image.Image:
    """裁掉透明边距，等比缩放到目标尺寸，居中填充。

    getbbox() 必须在抠图之后调用，否则灰底会被算作有效区域。
    """
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    img.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2))
    return canvas


def find_source(src_dir: Path, stem: str):
    """源文件扩展名可能是 .png/.jpg，做一次容错查找。"""
    for ext in (".png", ".PNG", ".jpg", ".jpeg", ".webp"):
        p = src_dir / f"{stem}{ext}"
        if p.exists():
            return p
    matches = list(src_dir.glob(f"*{stem}*"))
    return matches[0] if matches else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tolerance", type=int, default=30, help="抠图颜色距离阈值")
    ap.add_argument("--dry-run", action="store_true", help="只打印计划不写文件")
    args = ap.parse_args()

    if not SRC_ROOT.exists():
        sys.exit(f"❌ 找不到源目录：{SRC_ROOT}")

    ok, miss = 0, 0
    for src_name, out_name in MAPPING.items():
        src_dir = SRC_ROOT / src_name
        out_dir = OUT_ROOT / out_name

        if not src_dir.exists():
            print(f"⚠️  跳过（源目录不存在）：{src_dir}")
            continue

        if not args.dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)

        for stem, (out_file, size) in FILE_SPEC.items():
            src = find_source(src_dir, stem)
            if src is None:
                print(f"⚠️  缺少源文件：{src_dir.name}/{stem}.*")
                miss += 1
                continue

            dst = out_dir / out_file
            print(f"→ {src.relative_to(ROOT)}  →  {dst.relative_to(ROOT)}  ({size}x{size})")

            if args.dry_run:
                ok += 1
                continue

            img = Image.open(src)
            img = remove_bg(img, args.tolerance)
            img = trim_and_resize(img, size)
            img.save(dst, optimize=True)
            ok += 1

    print()
    print(f"完成：{ok} 个输出，{miss} 个缺失")
    if not args.dry_run and ok:
        print("⚠️  请目视检查输出图：抠图是否把角色身上挖出了洞（阈值过大的典型症状）")
        print("   下一步：python tools/asset-pipeline/verify-output.py")


if __name__ == "__main__":
    main()
