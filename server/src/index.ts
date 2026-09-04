import { findRepositoryRoot, loadProjectConfig } from './config/project-config';
import { loadRuntimeConfig } from './config/runtime-config';
import { GameWebSocketServer } from './net/websocket-server';

async function main(): Promise<void> {
  const repositoryRoot = findRepositoryRoot();
  const projectConfig = loadProjectConfig(repositoryRoot);
  const runtimeConfig = loadRuntimeConfig(repositoryRoot);
  const server = new GameWebSocketServer(runtimeConfig, projectConfig);

  await server.start();
  console.info(
    `[server] WebSocket 已监听 ws://${runtimeConfig.host}:${runtimeConfig.wsPort}${runtimeConfig.wsPath}`,
  );
  console.info(
    `[server] 配置已加载：${projectConfig.waves.waves.length} 波，敌军总数 ${projectConfig.waves.totalEnemies}，席位 ${projectConfig.allies.seatCount}`,
  );

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.info(`[server] 收到 ${signal}，正在停止服务`);
    await server.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error: unknown) => {
  console.error('[server] 启动失败', error);
  process.exit(1);
});
