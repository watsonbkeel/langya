# M3 真人试玩修复交接文档

更新时间：2026-09-05（Mac 侧）

## 1. 交接目标

本文件用于新对话继续处理“狼牙山五壮士”M3 真人试玩问题。当前目标是完成正式 Debian Tailscale 地址上的客户端初始化与试玩验收闭环。**不要进入 VB0/M4，不接入美术素材，不修改原始素材。**

正式交付地址：

- [http://100.74.3.56:8080/?build=09ef588](http://100.74.3.56:8080/?build=09ef588)
- 服务器是 Debian 的 Tailscale 地址，不是本机 `127.0.0.1`，也不是 `2-nb`。

## 2. 当前 Git 状态

Mac 工作目录：仓库根 `/Users/watson/Documents/微云盘/AI+小程序培训课件/长训营/狼牙山`。

- 当前分支：`main`
- 当前 HEAD：`09ef588 fix(mac): 优化操作焦点与低血量提示`
- `origin/main` 当前可见也为 `09ef588`
- 工作树：仅有用户原有未跟踪目录 `NewProject/`，**不要添加、删除或修改**
- 最近相关提交：
  - `99fc216`：真人操作与立即血包反馈
  - `d6602f8`：Debian 血包改为立即生效
  - `5abdce7`：Debian M3 试玩修复部署记录
  - `09ef588`：客户端焦点、Pointer Lock、低血量提示等修复

Debian 侧另报告过 Nginx 缓存修复提交 `2452ee8`；Mac 当前 `git log` 尚未看到该提交。新对话开始时先执行 `git pull --rebase origin main`，确认两端是否已同步，**不要猜测或强推**。

## 3. 已完成的客户端修复

主要代码在 `client/`，已推送到 `09ef588`：

- `input_state` 按 `shared/config/gameplay.json` 的 `server.tickRateHz` 使用独立累加器发送。
- 从 `onWorldSnapshot` 移除重复输入发送。
- Canvas focus、Pointer Lock、`pointerlockerror` 和 Esc 释放提示。
- 未锁鼠标时禁止视角、WASD 和开火。
- 首次点击只请求进入战斗，不误开火。
- 低血量红边阈值使用 `maxHp - carriedHeal`。
- 血包等待服务器 `action_result` 和下一帧权威 HP 后表现为立即回血。
- 删除 2.5 秒血包进度条和全屏绿色遮罩；绿色边缘闪光约 `0.3s`，数值来自配置。
- 血包拒绝原因中文化。
- 增加“移动已生效”提示，以及调试位置/输入/Pointer Lock 状态。
- 结算页隐藏战斗 HUD 与武器占位。

客户端不做命中、伤害、回血、死亡、计分或胜负判定，均以服务端消息为准。

## 4. Debian 部署与服务端已知信息

Debian 已完成并部署：

- 权威血包逻辑提交 `61fffec`：服务端立即扣除血包并回血，`carriedUseSec=0`、`carriedBlocksFire=false`。
- WS 积压/心跳修复：超过阈值跳过可替代快照，关键事件照发；后续改为仅在 `socket.bufferedAmount === 0` 时发送快照。
- Nginx 对入口 JS、资源 JSON、`src/*.js`/`src/*.json` 增加 no-cache 规则；Debian 报告提交 `2452ee8`。
- Debian 报告的正式包 SHA-256（v2）：`c0058d619169f08082e2a5cdff83b97584c260580bfb47337435b3d4ef0edc3a`。
- PM2 服务名：`langyashan-server`，线上保持 online。

此前 M3 完整单局曾实测：300 秒坚守成功、四波、投放 200/200、5 席战报、FPS 60、Draw Call 30、控制台 warning/error 0。当前交接针对后续真人操作与正式 IP 资源加载问题，不重复宣称新的完整验收结果。

## 5. 当前阻塞与证据

在 Chrome 使用正式地址时仍可能出现：

```text
[M1] 客户端初始化失败 Error: presentation.json 格式无效
```

表现为黑屏，`data-langyashan-m3` 为空。

已确认：

- `curl` 获取的远端 `assets/main/index.js` 与本地构建主 JS SHA 一致。
- 远端 presentation JSON 含有 `helpFontSizePx`、`focusOffsetYPx`、`medkitFlashSec`、`lowHealthPulseSec` 等新字段。
- 远端 `src/settings.json` 与本地构建内容/哈希一致。
- 使用新 origin `2-nb:8080` 可正常加载新客户端并显示新进入战斗提示，但该地址不能作为最终交付地址。
- 因此重点怀疑正式 IP 旧 origin 的 Chrome 缓存、Service Worker 或资源映射仍未刷新；必须在 `100.74.3.56` 上复核。

## 6. 新对话开始时的第一步

在仓库根执行：

```bash
uname -a
git pull --rebase origin main
node tools/verify-config.js
git status --short --branch
```

然后只用正式地址打开并排查实际加载资源：

```text
http://100.74.3.56:8080/?build=09ef588
```

重点查看 Chrome DevTools 的 Network/Application：

1. `src/settings.json`
2. `src/import-map.json`
3. 入口 `assets/main/index.js`
4. 对应的 presentation JSON
5. 是否存在旧 Service Worker、旧 Cache Storage 或旧 import map

若仍失败，先记录正式 IP 实际响应内容、响应头、HTTP 状态和控制台首个错误，再与 Debian 协商；不要把 `2-nb` 或本机代理结果当作正式验收。

## 7. 正式 IP 验收清单

初始化成功后，在同一正式地址完成一局或按现有部署要求完成等价验证：

- 首屏显示“点击画面进入战斗”。
- 首次点击不误开火；Pointer Lock 成功/失败提示可见。
- Esc 释放鼠标后可再次点击进入。
- W/A/S/D 四向移动，“移动已生效”提示与位置变化正常。
- 高于血包阈值按 H 时由服务器拒绝并显示中文原因。
- 低于或等于阈值按 H：血包数减少、权威 HP 下一帧回升、绿色边缘闪光约 0.3 秒。
- 血包使用期间不阻止移动、开火、换枪或交互。
- 血包耗尽时显示服务器拒绝提示。
- 控制台 warning/error 为 0，并记录 FPS。
- 需要时记录 `data-langyashan-m3` 的 `lastDisconnectCode`、`lastDisconnectReason`、`matchEnded`、`playerAlive`、`currentWaveIndex`、`snapshotTick` 等诊断字段。

## 8. 协作与提交边界

- Mac 可改：`client/**`、`tools/asset-pipeline/**`、`docs/MILESTONES.md` 及本交接文档。
- Debian 独占：`server/**`。
- `shared/protocol.ts` 和 `shared/config/*.json` 不得单方面修改；需要新字段时先走 `docs/COLLAB.md` 协商流程。
- `军服素材/`、`武器素材/` 只读；不要接入 M4 素材。
- 不要跟踪 `client/build`、`library`、`temp`、`local`、`profiles`。
- 不得 `git push --force`。
- 每个可运行小步骤完成后提交并推送；提交前至少运行配置校验、客户端配置检查、`cd client && npx tsc --noEmit`、Creator Web-Mobile 构建和凭据扫描。

## 9. 完成后的回写要求

只有在正式 Tailscale 地址实际加载成功并完成验收后，才更新 `docs/MILESTONES.md` 的 Mac M3 试玩修复记录并提交。最终报告必须说明：做了什么、实际执行的验证、是否偏离 PRD、遗留开放问题和下一步。若资源初始化仍失败，应报告证据与阻塞原因，不得写“已完成”。

