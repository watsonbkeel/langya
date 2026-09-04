# 开放问题记录 — 狼牙山五壮士项目

> 用途：记录待决策事项。**Codex 执行时遇到未覆盖的决策，按默认值推进并追加到本文件，不要停下来等待。**

## 已确认（2026-09-04，watson 拍板）

| # | 事项 | 结论 |
|---|---|---|
| 1 | 日军总兵力与分批 | **200 人，四波 30 / 50 / 60 / 60**，数字缺口已消除 |
| 2 | v1.0 主线形态 | **单人优先**，自动配 4 名 AI 队友补齐五壮士编成 |
| 3 | 阵亡玩家参评 MVP | 不参评，仅存活真人玩家参评；AI 队友也不参评 |
| 4 | 部署边界 | Codex 只负责在 Debian 上部署好服务；**不配置 frpc、不碰域名**。域名 + Nginx 转发经 Tailscale 由 watson 自行处理 |

## 待 watson 确认

| # | 问题 | 默认处理 | 状态 |
|---|---|---|---|
| 1 | 玩家能否拾取日军三八式？ | 不能，仅用中国军队武器 | 待确认 |
| 2 | 是否做「跳崖」历史结局演出？ | v1.0 不做，仅结算页文案致敬 | 待确认 |
| 3 | 移动端是 v1.0 必须项吗？ | 做兼容适配，不做深度优化 | 待确认 |
| 4 | 需要账号系统与历史战绩吗？ | v1.0 不做，仅本局昵称 | 待确认 |
| 5 | AI 队友难度是否开放玩家调节？ | v1.0 不开放，固定一档 | 待确认 |
| 6 | 联机（M5）是否本期必做？ | 架构已预留，按里程碑推进 | 待确认 |

## 需 watson 授权的操作（Codex 不得自行执行）

| 操作 | 原因 |
|---|---|
| 对外公开发布游戏链接 | 属于公开发布行为 |
| 删除或修改 `军服素材/` `武器素材/` 原始文件 | 原始素材须保持只读 |
| 修改 Debian 上与本项目无关的服务配置 | 工作站还跑着其他服务 |

> 注：frpc 已移出本项目范围。watson 自行用域名 + Nginx + Tailscale 处理对外转发，Codex 只需保证服务在内网地址可达。

## 需在开发中实测校准的项（Codex 负责）

| 项 | 校准标准 | 阶段 |
|---|---|---|
| Tailscale 链路延迟 | 实测转发后延迟，超过 150ms 需调整插值缓冲 | M0 |
| AI 队友歼敌占比 | 4 名合计不超过全场 50%，超出则下调命中率 | M2 |
| AI 队友存活时长 | 基准为存活到 3 分钟以上，全灭过早说明太弱 | M2 |
| 四波难度曲线 | 熟练玩家应能通关，新手在第三、四波有明显压力 | M3 |
| 同屏 40 敌人帧率 | PC ≥ 50 FPS | M3 |

## 协议变更提案区（双机协商用）

> `shared/protocol.ts` 是双方共同依赖的真源，**单方面修改会直接搞坏另一台机器**。
>
> 流程见 `COLLAB.md` 第 4 节：先在此提案 → 推送 → 告知 watson → 双方确认 → 再改代码。

| # | 提案机器 | 日期 | 改什么 | 为什么 | 影响范围 | 状态 |
|---|---|---|---|---|---|---|
| 1 | debian | 2026-09-04 | 新建 `shared/protocol.ts`，定义 M0 的 `join` / `snapshot` / `ping` / `pong` 判别联合类型；统一使用 `{ type, payload }` JSON 信封 | 建立客户端与权威服务器的唯一协议真源，供 Mac 侧直接导入并完成 M0 联调 | 服务端 WS 握手、客户端网络层、`tools/check-ws.js` | 已完成，Mac 已拉取并通过 M0 联调 |
| 2 | debian | 2026-09-04 | 在不改动 M0 消息的前提下，增量增加 M1 的 `input_state` / `fire` / `reload` / `world_snapshot` / `fire_result` / `enemy_died` 消息及共享状态类型 | 建立“输入 → 服务端命中裁决 → 扣血/死亡 → 客户端表现”的权威战斗链路，并同步权威弹药状态 | 服务端消息解析、20Hz 战斗循环、射线命中与弹药校验；Mac 输入、敌人占位、HUD 和命中反馈 | 双方已确认，Debian 已实现并推送 `51bd7f6` |
| 3 | debian | 2026-09-04 | 在 `gameplay.json` 增加 M1 权威校验参数：`server.tickRateHz = 20`；`player.aimPitchMinDeg = -60`、`aimPitchMaxDeg = 60`；`combat.fireOriginToleranceM = 1.0`、`directionMagnitudeTolerance = 0.05`、`enemyHitboxRadiusM = 0.45`、`enemyHitboxHeightM = 1.8`、`headHitboxStartM = 1.4`、`torsoHitboxStartM = 0.5` | 现有配置缺少主循环、视角合法性、射击原点容差和服务端射线碰撞体数值；写死会违反配置唯一真源 | `shared/config/gameplay.json`、配置校验、服务端输入校验与射线命中；Mac 可读取相同俯仰范围和占位碰撞尺寸 | 双方已确认，Debian 已实现并推送 `8f849cc` |
| 4 | debian | 2026-09-04 | M2 增量增加 `room_state` / `ally_callout` / `ally_damaged` / `ally_died`；新增 `RouteId`、敌我 AI 状态类型和 `RoomSeatState`；`AllyState` 增加 `seatIndex`、`heroName`、`routeId`、可选 `aiState`，`EnemyState` 增加 `routeId`、`aiState`、可选 `fireWarningEndsAtMs` | 客户端需要显示恒定 5 席、4 名 AI 队友的姓名/血量/路线/状态、三路威胁和喊话，并表现敌人移动、交战与 0.35 秒开火预警 | 服务端房间与 AI 系统、世界快照和事件广播；Mac 队友面板、喊话、路线威胁和敌人状态表现 | 待 Mac 确认 |

<!-- 示例：
| 1 | debian | 2026-09-05 | snapshot 增加 allyRoute 字段 | 客户端要显示队友在哪条路线 | 客户端队友面板 | 待确认 |
-->

### 提案 2：M1 战斗协议字段草案

兼容策略：

- 保留 `PROTOCOL_VERSION = 1`，M0 的四种消息和字段不变。
- M1 消息继续使用 `{ type, payload }` JSON 信封，属于向后兼容的新增类型。
- 武器 ID 使用字符串，服务端必须对照 `weapons.json` 校验，不信任客户端。
- 坐标使用 Cocos 世界坐标米制浮点数，`Vector3.y` 为竖直方向；M5 再按计划增加
  int16 量化传输，不在 M1 提前改变客户端坐标表示。

客户端到服务端：

| 消息 | payload 字段 |
|---|---|
| `input_state` | `clientTick`, `moveDir: Vector2`, `aimYaw`, `aimPitch`, `isCrouch` |
| `fire` | `weaponId`, `originPos: Vector3`, `dirVec: Vector3`, `clientTick` |
| `reload` | `weaponId` |

服务端到客户端：

| 消息 | payload 字段 |
|---|---|
| `world_snapshot` | `tick`, `serverTimeMs`, `allies: AllyState[]`, `enemies: EnemyState[]`, `items: ItemState[]`；M1 的 `items` 为空数组 |
| `fire_result` | `clientTick`, `weaponId`, `accepted`, `rejectReason?`, `hit`, `targetId?`, `damage`, `isKill`, `hitPart?`, `magazineAmmo`, `reserveAmmo` |
| `enemy_died` | `enemyId`, `killerId`, `killerIsBot`；M1 固定为真人击杀，字段为后续 AI 复用预留 |

共享状态：

| 类型 | 字段 |
|---|---|
| `Vector2` | `x`, `y` |
| `Vector3` | `x`, `y`, `z` |
| `HitPart` | `'head' \| 'torso' \| 'limb'` |
| `FireRejectReason` | `'not_joined' \| 'invalid_weapon' \| 'invalid_origin' \| 'invalid_direction' \| 'cooldown' \| 'empty_magazine' \| 'reloading' \| 'dead'` |
| `WeaponState` | `weaponId`, `magazineAmmo`, `reserveAmmo`, `isReloading`, `reloadEndsAtMs?` |
| `AllyState` | `id`, `isBot`, `hp`, `maxHp`, `position`, `aimYaw`, `aimPitch`, `isCrouch`, `weapon` |
| `EnemyState` | `id`, `enemyType`, `hp`, `maxHp`, `position`, `alive` |
| `ItemState` | M1 仅定义空接口占位不合适，因此定义为 `never` 并发送空数组；M3 加空投字段时另走协议提案 |

校验约定：

- `moveDir` 每轴必须有限且位于 `[-1, 1]`，斜向长度由服务端归一化。
- `aimYaw` / `aimPitch`、所有向量分量和 `clientTick` 必须是有限数；
  `dirVec` 必须接近单位向量。
- `originPos` 只能在服务端权威玩家位置的容差范围内，否则以
  `invalid_origin` 拒绝；具体容差由服务端配置决定，不写进协议。
- 射速、弹匣、备弹、换弹时间、伤害、距离衰减和部位倍率全部读取
  `shared/config/*.json`，客户端不得提交命中对象或伤害值。

### 提案 4：M2 房间与 AI 协议字段草案

兼容策略：

- 保留 `PROTOCOL_VERSION = 1` 和现有 M0/M1 消息，不新增客户端上行消息。
- 现有 `join` 在 M2 继续表示进入单人战斗房间；服务端收到后补齐 4 个 AI 席位。
- `world_snapshot` 保持现有信封与数组结构，仅给敌我实体增加 M2 表现字段。

新增共享类型：

| 类型 | 字段 |
|---|---|
| `RouteId` | `'A' \| 'B' \| 'C'` |
| `AllyAiState` | `'deploy' \| 'guard' \| 'engage' \| 'reassign' \| 'dead'` |
| `EnemyAiState` | `'advance' \| 'engage' \| 'dead'` |
| `RoomStatus` | `'forming' \| 'active' \| 'ended'` |
| `RoomSeatState` | `seatIndex`, `heroName`, `occupantId`, `displayName`, `isBot`, `alive`, `routeId` |

现有状态扩充：

| 类型 | 新增字段 |
|---|---|
| `AllyState` | `seatIndex`, `heroName`, `routeId`, `aiState?`（真人无 AI 状态） |
| `EnemyState` | `routeId`, `aiState`, `fireWarningEndsAtMs?`（只在预警阶段出现） |

新增服务端消息：

| 消息 | payload 字段 |
|---|---|
| `room_state` | `roomId`, `status`, `seats: RoomSeatState[]` |
| `ally_callout` | `allyId`, `routeId`, `text` |
| `ally_damaged` | `allyId`, `hp`, `fromDir: Vector3` |
| `ally_died` | `allyId`, `isBot`, `killerType` |

开火预警不另发事件：服务端在敌人进入预警阶段时设置
`EnemyState.fireWarningEndsAtMs`，客户端依据服务器时间显示枪口焰；伤害仍只由
服务端在预警结束后结算。

## 执行期间新增（Codex 追加区）

> 格式：`[机器] 日期 — 决策点 / 采用的默认值 / 理由`

<!-- Codex 在此追加执行中遇到的决策点 -->
