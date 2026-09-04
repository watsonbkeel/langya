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

cd "${REPOSITORY_ROOT}"

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
if [[ ! -e "${NGINX_SITE_LINK}" ]]; then
  ln -s "${NGINX_SITE_TARGET}" "${NGINX_SITE_LINK}"
fi
nginx -t
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

echo "部署完成"
