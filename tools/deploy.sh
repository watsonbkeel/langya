#!/usr/bin/env bash

set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="${REPOSITORY_ROOT}/server"
CLIENT_BUILD_DIR="${REPOSITORY_ROOT}/client/build/web-mobile"
FALLBACK_STATIC_DIR="${SERVER_DIR}/public"
NGINX_SITE_SOURCE="${SERVER_DIR}/deploy/nginx-langyashan.conf"
NGINX_SITE_TARGET="/etc/nginx/sites-available/langyashan"
NGINX_SITE_LINK="/etc/nginx/sites-enabled/langyashan"
STATIC_TARGET="/var/www/langyashan"
NODE_BIN_DIR="/opt/langyashan/node22/bin"

cd "${REPOSITORY_ROOT}"

if [[ ! -x "${NODE_BIN_DIR}/node" ]]; then
  echo "缺少项目 Node.js 22：${NODE_BIN_DIR}/node" >&2
  exit 1
fi

export PATH="${NODE_BIN_DIR}:${PATH}"

NODE_MAJOR="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "${NODE_MAJOR}" != "22" ]]; then
  echo "项目必须使用 Node.js 22，当前为 $(node --version)" >&2
  exit 1
fi

echo "-> 校验共享配置"
node tools/verify-config.js

echo "-> 安装并检查服务端依赖"
npm --prefix server ci
npm --prefix server run typecheck
npm --prefix server run build

if [[ -f "${CLIENT_BUILD_DIR}/index.html" ]]; then
  STATIC_SOURCE="${CLIENT_BUILD_DIR}"
  echo "-> 发布 Cocos 客户端构建"
else
  STATIC_SOURCE="${FALLBACK_STATIC_DIR}"
  echo "-> 客户端构建尚未就绪，发布 M0 连通性检查页"
fi

install -d -m 0755 "${STATIC_TARGET}"
cp -a "${STATIC_SOURCE}/." "${STATIC_TARGET}/"
chown -R www-data:www-data "${STATIC_TARGET}"

echo "-> 安装并校验 Nginx 项目站点"
install -m 0644 "${NGINX_SITE_SOURCE}" "${NGINX_SITE_TARGET}"
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  unlink /etc/nginx/sites-enabled/default
fi
if [[ ! -e "${NGINX_SITE_LINK}" ]]; then
  ln -s "${NGINX_SITE_TARGET}" "${NGINX_SITE_LINK}"
fi
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "-> 重载 PM2 服务"
(
  cd "${SERVER_DIR}"
  npx --no-install pm2 startOrReload ecosystem.config.cjs --update-env
  npx --no-install pm2 save
)

echo "-> 验证 HTTP 与 WebSocket"
curl -fsSI http://127.0.0.1:8080 >/dev/null
node tools/check-ws.js ws://127.0.0.1:8081/ws
node tools/check-ws.js ws://127.0.0.1:8080/ws

TAILSCALE_IP="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
if [[ -n "${TAILSCALE_IP}" ]]; then
  curl -fsSI "http://${TAILSCALE_IP}:8080" >/dev/null
  node tools/check-ws.js "ws://${TAILSCALE_IP}:8081/ws"
  node tools/check-ws.js "ws://${TAILSCALE_IP}:8080/ws"
fi

echo "部署完成"
