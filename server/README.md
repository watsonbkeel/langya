# 服务端

Node.js + TypeScript + `ws` 权威服务器。当前支持 M0 连接心跳，以及 M1 的
20Hz 世界快照、移动输入、服务端射线命中、伤害/死亡裁决和步枪弹药状态。

## 本地构建

```bash
export PATH="/opt/langyashan/node22/bin:${PATH}"
npm ci
npm run typecheck
npm test
npm run build
npm start
```

服务启动前会执行仓库根目录的 `tools/verify-config.js`。配置校验失败时进程直接退出。

默认监听：

- WebSocket：`0.0.0.0:8081/ws`
- 健康检查：`http://127.0.0.1:8081/healthz`

Debian 部署使用 `/opt/langyashan/node22/bin/node`，避免改变机器上其他项目使用的系统 Node.js。

运行时配置从仓库根目录 `.env` 读取，未提供时使用 `.env.example` 中的端口默认值。

部署后的协议自测：

```bash
node tools/check-ws.js ws://127.0.0.1:8080/ws
node tools/check-m1-ws.js ws://127.0.0.1:8080/ws
```
