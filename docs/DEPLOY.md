# 部署说明

> ⚠️ **本文件是模板，Codex 部署完成后必须按实际情况填写全部「待填写」项。**
>
> 本文件的读者是 watson——他要据此配置**域名 Nginx 转发（走 Tailscale 内网）**。
> Codex 的职责边界：把服务在内网跑起来并跑通；**不碰 frpc、不碰域名、不做对外暴露**。

---

## 1. 服务器信息

| 项 | 值 |
|---|---|
| 主机 | Debian 13 trixie 工作站 |
| 局域网 IP | 192.168.1.80 |
| Tailscale IP | 100.126.150.80 |
| 项目部署路径 | _待填写_ |
| Node.js 版本 | _待填写_ |
| 运行用户 | _待填写_ |

## 2. 端口占用

| 端口 | 用途 | 监听地址 | 说明 |
|---|---|---|---|
| _待填写_ | HTTP 静态站 | `0.0.0.0` | 托管 Cocos web-mobile 构建产物 |
| _待填写_ | WebSocket | `0.0.0.0` | 游戏权威服务器 |

> **必须监听 `0.0.0.0`**，不能是 `127.0.0.1`，否则 Tailscale 网段访问不到。

## 3. 目录结构（服务器上）

```
_待填写_
├── build/web-mobile/    客户端构建产物（静态文件根目录）
├── server/dist/         服务端编译产物
├── shared/config/       数值配置（改完需重启服务）
├── data/                SQLite 战报库
└── logs/                运行日志
```

## 4. 服务管理

### 启停

```bash
# 待填写实际命令，示例：
pm2 start ecosystem.config.js
pm2 stop  langyashan
pm2 restart langyashan
pm2 logs  langyashan --lines 100
pm2 status
```

### 开机自启

```bash
# 待填写实际执行过的命令
pm2 startup
pm2 save
```

### 更新部署

```bash
# 待填写：拉代码 → 构建 → 重启的完整流程
```

## 5. 环境变量

`.env` **不入库**（已在 `.gitignore`），仓库内提供 `.env.example` 模板。

| 变量 | 说明 | 默认值 |
|---|---|---|
| `HTTP_PORT` | 静态站端口 | _待填写_ |
| `WS_PORT` | WebSocket 端口 | _待填写_ |
| `WS_PATH` | WS 路径 | `/ws` |
| `DB_PATH` | SQLite 文件路径 | _待填写_ |
| `LOG_LEVEL` | 日志级别 | `info` |

## 6. 内网访问验证

Codex 完成部署后必须能跑通以下全部命令：

```bash
# 本机
curl -I http://127.0.0.1:<HTTP_PORT>

# Tailscale 网段
curl -I http://100.126.150.80:<HTTP_PORT>

# WebSocket 握手 + 心跳
node tools/check-ws.js ws://127.0.0.1:<WS_PORT>/ws
node tools/check-ws.js ws://100.126.150.80:<WS_PORT>/ws
```

浏览器（同一 Tailscale 网络的机器）打开 `http://100.126.150.80:<HTTP_PORT>` 应能正常进游戏。

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
        proxy_pass http://100.126.150.80:<HTTP_PORT>;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket —— 必须与静态站同源
    location /ws {
        proxy_pass http://100.126.150.80:<WS_PORT>;
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
pm2 restart langyashan
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

## 10. 备份

| 内容 | 路径 | 说明 |
|---|---|---|
| 战报数据库 | _待填写_ | 建议定期备份 |
| 配置文件 | `shared/config/` | 已入库，无需单独备份 |

---

## 填写记录

| 日期 | 填写人 | 内容 |
|---|---|---|
| 2026-09-04 | 小B | 模板创建 |
