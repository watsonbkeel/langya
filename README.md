# 狼牙山五壮士 · 网页射击游戏

> 一款 2.5D 网页固守射击游戏。玩家扮演狼牙山五壮士之一，与 4 名 AI 队友并肩坚守制高点，在 5 分钟内抵御四波共 200 名日军的进攻。

**项目代号**：`langyashan-defense`
**当前阶段**：需求已确认（PRD v1.1），待开发
**归属**：「AI+历史」游戏创作课程体系
**仓库**：https://github.com/watsonbkeel/langya
**开发方式**：Debian（服务端）+ Mac（客户端）双机并行，详见 [docs/COLLAB.md](./docs/COLLAB.md)

---

## 快速导航

| 我想…… | 看这个 |
|---|---|
| 开始开发（必读） | **[AGENTS.md](./AGENTS.md)** |
| 了解双机怎么协作（必读） | **[docs/COLLAB.md](./docs/COLLAB.md)** |
| 了解要做什么 | [docs/PRD.md](./docs/PRD.md) |
| 查看开发进度 | [docs/MILESTONES.md](./docs/MILESTONES.md) |
| 确认待决策事项 | [docs/OPEN-QUESTIONS.md](./docs/OPEN-QUESTIONS.md) |
| 处理素材 | [skills/asset-pipeline/SKILL.md](./skills/asset-pipeline/SKILL.md) |
| 写服务端 | [skills/server-authority/SKILL.md](./skills/server-authority/SKILL.md) |
| 写 AI 逻辑 | [skills/ai-behavior/SKILL.md](./skills/ai-behavior/SKILL.md) |
| 写客户端场景 | [skills/cocos-codegen/SKILL.md](./skills/cocos-codegen/SKILL.md) |
| 部署上线 | [skills/deployment/SKILL.md](./skills/deployment/SKILL.md) |

---

## 游戏概要

| 项 | 内容 |
|---|---|
| 玩法 | 居高临下的固守式射击，敌人从三条路线冲锋上山 |
| 单局时长 | 5 分钟（硬性） |
| 编成 | 恒定 5 席：1–5 名真人 + AI 队友补齐 |
| 敌人 | 日军 200 人，四波 **30 / 50 / 60 / 60** |
| 胜利条件 | 5:00 时玩家本人存活 |
| MVP | 存活真人中歼敌数最高者（AI 队友不参评） |
| 目标用户 | 9–15 岁青少年及家长 |

**v1.0 主线是单人模式**，联机作为后置里程碑（M5）。

---

## 技术栈

```
客户端  Cocos Creator 3.8 LTS + TypeScript  →  Web-Mobile
            ↕ WebSocket 20Hz
服务端  Node.js 22 + TypeScript + ws        →  权威服务器
            ↕
存储    SQLite（战报）
部署    PM2 + Nginx @ Debian 13 工作站
```

**核心架构原则**：客户端只做表现，服务器裁决一切。单人模式同样走服务器。

---

## 目录结构

```
狼牙山/
├── AGENTS.md              开发约束（最高优先级）
├── README.md              本文件
├── .gitignore
├── .env.example           环境变量模板（.env 不入库）
│
├── docs/                  文档
│   ├── PRD.md             需求唯一真源
│   ├── COLLAB.md          双机协作纪律（必读）
│   ├── OPEN-QUESTIONS.md  开放问题
│   ├── MILESTONES.md      里程碑进度（Codex 需持续更新）
│   └── DEPLOY.md          部署说明（模板，部署后补齐）
│
├── skills/                分域开发规范
│   ├── asset-pipeline/    素材加工
│   ├── server-authority/  服务端架构
│   ├── ai-behavior/       AI 设计
│   ├── cocos-codegen/     场景代码生成
│   └── deployment/        部署运维
│
├── shared/                前后端共享（唯一真源）
│   ├── protocol.ts        协议类型（待建）
│   └── config/            数值配置 ✅ 已就绪
│       ├── gameplay.json  玩家属性、血包、场景、计分、合规
│       ├── weapons.json   武器数值
│       ├── enemies.json   日军兵种
│       ├── allies.json    AI 队友
│       └── waves.json     四波调度
│
├── client/                Cocos Creator 工程（待建）
├── server/                Node.js 服务端（待建）
│
├── tools/                 加工与自测脚本
│   ├── verify-config.js   配置校验 ✅
│   ├── check-ws.js        WS 连通性自测 ✅
│   ├── simulate-match.js  AI 数值校准（骨架，M2 实现）
│   └── asset-pipeline/    素材加工脚本 ✅
│
├── 军服素材/               ⚠️ 只读
└── 武器素材/               ⚠️ 只读
```

配置改动后务必跑一次校验：

```bash
node tools/verify-config.js
```

---

## 开发里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 骨架 + WS 连通 + 部署跑通 | ⬜ 未开始 |
| M1 | 战斗核心（移动、射击、伤害） | ⬜ 未开始 |
| M2 | AI 队友（布防、补位、喊话） | ⬜ 未开始 |
| M3 | 完整单局（四波、重机枪、结算） | ⬜ 未开始 |
| M4 | 美术接入 | ⬜ 未开始 |
| M5 | 联机 | ⬜ 未开始 |
| M6 | 打磨上线 | ⬜ 未开始 |

**M3 完成后需交付试玩**，确认手感再继续。详见 [docs/MILESTONES.md](./docs/MILESTONES.md)。

---

## 快速开始

### 环境要求

- Node.js 22 LTS
- Cocos Creator 3.8 LTS（构建用，无头模式）
- Debian 13 工作站（开发与部署环境）

### 启动开发

```bash
# 安装依赖
cd server && npm ci
cd ../client && npm ci

# 启动服务端（开发模式）
cd server && npm run dev

# 构建客户端
CocosCreator --project ./client --build "platform=web-mobile;debug=true"
```

### 部署

```bash
# 服务端
cd server && npm ci && npm run build
pm2 start dist/index.js --name langyashan-server
pm2 save && pm2 startup

# 客户端
CocosCreator --project ./client --build "platform=web-mobile;debug=false"
rsync -a --delete client/build/web-mobile/ /var/www/langyashan/
```

### 访问

| 地址 | 用途 |
|---|---|
| `http://192.168.1.80:8080` | 局域网访问 |
| `http://100.126.150.80:8080` | Tailscale 内网访问 |

> **对外访问**由 watson 通过域名 + Nginx 转发经 Tailscale 自行配置，不在开发交付范围内。

---

## 素材说明

项目已提供以下素材，**全部为只读参考图，需二次加工后使用**：

**军服**（1024×1024 概念图，含 front/back/side/portrait/palette）

| 目录 | 用途 |
|---|---|
| `军服素材/national-army-soldier/` | 玩家与 AI 队友 |
| `军服素材/japanese-army-soldier/` | 日军敌人 |

**武器**（侧视图，含 left/right/detail/icon）

| 目录 | 武器 | 归属 |
|---|---|---|
| `武器素材/liaoshi13/` | 中正式步枪 | 玩家默认 |
| `武器素材/lee-enfield-no4/` | 李恩菲尔德 No.4 | 玩家 |
| `武器素材/zb26/` | ZB26 轻机枪 | 玩家 |
| `武器素材/bren/` | 布伦轻机枪 | 玩家 |
| `武器素材/type38/` | 三八式步枪 | 日军 |
| `武器素材/type92-hmg/` | 九二式重机枪 | 阵地固定 |
| `武器素材/手榴弹/` | 手榴弹 | 玩家 |

加工流程见 [skills/asset-pipeline/SKILL.md](./skills/asset-pipeline/SKILL.md)。

---

## 设计红线

本项目面向青少年，以下为不可逾越的底线：

- 无血液、无残肢、无血腥特效
- 无仇恨符号、无侮辱性称谓，敌方统一称「日军」
- 玩家只能加入中国军队，无阵营选择入口
- 无付费、无抽卡、无外部跳转
- 表现英雄坚守精神，不做猎奇化处理

---

## 相关约定

- 原始素材目录 `军服素材/` `武器素材/` **只读**，加工产物输出到 `client/assets/resources/`
- 所有数值来自 `shared/config/*.json`，代码中禁止硬编码
- 协议类型定义只有 `shared/protocol.ts` 一份
- 场景由代码生成，`.scene` 文件保持极简（开发环境无 GUI）
