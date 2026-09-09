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
  RoomActionResultMessage,
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
import { NetClient, type InputState } from '../net/net-client';
import { FirstPersonController } from '../player/first-person-controller';
import {
  M3WorldInteractions,
  type InteractionTarget,
} from '../level/m3-world-interactions';
import { M4SceneDecorations } from '../level/m4-scene-decorations';
import { M1Hud } from '../ui/m1-hud';
import { RoomView } from '../ui/room-view';
import { WeaponView } from '../weapon/weapon-view';

/** 重连凭证存在会话级存储：刷新页面能回原席位，关掉标签页则不保留。 */
const RECONNECT_TOKEN_KEY = 'langyashan.reconnectToken';
const PLAYER_NAME_KEY = 'langyashan.playerName';

interface M1DebugState {
  readonly connected: boolean;
  readonly playerAlive: boolean;
  readonly pointerLocked: boolean;
  readonly playerPosition: Vector3 | null;
  readonly lastInputState: InputState | null;
  readonly lastDisconnectCode: number | null;
  readonly lastDisconnectReason: string | null;
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
  readonly spectatingAllyId: string | null;
  readonly waveEvents: number;
  readonly supplyEvents: number;
  readonly matchEnded: boolean;
  readonly scoreboardEntries: number;
  readonly fps: number;
  readonly lobbyStage: string;
  readonly roomCode: string | null;
  readonly isHost: boolean;
  readonly reconnectPending: boolean;
  /** 稳定战斗身份，自我识别的唯一依据。 */
  readonly playerId: string | null;
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
  private readonly roomView: RoomView;
  private readonly weaponView: WeaponView;
  private readonly allyRenderer: AllyRenderer;
  private readonly enemyRenderer: EnemyRenderer;
  private readonly controller: FirstPersonController;
  private readonly netClient: NetClient;
  private readonly worldInteractions: M3WorldInteractions;
  private readonly sceneDecorations: M4SceneDecorations;
  private readonly pendingShots = new Map<number, number>();
  private readonly inputIntervalSec: number;
  private inputAccumulatorSec = 0;
  /** WebSocket 连接 id，重连后会变，只用于日志/调试，不能用来认人。 */
  private clientId: string | null = null;
  /**
   * 稳定战斗身份（`human:<uuid>`）。席位、快照 ally、击杀归属、计分板
   * 用的都是它。判断「哪个是我」一律用这个字段。
   */
  private playerId: string | null = null;
  private playerPosition: Vector3 | null = null;
  private weaponState: WeaponState | null = null;
  private availableWeaponIds: readonly string[] = [];
  private previousHp: number | null = null;
  private previousAuthoritativePosition: Vector3 | null = null;
  private movementConfirmed = false;
  private lastInputState: InputState | null = null;
  private connected = false;
  private lastDisconnectCode: number | null = null;
  private lastDisconnectReason: string | null = null;
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
  private playerAlive = false;
  private spectatingAllyId: string | null = null;
  private latestAllies: readonly AllyState[] = [];
  private waveEvents = 0;
  private supplyEvents = 0;
  private matchEnded = false;
  private scoreboardEntries = 0;
  private fps = 0;
  private fpsElapsedSec = 0;
  private fpsFrames = 0;
  private nextMachineGunFireAtMs = 0;
  private roomCode: string | null = null;
  private reconnectToken: string | null = null;
  private isHost = false;
  private matchStarted = false;
  private reconnectPending = false;
  private readonly playerName: string;

  constructor(canvas: Node, config: M1GameConfig) {
    this.config = config;
    this.inputIntervalSec = 1 / config.gameplay.server.tickRateHz;
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
    this.hud.setRestartHandler(() => {
      // 结算页只负责重新进入一局；新局仍由服务器创建并裁决。
      if (typeof window !== 'undefined') {
        window.sessionStorage?.removeItem(RECONNECT_TOKEN_KEY);
        window.location.reload();
      }
    });
    this.playerName = this.resolvePlayerName();
    this.roomView = new RoomView(
      canvas,
      config.presentation,
      config.waves,
      config.allies.seatCount,
      {
        onSoloStart: () => {
          this.roomView.setHint('正在建立单人战场…');
          this.netClient.joinSolo(this.playerName);
        },
        onCreateRoom: () => {
          this.roomView.setHint('正在创建房间…');
          this.netClient.createRoom(this.playerName);
        },
        onJoinRoom: (code) => {
          this.roomView.setHint(`正在加入房间 ${code}…`);
          this.netClient.joinRoom(code, this.playerName);
        },
        onQuickMatch: () => {
          this.roomView.setHint('正在寻找可加入的房间…');
          this.netClient.quickMatch(this.playerName);
        },
        onPlayerReady: () => {
          this.roomView.setHint('已告知服务器你准备完毕');
          this.netClient.playerReady();
        },
        onStartMatch: () => {
          this.roomView.setHint('正在开局…');
          this.netClient.startMatch();
        },
      },
    );
    this.weaponView = new WeaponView(
      canvas,
      config.presentation,
      config.weapons,
      config.gameplay.player.defaultLoadout.primary,
    );
    this.enemyRenderer = new EnemyRenderer(
      sceneRoot,
      config.gameplay,
      config.presentation,
      config.waves.maxAliveEnemies,
      config.enemies.units.rifleman.assets.sprite,
    );
    this.allyRenderer = new AllyRenderer(
      sceneRoot,
      config.gameplay,
      config.presentation,
      config.allies.bot.assets.sprite,
      config.allies.bot.heroSprites,
    );
    this.worldInteractions = new M3WorldInteractions(
      sceneRoot,
      config.gameplay,
      config.presentation,
      config.weapons,
    );
    this.sceneDecorations = new M4SceneDecorations(
      sceneRoot,
      config.gameplay,
      config.waves,
      config.presentation,
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
        onFocusChanged: (focused, message) => {
          this.hud.setCombatFocus(focused, message);
          this.publishDebugState();
        },
      },
    );
    this.enemyRenderer.setCameraNode(this.controller.getCameraNode());
    this.allyRenderer.setCameraNode(this.controller.getCameraNode());
    this.worldInteractions.setCameraNode(this.controller.getCameraNode());
    this.sceneDecorations.setCameraNode(this.controller.getCameraNode());
    this.netClient = new NetClient({
      onStatus: (status) => {
        this.connected = status.kind === 'connected';
        if (status.kind === 'connecting') {
          this.lastDisconnectCode = null;
          this.lastDisconnectReason = null;
        } else if (status.kind === 'disconnected') {
          this.lastDisconnectCode = status.code;
          this.lastDisconnectReason = status.reason;
          this.onDisconnected(status.code);
        }
        this.hud.renderConnection(status);
        this.publishDebugState();
      },
      onSnapshot: (message) => this.onSnapshot(message),
      onRoomState: (message) => this.onRoomState(message),
      onRoomActionResult: (message) => this.onRoomActionResult(message),
      onWorldSnapshot: (message) => this.onWorldSnapshot(message),
      onFireResult: (message) => this.onFireResult(message),
      onEnemyDied: (message) => {
        if (this.playerId !== null && message.payload.killerId === this.playerId) {
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
    this.controller.setLobbyMode(true);
    this.netClient.setOpenHandler(() => this.onSocketReady());
    void this.netClient.connect();
  }

  /**
   * 连上服务器后决定去向：手里有重连凭证就先试着回原来那一局，
   * 没有就停在大厅等玩家选择入口。
   */
  private onSocketReady(): void {
    const token = this.readStoredToken();
    if (token) {
      this.reconnectPending = true;
      this.reconnectToken = token;
      this.roomView.setStage('entry');
      this.roomView.setReconnectNotice('检测到未结束的战斗，正在尝试重连…');
      this.netClient.reconnect(token);
      this.publishDebugState();
      return;
    }
    this.roomView.setStage('entry');
    this.roomView.setHint('选择进入方式');
    this.publishDebugState();
  }

  private onDisconnected(code: number): void {
    // 1008 是服务器主动踢人（限流 / 非法输入），重连没有意义。
    if (code === 1008 || this.matchEnded) {
      this.clearStoredToken();
      return;
    }
    if (!this.reconnectToken) {
      return;
    }
    this.reconnectPending = true;
    this.roomView.setStage('entry');
    this.roomView.setReconnectNotice('连接中断，正在重连…');
    this.controller.setLobbyMode(true);
    void this.netClient.connect();
  }

  private onRoomActionResult(message: RoomActionResultMessage): void {
    const payload = message.payload;
    if (!payload.accepted) {
      this.reconnectPending = false;
      if (payload.action === 'reconnect') {
        // 凭证失效就别再重试了，清掉回大厅重新进。
        this.clearStoredToken();
        this.roomView.setReconnectNotice('');
        this.roomView.setStage('entry');
        this.roomView.setHint('上一局已经结束，请重新选择进入方式');
      } else {
        this.roomView.showRejectReason(payload);
      }
      this.publishDebugState();
      return;
    }

    if (payload.roomCode !== undefined) {
      this.roomCode = payload.roomCode;
    }
    if (payload.reconnectToken !== undefined) {
      this.reconnectToken = payload.reconnectToken;
      this.writeStoredToken(payload.reconnectToken);
    }

    if (payload.action === 'create_room') {
      this.isHost = true;
      this.roomView.setHost(true);
      this.roomView.setStage('room');
      this.roomView.setHint('把房间码告诉同伴，人齐后点开始战斗');
    } else if (
      payload.action === 'join_room' ||
      payload.action === 'quick_match'
    ) {
      this.isHost = false;
      this.roomView.setHost(false);
      this.roomView.setStage('room');
      this.roomView.setHint('已进入房间，等待房主开始');
    } else if (payload.action === 'reconnect') {
      this.reconnectPending = false;
      this.roomView.setReconnectNotice('');
      this.enterCombat();
    } else if (payload.action === 'player_ready') {
      this.roomView.setHint('已准备，等待房主开始');
    }
    this.publishDebugState();
  }

  /** 大厅收起、战斗输入接管。单人和多人走同一条路径。 */
  private enterCombat(): void {
    if (this.matchStarted) {
      return;
    }
    this.matchStarted = true;
    this.roomView.setStage('hidden');
    this.controller.setLobbyMode(false);
    this.hud.setCombatFocus(false, '点击画面进入战斗');
  }

  private resolvePlayerName(): string {
    if (typeof window === 'undefined') {
      return '狼牙山战士';
    }
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('name')?.trim();
    if (fromQuery) {
      window.sessionStorage?.setItem(PLAYER_NAME_KEY, fromQuery);
      return fromQuery;
    }
    const stored = window.sessionStorage?.getItem(PLAYER_NAME_KEY)?.trim();
    if (stored) {
      return stored;
    }
    const generated = `战士${Math.floor(Math.random() * 900 + 100)}`;
    window.sessionStorage?.setItem(PLAYER_NAME_KEY, generated);
    return generated;
  }

  private readStoredToken(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }
    return window.sessionStorage?.getItem(RECONNECT_TOKEN_KEY) ?? null;
  }

  private writeStoredToken(token: string): void {
    if (typeof window !== 'undefined') {
      window.sessionStorage?.setItem(RECONNECT_TOKEN_KEY, token);
    }
  }

  private clearStoredToken(): void {
    this.reconnectToken = null;
    this.reconnectPending = false;
    if (typeof window !== 'undefined') {
      window.sessionStorage?.removeItem(RECONNECT_TOKEN_KEY);
    }
  }

  update(deltaTime: number): void {
    this.fpsElapsedSec += deltaTime;
    this.fpsFrames += 1;
    if (this.fpsElapsedSec >= 1) {
      this.fps = Math.round(this.fpsFrames / this.fpsElapsedSec);
      this.fpsElapsedSec = 0;
      this.fpsFrames = 0;
      this.publishDebugState();
    }
    this.controller.update(deltaTime);
    this.inputAccumulatorSec += deltaTime;
    while (this.inputAccumulatorSec >= this.inputIntervalSec) {
      this.inputAccumulatorSec -= this.inputIntervalSec;
      if (
        this.connected &&
        this.playerAlive &&
        !this.matchEnded &&
        this.matchPhase !== 'ended'
      ) {
        const inputState = this.controller.getInputState();
        this.lastInputState = inputState;
        this.netClient.sendInput(inputState);
      }
    }
    this.enemyRenderer.update(deltaTime);
    this.allyRenderer.update(deltaTime);
    this.worldInteractions.update();
    this.sceneDecorations.update();
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
    this.netClient.setOpenHandler(null);
    this.netClient.disconnect();
    this.roomView.destroy();
    this.controller.destroy();
    this.allyRenderer.destroy();
    this.enemyRenderer.destroy();
    this.worldInteractions.destroy();
    this.sceneDecorations.destroy();
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
    // 入座后服务端才会带上战斗身份；大厅阶段没有，保持 null。
    // 注意不要在这里回退成 clientId —— 两者不是一套 id，混用会认错人。
    this.playerId = message.payload.connection.playerId ?? null;
  }

  private onRoomState(message: RoomStateMessage): void {
    this.roomSeatCount = message.payload.seats.length;
    this.roomCode = message.payload.roomId;
    this.roomView.renderRoomState(message.payload, this.playerId);
    // 服务器说这局已经开打，大厅就该让位。
    if (message.payload.status === 'active') {
      this.enterCombat();
    }
    this.publishDebugState();
  }

  private onWorldSnapshot(message: WorldSnapshotMessage): void {
    this.snapshotTick = message.payload.tick;
    this.latestAllies = message.payload.allies;
    const player = this.findPlayer(message.payload.allies);
    this.updateSpectator(player, message.payload.allies);
    this.enemyRenderer.sync(
      message.payload.enemies,
      message.payload.serverTimeMs,
    );
    this.allyRenderer.sync(
      message.payload.allies,
      this.playerId,
      this.spectatingAllyId,
    );
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

    if (!player) {
      return;
    }
    const previousHp = this.previousHp;
    this.previousHp = player.hp;
    this.playerPosition = { ...player.position };
    if (
      !this.movementConfirmed &&
      this.previousAuthoritativePosition &&
      (this.previousAuthoritativePosition.x !== player.position.x ||
        this.previousAuthoritativePosition.z !== player.position.z)
    ) {
      this.movementConfirmed = true;
      this.hud.showMovementConfirmed();
    }
    this.previousAuthoritativePosition = { ...player.position };
    this.weaponState = { ...player.weapon };
    // 第一视角显示的武器要跟着「是否架在重机枪上」走：
    // 上了机枪就该看到机枪，而不是手里还端着步枪。
    const mountedWeaponId = player.mountedMgId
      ? this.worldInteractions.getMachineGun(player.mountedMgId)?.weaponId
      : undefined;
    this.weaponView.setWeapon(mountedWeaponId ?? player.weapon.weaponId);
    this.availableWeaponIds = player.availableWeaponIds.slice();
    this.medkitsRemaining = player.medkitsRemaining;
    this.grenadesRemaining = player.grenadesRemaining;
    this.mountedMgId = player.mountedMgId ?? null;
    if (this.playerAlive) {
      this.controller.setAuthoritativePosition(player.position);
    }

    const weaponName =
      this.config.weapons.player[player.weapon.weaponId]?.displayName ??
      player.weapon.weaponId;
    this.hud.updatePlayer(player, weaponName);
    if (previousHp !== null && player.hp < previousHp) {
      this.hud.showDamage();
    }
    this.hud.updateInventory(player);
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
    if (!this.playerAlive) {
      this.interactionTarget = undefined;
      this.mountedMachineGun = undefined;
      this.hud.showInteraction('');
      this.hud.showMachineGun(undefined);
      this.controller.setMountedAimLimits(null);
    } else if (this.mountedMachineGun) {
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

    this.publishDebugState();
  }

  private onAllyDamaged(message: AllyDamagedMessage): void {
    this.allyDamageEvents += 1;
    if (this.playerId !== null && message.payload.allyId === this.playerId) {
      this.hud.showDamage();
    } else {
      this.allyRenderer.flashDamaged(message.payload.allyId);
      this.hud.flashAllyDamage(message.payload.allyId);
    }
    this.publishDebugState();
  }

  private findPlayer(allies: readonly AllyState[]): AllyState | undefined {
    // 严格按战斗身份匹配。不做「挑第一个非 bot」的兜底 ——
    // 多人局里那样会把队友当成自己，反而把问题藏起来。
    // 拿不到 playerId 说明还没入座，此时本来就不该有「我」。
    if (this.playerId === null) {
      return undefined;
    }
    return allies.find((ally) => ally.id === this.playerId);
  }

  private fire(): void {
    if (
      this.matchEnded ||
      !this.playerAlive ||
      !this.playerPosition ||
      !this.weaponState
    ) {
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
    if (this.matchEnded || !this.playerAlive || this.mountedMachineGun) {
      return;
    }
    if (!this.weaponState || !this.netClient.reload(this.weaponState.weaponId)) {
      return;
    }
    this.weaponView.playReload();
    this.hud.showReloadRequested();
  }

  private switchWeapon(): void {
    if (!this.playerAlive) {
      this.cycleSpectator();
      return;
    }
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
    if (this.matchEnded || !this.playerAlive) {
      return;
    }
    this.netClient.useMedkit();
  }

  private throwGrenade(): void {
    if (
      this.matchEnded ||
      !this.playerAlive ||
      !this.playerPosition ||
      this.mountedMachineGun
    ) {
      return;
    }
    this.netClient.throwGrenade(
      this.playerPosition,
      this.controller.getAimDirection(),
      this.config.presentation.grenadeThrowForce,
    );
  }

  private interact(): void {
    if (this.matchEnded || !this.playerAlive) {
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

  private onMatchStart(message: MatchStartMessage): void {
    this.matchPhase = 'deploy';
    this.enterCombat();
    const payload = message.payload;
    const deploySec = Math.max(
      0,
      Math.round((payload.deployEndsAtMs - payload.startedAtMs) / 1000),
    );
    this.hud.showBattleCry(deploySec);
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
    this.weaponView.setVisible(false);
    // 已经打完的局不需要重连，避免刷新页面后卡在旧战场。
    this.clearStoredToken();
    this.hud.showMatchEnd(message.payload, this.playerId);
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

  private updateSpectator(
    player: AllyState | undefined,
    allies: readonly AllyState[],
  ): void {
    const wasPlayerAlive = this.playerAlive;
    this.playerAlive = player !== undefined && player.hp > 0;
    if (this.playerAlive) {
      this.spectatingAllyId = null;
      this.controller.leaveSpectatorMode();
      this.weaponView.setVisible(!this.matchEnded);
      if (!wasPlayerAlive) {
        this.hud.setCombatFocus(this.controller.isPointerLocked());
      }
      this.hud.hideSpectating();
      return;
    }

    this.hud.setCombatFocus(true);
    const current = allies.find(
      (ally) =>
        ally.isBot &&
        ally.hp > 0 &&
        ally.id === this.spectatingAllyId,
    );
    const target = current ?? allies.find((ally) => ally.isBot && ally.hp > 0);
    this.applySpectatorTarget(target);
  }

  private cycleSpectator(): void {
    if (this.matchEnded) {
      return;
    }
    const candidates = this.latestAllies
      .filter((ally) => ally.isBot && ally.hp > 0)
      .sort((first, second) => first.seatIndex - second.seatIndex);
    if (candidates.length === 0) {
      this.applySpectatorTarget(undefined);
      return;
    }
    const currentIndex = candidates.findIndex(
      (ally) => ally.id === this.spectatingAllyId,
    );
    const next = candidates[(currentIndex + 1) % candidates.length];
    this.applySpectatorTarget(next);
    this.allyRenderer.sync(
      this.latestAllies,
      this.playerId,
      this.spectatingAllyId,
    );
    this.publishDebugState();
  }

  private applySpectatorTarget(target: AllyState | undefined): void {
    this.spectatingAllyId = target?.id ?? null;
    this.weaponView.setVisible(false);
    this.hud.showSpectating(target?.heroName ?? null);
    if (!target) {
      return;
    }
    const eyeHeight = this.config.gameplay.combat.enemyHitboxHeightM / 2;
    this.controller.setSpectatorTarget(
      {
        x: target.position.x,
        y: target.position.y + eyeHeight,
        z: target.position.z,
      },
      target.aimYaw,
      target.aimPitch,
    );
  }

  private getDebugState(): M1DebugState {
    return {
      connected: this.connected,
      playerAlive: this.playerAlive,
      pointerLocked: this.controller.isPointerLocked(),
      playerPosition: this.playerPosition
        ? { ...this.playerPosition }
        : null,
      lastInputState: this.lastInputState,
      lastDisconnectCode: this.lastDisconnectCode,
      lastDisconnectReason: this.lastDisconnectReason,
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
      spectatingAllyId: this.spectatingAllyId,
      waveEvents: this.waveEvents,
      supplyEvents: this.supplyEvents,
      matchEnded: this.matchEnded,
      scoreboardEntries: this.scoreboardEntries,
      fps: this.fps,
      lobbyStage: this.roomView.getStage(),
      roomCode: this.roomCode,
      isHost: this.isHost,
      reconnectPending: this.reconnectPending,
      playerId: this.playerId,
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
