# 部署说明

> 本文件的读者是 watson——他要据此配置**域名 Nginx 转发（走 Tailscale 内网）**。
> Codex 的职责边界：把服务在内网跑起来并跑通；**不碰 frpc、不碰域名、不做对外暴露**。

---

## 1. 服务器信息

| 项 | 值 |
|---|---|
| 主机 | Debian 13 trixie 工作站 |
| 局域网 IP | 192.168.1.80 |
| Tailscale IP | 100.74.3.56（2026-09-04 实测） |
| 项目部署路径 | `/root/langya/langya` |
| Node.js 版本 | `22.23.2`（项目专用路径 `/opt/langyashan/node22/bin/node`） |
| 运行用户 | `root` |

> PRD 中记录的 `100.126.150.80` 当前不属于本机，访问测试失败。转发配置应使用
> `tailscale ip -4` 返回的当前地址；如 Tailscale 重新分配地址，需要同步更新本节。

## 2. 端口占用

| 端口 | 用途 | 监听地址 | 说明 |
|---|---|---|---|
| 8080 | HTTP 静态站 | `0.0.0.0` | Nginx；当前托管 M0 连通性检查页，客户端构建就绪后托管 Cocos web-mobile |
| 8081 | WebSocket | `0.0.0.0` | Node.js 权威服务器，路径 `/ws` |

> **必须监听 `0.0.0.0`**，不能是 `127.0.0.1`，否则 Tailscale 网段访问不到。

## 3. 目录结构（服务器上）

```text
/root/langya/langya/
├── client/build/web-mobile/  客户端构建产物（Mac 完成构建后使用）
├── server/public/             M0 连通性检查页
├── server/dist/               服务端编译产物
├── shared/config/             数值配置（改完需重启服务）
├── data/                      SQLite 战报库（M3 创建）
└── tools/deploy.sh            更新部署脚本

/var/www/langyashan/           Nginx 实际静态站点目录
/root/.pm2/logs/               PM2 运行日志
/opt/langyashan/node22/        项目专用 Node.js 22
```

## 4. 服务管理

### 启停

```bash
cd /root/langya/langya/server
export PATH="/opt/langyashan/node22/bin:${PATH}"

npx --no-install pm2 startOrReload ecosystem.config.cjs
npx --no-install pm2 stop langyashan-server
npx --no-install pm2 restart langyashan-server
npx --no-install pm2 logs langyashan-server --lines 100
npx --no-install pm2 status
```

### 开机自启

```bash
cd /root/langya/langya/server
npx --no-install pm2 startup systemd -u root --hp /root
npx --no-install pm2 save

systemctl status pm2-root
systemctl is-enabled pm2-root
```

systemd 服务名为 `pm2-root.service`，PM2 应用名为 `langyashan-server`。

### 更新部署

```bash
cd /root/langya/langya
git pull --rebase origin main
tools/deploy.sh
```

`tools/deploy.sh` 会依次执行配置校验、`npm ci`、类型检查、构建、静态文件发布、
Nginx 配置校验、PM2 reload 和 HTTP/WS 连通性检查。客户端构建不存在时使用
`server/public/` 的 M0 检查页。

## 5. 环境变量

`.env` **不入库**（已在 `.gitignore`），仓库内提供 `.env.example` 模板。

| 变量 | 说明 | 默认值 |
|---|---|---|
| `HTTP_PORT` | 静态站端口 | `8080` |
| `WS_PORT` | WebSocket 端口 | `8081` |
| `WS_PATH` | WS 路径 | `/ws` |
| `DB_PATH` | SQLite 文件路径 | `./data/matches.sqlite`（M3 使用） |
| `LOG_LEVEL` | 日志级别 | `info` |

## 6. 内网访问验证

Codex 完成部署后必须能跑通以下全部命令：

```bash
# 本机
curl -I http://127.0.0.1:8080

# Tailscale 网段
curl -I http://100.74.3.56:8080

# WebSocket 握手 + 心跳
node tools/check-ws.js ws://127.0.0.1:8081/ws
node tools/check-ws.js ws://100.74.3.56:8081/ws

# Nginx 同源 WebSocket 反代
node tools/check-ws.js ws://127.0.0.1:8080/ws
node tools/check-ws.js ws://100.74.3.56:8080/ws
```

浏览器（同一 Tailscale 网络的机器）打开 `http://100.74.3.56:8080`。M0 阶段
显示连通性检查页；Mac 推送客户端构建后显示游戏。

## 7. Nginx 转发参考（watson 自行配置，不在 Codex 交付范围）

客户端 WS 地址从**当前页面域名推导**，因此静态站和 WS 必须**同源**。转发时请把两者放在同一域名下：

```nginx
server {
    listen 443 ssl http2;
    server_name <你的域名>;

    # ssl_certificate     /path/to/fullchain.pem;
    # ssl_certificate_key /path/to/privkey.pem;

    # 静态站
    location / {
        proxy_pass http://100.74.3.56:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket —— 必须与静态站同源
    location /ws {
        proxy_pass http://100.74.3.56:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;

        # 游戏长连接，超时要放宽
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
        proxy_buffering     off;
    }
}
```

> 页面走 `https` 时，客户端会自动用 `wss://`；走 `http` 时用 `ws://`。无需改代码。

## 8. 数值热更新

修改 `shared/config/*.json` 后需要**重启服务**才生效（配置在启动时加载一次，不在热路径读文件）。

```bash
cd /root/langya/langya/server
npx --no-install pm2 restart langyashan-server
```

启动时会校验配置合法性，**四波敌人总和必须恰好等于 200**，否则拒绝启动并打印错误。

## 9. 日志与排障

| 现象 | 排查方向 |
|---|---|
| 页面能开但连不上 WS | Nginx `/ws` 转发是否配了 `Upgrade` 头；WS 是否监听 `0.0.0.0` |
| Tailscale 访问超时 | 服务是否只监听 `127.0.0.1`；Tailscale 状态 `tailscale status` |
| 服务启动即退出 | 看 `pm2 logs`，多半是配置校验失败（波次总和不等于 200） |
| 帧率低 / 卡顿 | 同屏敌人是否超 40；AI 是否没分帧 |
| 战报没落库 | `data/` 目录权限、SQLite 文件路径 |

实际配置与日志位置：

- Nginx 站点配置：`/etc/nginx/sites-available/langyashan`
- Nginx 启用链接：`/etc/nginx/sites-enabled/langyashan`
- Nginx 静态目录：`/var/www/langyashan`
- PM2 标准输出：`/root/.pm2/logs/langyashan-server-out-0.log`
- PM2 错误日志：`/root/.pm2/logs/langyashan-server-error-0.log`

本机 Apache 继续监听 80 端口，未被修改；Nginx 只监听 8080。

## 10. 备份

| 内容 | 路径 | 说明 |
|---|---|---|
| 战报数据库 | `/root/langya/langya/data/matches.sqlite` | M3 创建后建议定期备份 |
| 配置文件 | `shared/config/` | 已入库，无需单独备份 |

---

## 填写记录

| 日期 | 填写人 | 内容 |
|---|---|---|
| 2026-09-04 | 小B | 模板创建 |
| 2026-09-04 | Codex Debian | 填写 M0 实际端口、Node/PM2/Nginx 路径、内网验证与运维命令 |
