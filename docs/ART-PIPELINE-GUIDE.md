# 从「方块人」到「能看的射击游戏」——AI 时代的游戏美术实战手册

> 读者：正在用 AI 开发射击游戏的同学，以及帮你干活的那个 AI。
> 来源：狼牙山五壮士项目（Cocos Creator 3.8.7 + Node 权威服务端多人 FPS）的真实开发记录提炼。
> 用法：同学先读第 0、1、6 章建立判断力；AI 读第 2~5 章照着执行。

---

## 0. 先说结论：99% 的人把顺序搞反了

新手做射击游戏的典型路径是这样的：

```
打开引擎 → 想让画面好看 → 开始找素材 / 生图 → 素材一直不满意 → 三周后游戏还不能玩
```

这条路会死。正确的路径只有一条：

```
毛坯房（色块能跑通玩法） → 验证好玩 → 精装房（真实贴图 + 光照 + HUD） → 打磨
```

**毛坯房阶段**，我们项目里的中国军队是一个 `#6B7A45` 的绿色方块，日军是一个 `#A8935F` 的土黄方块，地面是一张纯色网格，天空是引擎默认的灰蓝。就这样，我们跑完了：移动、瞄准、开枪、命中判定、掉血、AI 敌人推进、多人联机、复活。

**这一步必须先完成。** 因为：

1. 玩法不好玩，贴图再真实也没人玩第二局。
2. 玩法没定型时做的素材，90% 会因为「镜头换了 / 尺寸变了 / 视角改了」而废掉。
3. 色块阶段暴露问题最快——方块人如果都看不清在哪，换成真人立绘只会更看不清。

我们项目里写进规范的一句话是：

> **M4（玩法里程碑）之前不要卡素材，一律用色块占位。**

记住这个判断标准：**当你能用方块人打完一整局并且觉得"有点上瘾"了，才允许开始做美术。**

---

## 1. 「毛坯房 → 精装房」到底改了什么

很多人以为精装房 = 把方块换成真人图。**错。** 我们项目做完第一版真人贴图后，专门写了一份视觉评审文档，第一句结论是：

> 当前呈现层是一个「调试面板」，而不是一个「游戏画面」。风险不在于换素材，而在于 HUD 信息架构、渲染管线、画布适配三处结构性欠账——这些**不会因为换了立绘而自动变好**。

换句话说，画面「像游戏」靠的是四层东西，贴图只是其中一层：

| 层级 | 毛坯房状态 | 精装房状态 | 不做会怎样 |
|---|---|---|---|
| **① 渲染/光照** | 全场 `builtin-unlit`，没有光 | 平行光（太阳）+ 环境光 + 线性雾 | 画面"平"，再好的贴图也像纸片贴在白墙上 |
| **② 环境/空间** | 纯色地面 + 引擎默认天空 | 全景天空球 + 远山视差层 + 中景散布物件 | 玩家没有"身处一个地方"的感觉，只有一块地板 |
| **③ 角色/道具贴图** | 色块 | 真实人物立绘 + 第一视角武器 | 这个是大家唯一想到的一层 |
| **④ HUD/信息架构** | 「M2 五人防线·服务器权威 AI」「延迟 12ms」「命中 55·裁决 7ms」 | 只留玩家需要的信息，调试信息藏进 `?debug=1` | 画面永远像个测试工具 |

**优先级：① > ② > ④ > ③。**

这个顺序反直觉，但是对的。我们项目的实际体验跃迁，一半来自"加了一盏太阳光和一层雾"，而不是来自换贴图。因为光照和雾负责的是**空间感和距离感**——射击游戏里玩家判断"敌人有多远、能不能打到"全靠这个。

所以给你的 AI 的第一条指令不该是「帮我生成士兵立绘」，而应该是：

```
请先给场景加上：一盏平行光作为太阳（方向按剧情时间设定）、
一个环境光、以及线性雾（起始距离 90 米以上）。
材质从 builtin-unlit 改为 builtin-standard 或 toon。
先不要碰任何贴图。
```

### 1.1 光照方向要有"理由"

我们项目的光照不是随手调的，是从剧情推出来的：

- 1941-09-24 深夜：月光下埋雷 → 冷蓝色调，低亮度
- 09-25 清晨 6:00：接火 → 晨白光，低角度，从东侧来
- 午后：撤向棋盘陀 → 太阳偏西

**主光源是太阳，所以白天的战斗不需要任何人造光源。** 我们明确否决了"局内加照明灯"的提案，因为不符合史实。

你的游戏也一样：先定"这场战斗发生在什么时间、什么天气"，光的颜色、角度、强度就都有答案了。这比调参数快十倍，而且不会调出一个"说不出哪里怪"的画面。

---

## 2. 如何让 AI 自动生成你要的图片素材

### 2.1 工具：一个异步生图 Agent

我们项目里有个脚本 `tools/asset-pipeline/image-agent.py`，它干的事是：读一份"素材清单"→ 并发提交给生图 API → 轮询等结果 → 下载成 PNG。

调用方式：

```bash
export BKEEL_IMAGE_API_KEY='你的密钥'        # 只从环境变量读，绝不写进文件
python tools/asset-pipeline/image-agent.py \
    tools/asset-pipeline/m7-environment.json \
    --output-dir output/m7-raw
```

完整参数：

| 参数 | 说明 |
|---|---|
| `manifest`（位置参数） | JSON 数组或 JSONL 文件，就是素材清单 |
| `--output-dir` | 必填，图片落盘目录 |
| `--base-url` | 默认 `https://token.bkeel.com/v1` |
| `--model` | 默认 `og-image2-low` |
| `--max-concurrency` | 默认 5，上限 5 |
| `--allow-over-100` | 单批超过 100 张时必须显式加这个开关 |
| `--resume NAME=TASK_ID` | 断点续传，可重复传 |

内部行为（你的 AI 需要知道）：轮询间隔 8 秒，单张超时 20 分钟，网络类瞬时错误自动重试 6 次，成功后保存为 `<name>.png`。

### 2.2 三条硬规矩（关于花钱）

生图是**付费**的。我们项目把这几条写成了铁律：

1. **先报预算再调用。** 「本次调用 N 次、生成 N 张候选」，得到确认后才发起。
2. **不为"探索参数"重复调用。** 一次任务只发必要的最少次数。想验证 prompt 好不好，先只生 1~2 张试水，别一次性铺 20 张。
3. **密钥只走环境变量。** 脚本里 `os.environ.get("BKEEL_IMAGE_API_KEY")`，取不到就直接退出。绝不允许密钥出现在任何提交进 git 的文件里。

告诉你的 AI：**没有拿到我的明确同意，不许发起生图请求。**

### 2.3 核心技能：写"素材清单"（manifest）

manifest 是一个 JSON 数组，每项三个字段：

```json
[
  {
    "name": "sky-dawn-panorama",
    "size": "1536x1024",
    "prompt": "……"
  }
]
```

`name` 就是输出文件名（必须全英文、小写、连字符），`size` 可选，`prompt` 是关键。

我们项目的 prompt 全部遵循**七段式结构**，这是踩坑后固定下来的模板：

```
Use case: <用途，如 historical-scene>
Asset type: <素材类型，如 first-person shooter game weapon view cutout>
Primary request: <画什么，最长的一段，写死所有细节>
Style/medium: <风格，如 photorealistic game render>
Composition/framing: <构图，物体在画面哪个位置、占多大>
Lighting/mood: <光照方向和气氛>
Color palette: <配色>
Constraints: <禁止项>
```

真实例子（第一视角重机枪，来自 `m8-hmg-fp.json`，为便于阅读做了换行）：

> Use case: historical-scene. Asset type: first-person shooter game weapon view cutout.
> **Primary request:** gunner's-eye rear view of a Japanese Type 92 heavy machine gun (1930s, air-cooled finned barrel, hopper-fed 30-round strip on the left side, dual spade grips at the rear, mounted on a low tripod) seen from directly behind and slightly above, as if the player is sitting behind it looking straight down the barrel toward the horizon. The weapon body sits in the **LOWER CENTER** of the frame, perfectly centered left-to-right, the barrel pointing straight away from the viewer and foreshortened, the muzzle ending near the vertical middle of the frame. Two Chinese soldier hands in blue-grey cloth uniform sleeves grip the spade grips at the bottom edge of the frame, forearms going out of the frame at the bottom.
> **Style/medium:** photorealistic game render, matching a clean asset cutout.
> **Composition/framing:** symmetric, weapon occupies the lower half and center of the frame, **upper third of the frame empty and transparent so the crosshair area is unobstructed**.
> **Lighting/mood:** low-angle warm morning sunlight from the upper right, gunmetal highlights on the cooling fins.
> **Color palette:** dark gunmetal, blued steel, blue-grey cloth, brass strip.
> **Constraints:** transparent background, no scope, no text, no watermark, no face, no blood, no ground, no scenery.

从这个例子里要学到四件事：

**第一，构图要写成"画面坐标"，不是形容词。** 别写"帅气的机枪视角"，要写"武器在画面下方居中，枪口停在画面垂直中线附近，上三分之一留空"。因为这张图最后要按像素坐标贴进游戏，构图错一点就全废。

**第二，`Constraints` 段是保命段。** 必须固定包含：

```
transparent background, no text, no watermark, no people(视情况), no blood, no gore
```

`no text` / `no watermark` 是因为生图模型极爱自己加英文字和签名；`transparent background` 是因为所有角色和道具都要抠成透明 PNG。

**第三，成对素材要写"和另一张完全一致"。** 待机和开火是两张图，会在游戏里瞬间切换。所以开火那张的 prompt 里明确写了 `identical camera and weapon placement to the idle frame`。不这么写，切枪时画面会"跳"一下，非常廉价。

**第四，写死历史/物件细节。** 「Type 92 重机枪，1930 年代，气冷散热片枪管，左侧 30 发弹板供弹，后部双铲形握把，低三脚架」——细节越具体，模型越不会瞎编。只写"日军重机枪"你会得到一把科幻武器。

### 2.4 内容红线（尤其重要）

我们项目面向 9~15 岁学生，所以有一条不可协商的规则写进了 prompt 模板：

> **禁止血液、血迹、残肢。** 命中反馈用尘土粒子代替。敌方统一称"日军"，不使用任何带侮辱性的称谓，不出现仇恨符号。

体现在 prompt 的 `Constraints` 里就是那句 `no blood, no gore, no hate symbols`。

你们的游戏如果也是给同龄人玩的，请照抄这条。这不是自我审查，是**让作品能公开展示**的前提——带血的作品没法放进课程汇报、没法上任何平台。

### 2.5 我们项目实际用过的四份清单

| 清单文件 | 生成什么 | 对应阶段 |
|---|---|---|
| `m4-character-states.json` | 中日士兵的 idle / run / fire 三态 | 换掉方块人 |
| `d1-heroes.json` | 五位壮士的独立立绘（三态） | 主角个性化 |
| `m7-environment.json` | 天空全景图、远山两层、沙袋、栅栏、枯树、灌木、石堆、第一视角步枪手 | 环境从"一块地板"变成"一座山" |
| `m8-hmg-fp.json` | 第一视角重机枪（待机 / 开火） | 武器手感 |

**看这个顺序：角色 → 主角 → 环境 → 武器。** 每一批都是"做完、贴进游戏、在真机上看一眼、再决定下一批"。绝不一次性生成一百张。

### 2.6 一个高频坑：假透明

生图 API 说好的"透明背景"，实测经常给你一张**画着灰白棋盘格的不透明图**（模型把 Photoshop 里表示透明的棋盘格当成了图案画出来了）。

所以我们有专门的脚本 `clean-generated.py` 处理它：识别中性亮色块判为透明、删掉角色脚下那条白色地面线、裁包围盒、缩放居中。

给你的 AI 的提醒：**生图下载完的第一件事是打开看它到底透不透明，不是直接往游戏里塞。**

---

## 3. 生成的图不能直接用——必须过一条加工流水线

这是新手和能做出成品的人之间最大的差距。生图给你的是**概念参考图**：带背景、尺寸巨大（我们收到过 2277×1055）、没有统一规格、文件名是中文。直接塞进游戏的结果是：包体爆炸、角色边缘一圈白边、物件悬浮在半空。

我们的流水线在 `tools/asset-pipeline/` 下，六个脚本，按顺序跑：

```
生图产物 (output/xxx-raw/*.png)
   │
   ├─1─ clean-generated.py          假透明棋盘格 → 真透明
   ├─2─ process-chars.py            角色：抠底 → 裁包围盒 → 缩放 512
   │    process-weapons.py          武器：抠底 → 裁切 → 第一视角 ≤1024 / 图标 128×64
   │    process-environment.py      环境：去棋盘格 → 裁包围盒 → 按用途限长边
   ├─4─ crop-transparent-margins.py 裁掉透明边距（防悬空）
   ├─5─ optimize-textures.py --apply  PNG → WebP 瘦身
   └─6─ verify-output.py            体检：尺寸 / 透明通道 / 总体积
   │
   ▼
client/assets/resources/  （引擎真正读取的目录）
```

### 3.1 第一条铁则：原始素材目录只读

我们项目有两个原始素材目录 `军服素材/` 和 `武器素材/`，规范里写死：

> **⚠️ 铁则：原素材目录是只读的。脚本只读取，绝不修改、移动、重命名原文件。所有产物一律输出到 `client/assets/resources/`。**

为什么这么严？因为加工是要反复调参数的（抠图阈值调了七八轮）。**如果脚本原地改文件，第一次调错就永久失去了原图**，而生图是花钱的，重新生成又是一笔钱。

配套要求：**每个脚本都必须支持 `--dry-run`，先空跑打印"会做什么"，确认无误再实跑。** 并且脚本必须幂等——同一条命令跑十次结果一样。

### 3.2 抠图：一个 30 行函数解决 90% 的问题

不需要 AI 抠图模型。生图给的背景通常是纯色或近纯色，用最朴素的办法就够了：

```python
def remove_bg(img, tolerance=30):
    # 取四个角像素的平均值作为"背景基准色"
    # 逐像素算颜色距离，小于 tolerance 的判为透明
```

关键是 `tolerance` 这个参数的调法：

| 现象 | 调整方向 |
|---|---|
| 背景没抠干净，还剩灰边/方块 | 调**大**（30 → 45） |
| 角色身上被抠出洞（衣服颜色接近背景） | 调**小**（30 → 18） |

**调完必须用眼睛看一遍。** 脚本报告"成功"不等于图是对的。

环境素材的背景更麻烦（是棋盘格而不是纯色），所以 `process-environment.py` 用的是另一招：**从图片四边向内做洪水填充**，只删掉"和画布边缘连通的"中性浅色块。这样物件内部的浅色（比如沙袋的亮面）不会被误删。

再叠一步 `soften_edge()`：把边缘 1 像素按亮度做半透明，消掉锯齿白边。**这一步不做，所有角色都会顶着一圈刺眼的白描边**，是"业余感"的头号来源。

### 3.3 顺序陷阱：`getbbox()` 必须在抠图之后调

```python
# ❌ 错误：背景还在，整张画布都算"有效区域"，裁不掉任何东西
bbox = img.getbbox()
img = remove_bg(img)

# ✅ 正确
img = remove_bg(img)
bbox = img.getbbox()   # 现在才能量出物件真实边界
```

这是我们真实踩过的坑。先裁后抠，等于没裁。

### 3.4 尺寸规格表：一开始就定死

| 用途 | 输出路径 | 规格 |
|---|---|---|
| 角色正面/侧面 | `chars/<name>/idle.png`、`side.png` | 512×512 |
| 角色头像 | `chars/<name>/portrait.png` | 128×128 |
| 第一视角武器 | `weapons/fp/<name>.png` | 宽 ≤ 1024（带手臂的整幅 ≤1536 源） |
| HUD 武器图标 | `weapons/icons/<name>.png` | 128×64（精确值） |
| 天空全景 | `scene/sky-*.png` | 宽 ≤ 2048 |
| 远山 | `scene/mountain-layer-*.png` | 最长边 1536 |
| 中景小件（沙袋/树/石堆） | `scene/*.png` | 最长边 640~768 |

**总体积上限：25 MB。** 这是我们定的硬约束，`verify-output.py` 会检查，超了直接报错。

为什么要这么抠？因为射击游戏要流畅。我们项目实测首屏加载的最大瓶颈是引擎自身的 `cc.js`（gzip 后 511 KB），如果贴图再来几十兆，手机上根本进不去游戏。

### 3.5 悬空 bug：一个必踩的坑

我们的石头掩体和机枪工事贴图是 512×512，但物件只占中间部分，上下各有约 26% 的透明边距。结果摆进场景后，**工事悬浮在地面上方 0.38~0.55 米**，像漂在空中。

原因：引擎按"图片"定位，不按"图片里的内容"定位。图片底边贴地了，但内容底边还在半空。

解法就是 `crop-transparent-margins.py`：把透明边距裁掉，**让内容底边 = 画布底边**。

```bash
python tools/asset-pipeline/crop-transparent-margins.py --apply
```

对应地，代码里的物件宽高常量必须用**裁切之后**的比例。比如石垒裁完是 485×236 ≈ 2.06，代码里就写 `COVER_WIDTH_M = 3.3, COVER_HEIGHT_M = 1.6`（比值 2.06）。宽高比对不上，物件就会被拉变形。

> 通用规则：**任何贴地的立牌类素材，入库前先裁透明边距，代码里的宽高常量取裁后比例。**

### 3.6 WebP 瘦身：一个几乎零成本的优化

`optimize-textures.py` 把 `resources/` 下所有 PNG 按用途降分辨率并转成 WebP。Cocos Creator 3.8.7 原生支持 WebP。

**关键技巧：代码一行都不用改。** 因为引擎的资源加载是按"名字"而不是"文件名+后缀"：

```ts
resources.load('weapons/fp/liaoshi13/texture', Texture2D)
```

配置文件里也是不带后缀的：

```json
"assets": {
  "firstPerson": "weapons/fp/liaoshi13",
  "firstPersonHands": "weapons/fp/liaoshi13-hands",
  "icon": "weapons/icons/liaoshi13"
}
```

所以 `liaoshi13.png` 换成 `liaoshi13.webp`，一切照旧。

**唯一的坑：`.meta` 文件。** Cocos 用 `.meta` 里的 uuid 追踪资源，脚本必须把原 `.meta` 的 uuid 和 userData 原样搬过来，只把内部的 `.png` 字符串换成 `.webp`。不这么做，场景里所有引用会集体丢失（引擎里表现为一堆白块）。

跑法（注意先干跑）：

```bash
python tools/asset-pipeline/optimize-textures.py            # 只打印将要做什么
python tools/asset-pipeline/optimize-textures.py --apply    # 真正转换并删除 PNG
```

### 3.7 体检脚本：不合格不许进游戏

`verify-output.py` 检查五项，任一不过就退出码 1：

1. 所有配置文件里声明的素材路径，磁盘上真的有文件
2. 尺寸符合规格表
3. 全部是 RGBA 且**真的有透明像素**
4. 透明像素占比异常告警：> 92% 说明抠穿了（人没了），= 0 说明根本没抠
5. 总体积 < 25 MB

第 3、4 项特别值钱。"抠图完成了但把主体抠没了"这种错，肉眼扫一眼缩略图很容易漏掉，脚本一秒发现。

**给你的 AI 的规矩：每次加工完素材，必须跑 `verify-output.py` 并把输出贴出来。不许口头说"已完成"。**

---

## 4. 如何把素材"完美贴合"进游戏

素材加工完只是一半。贴不好的话，你会得到：纸片人转圈、树立在天上、枪口喷出的火焰和枪不在一条线上。

我们项目的场景**全部由代码生成**（没有手摆的场景文件），所以所有贴合逻辑都在几个 TS 文件里。这一章讲这四类素材各自的贴法。

### 4.1 角色和小物件：Billboard（立牌）

2.5D 做法：把贴图贴在一个平面上，让这个平面永远面向摄像机。核心工具在 `client/assets/scripts/core/billboard.ts`。

**要点一：只绕 Y 轴转，不要"完全朝向摄像机"。**

```ts
// ✅ 只算水平方向的角度
node.setRotationFromEuler(0, Math.atan2(dx, dz) * 180 / Math.PI, 0);
```

如果用引擎的 `lookAt`，玩家蹲下或上坡时，所有士兵会跟着**向后倾倒**，瞬间暴露"这是纸片"。只绕 Y 轴，就永远是站着的。

**要点二：锚点放在脚底。**

我们的 `createBillboard` 有个 `centerY` 参数，角色用 `0.5`（贴图中心在半高处，等价于脚底为原点）。这样服务端下发的角色坐标（是地面坐标）可以直接用，不需要每次加半个身高。**贴地的物件用 `centerY: 0`。**

**要点三：`widthScale`（横向补偿）。**

角色默认 `widthScale = 2`。原因是人物立绘是竖长的，如果严格按贴图比例做面片，命中盒会窄得几乎打不中。适当加宽，手感会好很多。这是**为玩法牺牲一点视觉精确**的典型取舍，射击游戏里非常值得。

**要点四：alpha 测试而不是 alpha 混合。**

```ts
// builtin-unlit + USE_TEXTURE + USE_ALPHA_TEST, alphaThreshold = 0.1
```

用 alpha test，透明部分直接丢弃像素，不参与排序。如果用半透明混合，多个立牌互相遮挡时会出现"前面的树把后面的人擦掉"的排序错乱。

**要点五：贴图 wrapMode 必须是 `clamp-to-edge`。**

默认的 `repeat` 会让贴图边缘采样到对边的像素，表现为立牌四周出现一条细线。

**要点六：静态物件批量管理。**

我们场景里有 110+ 个装饰立牌（树、石头、灌木）。如果每帧给每个都 `setRotation`，帧率会掉。解法是 `StaticBillboardGroup`：**只有摄像机移动超过 0.1 米时才批量重算朝向**。玩家站着不动时，这部分开销是零。

### 4.2 环境：天空球 + 远山视差 + 地面裙边

这一层是"从一块地板变成一座山"的关键，代码在 `m7-environment.ts`。

**天空：用一个跟随摄像机的反向球体，不用引擎 Skybox。**

做法是：一个内表面贴着等距柱状（equirectangular）全景图的球体，球心永远等于摄像机位置。好处是完全可控（引擎 Skybox 要配 cubemap，生图不好生），而且球心跟随摄像机意味着玩家永远走不到天边。

两个技术细节：
- 引擎自带 sphere 的 UV 是外表面的，需要**翻转 V 轴**，否则天空是上下颠倒的。
- 天空球和远山**不能吃雾**。它们本来就该在最远处。我们为此单独写了一个 `sky-unlit.effect`，并手动在 `mainColor` 里混了一点大气色来模拟透视。

**远山：两层视差（far / near）。**

两层透明背景的山脉立牌，按不同速度/距离摆放，玩家移动时产生视差，空间感立刻出来。这是 2D 游戏里最老的技巧，在 3D 里同样有效且极便宜。

**雾：线性雾，起始距离 ≥ 90 米。**

雾有两个作用：一是遮住远处的贴图接缝，二是**给玩家距离感**——雾中的敌人看起来就是"远"。

⚠️ 但雾有个陷阱：起始距离设太近，敌人会被雾糊掉看不见。我们项目「看不到敌人」的报障，排查顺序固定是这三处：雾起始距离、武器朝向基准角、偏转角上限。

**地面裙边：一个你一定会踩的坑。**

我们的地面网格原本只铺了战场范围（约 81m × 150m）。结果在 70° 视场角下，视野超出了网格边缘，**露出了天空球地平线以下的灰蓝色，看起来像战场两侧各有一条笔直的河。**

解法：用粗网格（8 米一格，省性能）把地面**一直铺到雾外的 360 米**，再把地平线附近的边缘略微抬升。

> 通用规则：**地面必须铺到雾完全遮住的距离之外。** 你看不到的地方，成本很低；玩家看到"世界的边缘"，代价很大。

**散布物件：用确定性伪随机。**

树、石头的位置不能用 `Math.random()`，要用一个固定 seed 的伪随机。原因：多人游戏里每个客户端必须看到同一棵树在同一个位置，否则 A 觉得自己在掩体后，B 看到他站在空地上。

### 4.3 第一视角武器：射击游戏手感的 80%

这是最难贴、也最值得下功夫的一类。代码在 `weapon-view.ts`。

我们的构图参数长这样（真实数值）：

```ts
HANDS_COMPOSITIONS.liaoshi13 = {
  heightRatio: 0.78,       // 贴图高度占屏幕高的比例
  muzzleU: 0.49,           // 枪口在贴图上的横向 UV 坐标
  muzzleV: 0.299,          // 枪口在贴图上的纵向 UV 坐标
  muzzleGapXPx: 150,       // 枪口相对准心的像素偏移
  muzzleGapYPx: -60,
  fireShiftXPx: -82,       // 开火时整幅图的位移（后坐）
  fireShiftYPx: -49,
}
```

**最重要的一条规矩：`muzzleU` / `muzzleV` 必须实测，不许凭感觉填。**

我们为此专门写了个工具 `preview-weapon-layout.py`：它按照 `weapon-view.ts` 里的同一套公式，把武器贴图摆到 1280×720 的画布上、叠加准星，输出一张 PNG 让你核对。

```bash
python tools/asset-pipeline/preview-weapon-layout.py
```

**为什么必须这么做？** 因为枪口位置决定了枪焰、弹道起点、命中特效的出发点。差 20 像素，玩家就会觉得"火从枪身中间冒出来"，整个手感垮掉。改构图先出图，不要改完直接进引擎试——引擎构建一次好几分钟。

**构图经验（经过很多轮迭代）：**

- **只露枪的前 2/3。** 整把枪都画出来会占掉半个屏幕。
- **枪口在准心的右下方约 150 像素。** 不要把枪口对准准心正中——那样枪身会挡住视野中心。
- **从屏幕中偏右位置出屏。** 模拟右手持枪的真实视角。
- **待机和开火两张图必须严格同构图**，只靠代码做位移（`fireShiftXPx/YPx`）表现后坐。这就是 2.3 节里 prompt 要写 `identical camera placement` 的原因。
- **重机枪例外**：因为是架在三脚架上双手握把，用的是"后视整幅图"方案（`HANDS_COMPOSITIONS`），构图左右对称居中。

### 4.4 一个 Cocos 专属陷阱：着色器不会自动打包

这条很隐蔽，浪费过我们不少时间：

> **Cocos 构建时，只打包被 `.scene` / `.prefab` / `.mtl` 文件"直接引用"的 effect。** 代码里写 `initialize({ effectName: 'xxx' })` **不算引用**。

结果就是编辑器里一切正常，构建出的正式版本材质全丢。

解法：在 `resources/` 目录下放一个真实的 `.mtl` 材质文件，代码里 `load` 它然后 `.copy()` 使用。

同类提醒：`CC_USE_FOG` 这个宏在材质里关不掉，所以需要"不吃雾"的物体（天空、远山）必须换用专门的 effect，而不是试图在材质面板里关雾。

### 4.5 动作怎么做——不要做逐帧动画

我们明确否决了逐帧动画方案。角色的待机/奔跑/开火三态，做法是：

- **三张静态图**（idle / run / fire），按状态切贴图
- **动感靠代码补**：用引擎的 tween 做轻微的上下浮动、开火时的位移和缩放

理由：逐帧动画意味着每个角色每个动作要生成 8~12 张图，成本乘十倍，而且 AI 生图**无法保证帧间一致性**（每一帧的衣服褶皱都不一样，连起来会闪）。三态 + 代码补间，成本低十倍，效果够用。

---

## 5. 给 AI 的执行清单（可以直接复制给你的 AI）

```
【美术管线执行规范】

阶段判断：
- 如果玩法还不能完整玩一局，禁止做任何美术素材，用纯色块占位。

改美术的顺序（不许跳步）：
1. 加光照：平行光（太阳）+ 环境光 + 线性雾（起始 ≥90m）；材质从 unlit 改 standard/toon
2. 加环境：天空全景球（跟随摄像机）+ 远山两层视差 + 地面铺到雾外
3. 清 HUD：删掉所有调试文案（版本号、延迟 ms、内部里程碑名），调试信息移到 ?debug=1
4. 最后才换角色和武器贴图

生图规范：
- 未经用户明确同意，禁止发起任何生图请求；调用前先报"预计 N 张"
- 密钥只从环境变量读，禁止写进任何文件
- manifest 用七段式 prompt：Use case / Asset type / Primary request / Style /
  Composition / Lighting / Color palette / Constraints
- Constraints 固定包含：transparent background, no text, no watermark, no blood, no gore
- 构图写画面坐标，不写形容词
- 成对素材（待机/开火）写明 identical camera and weapon placement
- 单批不超过 100 张；一次任务只发必要的最少次数，禁止为试参数重复调用

加工规范：
- 原始素材目录只读，产物一律输出到 resources/
- 每个脚本先 --dry-run，确认后再实跑
- getbbox() 必须在抠图之后调用
- 贴地素材入库前先裁透明边距，代码宽高常量取裁后比例
- 转 WebP 时 .meta 的 uuid/userData 原样保留，只改 .png → .webp
- 加工完必须跑 verify-output.py 并贴出完整输出
- 总素材体积 < 25MB

贴合规范：
- Billboard 只绕 Y 轴旋转，禁用 lookAt
- 角色 centerY=0.5（脚底为根）、widthScale=2；贴地物件 centerY=0
- 材质用 alpha test（阈值 0.1），不用 alpha blend
- 贴图 wrapMode 设 clamp-to-edge
- 静态装饰用批量组管理，摄像机位移超阈值才重算朝向
- 散布位置用固定 seed 伪随机，禁用 Math.random()
- 第一视角武器的枪口 UV 必须用预览脚本实测，禁止估算
- 需要在构建后可用的 effect，必须有 .mtl 文件真实引用

内容红线：
- 禁止血液、血迹、残肢；命中反馈用尘土粒子
- 敌方使用中立称谓，禁止侮辱性表述和仇恨符号
```

---

## 6. 怎么才算"有审美和游戏性"

最后说判断标准。技术都在前面五章了，这一章是品味。

### 6.1 审美的三个可执行标准

**① 统一 > 精致。** 十张风格不一的高质量图，不如十张风格统一的中等质量图。做法：所有 prompt 共用同一套 `Style/medium`、`Color palette`、`Lighting` 描述。我们项目全部素材都是「photorealistic game render + 清晨低角度暖光 + 蓝灰/黄土双色阵营」，所以哪怕单张图有瑕疵，整体看是一个世界。

**② 有"理由"的美术不会丑。** 光为什么从东边来（清晨接火）、中国军队为什么是蓝灰冷调（布军装）、日军为什么是黄土暖调（呢军服）——每个决定背后都有史实依据。凭感觉调的参数会互相打架，有依据的决定会自动协调。

**③ 阵营必须一眼可辨。** 这既是审美也是玩法。我们用**色温**区分：中国军队冷调（蓝灰 `#6B7A45` 系），日军暖调（黄土 `#A8935F` 系）。在雾里、在远处、在余光里，玩家靠色温就能分敌友，不需要看清细节。

> 这条是射击游戏的生命线。**如果玩家需要看清脸才能分辨敌友，你的美术是失败的。**

### 6.2 游戏性上不能省的五件事

我们视觉评审里列出的、影响"是否像个游戏"的表现层清单：

| 项目 | 廉价做法（不要） | 应该做成 |
|---|---|---|
| **敌人朝向** | 敌人立牌永远正对你 | 协议里加一个朝向角，让你能看出敌人在看哪边 |
| **移动插值** | 只插值位置 | 位置 + 朝向一起插值，否则转身像鬼畜 |
| **死亡表现** | 立牌直接消失 | 倒地旋转 + 淡出（半秒就够） |
| **开火预警** | 敌人身上画个橙色方块 | 枪口闪光 + 音效方向 |
| **音效** | 方波蜂鸣 | 哪怕是免费素材库的真实枪声，也比合成音好十倍 |
| **命中反馈** | 无 | 准星命中标记 + 尘土粒子（不要血） |

**"死亡表现"和"命中反馈"这两项性价比最高。** 玩家 90% 的时间在做"我打中了吗 / 他死了吗"这个判断，这两处反馈一做，游戏立刻从"测试程序"变成"游戏"。

### 6.3 HUD：删掉的比加上的重要

我们第一版 HUD 上写着这些东西：

```
M2 五人防线·服务器权威 AI
已连接，延迟 12ms
等待权威快照
命中 55 · 裁决 7ms
```

**全部是给开发者看的。** 玩家不需要知道你的里程碑编号、不需要知道网络延迟、更不需要知道伤害裁决耗时。

改法：
1. 所有面向玩家的文案抽到一个配置文件（`presentation-strings.json`），集中审校（我们还顺手改掉了一个错别字「矄准」→「瞄准」）
2. 调试信息全部移到一个调试层，只在 URL 带 `?debug=1` 时显示
3. HUD 分区用锚点/自适应布局，**不要用绝对像素定位**——否则在非 16:9 屏幕上会错位到黑边里

> 一个检验方法：**把你的游戏截图发给一个没参与开发的同学。如果他问"这些数字是什么意思"，就该删了。**

### 6.4 我们明确否决过的方案（省你的时间）

| 提案 | 为什么否决 |
|---|---|
| 局内加人造照明灯 | 白天作战不需要，不符合史实，光照打架 |
| 逐帧角色动画 | 成本 ×10，AI 生图无法保证帧间一致 |
| 引入 UI 框架 | 为了几个 HUD 元素引入框架，不值 |
| 后处理特效（Bloom 等） | 性价比低，且容易把画面糊掉 |
| 重写渲染层 | 在现有管线上加光照和雾就能解决 80% 的问题 |

**共同模式：能用"加一盏灯 / 改一个参数 / 加一段 tween"解决的，不要上新系统。** 你们的项目周期只有几周，每一个"架构升级"都会吃掉全部时间。

---

## 7. 一句话总结

> **先用方块人把游戏做好玩，再用光照和雾把空间做出来，最后才让 AI 批量生成风格统一的贴图——每一张都过抠图、裁边、压缩、体检四道关，按实测坐标贴进去。**

顺序错了，再多的图也救不回来；顺序对了，中等质量的素材也能做出像样的游戏。

---

## 附录：文件地图

| 路径 | 作用 |
|---|---|
| `tools/asset-pipeline/image-agent.py` | 生图 Agent（读 manifest → 并发生成 → 下载） |
| `tools/asset-pipeline/*.json` | 素材清单（prompt manifest），按里程碑分批 |
| `tools/asset-pipeline/clean-generated.py` | 假透明棋盘格 → 真透明 |
| `tools/asset-pipeline/process-chars.py` | 角色抠图/裁切/缩放 |
| `tools/asset-pipeline/process-weapons.py` | 武器第一视角 + HUD 图标 |
| `tools/asset-pipeline/process-environment.py` | 环境/天空/第一视角手加工 |
| `tools/asset-pipeline/crop-transparent-margins.py` | 裁透明边距（防悬空） |
| `tools/asset-pipeline/optimize-textures.py` | PNG → WebP 瘦身 |
| `tools/asset-pipeline/verify-output.py` | 素材体检 |
| `tools/asset-pipeline/preview-weapon-layout.py` | 第一视角构图实测预览 |
| `client/assets/scripts/core/billboard.ts` | 立牌创建/朝向/批量管理 |
| `client/assets/scripts/level/m7-environment.ts` | 天空球/远山/雾/光照/散布 |
| `client/assets/scripts/level/m4-scene-decorations.ts` | 地面网格/裙边/工事摆放 |
| `client/assets/scripts/weapon/weapon-view.ts` | 第一视角武器构图参数 |
| `docs/REVIEW-CLIENT-VISUAL.md` | 视觉评审（毛坯→精装的问题清单原文） |
| `skills/asset-pipeline/SKILL.md` | 素材管线技能定义（给 AI 读的版本） |
