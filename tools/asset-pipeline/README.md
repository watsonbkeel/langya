# 素材加工脚本

> 规范见 [`../../skills/asset-pipeline/SKILL.md`](../../skills/asset-pipeline/SKILL.md)

## ⚠️ 铁则

```
军服素材/  和  武器素材/  是只读的。
脚本只读取原目录，输出到 client/assets/resources/。
绝不原地修改、绝不移动、绝不重命名原文件。
```

## 依赖

```bash
pip install pillow numpy
```

## 使用顺序

```bash
# 1. 先空跑看计划，确认源文件都能找到
python tools/asset-pipeline/process-chars.py   --dry-run
python tools/asset-pipeline/process-weapons.py --dry-run

# 2. 实际加工
python tools/asset-pipeline/process-chars.py
python tools/asset-pipeline/process-weapons.py

# 3. 校验输出
python tools/asset-pipeline/verify-output.py
```

## 抠图阈值调整

军服/武器是灰底渲染图，用颜色距离阈值去背。默认 `--tolerance 30`。

| 症状 | 处理 |
|---|---|
| 输出图还带灰底方块 | 调大：`--tolerance 40` |
| 角色身上被挖出洞 | 调小：`--tolerance 20` |
| 怎么调都不行 | 记入待办，请 watson 在 Mac 上手动抠 |

`verify-output.py` 会检测透明像素占比异常，但**最终仍需目视检查**——脚本判断不出"钢盔被抠掉一块"这种局部问题。

## 时机

**M4 之前不要卡在素材上。** 用色块占位先把玩法跑通：

```
中国军队 → #6B7A45（黄绿冷调）
日军     → #A8935F（黄土暖调）
```

## 幂等性

三个脚本都必须幂等——重复运行结果一致，不累积副作用。修改脚本时保持这个性质。

## 输出路径与配置的对应关系

`verify-output.py` 会从 `shared/config/*.json` 的 `assets` 字段自动收集所有声明路径并逐一校验。

因此：**改了输出文件名，必须同步改 `weapons.json` / `enemies.json` / `allies.json` 里的 `assets` 路径**，否则校验会报缺失。
