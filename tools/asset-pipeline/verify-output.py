#!/usr/bin/env python3
"""
素材加工输出校验

检查项：
    1. shared/config/*.json 里声明的每个 assets 路径都有对应文件
    2. 输出尺寸符合 skills/asset-pipeline/SKILL.md 的规格表
    3. 全部为 PNG-32 且真的有透明通道（抠图没白做）
    4. 透明像素占比异常检测（过高 = 抠穿了，过低 = 没抠掉背景）
    5. 资源总体积 < 25 MB

用法：
    python tools/asset-pipeline/verify-output.py

退出码：0 = 通过，1 = 有错误
"""

import json
import sys
from pathlib import Path

try:
    from PIL import Image
    import numpy as np
except ImportError:
    sys.exit("缺少依赖，请先执行：pip install pillow numpy")

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "client" / "assets" / "resources"
CONFIG = ROOT / "shared" / "config"

MAX_TOTAL_MB = 25

# 路径前缀 -> 期望尺寸（None = 只校验上限）
SPEC = {
    "chars/": {"suffix": {"idle": (512, 512), "side": (512, 512), "run": (512, 512), "fire": (512, 512), "portrait": (128, 128)}},
    "weapons/icons/": {"exact": (128, 64)},
    "weapons/fp/": {"max_width": 1024},
}

errors, warnings = [], []


def collect_declared_assets():
    """从配置文件里收集所有声明的素材路径。"""
    paths = set()

    def walk(node):
        if isinstance(node, dict):
            if "assets" in node and isinstance(node["assets"], dict):
                for v in node["assets"].values():
                    if isinstance(v, str):
                        paths.add(v)
            if "heroSprites" in node and isinstance(node["heroSprites"], dict):
                for base_path in node["heroSprites"].values():
                    if isinstance(base_path, str):
                        for state in ("idle", "run", "fire"):
                            paths.add(f"{base_path}/{state}")
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    for f in CONFIG.glob("*.json"):
        try:
            walk(json.loads(f.read_text(encoding="utf-8")))
        except Exception as e:
            errors.append(f"{f.name} 解析失败：{e}")
    return sorted(paths)


def check_image(rel_path: str):
    p = RES / f"{rel_path}.png"
    if not p.exists():
        errors.append(f"缺少素材文件：client/assets/resources/{rel_path}.png")
        return

    try:
        img = Image.open(p)
    except Exception as e:
        errors.append(f"{rel_path}.png 无法打开：{e}")
        return

    if img.mode != "RGBA":
        errors.append(f"{rel_path}.png 模式为 {img.mode}，必须是 RGBA（PNG-32）")
        return

    arr = np.array(img)
    alpha = arr[:, :, 3]
    transparent_ratio = float((alpha == 0).mean())

    if transparent_ratio == 0:
        errors.append(f"{rel_path}.png 完全不透明 —— 抠图没生效，背景还在")
    elif transparent_ratio > 0.92:
        warnings.append(
            f"{rel_path}.png 透明像素占 {transparent_ratio:.0%} —— 疑似抠穿了，请目视检查"
        )

    # 尺寸校验
    w, h = img.size
    for prefix, rule in SPEC.items():
        if not rel_path.startswith(prefix):
            continue
        if "exact" in rule and (w, h) != rule["exact"]:
            errors.append(f"{rel_path}.png 尺寸 {w}x{h}，规格要求 {rule['exact'][0]}x{rule['exact'][1]}")
        if "max_width" in rule and w > rule["max_width"]:
            errors.append(f"{rel_path}.png 宽度 {w} 超过上限 {rule['max_width']}")
        if "suffix" in rule:
            stem = Path(rel_path).name
            want = rule["suffix"].get(stem)
            if want and (w, h) != want:
                errors.append(f"{rel_path}.png 尺寸 {w}x{h}，规格要求 {want[0]}x{want[1]}")
        break


def main():
    if not RES.exists():
        sys.exit(f"❌ 输出目录不存在：{RES}\n   请先运行 process-chars.py / process-weapons.py")

    declared = collect_declared_assets()
    print(f"→ 从 shared/config/ 收集到 {len(declared)} 个声明素材路径")
    for rel in declared:
        check_image(rel)

    # 总体积
    total = sum(f.stat().st_size for f in RES.rglob("*") if f.is_file())
    total_mb = total / 1024 / 1024
    print(f"→ 资源总体积：{total_mb:.2f} MB / 上限 {MAX_TOTAL_MB} MB")
    if total_mb > MAX_TOTAL_MB:
        errors.append(f"资源总体积 {total_mb:.2f} MB 超过红线 {MAX_TOTAL_MB} MB")

    print()
    if warnings:
        print(f"⚠️  {len(warnings)} 条警告：")
        for m in warnings:
            print(f"   - {m}")
        print()
    if errors:
        print(f"❌ {len(errors)} 条错误：")
        for m in errors:
            print(f"   - {m}")
        sys.exit(1)

    print("✅ 素材校验全部通过")


if __name__ == "__main__":
    main()
