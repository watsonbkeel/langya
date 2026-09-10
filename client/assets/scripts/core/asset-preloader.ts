import { assetManager, ImageAsset, resources } from 'cc';

/**
 * 战斗素材预加载。
 *
 * 各渲染器在构造时就各自 `resources.load` 自己的贴图，引擎会把同一文件的
 * 并发请求合并，所以这里再 preloadDir 不会重复下载；它的价值是：
 * 1. 汇总一个总进度给大厅显示，玩家知道「在等什么」；
 * 2. 给单人上阵一个「素材就绪」的信号，避免点得快就进一片灰白的战场。
 *
 * 只预取 resources 里真正会在战斗里用到的三个目录。config 目录是启动时
 * 已经读过的 json，不用管。
 */
const PRELOAD_DIRS: readonly string[] = ['scene', 'weapons', 'chars'];

/** HTTP/2 下多路复用没有连接数瓶颈，引擎默认的 6 并发太保守。 */
const DOWNLOAD_MAX_CONCURRENCY = 16;
const DOWNLOAD_MAX_REQUESTS_PER_FRAME = 16;

export interface PreloadProgress {
  readonly finished: number;
  readonly total: number;
  readonly done: boolean;
}

export interface AssetPreloaderHandlers {
  readonly onProgress: (progress: PreloadProgress) => void;
  readonly onComplete: () => void;
}

/** 放宽下载器并发，必须在任何 resources.load 之前调用。 */
export function tuneDownloader(): void {
  const downloader = assetManager.downloader;
  downloader.maxConcurrency = Math.max(
    downloader.maxConcurrency,
    DOWNLOAD_MAX_CONCURRENCY,
  );
  downloader.maxRequestsPerFrame = Math.max(
    downloader.maxRequestsPerFrame,
    DOWNLOAD_MAX_REQUESTS_PER_FRAME,
  );
  // preload* 接口走引擎自带的 preload 预设（并发 6 / 每帧 2），
  // 会覆盖上面的全局值，得单独把这个预设也放宽。
  const preloadPreset = assetManager.presets.preload;
  if (preloadPreset) {
    preloadPreset.maxConcurrency = DOWNLOAD_MAX_CONCURRENCY;
    preloadPreset.maxRequestsPerFrame = DOWNLOAD_MAX_REQUESTS_PER_FRAME;
  }
}

export class AssetPreloader {
  private readonly handlers: AssetPreloaderHandlers;
  private readonly perDir = new Map<string, { finished: number; total: number }>();
  private pendingDirs = 0;
  private completed = false;
  private started = false;
  private disposed = false;

  constructor(handlers: AssetPreloaderHandlers) {
    this.handlers = handlers;
  }

  isDone(): boolean {
    return this.completed;
  }

  /** 宿主销毁后不再回调；引擎的下载本身不取消，缓存下次还能用。 */
  dispose(): void {
    this.disposed = true;
  }

  getProgress(): PreloadProgress {
    let finished = 0;
    let total = 0;
    for (const entry of this.perDir.values()) {
      finished += entry.finished;
      total += entry.total;
    }
    return { finished, total, done: this.completed };
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.pendingDirs = PRELOAD_DIRS.length;
    for (const dir of PRELOAD_DIRS) {
      this.perDir.set(dir, { finished: 0, total: 0 });
      // 必须用 ImageAsset：Texture2D 的 json 已经打进了 pack，按 Texture2D 预加载
      // 只会命中 pack，贴图原生文件（.webp）一张都不会下（2026-09-10 实测）。
      resources.preloadDir(
        dir,
        ImageAsset,
        (finished, total) => {
          if (this.disposed) {
            return;
          }
          const entry = this.perDir.get(dir);
          if (entry) {
            entry.finished = finished;
            entry.total = total;
          }
          this.handlers.onProgress(this.getProgress());
        },
        (error) => {
          if (this.disposed) {
            return;
          }
          if (error) {
            // 预加载失败不阻塞游戏：渲染器各自的 load 有兜底占位，
            // 这里只是提前拉取，失败就当这个目录已经处理完。
            console.warn(`[preload] 目录预加载失败：${dir}`, error);
          }
          const entry = this.perDir.get(dir);
          if (entry && entry.total > 0) {
            entry.finished = entry.total;
          }
          this.pendingDirs -= 1;
          if (this.pendingDirs <= 0 && !this.completed) {
            this.completed = true;
            this.handlers.onProgress(this.getProgress());
            this.handlers.onComplete();
          }
        },
      );
    }
  }
}
