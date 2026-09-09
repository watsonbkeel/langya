# 多模型任务分流规程

> 目的：GPT 系模型不稳定时，项目进度不受单一模型可用性绑架。
>
> 原则：**换模型不换规矩**。无论哪个模型、哪个客户端在干活，都必须遵守 `AGENTS.md` 十二条铁律、`docs/PRD.md` 需求真源、`docs/COLLAB.md` 归属划分。

---

## 1. 已具备的能力（2026-09-06 实测）

中转站 `api.bkeel.com`，key 所属分组（VIP/distributor）决定可见模型。
2026-09-06 23:16 复核可用 23 个（分组支持 DeepSeek 系后）：

| 系列 | 型号 |
|---|---|
| GPT | gpt-6-astra、gpt-5.6-sol、gpt-5.6-terra、gpt-5.5、gpt-5.4、gpt-5.4-mini |
| Claude | claude-opus-5、claude-opus-4-8、claude-opus-4-6、claude-sonnet-5、claude-sonnet-4-6、claude-haiku-4-5 |
| Gemini | gemini-3.8-flash（接口待启用，配置已就绪） |
| DeepSeek | deepseek-v4-pro（已配）、deepseek-v4-flash、deepseek-v4-flash-vision-exp |

> **重要：模型列表会随分组配置变化。** 当日曾出现 `/v1/models` 只返回 6 个纯 GPT 模型、
> 请求 Claude 报 `503 No available channel for model X under group VIP (distributor)` 的情况。
> 遇到 503 先查分组，不要怀疑配置。
>
> 排查命令：`curl -s https://api.bkeel.com/v1/models -H "Authorization: Bearer $KEY" | python3 -m json.tool`

**关键实测结论**：中转站对 Claude 模型**同时支持 `/v1/responses` 与 `/v1/chat/completions` 两种协议**，且在 responses 协议下 `tools` / `function_call` / `instructions` / `reasoning.effort` / `parallel_tool_calls` 全部正常返回。

这意味着 **Codex CLI 可以直接切到 Claude 模型运行，不需要 ccswitch 之类的中间层**。

验证命令（可复跑）：

```bash
curl -s https://api.bkeel.com/v1/responses \
  -H "Authorization: Bearer $BKEEL_KEY" -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-5","instructions":"You are a coding agent.",
       "input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"列出当前目录"}]}],
       "tools":[{"type":"function","name":"shell","description":"run shell",
                 "parameters":{"type":"object","properties":{"command":{"type":"array","items":{"type":"string"}}},"required":["command"]}}],
       "reasoning":{"effort":"high"},"parallel_tool_calls":false,"store":false}'
# 期望：output 中出现 function_call shell {"command":["ls","-la"]}
```

---

## 2. 已完成的配置

`~/.codex/config.toml` 新增 5 个 profile，`~/.codex/model_catalog.json` 新增对应条目：

| Profile 名 | 模型 | 上下文 | auto-compact | 推理档 |
|---|---|---|---|---|
| `Bkeel/Claude Opus 5` | claude-opus-5 | **1M** | 750K | high |
| `Bkeel/Claude Sonnet 5` | claude-sonnet-5 | **1M** | 750K | high |
| `Bkeel/Claude Opus 4.8` | claude-opus-4-8 | 500K | 375K | high |
| `Bkeel/Gemini 3.8 Flash` | gemini-3.8-flash | 1M | 750K | medium |
| `Bkeel/DeepSeek V4 Pro` | deepseek-v4-pro | **1M** | 750K | high |

在 Codex 里用 `/model` 即可切换，**同一个会话中途可换**。

原有 5 个 GPT profile 保持不变。备份文件：
`config.toml.bak-20260906-222843-before-1m-fix`、`model_catalog.json.bak-20260906-222843-before-1m-fix`、
`config.toml.bak-20260906-231650-before-deepseek`、`model_catalog.json.bak-20260906-231650-before-deepseek`。

### 上下文窗口（已实测更正）

初版误按 Claude 传统窗口填了 200K，实际不对。上游 400 报错直接给出了真值：

```
prompt is too long: 1280585 tokens > 1000000 maximum
```

- **Claude Opus 5 / Sonnet 5 = 1M**（官方规格：1M 上下文、128K 输出、adaptive thinking 默认开启）
- Claude Opus 4.8 = 500K
- Gemini 3.8 Flash = 1M（2026-09-02 发布，取代 3.7 Flash；1,048,576 输入 / 65,536 输出）
- **DeepSeek V4 Pro = 1M**（V4-Pro-0813 正式版：1M 上下文、384K 输出、思考模式默认开启、支持工具调用与 Responses API）

**结论：GPT / Claude / Gemini / DeepSeek 现在窗口一致（均为 1M，仅 Opus 4.8 为 500K），切换模型不需要额外切小任务。**

> 注意：`config.toml` 的 `model_context_window` 与 `model_catalog.json` 的 `context_window`
> 必须一致，两处都要改，否则 Codex 会按较小值提前压缩。

---

## 3. 任务分流表

### 按"改哪个目录"分（硬约束，来自 COLLAB.md）

| 目录 | 谁能改 | 不受模型影响 |
|---|---|---|
| `server/**` | 只有 Debian | ✅ |
| `client/assets/scenes\|resources\|settings/**` | 只有 Mac | ✅ |
| `shared/**` | 改动前必须协商 | ✅ |
| `军服素材/` `武器素材/` | 谁都不能改 | ✅ |

**归属划分优先于模型选择。** 换模型不等于换归属。

### 按"任务性质"分（新增建议）

| 任务类型 | 推荐执行者 | 理由 |
|---|---|---|
| `shared/protocol.ts` 协议设计与变更 | Codex + GPT（astra / sol） | 双端依赖，出错代价最高，用最熟悉本项目的链路 |
| 服务端逻辑、战斗数值、AI 行为 | Codex + GPT | 已有 91 项测试和验收脚本，链路成熟 |
| 部署、PM2、Nginx、`tools/deploy.sh` | Codex + GPT（Debian 端） | 环境相关，换模型无收益 |
| **客户端表现层、光照、HUD、视觉修正** | **Codex + Claude Opus 5** | 边界清晰、单文件为主，Claude 在 UI/审美判断上更强 |
| **单元测试补齐、技术债清理** | **Codex + Claude Sonnet 5** | 任务定义明确、可机械验证，用便宜快的模型 |
| **文档写作、评审、里程碑回写** | **WorkBuddy** | 不碰代码、零冲突风险，随时可做 |
| **素材加工脚本调参、抠图目视检查** | **WorkBuddy（Mac）** | 需要看图、需要人在场判断 |
| 大批量搜索、日志分析、跑脚本 | Gemini 3.8 Flash | 1M 上下文，便宜（接口启用后可用） |
| **长任务 coding、大型重构、长上下文代码库** | **Codex + DeepSeek V4 Pro** | 1M 上下文 + 384K 输出、思考模式默认开、Agent 能力强（DeepSWE 62.7）；产出比 Claude 便宜约 12 倍 |

---

## 4. 三条防冲突纪律

多模型并行的风险不是"模型不够聪明"，是"两个 agent 同时改一个文件"。

### 纪律 A：一次只有一个 agent 持有写权限

开工前先声明范围，做完立刻 commit + push。**不要攒一堆**。

```bash
git pull --rebase origin main   # 开工
# ... 干活 ...
git add -A && git commit -m "..." && git push
```

### 纪律 B：WorkBuddy 默认只读

WorkBuddy 负责文档、评审、分析。要改代码时**必须先说清改哪几个文件**，
且不能与正在跑的 Codex 会话重叠。

### 纪律 C：换模型必须重新交代上下文

新模型没有之前会话的记忆。切换后第一句话必须包含：

```
读 AGENTS.md、docs/PRD.md、docs/COLLAB.md、docs/MILESTONES.md。
本次任务范围：<明确的文件列表>
不要碰：<明确的排除列表>
完成后回写 docs/MILESTONES.md 对应条目。
```

---

## 5. GPT 不可用时的降级顺序

0. **先确认不是分组问题**：报 `503 No available channel ... under group` 说明 key 分组里没这个模型，改分组即可，不用换模型
1. **同系列换档**：gpt-5.6-sol → gpt-6-astra → gpt-5.5 → gpt-5.4
2. **跨系列切 Claude / DeepSeek**：`/model` 选 `Bkeel/Claude Opus 5` 或 `Bkeel/DeepSeek V4 Pro`（均 1M 窗口，与 GPT 同级，无需切小任务；DeepSeek 性价比更高，适合长 coding 任务）
3. **换客户端**：Claude Code CLI（`~/.npm-global/bin/claude`）走独立通道
4. **纯文档/评审类**：直接在 WorkBuddy 做，不依赖 Codex

**不建议做的**：装 ccswitch 或 claude-code-router。
中转站原生支持 responses 协议，多加一层代理只会多一个故障点。
（本机 `~/.claude/settings.json` 已配 `ANTHROPIC_BASE_URL=http://127.0.0.1:15721`，
该代理当前未运行，Claude Code 若要用需先修这个，或改回直连中转站。）

---

## 6. 当前可立刻分出去的任务

基于 `docs/MILESTONES.md` 未完项：

| 任务 | 分给谁 | 依赖 |
|---|---|---|
| M4 剩余：抠图目视检查、资源体积核对 | WorkBuddy（Mac） | 无 |
| M6：新手引导 UI | Codex + Claude Opus 5（Mac） | 无 |
| M6：断网提示、资源加载失败降级 | Codex + Claude Sonnet 5（Mac） | 无 |
| M6：适龄合规复核 | WorkBuddy | 无 |
| M6：`docs/DEPLOY.md` 补全待填项 | Codex + GPT（Debian） | 需读实际端口 |
| M4：清理 M1–M3 技术债 | Codex + Claude Sonnet 5（Debian） | 无 |
| M5：多人协议设计 | **Codex + GPT，不要分流** | 双端依赖，风险最高 |

---

## 变更日志

| 日期 | 内容 |
|---|---|
| 2026-09-06 | 文件创建。实测中转站 Claude 支持 responses 协议 + 工具调用；在 `~/.codex/config.toml` 增加 4 个非 GPT profile |
| 2026-09-06 晚 | **更正上下文窗口**：Claude Opus 5 / Sonnet 5 实为 **1M**（初版误填 200K），Opus 4.8 为 500K；Gemini 由 3.7 换为 **3.8 Flash**（09-02 发布）。补记分组变动导致的 503 排查方法 |
| 2026-09-06 23:16 | 增加第 5 个 profile **`Bkeel/DeepSeek V4 Pro`**（deepseek-v4-pro，1M 上下文 / 750K auto-compact）。分组已支持 DeepSeek 系，实测 responses 协议 + 工具调用正常（返回 `shell {"command":["ls","-la"]}`）。上下文窗口据官方规格 V4-Pro-0813 填 1M（384K 输出、思考默认开） |

---

## 7. 已知问题：切到 opus5/sonnet5 报 `input_schema does not support oneOf, allOf, or anyOf at the top level`

**现象**：Codex 桌面版切到 Anthropic 模型（opus5 / sonnet5）时报错，路径形如 `***.***.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level`（工具名被中转站脱敏为 `***.***`）。切回 GPT 不报错。

**根因（2026-09-06 实测定位）**：Codex 桌面版内置插件 **`codex-app-tools`**（配置 `config.toml` 第 107 行 `enabled = true`）集成的线程/自动化管理工具（`automation_update` / `create_thread` / `send_message_to_thread` / `fork_thread` / `handoff_thread`，共 5 个）的 `input_schema` 顶层含 `anyOf/oneOf/allOf`。这些工具是 `custom` 类型（非普通 `function` 类型 MCP 工具），其 schema 由 Codex App 主程序经 pipe 注入，**隔离环境探不到、本地也改不了**。Anthropic API 严格拒绝顶层 `anyOf`，OpenAI 对此宽松，所以只有 Anthropic 模型暴露。

**排除过程（铁证）**：用脚本把 Codex 实际会发送的全部其他工具发给 opus5 逐一验证 ——
- shell + apply_patch → 200 OK
- playwright 24 个工具 → 200 OK
- pencil 13 / node_repl 3 / openaiDeveloperDocs 5 → 均为 0 个顶层 `anyOf`
- figma（401 未认证，不加载）、computer-use（`enabled = false`）、codex-app-tools（隔离探不到，返回 0 工具）已排除或隔离

最终 **47 个真实工具（playwright+pencil+node_repl+openaiDeveloperDocs+shell+apply_patch）全集发给 opus5 → HTTP 200 零错误**，100% 锁定 `codex-app-tools` 为唯一未排除源，且它正是 `custom` 类型工具（与报错路径 `custom.input_schema` 吻合）。

**修复选项**：
1. **临时绕过（最快）**：若不用 Codex App 的自动化/多线程功能，把 `config.toml` 第 107 行 `[plugins."codex-app-tools@openai-bundled"]` 的 `enabled = true` 改为 `false`，重启 Codex 后切 opus5 应不再报错。
2. **根本修复**：向 `api.bkeel.com` 中转站反馈，请其在转发 Anthropic 前清洗 `input_schema` 顶层的 `anyOf/oneOf/allOf`（通常可安全内联为 `object`+`properties`，不影响功能）。修复后所有 Anthropic 模型可用，且保留 automation 功能。
3. **短期规避**：需要 Anthropic 模型时先用 GPT 完成，或等中转站修复。

> 注意：`codex-app-tools` 是 Codex App 运行时经 pipe 注入的工具，无法在 `model_catalog.json` 或 `config.toml` 里改其 schema。只能禁用插件或等上游修。
