import {
  Camera,
  Layers,
  Node,
  ResolutionPolicy,
  view,
} from 'cc';

import type {
  AllyState,
  FireResultMessage,
  SnapshotMessage,
  Vector3,
  WeaponState,
  WorldSnapshotMessage,
} from '../../../../shared/protocol';
import type { M1GameConfig } from '../config/game-config';
import { EnemyRenderer } from '../enemy/enemy-renderer';
import { NetClient } from '../net/net-client';
import { FirstPersonController } from '../player/first-person-controller';
import { M1Hud } from '../ui/m1-hud';
import { WeaponView } from '../weapon/weapon-view';

interface M1DebugState {
  readonly connected: boolean;
  readonly snapshotTick: number;
  readonly enemyCount: number;
  readonly magazineAmmo: number | null;
  readonly reserveAmmo: number | null;
  readonly kills: number;
  readonly lastFireLatencyMs: number | null;
  readonly lastFireAccepted: boolean | null;
  readonly lastFireHit: boolean | null;
}

declare global {
  interface Window {
    __LANGYASHAN_M1__?: {
      readonly getState: () => M1DebugState;
    };
  }
}

export class M1Game {
  private readonly config: M1GameConfig;
  private readonly hud: M1Hud;
  private readonly weaponView: WeaponView;
  private readonly enemyRenderer: EnemyRenderer;
  private readonly controller: FirstPersonController;
  private readonly netClient: NetClient;
  private readonly pendingShots = new Map<number, number>();
  private clientId: string | null = null;
  private playerPosition: Vector3 | null = null;
  private weaponState: WeaponState | null = null;
  private previousHp: number | null = null;
  private connected = false;
  private snapshotTick = 0;
  private kills = 0;
  private lastFireLatencyMs: number | null = null;
  private lastFireAccepted: boolean | null = null;
  private lastFireHit: boolean | null = null;
  private receivedFirstWorld = false;

  constructor(canvas: Node, config: M1GameConfig) {
    this.config = config;
    view.setDesignResolutionSize(
      config.presentation.designWidth,
      config.presentation.designHeight,
      ResolutionPolicy.SHOW_ALL,
    );
    this.configureUiCamera(canvas);

    const sceneRoot = canvas.scene;
    if (!sceneRoot) {
      throw new Error('找不到 Cocos 场景根节点');
    }

    this.hud = new M1Hud(canvas, config.presentation);
    this.weaponView = new WeaponView(canvas, config.presentation);
    this.enemyRenderer = new EnemyRenderer(
      sceneRoot,
      config.gameplay,
      config.presentation,
      config.waves.maxAliveEnemies,
    );
    this.controller = new FirstPersonController(
      sceneRoot,
      config.gameplay,
      config.presentation,
      {
        onFire: () => this.fire(),
        onReload: () => this.reload(),
      },
    );
    this.netClient = new NetClient({
      onStatus: (status) => {
        this.connected = status.kind === 'connected';
        this.hud.renderConnection(status);
        this.publishDebugState();
      },
      onSnapshot: (message) => this.onSnapshot(message),
      onWorldSnapshot: (message) => this.onWorldSnapshot(message),
      onFireResult: (message) => this.onFireResult(message),
      onEnemyDied: (message) => {
        this.kills += 1;
        this.enemyRenderer.remove(message.payload.enemyId);
        this.publishDebugState();
      },
    });

    if (typeof window !== 'undefined') {
      window.__LANGYASHAN_M1__ = {
        getState: () => this.getDebugState(),
      };
    }
    this.publishDebugState();
  }

  connect(): void {
    void this.netClient.connect();
  }

  update(deltaTime: number): void {
    this.controller.update(deltaTime);
  }

  destroy(): void {
    this.netClient.disconnect();
    this.controller.destroy();
    this.enemyRenderer.destroy();
    this.weaponView.destroy();
    this.hud.destroy();
    if (typeof window !== 'undefined') {
      window.__LANGYASHAN_M1__ = undefined;
    }
    if (typeof document !== 'undefined') {
      document.documentElement.removeAttribute('data-langyashan-m1');
    }
  }

  private configureUiCamera(canvas: Node): void {
    const uiCamera = canvas.getChildByName('Main Camera')?.getComponent(Camera);
    if (!uiCamera) {
      throw new Error('Boot.scene 缺少 Main Camera');
    }
    uiCamera.priority = 1;
    uiCamera.visibility = Layers.Enum.UI_2D;
    uiCamera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
  }

  private onSnapshot(message: SnapshotMessage): void {
    this.clientId = message.payload.connection.clientId;
  }

  private onWorldSnapshot(message: WorldSnapshotMessage): void {
    this.snapshotTick = message.payload.tick;
    this.enemyRenderer.sync(message.payload.enemies);

    const player = this.findPlayer(message.payload.allies);
    if (!player) {
      return;
    }
    if (this.previousHp !== null && player.hp < this.previousHp) {
      this.hud.showDamage();
    }
    this.previousHp = player.hp;
    this.playerPosition = { ...player.position };
    this.weaponState = { ...player.weapon };
    this.controller.setAuthoritativePosition(player.position);

    const weaponName =
      this.config.weapons.player[player.weapon.weaponId]?.displayName ??
      player.weapon.weaponId;
    this.hud.updatePlayer(player, weaponName);
    if (!this.receivedFirstWorld) {
      this.receivedFirstWorld = true;
      this.hud.showReady(message.payload.enemies.length);
    }

    this.netClient.sendInput(this.controller.getInputState());
    this.publishDebugState();
  }

  private findPlayer(allies: readonly AllyState[]): AllyState | undefined {
    return this.clientId
      ? allies.find((ally) => ally.id === this.clientId)
      : allies.find((ally) => !ally.isBot);
  }

  private fire(): void {
    if (!this.playerPosition || !this.weaponState) {
      return;
    }

    const clientTick = this.netClient.fire(
      this.weaponState.weaponId,
      this.playerPosition,
      this.controller.getAimDirection(),
    );
    if (clientTick === undefined) {
      return;
    }

    this.pendingShots.set(clientTick, performance.now());
    this.weaponView.playFire();
    this.hud.showShotPending();
  }

  private reload(): void {
    if (!this.weaponState || !this.netClient.reload(this.weaponState.weaponId)) {
      return;
    }
    this.weaponView.playReload();
    this.hud.showReloadRequested();
  }

  private onFireResult(message: FireResultMessage): void {
    const sentAt = this.pendingShots.get(message.payload.clientTick);
    this.pendingShots.delete(message.payload.clientTick);
    const latencyMs = sentAt === undefined
      ? 0
      : Math.max(0, Math.round(performance.now() - sentAt));
    this.lastFireLatencyMs = latencyMs;
    this.lastFireAccepted = message.payload.accepted;
    this.lastFireHit = message.payload.hit;
    this.weaponState = this.weaponState
      ? {
          ...this.weaponState,
          magazineAmmo: message.payload.magazineAmmo,
          reserveAmmo: message.payload.reserveAmmo,
        }
      : null;

    this.hud.showFireResult(message.payload, latencyMs);
    if (message.payload.accepted && message.payload.hit) {
      this.enemyRenderer.flash(message.payload.targetId);
    }
    this.publishDebugState();
  }

  private getDebugState(): M1DebugState {
    return {
      connected: this.connected,
      snapshotTick: this.snapshotTick,
      enemyCount: this.enemyRenderer.getActiveCount(),
      magazineAmmo: this.weaponState?.magazineAmmo ?? null,
      reserveAmmo: this.weaponState?.reserveAmmo ?? null,
      kills: this.kills,
      lastFireLatencyMs: this.lastFireLatencyMs,
      lastFireAccepted: this.lastFireAccepted,
      lastFireHit: this.lastFireHit,
    };
  }

  private publishDebugState(): void {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.setAttribute(
      'data-langyashan-m1',
      JSON.stringify(this.getDebugState()),
    );
  }
}
