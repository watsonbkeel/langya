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
  AllyAiState,
  AllyState,
  EnemyState,
  FireRejectReason,
  FireResultPayload,
  RouteId,
  WeaponState,
} from '../../../../shared/protocol';
import type {
  PresentationConfig,
  WavesConfig,
} from '../config/game-config';
import type { ConnectionStatus } from '../net/net-client';

const REJECT_TEXT: Readonly<Record<FireRejectReason, string>> = {
  not_joined: '尚未加入战斗',
  invalid_weapon: '武器无效',
  invalid_origin: '射击位置需要校正',
  invalid_direction: '矄准方向无效',
  cooldown: '枪机未就绪',
  empty_magazine: '弹仓已空，请换弹',
  reloading: '正在换弹',
  dead: '已无法开火',
};

export class M1Hud {
  private readonly root: Node;
  private readonly presentation: PresentationConfig;
  private readonly connectionLabel: Label;
  private readonly healthLabel: Label;
  private readonly ammoLabel: Label;
  private readonly messageLabel: Label;
  private readonly hitLabel: Label;
  private readonly damageLabel: Label;
  private readonly vignetteOpacity: UIOpacity;
  private readonly routeLabel: Label;
  private readonly calloutLabel: Label;
  private readonly allyLabels = new Map<number, Label>();
  private readonly allyIds = new Map<string, Label>();
  private readonly flashingAllies = new Set<string>();
  private readonly routeNames: Readonly<Record<RouteId, string>>;
  private weaponName = '步枪';
  private routeHighlightSequence = 0;
  private calloutAudioContext: AudioContext | null = null;

  constructor(
    canvas: Node,
    presentation: PresentationConfig,
    waves: WavesConfig,
  ) {
    this.presentation = presentation;
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
      'M2 五人防线 · 服务器权威 AI',
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
    this.createLabel(
      'Help',
      '点击画面锁定鼠标  |  WASD 移动  |  左键射击  |  R 换弹  |  Ctrl 蹲下',
      presentation.hudFontSizePx,
      new Vec3(0, presentation.helpOffsetYPx, 0),
      '#DDE7EA',
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

    this.createCrosshair();
    this.vignetteOpacity = this.createDamageVignette();
  }

  renderConnection(status: ConnectionStatus): void {
    switch (status.kind) {
      case 'connecting':
        this.connectionLabel.string = '正在连接…';
        break;
      case 'measuring':
        this.connectionLabel.string = '已连接，正在测量延迟…';
        break;
      case 'connected':
        this.connectionLabel.string = `已连接，延迟 ${status.latencyMs} ms`;
        break;
      case 'disconnected':
        this.connectionLabel.string = '连接已断开';
        break;
      case 'error':
        this.connectionLabel.string = `连接失败：${status.message}`;
        break;
    }
  }

  updatePlayer(player: AllyState, weaponName: string): void {
    this.weaponName = weaponName;
    this.healthLabel.string = `生命 ${player.hp}/${player.maxHp}`;
    this.updateAmmo(player.weapon);
  }

  updateAmmo(weapon: WeaponState): void {
    const state = weapon.isReloading ? ' · 换弹中…' : '';
    this.ammoLabel.string = `${this.weaponName}  ${weapon.magazineAmmo}/${weapon.reserveAmmo}${state}`;
  }

  showReady(enemyCount: number): void {
    this.messageLabel.string = `敌人 ${enemyCount}  · 所有伤害等待服务器裁决`;
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
    this.messageLabel.string = '已开火，等待服务器裁决…';
  }

  showReloadRequested(): void {
    this.messageLabel.string = '已请求换弹';
  }

  showFireResult(payload: FireResultPayload, latencyMs: number): void {
    this.ammoLabel.string = `${this.weaponName}  ${payload.magazineAmmo}/${payload.reserveAmmo}`;
    if (!payload.accepted) {
      this.messageLabel.string = `${REJECT_TEXT[payload.rejectReason]} · ${latencyMs} ms`;
      return;
    }
    if (!payload.hit) {
      this.messageLabel.string = `未命中 · 裁决 ${latencyMs} ms`;
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
      ? `消灭日军${precise ? ' · 精准射击' : ''} · ${latencyMs} ms`
      : `命中 ${payload.damage} · 裁决 ${latencyMs} ms`;
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
      .to(this.presentation.damageVignetteSec, { opacity: 0 })
      .start();
  }

  destroy(): void {
    void this.calloutAudioContext?.close();
    this.calloutAudioContext = null;
    this.root.destroy();
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
    const graphics = node.addComponent(Graphics);
    graphics.strokeColor = Color.WHITE;
    graphics.lineWidth = this.presentation.crosshairLineWidthPx;
    const gap = this.presentation.crosshairGapPx;
    const size = this.presentation.crosshairSizePx;
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

  private setUiLayer(node: Node): void {
    node.layer = Layers.Enum.UI_2D;
  }
}
