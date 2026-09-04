---
name: asset-pipeline
description: 狼牙山项目素材二次加工规范。当需要把 军服素材/ 武器素材/ 下的原始参考图转换为游戏可用资源时使用。涵盖抠图、裁切、缩放、命名规范与 Cocos 图集配置。
---

# 素材二次加工规范

## ⚠️ 首要认知：现有素材不能直接用

**这是本项目最容易翻车的环节。**

原始素材是**美术概念参考图**，不是游戏资源：

| 问题 | 具体表现 |
|---|---|
| 带背景 | 军服图是灰底渲染图，没有透明通道 |
| 尺寸过大 | 军服 1024×1024，武器最大 2277×1055 |
| 无动作 | 只有静态 T-pose，没有动画序列 |
| 中文目录 | `武器素材/手榴弹/` 在构建管线中可能出问题 |

直接把原图塞进场景 → 首屏加载爆炸 + 角色带灰底方块 + 构建报错。

---

## 铁则

```
军服素材/  和  武器素材/  是只读的。

加工脚本必须：读取原目录 → 输出到 client/assets/resources/
绝不原地修改、绝不移动、绝不重命名原文件。
```

---

## 素材清单（已实测）

### 军服（1024×1024 PNG）

| 目录 | 用途 | 可用文件 |
|---|---|---|
| `军服素材/national-army-soldier/` | 玩家 + AI 队友 | front / back / side / portrait / palette |
| `军服素材/japanese-army-soldier/` | 日军敌人 | 同上 |

两个目录各有 `design-notes.md`，内含视觉区分要点，加工时参考：

- 中国军队：黄绿色（冷调）+ M35 钢盔 + 帆布子弹带 + 布鞋
- 日军：黄土色（暖调）+ 略帽/90 式钢盔 + 皮质弹药盒 + 分趾胶鞋

### 武器（侧视图 PNG）

| 原目录 | 输出目录名 | 武器 | 归属 |
|---|---|---|---|
| `武器素材/liaoshi13/` | `liaoshi13` | 中正式步枪 | 玩家默认 |
| `武器素材/lee-enfield-no4/` | `lee-enfield` | 李恩菲尔德 No.4 | 玩家 |
| `武器素材/zb26/` | `zb26` | ZB26 轻机枪 | 玩家 |
| `武器素材/bren/` | `bren` | 布伦轻机枪 | 玩家 |
| `武器素材/type38/` | `type38` | 三八式步枪 | 日军 |
| `武器素材/type92-hmg/` | `type92-hmg` | 九二式重机枪 | 阵地固定 |
| `武器素材/手榴弹/` | **`grenade`** | 手榴弹 | 玩家 |

> **注意**：`手榴弹` 必须改名为 `grenade`。所有输出目录一律英文。

---

## 加工管线

### 输出结构

```
client/assets/resources/
├── chars/
│   ├── cn-soldier/          # 中国军队（玩家 + AI 队友共用）
│   │   ├── idle.png         # 512×512，由 front.png 抠图裁切
│   │   ├── side.png         # 512×512，由 side.png 加工
│   │   └── portrait.png     # 128×128，HUD 头像
│   └── jp-soldier/          # 日军
│       ├── idle.png
│       ├── side.png
│       └── portrait.png
├── weapons/
│   ├── fp/                  # 第一人称手部武器视图
│   │   ├── liaoshi13.png    # ≤1024 宽
│   │   ├── zb26.png
│   │   └── ...
│   └── icons/               # HUD 图标
│       ├── liaoshi13.png    # 128×64
│       └── ...
├── ui/
├── audio/
└── terrain/
```

### 规格表

| 用途 | 目标尺寸 | 格式 | 要求 |
|---|---|---|---|
| 角色 Billboard | 512×512 | PNG-32 | 必须抠除背景，保留透明通道 |
| 第一人称武器 | ≤1024 宽 | PNG-32 | 抠背景，等比缩放 |
| 武器 HUD 图标 | 128×64 | PNG-32 | 由 icon.png 缩放 |
| 角色头像 | 128×128 | PNG-32 | 由 portrait.png 居中裁切 |

**总体积红线**：全部资源 < 25 MB。

---

## 抠图处理

军服图是灰色背景，需要去背。优先级顺序：

### 方案 1：颜色阈值去背（首选，可脚本化）

背景是相对均匀的灰色，可用颜色距离判断：

```python
from PIL import Image
import numpy as np

def remove_bg(src, dst, tolerance=30):
    img = Image.open(src).convert('RGBA')
    arr = np.array(img)

    # 取四角像素均值作为背景色基准
    corners = [arr[0,0], arr[0,-1], arr[-1,0], arr[-1,-1]]
    bg = np.mean([c[:3] for c in corners], axis=0)

    # 颜色距离小于阈值的判为背景
    dist = np.sqrt(np.sum((arr[:,:,:3].astype(int) - bg)**2, axis=2))
    arr[:,:,3] = np.where(dist < tolerance, 0, 255)

    Image.fromarray(arr).save(dst)
```

**注意**：钢盔和军服可能有接近背景灰的区域，阈值不要设太大。加工后必须**目视检查**是否把角色身上抠出了洞。

### 方案 2：手动抠图

若阈值法效果差，用图像工具手动处理。这属于需要 GUI 的工作，可以：
- 记入待办，请 watson 在 Mac 上处理
- 或先用方案 1 的粗糙结果占位，不阻塞开发

### 方案 3：程序化占位（M4 之前）

**M4 美术接入之前，直接用色块占位，不要卡在素材上。**

```
中国军队 → 黄绿色矩形 #6B7A45
日军     → 黄土色矩形 #A8935F
```

玩法逻辑跑通比画面好看重要得多。

---

## 裁切与缩放

抠图后角色周围会有大量透明区域，必须裁掉：

```python
def trim_and_resize(src, dst, size=512):
    img = Image.open(src).convert('RGBA')
    bbox = img.getbbox()          # 自动获取非透明区域边界
    img = img.crop(bbox)

    # 等比缩放到目标尺寸，居中填充
    img.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0,0,0,0))
    x = (size - img.width) // 2
    y = (size - img.height) // 2
    canvas.paste(img, (x, y))
    canvas.save(dst, optimize=True)
```

**关键**：`getbbox()` 必须在抠图之后调用，否则灰底会被算作有效区域。

---

## 角色动作方案（v1.0）

**不做逐帧动画。** 用代码补间模拟动作：

| 状态 | 实现 |
|---|---|
| 待机 | 静态图 + 上下轻微浮动（tween，周期 2s，振幅 3px） |
| 奔跑 | 静态图 + 左右摇摆（±4°）+ 位移 |
| 中弹 | 红色闪烁（0.15s）+ 后仰 8° |
| 阵亡 | 倒地旋转 90° + 淡出（0.8s） |

**理由**：2.5D Billboard 视角下，角色通常在中远距离，逐帧动画收益低但成本极高。

**接口预留**：状态用枚举定义，后续要升级逐帧只需换实现，不动调用方。

```ts
export enum AnimState {
  Idle, Run, Hit, Dead
}
```

---

## Billboard 朝向处理

2D 角色面片必须始终朝向摄像机：

```ts
// 每帧更新，只绕 Y 轴旋转（保持角色站立）
const camPos = camera.node.worldPosition;
const myPos = this.node.worldPosition;
const dir = new Vec3(camPos.x - myPos.x, 0, camPos.z - myPos.z);
this.node.forward = dir.normalize();
```

**不要**用完整 lookAt，否则角色会跟着摄像机俯仰而倾倒。

**左右朝向**：根据角色移动方向决定用 `idle.png` 还是水平翻转版本，用 `scale.x = ±1` 实现，不需要额外贴图。

---

## 加工脚本组织

```
tools/asset-pipeline/
├── process-chars.py      # 军服加工
├── process-weapons.py    # 武器加工
├── verify-output.py      # 输出校验（尺寸、透明通道、总体积）
└── README.md             # 使用说明
```

**脚本必须幂等**：重复运行结果一致，不累积副作用。

**必须有校验步骤**：
```bash
python tools/asset-pipeline/verify-output.py
# 检查：所有输出文件存在、尺寸符合规格、有透明通道、总体积 < 25MB
```

---

## 待补充素材（当前缺失）

以下素材项目里没有，需要另行生成或找免费资源：

| 素材 | 优先级 | 建议方案 |
|---|---|---|
| 山地地形贴图 | P0 | 程序化生成或免费素材库 |
| 天空盒 | P0 | Cocos 内置或纯色渐变 |
| 石垒掩体 | P0 | 代码生成简单几何体，不需要贴图 |
| 枪声音效 | P0 | 免费音效库（注意授权） |
| 血包图标 | P1 | 简单图形，可代码绘制 |
| UI 框体 | P1 | 沿用品牌色，代码绘制 |
| 弹着尘土粒子 | P1 | Cocos 内置粒子贴图 |

**品牌色**（沿用「跟我练-AI创造」体系）：

```
主色深蓝  #1B4B6F
青色      #45B7C9
暗蓝      #183040
```

---

## 检查清单

加工完成后逐项确认：

- [ ] 原始素材目录未被修改（`git status` 或文件时间戳确认）
- [ ] 所有输出目录名为英文（特别是 `手榴弹` → `grenade`）
- [ ] 角色图已抠背景，边缘无灰色残留
- [ ] 角色图无「抠出洞」的问题（目视检查）
- [ ] 尺寸符合规格表
- [ ] 所有 PNG 有透明通道
- [ ] 资源总体积 < 25 MB
- [ ] 加工脚本可重复运行且结果一致
