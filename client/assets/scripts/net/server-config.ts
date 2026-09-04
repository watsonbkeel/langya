import { JsonAsset, resources } from 'cc';

interface ServerConfig {
  readonly wsUrl: string;
  readonly wsPath: string;
}

function isServerConfig(value: unknown): value is ServerConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.wsUrl === 'string' && typeof record.wsPath === 'string';
}

function loadServerConfig(): Promise<ServerConfig> {
  return new Promise((resolve, reject) => {
    resources.load('config/server', JsonAsset, (error, asset) => {
      if (error) {
        reject(new Error(`服务器配置加载失败：${error.message}`));
        return;
      }

      if (!isServerConfig(asset.json)) {
        reject(new Error('服务器配置格式无效'));
        return;
      }

      resolve(asset.json);
    });
  });
}

export async function getWebSocketUrl(): Promise<string> {
  const config = await loadServerConfig();
  if (config.wsUrl.trim()) {
    return config.wsUrl.trim();
  }

  if (typeof location === 'undefined' || !location.host) {
    throw new Error('当前环境无法推导 WebSocket 地址');
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = config.wsPath.startsWith('/')
    ? config.wsPath
    : `/${config.wsPath}`;
  return `${protocol}//${location.host}${path}`;
}
