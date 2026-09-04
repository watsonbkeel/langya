import { _decorator, Component } from 'cc';

import { loadM1GameConfig } from '../config/game-config';
import { M1Game } from './m1-game';

const { ccclass } = _decorator;

@ccclass('GameEntry')
export class GameEntry extends Component {
  private game: M1Game | null = null;

  onLoad(): void {
    void this.initialize();
  }

  update(deltaTime: number): void {
    this.game?.update(deltaTime);
  }

  onDestroy(): void {
    this.game?.destroy();
    this.game = null;
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
    }
  }
}
