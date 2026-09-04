import {
  Camera,
  Layers,
  Node,
  ResolutionPolicy,
  view,
} from 'cc';

import type {
  ActionResultMessage,
  AllyDamagedMessage,
  AllyState,
  FireResultMessage,
  MachineGunState,
  MatchEndMessage,
  MatchStartMessage,
  RoomStateMessage,
  RouteId,
  SnapshotMessage,
  SupplyDropMessage,
  Vector3,
  WeaponState,
  WorldSnapshotMessage,
  WaveStartMessage,
} from '../../../../shared/protocol';
import type { M1GameConfig } from '../config/game-config';
import { AllyRenderer } from '../ally/ally-renderer';
import { EnemyRenderer } from '../enemy/enemy-renderer';
import { NetClient } from '../net/net-client';
import { FirstPersonController } from '../player/first-person-controller';
import {
  M3WorldInteractions,
  type InteractionTarget,
} from '../level/m3-world-interactions';
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
  readonly roomSeatCount: number;
  readonly botCount: number;
  readonly visibleAllyCount: number;
  readonly threatCounts: Readonly<Record<RouteId, number>>;
  readonly warningCount: number;
  readonly calloutCount: number;
  readonly allyDamageEvents: number;
  readonly allyDeathEvents: number;
  readonly matchPhase: string;
  readonly currentWaveIndex: number;
  readonly spawnedEnemies: number;
  readonly remainingEnemies: number;
  readonly worldItemCount: number;
  readonly machineGunCount: number;
  readonly medkitsRemaining: number | null;
  readonly grenadesRemaining: number | null;
  readonly mountedMgId: string | null;
  readonly waveEvents: number;
  readonly supplyEvents: number;
  readonly matchEnded: boolean;
  readonly scoreboardEntries: number;
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
  private readonly allyRenderer: AllyRenderer;
  private readonly enemyRenderer: EnemyRenderer;
  private readonly controller: FirstPersonController;
  private readonly netClient: NetClient;
  private readonly worldInteractions: M3WorldInteractions;
  private readonly pendingShots = new Map<number, number>();
  private clientId: string | null = null;
  private playerPosition: Vector3 | null = null;
  private weaponState: WeaponState | null = null;
  private availableWeaponIds: readonly string[] = [];
  private previousHp: number | null = null;
  private connected = false;
  private snapshotTick = 0;
  private kills = 0;
  private lastFireLatencyMs: number | null = null;
  private lastFireAccepted: boolean | null = null;
  private lastFireHit: boolean | null = null;
  private receivedFirstWorld = false;
  private roomSeatCount = 0;
  private botCount = 0;
  private threatCounts: Record<RouteId, number> = { A: 0, B: 0, C: 0 };
  private warningCount = 0;
  private calloutCount = 0;
  private allyDamageEvents = 0;
  private allyDeathEvents = 0;
  private interactionTarget: InteractionTarget | undefined;
  private mountedMachineGun: MachineGunState | undefined;
  private matchPhase = 'deploy';
  private currentWaveIndex = 0;
  private spawnedEnemies = 0;
  private remainingEnemies = 0;
  private worldItemCount = 0;
  private machineGunCount = 0;
  private medkitsRemaining: number | null = null;
  private grenadesRemaining: number | null = null;
  private mountedMgId: string | null = null;
  private waveEvents = 0;
  private supplyEvents = 0;
  private matchEnded = false;
  private scoreboardEntries = 0;
  private nextMachineGunFireAtMs = 0;

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

    this.hud = new M1Hud(
      canvas,
      config.presentation,
      config.waves,
      config.gameplay,
      config.weapons,
    );
    this.weaponView = new WeaponView(canvas, config.presentation);
    this.enemyRenderer = new EnemyRenderer(
      sceneRoot,
      config.gameplay,
      config.presentation,
      config.waves.maxAliveEnemies,
    );
    this.allyRenderer = new AllyRenderer(
      sceneRoot,
      config.gameplay,
      config.presentation,
    );
    this.worldInteractions = new M3WorldInteractions(
      sceneRoot,
      config.gameplay,
      config.presentation,
      config.weapons,
    );
    this.controller = new FirstPersonController(
      sceneRoot,
      config.gameplay,
      config.presentation,
      {
        onFire: () => this.fire(),
        onReload: () => this.reload(),
        onSwitchWeapon: () => this.switchWeapon(),
        onUseMedkit: () => this.useMedkit(),
        onThrowGrenade: () => this.throwGrenade(),
        onInteract: () => this.interact(),
      },
    );
    this.netClient = new NetClient({
      onStatus: (status) => {
        this.connected = status.kind === 'connected';
        this.hud.renderConnection(status);
        this.publishDebugState();
      },
      onSnapshot: (message) => this.onSnapshot(message),
      onRoomState: (message) => this.onRoomState(message),
      onWorldSnapshot: (message) => this.onWorldSnapshot(message),
      onFireResult: (message) => this.onFireResult(message),
      onEnemyDied: (message) => {
        if (message.payload.killerId === this.clientId) {
          this.kills += 1;
        }
        this.enemyRenderer.remove(message.payload.enemyId);
        this.publishDebugState();
      },
      onAllyCallout: (message) => {
        this.calloutCount += 1;
        this.hud.showCallout(
          message.payload.text,
          message.payload.routeId,
        );
        this.publishDebugState();
      },
      onAllyDamaged: (message) => this.onAllyDamaged(message),
      onAllyDied: (message) => {
        this.allyDeathEvents += 1;
        this.hud.showAllyDied(message.payload.allyId);
        this.publishDebugState();
      },
      onActionResult: (message) => this.onActionResult(message),
      onMatchStart: (message) => this.onMatchStart(message),
      onWaveStart: (message) => this.onWaveStart(message),
      onSupplyDrop: (message) => this.onSupplyDrop(message),
      onMatchEnd: (message) => this.onMatchEnd(message),
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
    this.enemyRenderer.update(deltaTime);
    this.allyRenderer.update(deltaTime);
    if (this.mountedMachineGun && this.controller.isFireHeld()) {
      const config =
        this.config.weapons.emplacement[this.mountedMachineGun.weaponId];
      const nowMs = performance.now();
      if (config && nowMs >= this.nextMachineGunFireAtMs) {
        this.fire();
      }
    }
  }

  destroy(): void {
    this.netClient.disconnect();
    this.controller.destroy();
    this.allyRenderer.destroy();
    this.enemyRenderer.destroy();
    this.worldInteractions.destroy();
    this.weaponView.destroy();
    this.hud.destroy();
    if (typeof window !== 'undefined') {
      window.__LANGYASHAN_M1__ = undefined;
    }
    if (typeof document !== 'undefined') {
      document.documentElement.removeAttribute('data-langyashan-m1');
      document.documentElement.removeAttribute('data-langyashan-m2');
      document.documentElement.removeAttribute('data-langyashan-m3');
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

  private onRoomState(message: RoomStateMessage): void {
    this.roomSeatCount = message.payload.seats.length;
    this.publishDebugState();
  }

  private onWorldSnapshot(message: WorldSnapshotMessage): void {
    this.snapshotTick = message.payload.tick;
    this.enemyRenderer.sync(
      message.payload.enemies,
      message.payload.serverTimeMs,
    );
    this.allyRenderer.sync(message.payload.allies, this.clientId);
    this.hud.updateAllies(message.payload.allies);
    this.hud.updateRouteThreat(
      message.payload.enemies,
      message.payload.serverTimeMs,
    );
    this.botCount = message.payload.allies.filter(
      (ally) => ally.isBot,
    ).length;
    this.threatCounts = { A: 0, B: 0, C: 0 };
    for (const enemy of message.payload.enemies) {
      if (enemy.alive) {
        this.threatCounts[enemy.routeId] += 1;
      }
    }
    this.warningCount = this.enemyRenderer.getWarningCount();
    this.worldInteractions.sync(
      message.payload.items,
      message.payload.machineGuns,
    );
    this.matchPhase = message.payload.match.phase;
    this.currentWaveIndex = message.payload.match.currentWaveIndex;
    this.spawnedEnemies = message.payload.match.spawnedEnemies;
    this.remainingEnemies = message.payload.match.remainingEnemies;
    this.worldItemCount = message.payload.items.filter(
      (item) => item.available,
    ).length;
    this.machineGunCount = message.payload.machineGuns.length;
    this.hud.updateMatch(
      message.payload.match,
      message.payload.serverTimeMs,
    );

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
    this.availableWeaponIds = player.availableWeaponIds.slice();
    this.medkitsRemaining = player.medkitsRemaining;
    this.grenadesRemaining = player.grenadesRemaining;
    this.mountedMgId = player.mountedMgId ?? null;
    this.controller.setAuthoritativePosition(player.position);

    const weaponName =
      this.config.weapons.player[player.weapon.weaponId]?.displayName ??
      player.weapon.weaponId;
    this.hud.updatePlayer(player, weaponName);
    this.hud.updateInventory(player);
    this.hud.updateMedkit(player, message.payload.serverTimeMs);
    this.interactionTarget = this.worldInteractions.findInteraction(
      player.position,
      player.mountedMgId,
      player.availableWeaponIds,
    );
    this.hud.showInteraction(this.interactionTarget?.label ?? '');
    this.mountedMachineGun = this.worldInteractions.getMachineGun(
      player.mountedMgId,
    );
    this.hud.showMachineGun(this.mountedMachineGun);
    if (this.mountedMachineGun) {
      const machineGunConfig =
        this.config.weapons.emplacement[this.mountedMachineGun.weaponId];
      this.controller.setMountedAimLimits(
        machineGunConfig
          ? {
              baseYaw: this.mountedMachineGun.baseYaw,
              yawLimitDeg: machineGunConfig.yawLimitDeg,
              pitchMinDeg: machineGunConfig.pitchMinDeg,
              pitchMaxDeg: machineGunConfig.pitchMaxDeg,
            }
          : null,
      );
    } else {
      this.controller.setMountedAimLimits(null);
    }
    if (!this.receivedFirstWorld) {
      this.receivedFirstWorld = true;
      this.hud.showReady(message.payload.enemies.length);
    }

    if (message.payload.match.phase !== 'ended' && !this.matchEnded) {
      this.netClient.sendInput(this.controller.getInputState());
    }
    this.publishDebugState();
  }

  private onAllyDamaged(message: AllyDamagedMessage): void {
    this.allyDamageEvents += 1;
    if (message.payload.allyId === this.clientId) {
      this.hud.showDamage();
    } else {
      this.allyRenderer.flashDamaged(message.payload.allyId);
      this.hud.flashAllyDamage(message.payload.allyId);
    }
    this.publishDebugState();
  }

  private findPlayer(allies: readonly AllyState[]): AllyState | undefined {
    return this.clientId
      ? allies.find((ally) => ally.id === this.clientId)
      : allies.find((ally) => !ally.isBot);
  }

  private fire(): void {
    if (this.matchEnded || !this.playerPosition || !this.weaponState) {
      return;
    }

    const clientTick = this.netClient.fire(
      this.mountedMachineGun?.weaponId ?? this.weaponState.weaponId,
      this.playerPosition,
      this.controller.getAimDirection(),
    );
    if (clientTick === undefined) {
      return;
    }

    this.pendingShots.set(clientTick, performance.now());
    if (this.mountedMachineGun) {
      const config =
        this.config.weapons.emplacement[this.mountedMachineGun.weaponId];
      if (config) {
        this.nextMachineGunFireAtMs =
          performance.now() + 1000 / config.fireRate;
      }
    }
    this.weaponView.playFire();
    this.hud.showShotPending();
  }

  private reload(): void {
    if (this.matchEnded || this.mountedMachineGun) {
      return;
    }
    if (!this.weaponState || !this.netClient.reload(this.weaponState.weaponId)) {
      return;
    }
    this.weaponView.playReload();
    this.hud.showReloadRequested();
  }

  private switchWeapon(): void {
    if (
      this.matchEnded ||
      this.mountedMachineGun ||
      this.availableWeaponIds.length < 2
    ) {
      return;
    }
    const currentIndex = this.availableWeaponIds.indexOf(
      this.weaponState?.weaponId ?? '',
    );
    const nextIndex = (currentIndex + 1) % this.availableWeaponIds.length;
    const weaponId = this.availableWeaponIds[nextIndex];
    if (weaponId) {
      this.netClient.switchWeapon(weaponId);
    }
  }

  private useMedkit(): void {
    if (this.matchEnded) {
      return;
    }
    this.netClient.useMedkit();
  }

  private throwGrenade(): void {
    if (this.matchEnded || !this.playerPosition || this.mountedMachineGun) {
      return;
    }
    this.netClient.throwGrenade(
      this.playerPosition,
      this.controller.getAimDirection(),
      this.config.presentation.grenadeThrowForce,
    );
  }

  private interact(): void {
    if (this.matchEnded) {
      return;
    }
    const target = this.interactionTarget;
    if (!target) {
      return;
    }
    switch (target.kind) {
      case 'pickup':
        this.netClient.pickup(target.id);
        break;
      case 'mount_mg':
        this.netClient.mountMachineGun(target.id);
        break;
      case 'unmount_mg':
        this.netClient.unmountMachineGun();
        break;
    }
  }

  private onActionResult(message: ActionResultMessage): void {
    this.hud.showActionResult(message.payload);
    this.publishDebugState();
  }

  private onMatchStart(_message: MatchStartMessage): void {
    this.matchPhase = 'deploy';
    this.publishDebugState();
  }

  private onWaveStart(message: WaveStartMessage): void {
    this.waveEvents += 1;
    this.hud.showWaveStart(
      message.payload.waveIndex,
      message.payload.totalWaves,
    );
    this.publishDebugState();
  }

  private onSupplyDrop(message: SupplyDropMessage): void {
    this.supplyEvents += 1;
    this.hud.showSupplyDrop(message.payload.text);
    this.publishDebugState();
  }

  private onMatchEnd(message: MatchEndMessage): void {
    this.matchEnded = true;
    this.scoreboardEntries = message.payload.scoreboard.length;
    this.hud.showMatchEnd(message.payload, this.clientId);
    this.publishDebugState();
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
      roomSeatCount: this.roomSeatCount,
      botCount: this.botCount,
      visibleAllyCount: this.allyRenderer.getActiveCount(),
      threatCounts: { ...this.threatCounts },
      warningCount: this.warningCount,
      calloutCount: this.calloutCount,
      allyDamageEvents: this.allyDamageEvents,
      allyDeathEvents: this.allyDeathEvents,
      matchPhase: this.matchPhase,
      currentWaveIndex: this.currentWaveIndex,
      spawnedEnemies: this.spawnedEnemies,
      remainingEnemies: this.remainingEnemies,
      worldItemCount: this.worldItemCount,
      machineGunCount: this.machineGunCount,
      medkitsRemaining: this.medkitsRemaining,
      grenadesRemaining: this.grenadesRemaining,
      mountedMgId: this.mountedMgId,
      waveEvents: this.waveEvents,
      supplyEvents: this.supplyEvents,
      matchEnded: this.matchEnded,
      scoreboardEntries: this.scoreboardEntries,
    };
  }

  private publishDebugState(): void {
    if (typeof document === 'undefined') {
      return;
    }
    const state = JSON.stringify(this.getDebugState());
    document.documentElement.setAttribute(
      'data-langyashan-m3',
      state,
    );
  }
}
