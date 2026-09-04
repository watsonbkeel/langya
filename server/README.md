# 服务端

Node.js + TypeScript + `ws` 权威服务器。M0 只提供连接、加入、快照和延迟心跳，战斗逻辑从 M1 开始实现。

## 本地构建

```bash
npm ci
npm run typecheck
npm run build
npm start
```

服务启动前会执行仓库根目录的 `tools/verify-config.js`。配置校验失败时进程直接退出。

默认监听：

- WebSocket：`0.0.0.0:8081/ws`
- 健康检查：`http://127.0.0.1:8081/healthz`

运行时配置从仓库根目录 `.env` 读取，未提供时使用 `.env.example` 中的端口默认值。
