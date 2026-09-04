# 双机协作纪律

> 本项目由**两台机器上的两个 Codex** 协同开发，通过 GitHub 同步。
> 仓库：`https://github.com/watsonbkeel/langya`（**PUBLIC 公开仓库**）
>
> 本文件与 `AGENTS.md` 同为强制约束。冲突时以 `AGENTS.md` 为准。

---

## 1. 两台机器的分工

| | **Debian 工作站** | **Mac** |
|---|---|---|
| 代号 | `debian` | `mac` |
| 角色 | 服务端 + 部署 | 客户端 + 美术 |
| 有无 GUI | ❌ 无 | ✅ 有 |
| 有无 Cocos 编辑器 | ❌ 无（仅 CLI 构建） | ✅ 有 |
| 工作目录 | 仓库根 | 仓库根（**与 Debian 一致**） |

### 归属划分（谁改谁的，不越界）

| 路径 | 归属 | 说明 |
|---|---|---|
| `server/**` | **debian 独占** | mac 不改 |
| `client/assets/scripts/**` | 双方可改 | 需按下方时序纪律 |
| `client/assets/scenes/**` | **mac 独占** | `.scene` 是二进制式 JSON，冲突无法合并 |
| `client/assets/resources/**` | **mac 独占** | 素材加工产物 |
| `client/settings/**` | **mac 独占** | Cocos 工程配置 |
| `shared/**` | **需先协商** | 协议与配置是双方共同依赖，见第 4 节 |
| `tools/**` | 双方可改 | 各自维护自己用的脚本 |
| `docs/MILESTONES.md` | 双方都要写 | 只改自己负责的里程碑段落 |
| `军服素材/` `武器素材/` | **只读** | 谁都不许改 |

**核心原则：`.scene` 和 `resources/` 只有 mac 动，`server/` 只有 debian 动。**
这两块是最容易产生不可合并冲突的地方，用归属划分从根上避免。

---

## 2. 每次开工与收工的固定动作

### 开工前（第一件事，无例外）

```bash
git pull --rebase origin main
node tools/verify-config.js
```

`pull` 失败或有冲突 → **停下来问 watson**，不要自行 `--force` 或 `reset --hard`。

### 收工时（完成一个可用的小步骤就推）

```bash
node tools/verify-config.js        # 必须通过
git add -A
git commit -m "<类型>(<机器>): <说明>"
git pull --rebase origin main      # 推之前再同步一次
git push origin main
```

**不要攒一大堆改动才推。** 每完成一个能跑通的小步骤就推一次，减少冲突面。

### Commit message 格式

```
<类型>(<机器>): <说明>

类型：feat / fix / refactor / docs / chore / build
机器：debian / mac
```

示例：
```
feat(debian): M0 服务端骨架 + WS 握手
feat(mac): M0 Cocos 工程初始化 + 空场景
fix(mac): 修正 Billboard 绕 Y 轴旋转
docs(debian): 回写 M0 完成记录
```

**看 commit 就能知道是哪台机器做的**，这在排查「谁把它改坏了」时很关键。

---

## 3. 冲突处理

| 冲突文件 | 处理方式 |
|---|---|
| `.scene` / `.meta` | **不要手动合并**。以 mac 版本为准：`git checkout --theirs` 后让 mac 重新导出 |
| `shared/config/*.json` | 停下来问 watson。配置是数值真源，不能靠猜 |
| `shared/protocol.ts` | 停下来问 watson。协议改动影响双方 |
| `docs/MILESTONES.md` | 手动合并，保留双方各自的记录段落 |
| `.ts` 源码 | 正常合并。合完必须跑 `npx tsc --noEmit` |

**通用铁律**：解决冲突后必须重新跑 `node tools/verify-config.js` 和类型检查，通过了才能推。

---

## 4. 改 shared/ 的协商流程

`shared/protocol.ts` 和 `shared/config/*.json` 是**双方共同依赖的真源**，单方面改会直接搞坏对方。

### 改协议（`protocol.ts`）

1. 在 `docs/OPEN-QUESTIONS.md` 的「协议变更提案」区写清楚：改什么、为什么、影响哪些消息
2. 推送这条提案，**先不改代码**
3. 告诉 watson，由 watson 通知另一台机器
4. 双方确认后再改，改完双方各自跑通再推

### 改数值（`config/*.json`）

1. 先确认 PRD 里是不是已经规定了 —— 如果 PRD 有规定，**不许改**（AGENTS.md 铁律 1）
2. PRD 没覆盖的新数值：加字段可以直接做，但要跑 `verify-config.js` 确保不破坏既有校验
3. 改动已有数值：必须问 watson

---

## 5. 里程碑的双机拆分

| 里程碑 | debian 做什么 | mac 做什么 | 谁先 |
|---|---|---|---|
| M0 | 服务端骨架、WS 服务、静态托管、PM2 部署 | Cocos 工程初始化、空场景、WS 客户端连接 | **debian 先**（mac 需要有服务器才能连） |
| M1 | 战斗主循环、命中判定、伤害计算 | 第一人称视角、准心、开火表现、HUD | 并行，先约定好 protocol |
| M2 | 敌人 AI、队友 AI、数值校准 | AI 状态的视觉表现、喊话 UI、威胁指示器 | **debian 先** |
| M3 | 波次调度、空投、计分、战报落库 | 完整 HUD、战报页、重机枪操作 | 并行 |
| M4 | — | **mac 独占**：素材加工、地形、Billboard、音效 | mac |
| M5 | 房间、同步优化、反作弊 | 插值、预测、断线重连 | 并行 |
| M6 | 服务端打磨、DEPLOY.md 补齐 | 客户端打磨、新手引导 | 并行 |

**M4 是 mac 独占阶段**，因为素材加工需要目视检查抠图效果，Debian 无 GUI 做不了。

---

## 6. 构建产物不入库

`client/build/`、`client/library/`、`client/temp/`、`server/dist/` 全部在 `.gitignore` 里。

**不要 `git add -f` 强行加进来。** 这些目录跨机器不兼容，入库必然引发冲突。

Debian 需要客户端构建产物时，自己跑 Cocos CLI 构建，不从仓库拿。

---

## 7. 公开仓库的额外约束

⚠️ **本仓库是 PUBLIC 的，任何人都能看到全部内容和历史。**

绝对不能提交：

- 任何 token、密码、API Key、私钥（`.env` 已在 gitignore，但不要写死在代码里）
- 服务器登录凭据
- 学员个人信息

**已经推上去的敏感信息，删掉重推是没用的** —— Git 历史里还在。发生了要立刻告诉 watson，需要重写历史 + 吊销凭据。

提交前如果不确定，跑一下：

```bash
git diff --cached | grep -i -E "token|password|secret|ghp_|api[_-]?key"
```

---

## 8. 常见错误

| 错误做法 | 后果 | 正确做法 |
|---|---|---|
| 开工不 pull 直接改 | 大面积冲突 | 开工第一件事 pull |
| 攒一整天改动再推 | 冲突到无法合并 | 小步快推 |
| 手动合并 `.scene` | 场景文件损坏，Cocos 打不开 | 以 mac 版为准重新导出 |
| debian 改 `client/assets/scenes/` | 与 mac 冲突 | 归属划分，不越界 |
| mac 改 `server/` | 与 debian 冲突 | 归属划分，不越界 |
| 单方面改 protocol.ts | 对方代码全崩 | 走第 4 节协商流程 |
| `git push --force` | 覆盖对方工作，可能不可恢复 | **绝对禁止**，冲突了就问 watson |
| 把构建产物加进库 | 跨机冲突 | 保持 gitignore |
