#!/usr/bin/env python3
"""
把 client/assets/resources 下的 PNG 贴图整体瘦身：按用途降分辨率 + 转 WebP。

设计要点（2026-09-10 实测）：
- Cocos Creator 3.8.7 的 image importer 与运行时 downloader 都原生支持 .webp
  （engine/cocos/asset/asset-manager/downloader.ts:270），不需要任何引擎改动。
- 资源路径 `resources.load('scene/xxx')` 只看文件名不看后缀，因此代码零改动。
- .meta 的 uuid / userData（wrapMode、filter）原样搬到新的 .webp.meta，
  只把 files 里的 ".png" 换成 ".webp"，避免编辑器重新生成 uuid 导致引用漂移。
- 分辨率上限按「在屏幕上最大能占多少像素」定：
    ground  平铺地面，保 1024（近处会被放大）
    sky     全景 2:1，保 2048 宽
    far     远山 billboard，屏幕上最多 ~1000px 宽
    mid     中景物件（木箱/沙袋/树/石堆），屏幕上 200–400px，512 足够
    weapon  第一视角武器，屏幕上 ~700px，1024 宽
    char    角色序列帧 512，不动
- 质量：有透明通道的 billboard 用 q=88（边缘 alpha 要干净），不透明大图 q=82。

用法：
    python3 tools/asset-pipeline/optimize-textures.py            # 干跑，只打印计划
    python3 tools/asset-pipeline/optimize-textures.py --apply    # 真正转换并删除 PNG
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "client" / "assets" / "resources"

# (正则匹配 resources 相对路径, 最大宽, 最大高, 质量)
RULES: list[tuple[str, int, int, int]] = [
    (r"^scene/rocky-ground$", 1024, 1024, 82),
    (r"^scene/sky-dawn-panorama$", 2048, 1024, 82),
    (r"^scene/mountain-layer-(near|far)$", 1376, 1024, 86),
    (r"^weapons/fp/liaoshi13-hands(-fire)?$", 1024, 1024, 88),
    (r"^weapons/fp/", 1024, 1024, 88),
    (r"^scene/(supply-crate|weapon-rack|mg-emplacement|stone-barricade)$", 512, 512, 88),
    (r"^scene/(dead-tree|sandbag|rock-pile|wooden-fence|shrub)", 512, 512, 88),
    (r"^chars/", 512, 512, 88),
]
DEFAULT_RULE = (1024, 1024, 86)


def rule_for(rel: str) -> tuple[int, int, int]:
    for pattern, w, h, q in RULES:
        if re.search(pattern, rel):
            return w, h, q
    return DEFAULT_RULE


def fit(size: tuple[int, int], max_w: int, max_h: int) -> tuple[int, int]:
    w, h = size
    scale = min(max_w / w, max_h / h, 1.0)
    return max(1, round(w * scale)), max(1, round(h * scale))


def convert(png: Path, apply: bool) -> tuple[int, int]:
    rel = png.relative_to(RES).with_suffix("").as_posix()
    max_w, max_h, quality = rule_for(rel)
    im = Image.open(png)
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    im = im.convert("RGBA" if has_alpha else "RGB")
    target = fit(im.size, max_w, max_h)
    if target != im.size:
        im = im.resize(target, Image.LANCZOS)

    webp = png.with_suffix(".webp")
    before = png.stat().st_size
    if not apply:
        # 干跑也实际编码一次到内存，报告真实体积
        import io

        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=quality, method=6)
        after = buf.tell()
    else:
        im.save(webp, "WEBP", quality=quality, method=6)
        after = webp.stat().st_size
        # 搬 meta：保 uuid/userData，只换后缀
        meta_src = png.with_name(png.name + ".meta")
        meta_dst = webp.with_name(webp.name + ".meta")
        meta = json.loads(meta_src.read_text(encoding="utf-8"))
        meta["files"] = [".webp" if f == ".png" else f for f in meta.get("files", [])]
        meta_dst.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        png.unlink()
        meta_src.unlink()

    print(
        f"{before // 1024:6d}KB -> {after // 1024:5d}KB  "
        f"{im.size[0]}x{im.size[1]:<5} q{quality} {'A' if has_alpha else ' '}  {rel}"
    )
    return before, after


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="真正写入 webp 并删除 png")
    args = parser.parse_args()

    pngs = sorted(RES.rglob("*.png"))
    if not pngs:
        print("没有找到 PNG，可能已经全部转换过了")
        return 0
    total_before = total_after = 0
    for png in pngs:
        b, a = convert(png, args.apply)
        total_before += b
        total_after += a
    print(
        f"\n合计 {len(pngs)} 张：{total_before / 1048576:.1f}MB -> {total_after / 1048576:.1f}MB "
        f"（-{100 - total_after * 100 // max(total_before, 1)}%）"
        + ("" if args.apply else "   [干跑，加 --apply 生效]")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
