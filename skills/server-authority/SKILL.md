---
name: server-authority
description: 狼牙山项目权威服务器架构规范。当编写服务端战斗逻辑、网络同步、房间管理、伤害裁决时使用。核心原则是客户端只表现、服务器全裁决，单人模式同样走服务器。
---

# 权威服务器架构规范

## 核心原则

```
客户端说：「我朝这个方向开了一枪」
服务器答：「你打中了 3 号敌人的头部，造成 137 伤害，击杀」

客户端永远不说：「我打死了 3 号敌人」
```

---

## ⚠️ 最重要的一条：单人模式也走服务器

这是本项目最容易做错、返工成本最高的地方。

```
❌ 错误：「先做单人」→ 客户端本地跑战斗逻辑，联机时再写一套服务端版本
✅ 正确：「先做单人」→ 服务器开一个房间，里面 1 个真人 + 4 个 AI 队友
```

### 为什么

| 方案 | 代价 |
|---|---|
| 单人本地 + 联机服务端 | 两套战斗逻辑，数值和行为必然漂移。M5 做联机等于战斗系统重做，且要反复对齐两边表现 |
| 单人也走服务器 | 一套逻辑通吃。M3 做的所有战斗调优，M5 联机时零成本继承 |

### 具体表现

单人模式下：
- 客户端照样建立 WebSocket 连接
- 照样发 `input_state`、`fire` 等消息
- 服务器照样跑 20Hz tick、裁决伤害
- 只是房间里真人数为 1，其余 4 席是 AI 队友

**唯一的差别是房间里有几个真人，代码路径完全一致。**

---

## 架构分层

```
server/src/
├── index.ts           入口：启动 WS 服务、加载配置
├── room/              席位管理、AI 队友补位、房间生命周期
├── game/              战斗主循环（20Hz tick 调度者）
├── ai/
│   ├── enemy/         日军 AI
│   └── ally/          队友 AI
├── combat/            伤害与命中裁决（纯函数）
├── wave/              波次调度、空投投放
├── score/             计分与 MVP 评选
└── db/                SQLite 战报持久化
```

### 分层职责

| 层 | 做什么 | 不做什么 |
|---|---|---|
| `room` | 谁在房间里、几个真人几个 AI | 不含任何战斗规则 |
| `game` | 驱动 tick，按顺序调用各系统 | 不含具体规则实现 |
| `ai` | 决策「往哪走、打谁」 | 不直接改血量（走 combat） |
| `combat` | 算伤害、判命中 | 不知道谁是玩家谁是 AI |
| `wave` | 什么时候刷多少人 | 不管刷出来之后怎么打 |
| `score` | 记录与排名 | 不参与战斗流程 |

---

## combat 层必须是纯函数

**这是可测试性的关键。**

```ts
// ✅ 正确：纯函数，输入输出明确，无副作用
export function resolveHit(
  shooter: CombatEntity,
  target: CombatEntity,
  weapon: WeaponConfig,
  hitPart: HitPart,
  distance: number
): HitResult {
  const base = weapon.damage;
  const partMul = PART_MULTIPLIER[hitPart];
  const distMul = distance > weapon.falloffStart ? 0.6 : 1.0;
  const damage = Math.round(base * partMul * distMul);
  return {
    damage,
    isKill: target.hp - damage <= 0,
    hitPart,
  };
}

// ❌ 错误：直接改状态，无法单测
function shoot(shooter, target) {
  target.hp -= 55;              // 硬编码 + 副作用
  if (target.hp <= 0) target.die();
  broadcast(...);               // 混入网络逻辑
}
```

**收益**：能直接写单元测试验证数值，不用启动服务器。

```ts
// 测试示例
test('爆头伤害应为基础值 2.5 倍', () => {
  const r = resolveHit(player, enemy, rifle, HitPart.Head, 50);
  expect(r.damage).toBe(Math.round(55 * 2.5));
});
```

---

## 20Hz 主循环

```ts
const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;   // 50ms

class GameLoop {
  private tick = 0;

  update(dt: number) {
    this.tick++;

    // 顺序很重要
    this.waveSystem.update(dt);        // 1. 决定是否刷新敌人
    this.enemyAI.update(dt, this.tick);// 2. 敌人决策与移动
    this.allyAI.update(dt, this.tick); // 3. 队友决策与移动
    this.combatSystem.update(dt);      // 4. 处理待结算的射击
    this.itemSystem.update(dt);        // 5. 空投生成与过期
    this.scoreSystem.update(dt);       // 6. 更新统计
    this.broadcastSnapshot();          // 7. 广播状态
  }
}
```

### AI 分帧计算（性能关键）

场上最多 40 敌人 + 4 队友 = **44 个 AI 实体**。全部每 tick 决策会吃满 CPU。

```ts
// 把 AI 分成 4 组，每 tick 只更新一组 → 每个 AI 实际 5Hz 决策
const AI_GROUPS = 4;
update(dt: number, tick: number) {
  const group = tick % AI_GROUPS;
  for (let i = group; i < this.entities.length; i += AI_GROUPS) {
    this.entities[i].think(dt * AI_GROUPS);
  }
}
```

**移动照常每 tick 插值**，只有「决策」降频。玩家感知不到差异。

---

## 网络同步

### 快照结构

```ts
interface WorldSnapshot {
  tick: number;
  allies: AllyState[];     // 真人 + AI 队友，用 isBot 区分
  enemies: EnemyState[];   // 仅视野内
  items: ItemState[];
}
```

> **关键**：真人玩家和 AI 队友放在**同一个 `allies[]` 数组**，客户端渲染代码完全一致，只在 HUD 上加个小标识。这样单人和联机的客户端代码零差异。

### 带宽优化（必须做）

40 个敌人 × 20Hz × float 坐标 = 带宽爆炸。三个手段：

**1. 位置量化为 int16**

```ts
// 战场范围约 200m，精度 1cm 足够
const SCALE = 100;
const encode = (v: number) => Math.round(v * SCALE);   // → int16
const decode = (v: number) => v / SCALE;
```

**2. 视野裁剪**

只同步玩家视野内 + 一定缓冲范围的敌人。背面路线的敌人在玩家转身前不需要同步。

**3. 差量更新**

```ts
// 每 20 tick 发一次全量快照，其余发差量
if (tick % 20 === 0) sendFull();
else sendDelta(lastSnapshot, current);
```

### 客户端预测与校正

| 对象 | 策略 |
|---|---|
| 玩家自身移动 | 本地立即响应 + 服务器校正（偏差 > 0.5m 才拉回） |
| 其他友方 | 插值平滑，缓冲 100ms |
| 敌人 | 插值平滑，缓冲 100ms |
| 射击特效 | 客户端立即播放，服务器结果到达后补充命中反馈 |

**射击手感的关键**：枪口焰、音效、后坐力**立即本地播放**，不等服务器。命中标记（准星闪烁、伤害数字）等服务器 `fire_result` 回包。

---

## 房间与席位管理

```ts
interface Room {
  id: string;
  seats: Seat[];          // 恒定 5 个
  status: RoomStatus;
}

interface Seat {
  index: number;          // 0-4
  heroName: string;       // 马宝玉 / 葛振林 / 宋学义 / 胡德林 / 胡福才
  occupant: Player | AllyBot;
  isBot: boolean;
}
```

### 席位分配规则

```
1. 真人按加入顺序占位，从 index 0 开始
2. 开局时剩余空位全部填充 AI 队友
3. 单人模式：seat[0] = 真人（马宝玉），seat[1..4] = AI 队友
4. 席位总数恒为 5，不多不少
```

### 掉线处理

```
玩家掉线 → 保留席位 60 秒等待重连
       → 超时则转为 AI 队友接管，对局继续
       → 该玩家的已有战绩保留在战报中
```

> 这是 AI 队友系统的额外收益：因为已经有队友 AI，掉线可以无缝接管，不会让队友陷入减员劣势。

---

## 协议规范

类型定义在 `shared/protocol.ts`，**客户端和服务端都从这里导入，禁止各写一份**。

```ts
// shared/protocol.ts
export const enum ClientMsg {
  StartSolo    = 'start_solo',
  JoinRoom     = 'join_room',
  PlayerReady  = 'player_ready',
  InputState   = 'input_state',
  Fire         = 'fire',
  Reload       = 'reload',
  UseMedkit    = 'use_medkit',
  Pickup       = 'pickup',
  MountMG      = 'mount_mg',
  UnmountMG    = 'unmount_mg',
  ThrowGrenade = 'throw_grenade',
}

export const enum ServerMsg {
  RoomState     = 'room_state',
  MatchStart    = 'match_start',
  WorldSnapshot = 'world_snapshot',
  FireResult    = 'fire_result',
  AllyDamaged   = 'ally_damaged',
  AllyDied      = 'ally_died',
  EnemyDied     = 'enemy_died',
  AllyCallout   = 'ally_callout',
  WaveStart     = 'wave_start',
  SupplyDrop    = 'supply_drop',
  MatchEnd      = 'match_end',
}
```

完整字段定义见 `docs/PRD.md` 第 7.5 节。

---

## 反作弊底线

| 攻击方式 | 防御 |
|---|---|
| 改客户端血量 | 服务器持有唯一血量，客户端显示值仅供参考 |
| 伪造击杀 | 击杀只由服务器 `resolveHit` 产生 |
| 加速移动 | 服务器校验位移速度上限 |
| 无限子弹 | 弹药由服务器计数 |
| 瞬间转向连杀 | 服务器校验射击间隔 ≥ 武器射速 |

**基本原则**：客户端发来的一切都是「请求」，服务器验证后才生效。

```ts
// 射击请求处理
handleFire(player: Player, msg: FireMsg) {
  // 1. 校验冷却
  if (now - player.lastFireTime < weapon.fireInterval) return;
  // 2. 校验弹药
  if (player.ammo <= 0) return;
  // 3. 校验位置合理性（防瞬移）
  if (dist(msg.originPos, player.serverPos) > TOLERANCE) return;
  // 4. 服务器自己做射线检测，不信客户端的命中结果
  const hit = this.raycast(msg.originPos, msg.dirVec);
  // 5. 裁决
  ...
}
```

---

## 配置加载

```ts
// 启动时加载一次，之后只读
import weapons from '@shared/config/weapons.json';
import enemies from '@shared/config/enemies.json';
import allies  from '@shared/config/allies.json';
import waves   from '@shared/config/waves.json';
import gameplay from '@shared/config/gameplay.json';
```

**禁止**在 tick 循环里读文件或解析 JSON。

**启动时校验配置合法性**：

```ts
// 四波总和必须恰好 200
const total = waves.waves.reduce((s, w) => s + w.enemyCount, 0);
if (total !== 200) throw new Error(`波次总数应为 200，实际 ${total}`);
```

---

## 性能目标

| 指标 | 目标 |
|---|---|
| 单局 CPU | < 20%（单核，44 个 AI 实体） |
| tick 耗时 | < 15ms（50ms 预算内留足余量） |
| 并发对局 | ≥ 5 局同时进行 |
| 单玩家带宽 | < 30 KB/s |

**监测手段**：在 tick 循环里记录耗时，超过阈值打日志。

```ts
const t0 = performance.now();
this.update(dt);
const cost = performance.now() - t0;
if (cost > 15) console.warn(`tick ${this.tick} 耗时 ${cost.toFixed(1)}ms`);
```

---

## 检查清单

- [ ] 单人模式确实走了 WebSocket 和服务器 tick
- [ ] 客户端代码中不存在任何伤害计算
- [ ] combat 层是纯函数，有单元测试
- [ ] 协议类型只在 `shared/protocol.ts` 定义一份
- [ ] 所有数值从 config JSON 读取
- [ ] 启动时校验四波总和为 200
- [ ] AI 分帧计算已实现
- [ ] 位置用 int16 量化传输
- [ ] 视野裁剪已实现
- [ ] 射击请求做了冷却、弹药、位置校验
- [ ] tick 耗时监测已加
