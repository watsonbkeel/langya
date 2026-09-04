---
name: cocos-codegen
description: 狼牙山项目 Cocos Creator 代码生成场景规范。当在无 GUI 的 Debian 环境开发客户端时使用。涵盖场景代码化构建、2.5D 地形生成、Billboard 角色、无头构建与调试方法。
---

# Cocos 代码生成场景规范

## 为什么必须代码化

开发环境是**无图形界面的 Debian 工作站**，Cocos Creator 编辑器打不开。

```
传统流程：编辑器拖拽摆放节点 → 保存 .scene → 代码里引用
本项目：  .scene 只留空壳 → 代码里 instantiate 所有节点
```

**判据**：删掉 `.scene` 里除入口节点外的所有内容，游戏仍能正常运行。

---

## .scene 文件的最小结构

```
Game.scene
└── Canvas
    ├── Main Camera          （摄像机，必须在场景里）
    └── GameRoot             （空节点，挂 GameEntry.ts）
```

**只有这三个**。地形、掩体、枪位、角色、UI —— 全部代码创建。

---

## 入口脚本模式

```ts
// client/assets/scripts/core/GameEntry.ts
import { _decorator, Component, Node } from 'cc';
const { ccclass } = _decorator;

@ccclass('GameEntry')
export class GameEntry extends Component {
  async onLoad() {
    // 1. 加载配置
    await ConfigLoader.load();

    // 2. 构建场景（全部代码生成）
    const terrain = TerrainBuilder.build(this.node);
    const cover   = CoverBuilder.build(this.node);
    const mgNests = MGBuilder.build(this.node);

    // 3. 构建 UI
    UIBuilder.buildHUD(this.node);

    // 4. 连接服务器
    await NetClient.connect();
  }
}
```

**所有 Builder 都是纯代码，返回创建好的节点。**

---

## 地形生成（2.5D 的 3D 部分）

山地是本项目唯一必须用 3D 的元素 —— 要表现「居高临下」的高低差与遮挡。

### 方案：高度图驱动的网格生成

```ts
export class TerrainBuilder {
  static build(parent: Node): Node {
    const node = new Node('Terrain');
    node.setParent(parent);

    const mesh = this.generateMesh(
      GRID_W, GRID_H,     // 网格分辨率
      CELL_SIZE,          // 每格尺寸
      (x, z) => this.heightAt(x, z)   // 高度函数
    );

    const mr = node.addComponent(MeshRenderer);
    mr.mesh = mesh;
    mr.material = this.createTerrainMaterial();
    return node;
  }

  // 高度函数：山顶阵地平坦，向下三条路线各有坡度
  private static heightAt(x: number, z: number): number {
    if (z > PLATEAU_START) return PLATEAU_HEIGHT;   // 山顶平台
    const t = z / PLATEAU_START;
    return PLATEAU_HEIGHT * this.easeInOut(t) + this.noise(x, z) * 0.8;
  }
}
```

**关键点**：
- 山顶阵地必须是**平坦**的，玩家在上面移动不能有起伏
- 三条路线的坡度不同（A 陡、B 缓、C 长）
- 加轻微噪声让地形不那么规整，但幅度要小（< 1m），否则影响移动

### 掩体与枪位

```ts
// 石垒掩体：简单几何体即可，不需要模型文件
const cover = new Node('Cover');
const mr = cover.addComponent(MeshRenderer);
mr.mesh = utils.MeshUtils.createMesh(primitives.box({
  width: 3, height: 1.2, length: 0.8
}));
```

**掩体不需要精美**。它的作用是遮挡射线和提供蹲下位置，用长方体足够。M4 阶段可以换贴图。

---

## Billboard 角色（2.5D 的 2D 部分）

### 创建面片

```ts
export class CharacterBuilder {
  static create(camp: Camp): Node {
    const node = new Node('Character');

    // 用 Sprite 组件 + 3D 节点
    const sprite = node.addComponent(Sprite);
    sprite.spriteFrame = ResManager.getCharSprite(camp);

    node.addComponent(BillboardComponent);
    return node;
  }
}
```

### Billboard 朝向（只绕 Y 轴）

```ts
@ccclass('BillboardComponent')
export class BillboardComponent extends Component {
  private camera: Camera = null!;

  update() {
    const camPos = this.camera.node.worldPosition;
    const myPos = this.node.worldPosition;

    // 只取水平方向，忽略高度差
    const dir = new Vec3(
      camPos.x - myPos.x,
      0,                      // ← 关键：Y 分量置 0
      camPos.z - myPos.z
    );
    this.node.forward = dir.normalize();
  }
}
```

**为什么 Y 置 0**：玩家在山顶俯视山下敌人，如果用完整 lookAt，敌人会朝天仰躺。只绕 Y 轴旋转才能保持站立姿态。

### 左右朝向

不需要额外贴图，用缩放翻转：

```ts
// 根据移动方向决定朝向
const facingRight = velocity.x > 0;
this.node.setScale(facingRight ? 1 : -1, 1, 1);
```

### 动作模拟（不做逐帧）

```ts
// 待机：轻微上下浮动
tween(this.node)
  .repeatForever(
    tween()
      .to(1.0, { position: basePos.clone().add3f(0, 0.06, 0) })
      .to(1.0, { position: basePos })
  ).start();

// 中弹：闪红 + 后仰
tween(sprite)
  .to(0.08, { color: Color.RED })
  .to(0.08, { color: Color.WHITE })
  .start();

// 阵亡：倒地 + 淡出
tween(this.node)
  .to(0.5, { eulerAngles: new Vec3(0, 0, 90) })
  .to(0.3, { }, { onUpdate: (t, r) => sprite.color.a = 255 * (1 - r) })
  .call(() => this.node.destroy())
  .start();
```

---

## 对象池（性能必须）

40 个敌人频繁生成销毁会造成 GC 卡顿。

```ts
export class EnemyPool {
  private pool: Node[] = [];

  get(): Node {
    return this.pool.pop() ?? CharacterBuilder.create(Camp.Japanese);
  }

  put(node: Node) {
    node.active = false;
    this.pool.push(node);
  }
}
```

**预热**：开局前预创建 40 个，避免第一波卡顿。

---

## UI 代码化

HUD 也用代码构建，不依赖预制体。

```ts
export class HUDBuilder {
  static build(parent: Node): Node {
    const hud = new Node('HUD');
    const canvas = hud.addComponent(Canvas);

    this.addTimer(hud);          // 顶部计时与波次
    this.addAllyPanel(hud);      // 右上队友状态
    this.addRouteIndicator(hud); // 三路威胁指示
    this.addCrosshair(hud);      // 准星
    this.addBottomBar(hud);      // 血量、血包、武器、弹药
    return hud;
  }
}
```

**队友面板和三路指示器是单人模式的核心信息补偿**，不能省略。

---

## 网络地址配置

**禁止硬编码 WS 地址。**

```ts
// client/assets/scripts/net/NetConfig.ts
export function getWSUrl(): string {
  const cfg = ResManager.getJSON('config/server');

  if (cfg.wsUrl) return cfg.wsUrl;          // 显式配置优先

  // 否则从当前页面推导
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${cfg.wsPath || '/ws'}`;
}
```

**收益**：watson 换域名或调整转发时，**不需要重新构建客户端**。

---

## 无头构建

```bash
# Debian 上无 GUI 构建
CocosCreator --project ./client --build "platform=web-mobile;debug=false"

# 常用参数
# debug=true         保留调试信息，用于开发
# sourceMaps=true    便于排错
# md5Cache=true      资源加缓存戳
```

**构建产物**：`client/build/web-mobile/`

**若构建失败**：
1. 检查 `.scene` 是否引用了不存在的资源（代码化后容易残留引用）
2. 检查资源目录是否有中文路径（`手榴弹` 必须改成 `grenade`）
3. 检查 TypeScript 类型错误（先跑 `npx tsc --noEmit`）

---

## 无 GUI 环境的调试方法

编辑器打不开，靠这些手段排错：

| 手段 | 用法 |
|---|---|
| 类型检查 | `npx tsc --noEmit` —— 大部分错误在这一步暴露 |
| 浏览器控制台 | 构建后在浏览器打开，看 Console 报错 |
| 日志分级 | 关键流程打 log，用开关控制输出量 |
| 节点树打印 | 写个工具函数递归打印场景树，确认节点确实创建了 |
| 远程调试 | Chrome DevTools 连接页面，断点调试 |

```ts
// 场景树打印工具（调试用）
export function dumpTree(node: Node, depth = 0) {
  console.log('  '.repeat(depth) + node.name);
  node.children.forEach(c => dumpTree(c, depth + 1));
}
```

---

## 性能红线

| 指标 | 目标 |
|---|---|
| PC 帧率 | ≥ 50 FPS |
| 移动端帧率 | ≥ 30 FPS |
| 资源总体积 | < 25 MB |
| 首屏加载 | < 8 秒（4G） |
| Draw Call | < 100 |

**降 Draw Call 的手段**：
- 角色贴图打成图集
- 相同材质的掩体合批
- UI 元素尽量共用一张图集

---

## 检查清单

- [ ] `.scene` 只有 Canvas + Camera + GameRoot 三个节点
- [ ] 删掉 .scene 里的非入口节点后游戏仍能跑
- [ ] 地形由代码生成，山顶平台平坦
- [ ] Billboard 只绕 Y 轴旋转，角色不会仰倒
- [ ] 敌人用对象池，开局预热 40 个
- [ ] HUD 含队友面板与三路威胁指示器
- [ ] WS 地址可配置，未硬编码
- [ ] 资源目录无中文路径
- [ ] `npx tsc --noEmit` 无错误
- [ ] 无头构建成功产出 `build/web-mobile/`
