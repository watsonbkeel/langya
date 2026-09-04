# tools/ 工具脚本

| 脚本 | 用途 | 何时跑 | 状态 |
|---|---|---|---|
| `verify-config.js` | 校验 `shared/config/*.json` 合法性与自洽性 | 每次改配置后、服务启动前 | ✅ 可用 |
| `check-ws.js` | WebSocket 连通性自测 | 每次部署后 | ✅ 可用 |
| `simulate-match.js` | 批量模拟单局，校准 AI 队友数值 | M2 | 🟡 骨架待实现 |
| `asset-pipeline/` | 素材抠图裁切缩放 | M4 | ✅ 可用（需 pillow+numpy） |
| `deploy.sh` | 更新部署流程 | Codex 部署时创建 | ⬜ 待创建 |

## 常用命令

```bash
# 配置校验（改完 shared/config/*.json 必跑）
node tools/verify-config.js

# 部署验证（本机 + Tailscale 都要跑）
node tools/check-ws.js ws://127.0.0.1:8081/ws
node tools/check-ws.js ws://100.126.150.80:8081/ws

# AI 数值校准（M2）
node tools/simulate-match.js --runs 10 --output stats.json

# 素材加工（M4）
python tools/asset-pipeline/process-chars.py
python tools/asset-pipeline/process-weapons.py
python tools/asset-pipeline/verify-output.py
```

## 约定

- 所有脚本**只读或只写自己的输出目录**，不修改源素材、不修改配置文件
- 校验类脚本以退出码表达结果：`0` 通过 / `1` 失败，便于串进 CI 和 `deploy.sh`
- 脚本必须幂等：重复运行结果一致

## verify-config.js 校验了什么

关键铁律（不通过则服务端拒绝启动）：

- 四波敌人 `30/50/60/60`，总和恰好 **200**
- 局时长 300 秒，同屏上限 ≤ 40
- 各波兵种占比之和 = 1，路线占比之和 = 1
- 波次时间递增、命中率递增、最后一波能在时限内投完
- 日军 `hasMedkit / canHeal / canRespawn` 全为 `false`
- AI 队友 `canUseHMG / canPickupSupply / eligibleForMVP / canRespawn` 全为 `false`
- 队友歼敌占比上限 ≤ 0.5
- 五席位、五个英雄名、布防人数 = 4
- 所有武器/兵种/路线的交叉引用都存在
