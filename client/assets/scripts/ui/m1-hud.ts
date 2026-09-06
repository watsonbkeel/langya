import {
  Color,
  Graphics,
  Label,
  Layers,
  Node,
  tween,
  Tween,
  UIOpacity,
  Vec3,
} from 'cc';

import type {
  ActionResultPayload,
  AllyAiState,
  AllyState,
  EnemyState,
  FireRejectReason,
  FireResultPayload,
  MachineGunState,
  MatchEndPayload,
  MatchProgressState,
  RouteId,
  WeaponState,
} from '../../../../shared/protocol';
import type {
  GameplayConfig,
  PresentationConfig,
  WeaponsConfig,
  WavesConfig,
} from '../config/game-config';
import type { ConnectionStatus } from '../net/net-client';

const REJECT_TEXT: Readonly<Record<FireRejectReason, string>> = {
  not_joined: '尚未加入战斗',
  invalid_weapon: '武器无效',
  invalid_origin: '射击位置需要校正',
  invalid_direction: '瞄准方向无效',
  cooldown: '枪机未就绪',
  empty_magazine: '弹仓已空，请换弹',
  reloading: '正在换弹',
  dead: '已无法开火',
};

export class M1Hud {
  private readonly root: Node;
  private readonly presentation: PresentationConfig;
  private readonly connectionLabel: Label;
  private readonly debugVisible: boolean;
  private readonly healthLabel: Label;
  private readonly ammoLabel: Label;
  private readonly messageLabel: Label;
  private readonly focusLabel: Label;
  private readonly lowHealthLabel: Label;
  private readonly spectatorLabel: Label;
  private readonly hitLabel: Label;
  private readonly damageLabel: Label;
  private readonly vignetteOpacity: UIOpacity;
  private readonly medkitFlashOpacity: UIOpacity;
  private readonly routeLabel: Label;
  private readonly calloutLabel: Label;
  private readonly matchLabel: Label;
  private readonly waveBannerLabel: Label;
  private readonly interactionLabel: Label;
  private readonly inventoryLabel: Label;
  private readonly machineGunLabel: Label;
  private readonly gameplay: GameplayConfig;
  private readonly weapons: WeaponsConfig;
  private readonly allyLabels = new Map<number, Label>();
  private readonly allyIds = new Map<string, Label>();
  private readonly flashingAllies = new Set<string>();
  private readonly temporaryLabelTimers = new Map<Label, ReturnType<typeof setTimeout>>();
  private readonly routeNames: Readonly<Record<RouteId, string>>;
  private weaponName = '步枪';
  private routeHighlightSequence = 0;
  private lowHealthActive = false;
  private medkitConfirmationPending = false;
  private calloutAudioContext: AudioContext | null = null;

  constructor(
    canvas: Node,
    presentation: PresentationConfig,
    waves: WavesConfig,
    gameplay: GameplayConfig,
    weapons: WeaponsConfig,
  ) {
    this.presentation = presentation;
    this.debugVisible =
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get('debug') === '1';
    this.gameplay = gameplay;
    this.weapons = weapons;
    this.routeNames = {
      A: waves.routes.A.name,
      B: waves.routes.B.name,
      C: waves.routes.C.name,
    };
    this.root = new Node('M1HUD');
    this.setUiLayer(this.root);
    this.root.setParent(canvas);

    this.createLabel(
      'Title',
      '狼牙山五壮士 · 坚守棋盘陀',
      presentation.titleFontSizePx,
      new Vec3(0, presentation.statusOffsetYPx, 0),
      '#F4E8C1',
    );
    this.connectionLabel = this.createLabel(
      'Connection',
      '正在连接…',
      presentation.hudFontSizePx,
      new Vec3(0, presentation.statusOffsetYPx - presentation.titleFontSizePx, 0),
      '#C8F4FF',
    );
    const helpLabel = this.createLabel(
      'Help',
      '点击画面进入战斗 · WASD 移动 · 鼠标瞄准 · 左键射击 · Esc 释放鼠标\nR 换弹 · Q 切枪 · G 手榴弹 · H 立即使用血包 · F 交互/上下重机枪 · Ctrl 蹲下',
      presentation.helpFontSizePx,
      new Vec3(0, presentation.helpOffsetYPx, 0),
      '#DDE7EA',
    );
    this.fadeLabel(helpLabel, presentation.helpVisibleSec);
    this.focusLabel = this.createLabel(
      'CombatFocus',
      '点击画面进入战斗\nWASD 移动 · 鼠标瞄准 · 左键射击',
      presentation.hudFontSizePx,
      new Vec3(0, presentation.focusOffsetYPx, 0),
      '#C8F4FF',
    );
    this.showTemporaryLabel(
      this.focusLabel,
      this.focusLabel.string,
      presentation.helpVisibleSec,
    );
    this.healthLabel = this.createLabel(
      'Health',
      '生命 --/--',
      presentation.hudFontSizePx,
      new Vec3(
        presentation.healthOffsetXPx,
        presentation.healthOffsetYPx,
        0,
      ),
      '#DCE8B5',
    );
    this.ammoLabel = this.createLabel(
      'Ammo',
      '弹药 --/--',
      presentation.hudFontSizePx,
      new Vec3(
        presentation.ammoOffsetXPx,
        presentation.ammoOffsetYPx,
        0,
      ),
      '#F4E8C1',
    );
    this.messageLabel = this.createLabel(
      'Message',
      '等待权威快照…',
      presentation.hudFontSizePx,
      new Vec3(0, presentation.messageOffsetYPx, 0),
      '#FFFFFF',
    );
    this.lowHealthLabel = this.createLabel(
      'LowHealth',
      '',
      presentation.hudFontSizePx,
      new Vec3(0, presentation.lowHealthOffsetYPx, 0),
      '#FFB0A6',
    );
    this.spectatorLabel = this.createLabel(
      'Spectator',
      '',
      presentation.hudFontSizePx,
      new Vec3(0, presentation.spectatorOffsetYPx, 0),
      '#C8F4FF',
    );
    this.hitLabel = this.createLabel(
      'HitMarker',
      '',
      presentation.damageFontSizePx,
      new Vec3(),
      '#FFFFFF',
    );
    this.damageLabel = this.createLabel(
      'DamageNumber',
      '',
      presentation.damageFontSizePx,
      new Vec3(0, presentation.messageOffsetYPx / 2, 0),
      '#FFE8A3',
    );
    this.createLabel(
      'AllyPanelTitle',
      '队友状态',
      presentation.hudFontSizePx,
      new Vec3(
        presentation.allyPanelOffsetXPx,
        presentation.allyPanelOffsetYPx + presentation.allyPanelLineGapPx,
        0,
      ),
      '#DCE8B5',
    );
    this.routeLabel = this.createLabel(
      'RouteThreat',
      '',
      presentation.hudFontSizePx,
      new Vec3(0, presentation.routeIndicatorOffsetYPx, 0),
      '#FFFFFF',
    );
    this.calloutLabel = this.createLabel(
      'AllyCallout',
      '',
      presentation.calloutFontSizePx,
      new Vec3(0, presentation.calloutOffsetYPx, 0),
      '#FFD56A',
    );
    this.matchLabel = this.createLabel(
      'MatchProgress',
      '部署中  00:00  敌军 200',
      presentation.hudFontSizePx,
      new Vec3(0, presentation.matchHudOffsetYPx, 0),
      '#FFFFFF',
    );
    this.waveBannerLabel = this.createLabel(
      'WaveBanner',
      '',
      presentation.titleFontSizePx,
      new Vec3(0, presentation.waveBannerOffsetYPx, 0),
      '#FFD56A',
    );
    this.interactionLabel = this.createLabel(
      'Interaction',
      '',
      presentation.hudFontSizePx,
      new Vec3(0, presentation.interactionOffsetYPx, 0),
      '#C8F4FF',
    );
    this.inventoryLabel = this.createLabel(
      'Inventory',
      '',
      presentation.hudFontSizePx,
      new Vec3(0, presentation.inventoryOffsetYPx, 0),
      '#F4E8C1',
    );
    this.machineGunLabel = this.createLabel(
      'MachineGun',
      '',
      presentation.hudFontSizePx,
      new Vec3(0, presentation.machineGunOffsetYPx, 0),
      '#FFD56A',
    );
    this.vignetteOpacity = this.createDamageVignette();
    this.medkitFlashOpacity = this.createEdgeFlash(
      presentation.medkitGlowColor,
    );
    this.createCrosshair();
  }

  renderConnection(status: ConnectionStatus): void {
    switch (status.kind) {
      case 'connecting':
        this.connectionLabel.string = '正在进入阵地…';
        break;
      case 'measuring':
        this.connectionLabel.string = '阵地准备中…';
        break;
      case 'connected':
        this.connectionLabel.string = this.debugVisible
          ? `网络延迟 ${status.latencyMs} ms`
          : '';
        break;
      case 'disconnected':
        this.connectionLabel.string = '连接已断开';
        break;
      case 'error':
        this.connectionLabel.string = `连接失败：${status.message}`;
        break;
    }
  }

  setCombatFocus(focused: boolean, message?: string): void {
    if (focused) {
      this.clearTemporaryLabel(this.focusLabel);
      this.focusLabel.string = '';
      return;
    }
    this.showTemporaryLabel(
      this.focusLabel,
      message ?? '点击画面进入战斗\nWASD 移动 · 鼠标瞄准 · 左键射击',
      this.presentation.helpVisibleSec,
    );
  }

  updatePlayer(player: AllyState, weaponName: string): void {
    this.weaponName = weaponName;
    this.healthLabel.string = `生命 ${player.hp}/${player.maxHp}`;
    this.updateAmmo(player.weapon);
    if (this.medkitConfirmationPending) {
      this.medkitConfirmationPending = false;
      this.messageLabel.string = `血包生效，生命 ${player.hp}/${player.maxHp}`;
      this.fadeLabel(this.messageLabel, this.presentation.medkitFlashSec);
    }
    this.updateLowHealthWarning(player);
  }

  updateAmmo(weapon: WeaponState): void {
    const state = weapon.isReloading ? ' · 换弹中…' : '';
    this.ammoLabel.string = `${this.weaponName}  ${weapon.magazineAmmo}/${weapon.reserveAmmo}${state}`;
  }

  showReady(enemyCount: number): void {
    this.showTemporaryLabel(
      this.messageLabel,
      enemyCount > 0
        ? `坚守阵地！剩余敌军 ${enemyCount}`
        : '尽快选择防守位置',
      this.presentation.helpVisibleSec,
    );
  }

  updateMatch(match: MatchProgressState, serverTimeMs: number): void {
    const remainingSec = Math.max(
      0,
      Math.ceil((match.endsAtMs - serverTimeMs) / 1000),
    );
    const phase = match.phase === 'deploy'
      ? '部署期'
      : match.phase === 'intermission'
        ? '波次间歇'
        : match.phase === 'ended'
          ? '已结束'
          : `第 ${match.currentWaveIndex}/${match.totalWaves} 波`;
    this.matchLabel.string = `${phase}  ${formatTime(remainingSec)}  剩余敌军 ${match.remainingEnemies}  已投放 ${match.spawnedEnemies}/${match.totalEnemies}`;
  }

  updateInventory(player: AllyState): void {
    const weapons = player.availableWeaponIds.map((weaponId) => {
      const name = this.weapons.player[weaponId]?.displayName ?? weaponId;
      return weaponId === player.weapon.weaponId ? `【${name}】` : name;
    });
    this.inventoryLabel.string = `${weapons.join(' / ')}  手榴弹×${player.grenadesRemaining}  血包×${player.medkitsRemaining}`;
  }

  showMovementConfirmed(): void {
    this.messageLabel.string = '移动已生效';
    this.fadeLabel(this.messageLabel, this.presentation.helpVisibleSec);
  }

  showWaveStart(waveIndex: number, totalWaves: number): void {
    this.waveBannerLabel.color = Color.fromHEX(new Color(), '#FFD56A');
    this.waveBannerLabel.string = `第 ${waveIndex} 波进攻开始  /  共 ${totalWaves} 波`;
    this.fadeLabel(this.waveBannerLabel, this.presentation.waveBannerSec);
    // 先用短促程序音效占位，待正式战鼓素材补齐后替换。
    this.playCalloutSound();
  }

  showSupplyDrop(text: string): void {
    this.waveBannerLabel.string = text;
    this.waveBannerLabel.color = Color.fromHEX(
      new Color(),
      this.presentation.supplyColor,
    );
    this.fadeLabel(this.waveBannerLabel, this.presentation.supplyBannerSec);
    // 补给提示复用短音效占位，避免事件只有文字没有听觉反馈。
    this.playCalloutSound();
  }

  showInteraction(text: string): void {
    this.interactionLabel.string = text;
  }

  showMachineGun(machineGun: MachineGunState | undefined): void {
    if (!machineGun) {
      this.machineGunLabel.string = '';
      return;
    }
    const heat = Math.round(machineGun.heatRatio * 100);
    const state = machineGun.isOverheated
      ? '过热冷却中'
      : machineGun.reloadEndsAtMs !== undefined
        ? '弹链装填中'
        : '可开火';
    this.machineGunLabel.string = `九二式  弹链 ${machineGun.beltAmmo}  热量 ${heat}%  ${state}`;
  }

  showSpectating(heroName: string | null): void {
    this.spectatorLabel.string = heroName
      ? `观战：${heroName}  ·  按 Q 切换视角`
      : '全员阵亡，等待战报…';
  }

  hideSpectating(): void {
    this.spectatorLabel.string = '';
  }

  showActionResult(payload: ActionResultPayload): void {
    if (payload.accepted) {
      this.messageLabel.string = `操作成功：${describeAction(payload.action)}`;
      if (payload.action === 'use_medkit') {
        this.medkitConfirmationPending = true;
        this.playMedkitFlash();
      }
      return;
    }
    this.messageLabel.string = `操作失败：${describeAction(payload.action)} · ${describeActionReject(payload.action, payload.rejectReason)}`;
  }

  showMatchEnd(payload: MatchEndPayload, playerId: string | null): void {
    for (const child of this.root.children) {
      child.active = false;
    }
    const report = new Node('MatchReport');
    this.setUiLayer(report);
    report.setParent(this.root);
    const background = report.addComponent(Graphics);
    background.fillColor = Color.fromHEX(new Color(), '#183040');
    background.rect(
      -this.presentation.designWidth / 2,
      -this.presentation.designHeight / 2,
      this.presentation.designWidth,
      this.presentation.designHeight,
    );
    background.fill();
    this.createReportLabel(
      report,
      payload.result === 'victory' ? '坚守成功' : '坚守失败',
      this.presentation.reportTitleFontSizePx,
      this.presentation.matchHudOffsetYPx,
      '#F4E8C1',
    );
    this.createReportLabel(
      report,
      `全队歼敌 ${payload.defeatedEnemies}/${payload.totalEnemies}  ·  已投放 ${payload.spawnedEnemies}`,
      this.presentation.reportLineFontSizePx,
      this.presentation.waveBannerOffsetYPx,
      '#C8F4FF',
    );
    payload.scoreboard.forEach((entry, index) => {
      const isPlayer = entry.occupantId === playerId;
      const mvp = entry.occupantId === payload.mvpPlayerId ? '  ★ MVP' : '';
      const identity = isPlayer ? '（你）' : entry.isBot ? '（AI）' : '';
      const line = `${entry.heroName}${identity}  歼敌 ${entry.kills}  命中率 ${Math.round(entry.accuracy * 100)}%  存活 ${Math.round(entry.survivalSec)}s${mvp}`;
      this.createReportLabel(
        report,
        line,
        this.presentation.reportLineFontSizePx,
        this.presentation.reportFirstLineOffsetYPx -
          index * this.presentation.reportLineGapPx,
        isPlayer ? '#FFD56A' : '#FFFFFF',
      );
    });
    const playerEntry = payload.scoreboard.find(
      (entry) => entry.occupantId === playerId,
    );
    if (playerEntry) {
      const waveSummary = playerEntry.killsByWave
        .map((kills, index) => `第 ${index + 1} 波 ${kills}`)
        .join('  ·  ');
      this.createReportLabel(
        report,
        `你的分波战绩：${waveSummary}`,
        this.presentation.reportLineFontSizePx,
        this.presentation.reportFirstLineOffsetYPx -
          payload.scoreboard.length * this.presentation.reportLineGapPx -
          this.presentation.reportLineGapPx / 2,
        '#FFD56A',
      );
    }
    this.createReportLabel(
      report,
      '向英雄致敬',
      this.presentation.titleFontSizePx,
      -this.presentation.designHeight / 2 + this.presentation.titleFontSizePx,
      '#F4E8C1',
    );
  }

  updateAllies(allies: readonly AllyState[]): void {
    this.allyIds.clear();
    const bots = allies
      .filter((ally) => ally.isBot)
      .slice()
      .sort((first, second) => first.seatIndex - second.seatIndex);
    for (let index = 0; index < bots.length; index += 1) {
      const ally = bots[index];
      if (!ally) {
        continue;
      }
      let label = this.allyLabels.get(index);
      if (!label) {
        label = this.createLabel(
          `AllyStatus${index}`,
          '',
          this.presentation.hudFontSizePx,
          new Vec3(
            this.presentation.allyPanelOffsetXPx,
            this.presentation.allyPanelOffsetYPx -
              index * this.presentation.allyPanelLineGapPx,
            0,
          ),
          '#DCE8B5',
        );
        this.allyLabels.set(index, label);
      }
      const state = ally.hp <= 0
        ? '阵亡'
        : this.describeAllyState(ally.aiState);
      label.string = `${ally.heroName}  ${ally.hp}/${ally.maxHp}  ${ally.routeId}路  ${state}`;
      if (ally.hp <= 0 || !this.flashingAllies.has(ally.id)) {
        label.color = Color.fromHEX(
          new Color(),
          ally.hp <= 0 ? '#899094' : '#DCE8B5',
        );
      }
      this.allyIds.set(ally.id, label);
    }
  }

  updateRouteThreat(
    enemies: readonly EnemyState[],
    serverTimeMs: number,
  ): void {
    const counts: Record<RouteId, number> = { A: 0, B: 0, C: 0 };
    const warnings: Record<RouteId, number> = { A: 0, B: 0, C: 0 };
    for (const enemy of enemies) {
      if (enemy.alive) {
        counts[enemy.routeId] += 1;
        if (
          enemy.fireWarningEndsAtMs !== undefined &&
          enemy.fireWarningEndsAtMs > serverTimeMs
        ) {
          warnings[enemy.routeId] += 1;
        }
      }
    }
    this.routeLabel.string = (['A', 'B', 'C'] as const)
      .map((routeId) => {
        const dots = '●'.repeat(
          Math.min(counts[routeId], this.presentation.routeThreatMaxDots),
        );
        const warning = warnings[routeId] > 0 ? '⚠ ' : '';
        return `${warning}${routeId} ${this.routeNames[routeId]} ${dots || '·'} ${counts[routeId]}`;
      })
      .join('    ');
  }

  showCallout(text: string, routeId: RouteId): void {
    this.calloutLabel.string = `「${text}」`;
    this.fadeLabel(
      this.calloutLabel,
      this.presentation.calloutDurationSec,
    );
    const sequence = this.routeHighlightSequence + 1;
    this.routeHighlightSequence = sequence;
    this.routeLabel.color = Color.fromHEX(
      new Color(),
      this.presentation.fireWarningColor,
    );
    setTimeout(() => {
      if (
        this.routeHighlightSequence === sequence &&
        this.routeLabel.isValid
      ) {
        this.routeLabel.color = Color.WHITE;
      }
    }, this.presentation.routeFlashSec * 1000);
    this.messageLabel.string = `${routeId}路告急！`;
    this.playCalloutSound();
  }

  flashAllyDamage(allyId: string): void {
    const label = this.allyIds.get(allyId);
    if (!label) {
      return;
    }
    this.flashingAllies.add(allyId);
    label.color = Color.fromHEX(
      new Color(),
      this.presentation.fireWarningColor,
    );
    setTimeout(() => {
      this.flashingAllies.delete(allyId);
      if (label.isValid) {
        label.color = Color.fromHEX(new Color(), '#DCE8B5');
      }
    }, this.presentation.hitFeedbackSec * 1000);
  }

  showAllyDied(allyId: string): void {
    this.flashingAllies.delete(allyId);
    const label = this.allyIds.get(allyId);
    if (label) {
      label.color = Color.fromHEX(new Color(), '#899094');
    }
  }

  showShotPending(): void {
    this.messageLabel.string = '';
  }

  showReloadRequested(): void {
    this.messageLabel.string = '已请求换弹';
  }

  showFireResult(payload: FireResultPayload, latencyMs: number): void {
    this.ammoLabel.string = `${this.weaponName}  ${payload.magazineAmmo}/${payload.reserveAmmo}`;
    if (!payload.accepted) {
      this.messageLabel.string = REJECT_TEXT[payload.rejectReason];
      return;
    }
    if (!payload.hit) {
      this.messageLabel.string = '';
      return;
    }

    const precise = payload.hitPart === 'head';
    this.hitLabel.string = precise ? '✦' : '×';
    this.hitLabel.color = Color.fromHEX(
      new Color(),
      precise ? '#FFD56A' : '#FFFFFF',
    );
    this.damageLabel.string = `-${payload.damage}`;
    this.messageLabel.string = payload.isKill
      ? `消灭日军${precise ? ' · 精准射击' : ''}`
      : '';
    this.fadeLabel(this.hitLabel, this.presentation.hitFeedbackSec);
    this.fadeLabel(this.damageLabel, this.presentation.hitFeedbackSec);
    if (payload.isKill) {
      this.fadeLabel(this.messageLabel, this.presentation.killFeedbackSec);
    }
  }

  showDamage(): void {
    Tween.stopAllByTarget(this.vignetteOpacity);
    this.vignetteOpacity.opacity = 255;
    tween(this.vignetteOpacity)
      .to(this.presentation.damageVignetteSec, {
        opacity: this.lowHealthActive
          ? this.presentation.lowHealthVignetteOpacity
          : 0,
      })
      .call(() => {
        if (this.lowHealthActive) {
          this.startLowHealthPulse();
        }
      })
      .start();
  }

  destroy(): void {
    for (const timer of this.temporaryLabelTimers.values()) {
      clearTimeout(timer);
    }
    this.temporaryLabelTimers.clear();
    Tween.stopAllByTarget(this.vignetteOpacity);
    Tween.stopAllByTarget(this.medkitFlashOpacity);
    void this.calloutAudioContext?.close();
    this.calloutAudioContext = null;
    this.root.destroy();
  }

  private updateLowHealthWarning(player: AllyState): void {
    const usableThreshold = player.maxHp - this.gameplay.medkit.carriedHeal;
    const shouldWarn = player.hp > 0 && player.hp <= usableThreshold;
    if (!shouldWarn) {
      if (this.lowHealthActive) {
        this.lowHealthActive = false;
        this.lowHealthLabel.string = '';
        Tween.stopAllByTarget(this.vignetteOpacity);
        this.vignetteOpacity.opacity = 0;
      }
      return;
    }

    const wasActive = this.lowHealthActive;
    this.lowHealthActive = true;
    this.lowHealthLabel.string = player.medkitsRemaining > 0
      ? '生命较低，按 H 使用血包'
      : '生命危险，血包已用完';
    if (!wasActive) {
      this.startLowHealthPulse();
    }
  }

  private startLowHealthPulse(): void {
    if (!this.lowHealthActive) {
      return;
    }
    Tween.stopAllByTarget(this.vignetteOpacity);
    const halfPulseSec = this.presentation.lowHealthPulseSec / 2;
    this.vignetteOpacity.opacity = this.presentation.lowHealthVignetteOpacity;
    tween(this.vignetteOpacity)
      .to(halfPulseSec, {
        opacity: this.presentation.lowHealthPulseOpacity,
      })
      .to(halfPulseSec, {
        opacity: this.presentation.lowHealthVignetteOpacity,
      })
      .repeatForever()
      .start();
  }

  private playMedkitFlash(): void {
    Tween.stopAllByTarget(this.vignetteOpacity);
    this.vignetteOpacity.opacity = 0;
    Tween.stopAllByTarget(this.medkitFlashOpacity);
    this.medkitFlashOpacity.opacity = this.presentation.medkitFlashOpacity;
    tween(this.medkitFlashOpacity)
      .to(this.presentation.medkitFlashSec, { opacity: 0 })
      .call(() => {
        if (this.lowHealthActive) {
          this.startLowHealthPulse();
        }
      })
      .start();
  }

  private describeAllyState(state: AllyAiState | undefined): string {
    switch (state) {
      case 'deploy':
        return '就位中';
      case 'guard':
        return '守备';
      case 'engage':
        return '交战';
      case 'reassign':
        return '补位中';
      case 'dead':
        return '阵亡';
      default:
        return '同步中';
    }
  }

  private playCalloutSound(): void {
    if (typeof AudioContext === 'undefined') {
      return;
    }
    this.calloutAudioContext ??= new AudioContext();
    const context = this.calloutAudioContext;
    void context.resume().catch(() => {
      // 浏览器未收到手势时可能禁止自动音频，字幕和路线闪烁仍正常。
    });
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(
      this.presentation.calloutSoundFrequencyHz,
      context.currentTime,
    );
    gain.gain.setValueAtTime(1, context.currentTime);
    gain.gain.linearRampToValueAtTime(
      0,
      context.currentTime + this.presentation.calloutSoundDurationSec,
    );
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(
      context.currentTime + this.presentation.calloutSoundDurationSec,
    );
  }

  private createCrosshair(): void {
    const node = new Node('Crosshair');
    this.setUiLayer(node);
    node.setParent(this.root);
    // 准心是屏幕空间 UI，固定在设计分辨率中心，不继承世界旋转。
    node.setPosition(0, 0, 0);
    node.setRotationFromEuler(0, 0, 0);
    node.setScale(1, 1, 1);
    const graphics = node.addComponent(Graphics);
    const gap = this.presentation.crosshairGapPx;
    const size = this.presentation.crosshairSizePx;
    graphics.strokeColor = Color.fromHEX(
      new Color(),
      this.presentation.crosshairOutlineColor,
    );
    graphics.lineWidth = this.presentation.crosshairOutlineWidthPx;
    this.strokeCrosshair(graphics, gap, size);
    graphics.strokeColor = Color.WHITE;
    graphics.lineWidth = this.presentation.crosshairLineWidthPx;
    this.strokeCrosshair(graphics, gap, size);
  }

  private strokeCrosshair(
    graphics: Graphics,
    gap: number,
    size: number,
  ): void {
    graphics.moveTo(-gap - size, 0);
    graphics.lineTo(-gap, 0);
    graphics.moveTo(gap, 0);
    graphics.lineTo(gap + size, 0);
    graphics.moveTo(0, -gap - size);
    graphics.lineTo(0, -gap);
    graphics.moveTo(0, gap);
    graphics.lineTo(0, gap + size);
    graphics.stroke();
  }

  private createReportLabel(
    parent: Node,
    text: string,
    fontSize: number,
    y: number,
    colorHex: string,
  ): void {
    const node = new Node('ReportLine');
    this.setUiLayer(node);
    node.setParent(parent);
    node.setPosition(0, y, 0);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.NONE;
    label.color = Color.fromHEX(new Color(), colorHex);
  }

  private createDamageVignette(): UIOpacity {
    const node = new Node('DamageVignette');
    this.setUiLayer(node);
    node.setParent(this.root);
    const graphics = node.addComponent(Graphics);
    graphics.strokeColor = Color.fromHEX(new Color(), '#B62929');
    graphics.lineWidth = this.presentation.crosshairSizePx;
    graphics.rect(
      -this.presentation.designWidth / 2,
      -this.presentation.designHeight / 2,
      this.presentation.designWidth,
      this.presentation.designHeight,
    );
    graphics.stroke();
    const opacity = node.addComponent(UIOpacity);
    opacity.opacity = 0;
    return opacity;
  }

  private createEdgeFlash(colorHex: string): UIOpacity {
    const node = new Node('EdgeFlash');
    this.setUiLayer(node);
    node.setParent(this.root);
    const graphics = node.addComponent(Graphics);
    graphics.strokeColor = Color.fromHEX(new Color(), colorHex);
    graphics.lineWidth = this.presentation.crosshairSizePx;
    graphics.rect(
      -this.presentation.designWidth / 2,
      -this.presentation.designHeight / 2,
      this.presentation.designWidth,
      this.presentation.designHeight,
    );
    graphics.stroke();
    const opacity = node.addComponent(UIOpacity);
    opacity.opacity = 0;
    return opacity;
  }

  private createLabel(
    name: string,
    text: string,
    fontSize: number,
    position: Vec3,
    colorHex: string,
  ): Label {
    const node = new Node(name);
    this.setUiLayer(node);
    node.setParent(this.root);
    node.setPosition(position);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.NONE;
    label.color = Color.fromHEX(new Color(), colorHex);
    node.addComponent(UIOpacity);
    return label;
  }

  private fadeLabel(label: Label, duration: number): void {
    const opacity = label.node.getComponent(UIOpacity);
    if (!opacity) {
      return;
    }
    Tween.stopAllByTarget(opacity);
    opacity.opacity = 255;
    tween(opacity).delay(duration).to(duration, { opacity: 0 }).start();
  }

  /**
   * 中心提示不能常驻遮住准星。计时器只清除自己创建的文本，避免覆盖
   * 期间到达的换弹、击杀等后续反馈。
   */
  private showTemporaryLabel(label: Label, text: string, durationSec: number): void {
    this.clearTemporaryLabel(label);
    label.string = text;
    const timer = setTimeout(() => {
      this.temporaryLabelTimers.delete(label);
      if (label.isValid && label.string === text) {
        label.string = '';
      }
    }, durationSec * 1000);
    this.temporaryLabelTimers.set(label, timer);
  }

  private clearTemporaryLabel(label: Label): void {
    const timer = this.temporaryLabelTimers.get(label);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.temporaryLabelTimers.delete(label);
    }
  }

  private setUiLayer(node: Node): void {
    node.layer = Layers.Enum.UI_2D;
  }
}

function formatTime(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const minuteText = minutes < 10 ? `0${minutes}` : `${minutes}`;
  const secondText = seconds < 10 ? `0${seconds}` : `${seconds}`;
  return `${minuteText}:${secondText}`;
}

function describeAction(action: ActionResultPayload['action']): string {
  switch (action) {
    case 'switch_weapon':
      return '切换武器';
    case 'use_medkit':
      return '使用血包';
    case 'pickup':
      return '拾取';
    case 'mount_mg':
      return '上重机枪';
    case 'unmount_mg':
      return '下重机枪';
    case 'throw_grenade':
      return '投掷手榴弹';
  }
}

function describeActionReject(
  action: ActionResultPayload['action'],
  reason: Extract<ActionResultPayload, { readonly accepted: false }>['rejectReason'],
): string {
  if (action !== 'use_medkit') {
    return reason;
  }
  switch (reason) {
    case 'unavailable':
      return '当前生命值无需使用血包';
    case 'no_resource':
      return '血包已用完';
    case 'invalid_state':
      return '当前状态无法使用血包';
    case 'dead':
      return '阵亡后无法使用血包';
    default:
      return reason;
  }
}
