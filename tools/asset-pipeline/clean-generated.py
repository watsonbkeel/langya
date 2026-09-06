#!/usr/bin/env python3
"""把 image-agent 下载的棋盘格 RGB 图转成透明角色 PNG。

模型有时把“透明背景”渲染成白灰棋盘格。这里只处理下载副本，
不触碰军服素材/和武器素材/原始目录。
"""

from pathlib import Path
import sys

from PIL import Image
import numpy as np


def clean_checkerboard(source: Path, destination: Path, size: int = 512) -> None:
    image = Image.open(source).convert("RGBA")
    pixels = np.array(image)
    rgb = pixels[:, :, :3].astype(np.int16)
    neutral = rgb.max(axis=2) - rgb.min(axis=2) <= 18
    bright = rgb.min(axis=2) >= 218
    pixels[:, :, 3] = np.where(neutral & bright, 0, 255).astype(np.uint8)
    # 部分模型会在脚下额外画一条白色“地面线”，它不是角色的一部分。
    rows = np.indices(pixels.shape[:2])[0]
    floor_line = (rows >= int(pixels.shape[0] * 0.96)) & neutral & (rgb.min(axis=2) >= 170)
    pixels[:, :, 3] = np.where(floor_line, 0, pixels[:, :, 3]).astype(np.uint8)
    cleaned = Image.fromarray(pixels, "RGBA")
    alpha_box = cleaned.getchannel("A").getbbox()
    if alpha_box:
        cleaned = cleaned.crop(alpha_box)
    cleaned.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(cleaned, ((size - cleaned.width) // 2, (size - cleaned.height) // 2), cleaned)
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, optimize=True)


def main() -> int:
    if len(sys.argv) != 2:
        print("用法：python3 tools/asset-pipeline/clean-generated.py <下载目录>", file=sys.stderr)
        return 2
    source_root = Path(sys.argv[1])
    workspace = Path(__file__).resolve().parents[2]
    mapping = {
        "jp-soldier": "jp-soldier",
        "cn-soldier": "cn-soldier",
    }
    for source in sorted(source_root.glob("*.png")):
        stem = source.stem
        if "-ai" not in stem:
            continue
        faction, state, _ = stem.rsplit("-", 2)
        if faction not in mapping or state not in {"idle", "run", "fire"}:
            continue
        destination = workspace / "client" / "assets" / "resources" / "chars" / mapping[faction] / f"{state}.png"
        clean_checkerboard(source, destination)
        print(f"→ {source.name} -> {destination.relative_to(workspace)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
