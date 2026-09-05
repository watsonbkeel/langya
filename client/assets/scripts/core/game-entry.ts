import { _decorator, Component } from 'cc';

import { loadM1GameConfig } from '../config/game-config';
import { M1Game } from './m1-game';

const { ccclass } = _decorator;

@ccclass('GameEntry')
export class GameEntry extends Component {
  private game: M1Game | null = null;
  private initializationErrorElement: HTMLElement | null = null;

  onLoad(): void {
    void this.initialize();
  }

  update(deltaTime: number): void {
    this.game?.update(deltaTime);
  }

  onDestroy(): void {
    this.game?.destroy();
    this.game = null;
    this.initializationErrorElement?.remove();
    this.initializationErrorElement = null;
  }

  private async initialize(): Promise<void> {
    try {
      const config = await loadM1GameConfig();
      const canvas = this.node.parent;
      if (!canvas) {
        throw new Error('GameRoot 必须位于 Canvas 下');
      }
      this.game = new M1Game(canvas, config);
      this.game.connect();
    } catch (error: unknown) {
      console.error('[M1] 客户端初始化失败', error);
      this.showInitializationError();
    }
  }

  private showInitializationError(): void {
    if (typeof document === 'undefined' || this.initializationErrorElement) {
      return;
    }
    const element = document.createElement('div');
    element.id = 'langyashan-load-error';
    element.textContent = '游戏资源加载失败，请刷新页面重试';
    element.style.position = 'fixed';
    element.style.left = '50%';
    element.style.top = '50%';
    element.style.transform = 'translate(-50%, -50%)';
    element.style.padding = '18px 28px';
    element.style.background = 'rgba(24, 48, 64, 0.94)';
    element.style.border = '1px solid #D9B86C';
    element.style.borderRadius = '6px';
    element.style.color = '#F4E8C1';
    element.style.font = '600 20px sans-serif';
    element.style.zIndex = '1000';
    element.style.textAlign = 'center';
    document.body.appendChild(element);
    this.initializationErrorElement = element;
  }
}
