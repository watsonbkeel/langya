---
name: deployment
description: 狼牙山项目部署运维规范。当在 Debian 工作站部署服务端、配置 Nginx、设置 PM2 常驻时使用。明确交付边界为内网可达，不涉及 frpc、域名与对外暴露。
---

# 部署运维规范

## ⚠️ 交付边界（最重要）

```
Codex 的职责：把服务在 Debian 上跑好，内网地址能访问
watson 的职责：域名、对外 Nginx 转发、Tailscale 链路、证书
```

| 事项 | 负责方 |
|---|---|
| 服务端部署、PM2 常驻、开机自启 | **Codex** |
| 客户端构建产物落地 | **Codex** |
| 本机 Nginx 站点配置 | **Codex** |
| 内网/Tailscale 地址可访问性验证 | **Codex** |
| 域名解析 | watson |
| 对外反向代理 | watson |
| HTTPS 证书 | watson |
| frpc 配置 | **不需要，已移出项目范围** |

**不要**去配置 frpc，**不要**申请域名，**不要**折腾对外暴露。做完内网这一段就交付。

---

## 环境

| 项 | 值 |
|---|---|
| 机器 | Debian 13 工作站 |
| 局域网地址 | 192.168.1.80 |
| Tailscale 地址 | 100.126.150.80 |
| SSH | 端口 5212（已有） |
| Node.js | 22 LTS |
| 进程管理 | PM2 |
| Web 服务 | Nginx |

> 这台机器还跑着其他服务。**不要修改与本项目无关的配置**。

---

## 端口规划

| 端口 | 用途 | 监听地址 |
|---|---|---|
| 8080 | Nginx 静态站点（游戏客户端） | `0.0.0.0` |
| 8081 | WebSocket 游戏服务 | `0.0.0.0` |
| 5212 | SSH（已有，勿动） | — |
| 5900 | VNC（已有，勿动） | — |

### 为什么监听 0.0.0.0 而不是 127.0.0.1

**因为要经 Tailscale 内网转发访问。**

```
只听 127.0.0.1  →  Tailscale 接口（100.126.150.80）访问不到  ❌
听 0.0.0.0      →  局域网和 Tailscale 都能访问              ✅
```

**安全性说明**：这台机器不直接暴露公网，入口由 watson 的转发层控制，所以监听 0.0.0.0 是安全的。

---

## 服务端部署

```bash
cd server
npm ci
npm run build

# 首次启动
pm2 start dist/index.js --name langyashan-server

# 设置开机自启
pm2 save
pm2 startup        # 按提示执行输出的命令
```

### 常用运维命令

```bash
pm2 status                          # 查看状态
pm2 logs langyashan-server          # 查看日志
pm2 logs langyashan-server --lines 100
pm2 restart langyashan-server       # 重启
pm2 stop langyashan-server          # 停止
pm2 delete langyashan-server        # 移除
pm2 monit                           # 实时监控 CPU/内存
```

### 环境变量

```bash
# server/.env
PORT=8081
HOST=0.0.0.0
NODE_ENV=production
DB_PATH=./data/matches.db
LOG_LEVEL=info
```

**`.env` 不入库**，写进 `.gitignore`，提供 `.env.example` 模板。

---

## 客户端构建与发布

```bash
# 无头构建
CocosCreator --project ./client --build "platform=web-mobile;debug=false"

# 同步到 Nginx 站点目录
sudo mkdir -p /var/www/langyashan
sudo rsync -a --delete client/build/web-mobile/ /var/www/langyashan/
sudo chown -R www-data:www-data /var/www/langyashan
```

---

## Nginx 配置

**推荐做法：静态资源与 WebSocket 同源，只暴露一个端口。**

这样 watson 的转发层只需转发 8080 一个端口，省事且避免跨域问题。

```nginx
# /etc/nginx/sites-available/langyashan
server {
    listen 8080;
    server_name _;

    root /var/www/langyashan;
    index index.html;

    # 静态资源
    location / {
        try_files $uri $uri/ /index.html;
    }

    # WebSocket 反代到 8081，与静态资源同源
    location /ws {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # WebSocket 长连接超时（游戏单局 5 分钟，留足余量）
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|mp3|ogg)$ {
        expires 7d;
        add_header Cache-Control "public";
    }

    gzip on;
    gzip_types text/plain text/css application/javascript application/json;
    gzip_min_length 1024;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/langyashan /etc/nginx/sites-enabled/
sudo nginx -t                    # 必须先测试配置
sudo systemctl reload nginx
```

> **注意**：`nginx -t` 通过再 reload。配置错误会影响这台机器上的其他站点。

---

## 客户端 WS 地址配置

```json
// client/assets/resources/config/server.json
{
  "wsUrl": "",
  "wsPath": "/ws"
}
```

`wsUrl` 留空时，客户端从当前页面地址自动推导：

```
访问 http://100.126.150.80:8080  →  ws://100.126.150.80:8080/ws
访问 https://game.example.com    →  wss://game.example.com/ws
```

**这样 watson 换域名时不需要重新构建客户端。**

---

## 交付验证（必须全部通过）

```bash
# 1. 静态站点本机可访问
curl -I http://127.0.0.1:8080
# 期望：HTTP/1.1 200 OK

# 2. 局域网地址可访问
curl -I http://192.168.1.80:8080
# 期望：HTTP/1.1 200 OK

# 3. Tailscale 地址可访问 ← 关键
curl -I http://100.126.150.80:8080
# 期望：HTTP/1.1 200 OK

# 4. WebSocket 可连接
node tools/check-ws.js ws://127.0.0.1:8081/ws
# 期望：连接成功并收到心跳

# 5. 服务常驻
pm2 status
# 期望：langyashan-server 状态为 online

# 6. 开机自启已配置
systemctl is-enabled pm2-$USER
# 期望：enabled
```

**最终验证**：在浏览器打开 `http://100.126.150.80:8080`，能完整打完一局游戏。

---

## WS 连通性自测脚本

```js
// tools/check-ws.js
const WebSocket = require('ws');
const url = process.argv[2] || 'ws://127.0.0.1:8081/ws';

const ws = new WebSocket(url);
const timer = setTimeout(() => {
  console.error('❌ 连接超时');
  process.exit(1);
}, 5000);

ws.on('open', () => {
  console.log('✅ WebSocket 连接成功:', url);
});

ws.on('message', (data) => {
  console.log('✅ 收到服务端消息:', data.toString().slice(0, 100));
  clearTimeout(timer);
  ws.close();
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('❌ 连接失败:', err.message);
  process.exit(1);
});
```

---

## 更新部署流程

```bash
#!/bin/bash
# tools/deploy.sh
set -e

echo "→ 拉取最新代码"
git pull

echo "→ 构建服务端"
cd server && npm ci && npm run build && cd ..

echo "→ 构建客户端"
CocosCreator --project ./client --build "platform=web-mobile;debug=false"

echo "→ 同步静态资源"
sudo rsync -a --delete client/build/web-mobile/ /var/www/langyashan/

echo "→ 重启服务"
pm2 restart langyashan-server

echo "→ 验证"
sleep 2
curl -sI http://127.0.0.1:8080 | head -1
node tools/check-ws.js ws://127.0.0.1:8080/ws

echo "✅ 部署完成"
```

---

## 日志与监控

```bash
# 日志位置
~/.pm2/logs/langyashan-server-out.log
~/.pm2/logs/langyashan-server-error.log

# 日志轮转（避免磁盘写满）
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

**服务端应记录的关键日志**：
- 房间创建/结束（含最终比分）
- tick 耗时超过 15ms 的告警
- WebSocket 异常断开
- 配置加载失败

**不要**记录每个 tick 的详细状态，会瞬间写满磁盘。

---

## 故障排查

| 现象 | 排查方向 |
|---|---|
| Tailscale 地址访问不通 | 检查监听地址是否为 `0.0.0.0`：`ss -tlnp \| grep 8080` |
| WS 连接失败 | 检查 Nginx `/ws` 反代配置、`Upgrade` 头是否正确传递 |
| 页面白屏 | 浏览器控制台看报错，多为资源路径或构建问题 |
| 服务频繁重启 | `pm2 logs` 看崩溃原因，常见为未捕获异常 |
| 帧率低 | 检查同屏敌人是否超过 40、对象池是否生效 |
| 延迟高 | 实测 Tailscale 链路 RTT，调整客户端插值缓冲 |

```bash
# 查看端口监听情况
ss -tlnp | grep -E '8080|8081'
# 应看到 0.0.0.0:8080 和 0.0.0.0:8081

# 测试 Tailscale 链路延迟
ping -c 10 100.126.150.80
```

---

## docs/DEPLOY.md 交付要求

部署完成后，必须补充 `docs/DEPLOY.md`，供 watson 配置转发层时参考，内容包含：

1. 服务实际监听的端口与地址
2. PM2 服务名与常用命令
3. Nginx 配置文件路径与站点目录
4. 重新构建部署的完整命令
5. WS 地址配置文件位置与修改方式
6. 日志位置
7. 已知问题与注意事项

---

## 检查清单

- [ ] 服务监听 `0.0.0.0` 而非 `127.0.0.1`
- [ ] PM2 常驻且已配置开机自启
- [ ] Nginx 配置通过 `nginx -t` 测试
- [ ] Nginx 同源反代 `/ws` 到 8081
- [ ] WS 长连接超时设置 ≥ 600s
- [ ] 客户端 WS 地址可配置，未硬编码
- [ ] 局域网地址可访问
- [ ] **Tailscale 地址可访问并能完整游玩**
- [ ] 日志轮转已配置
- [ ] `docs/DEPLOY.md` 已补充完整
- [ ] 未修改本机其他无关服务配置
- [ ] 未配置 frpc、未涉及域名
