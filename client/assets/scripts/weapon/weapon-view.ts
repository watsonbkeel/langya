import {
  Color,
  Graphics,
  Layers,
  Node,
  Sprite,
  tween,
  Tween,
  UIOpacity,
  Vec3,
} from 'cc';

import type {
  PresentationConfig,
  WeaponsConfig,
} from '../config/game-config';
import { loadSpriteFrame } from '../core/billboard';

interface WeaponComposition {
  /** 枪身在屏幕上的倾角，负值表示枪口朝左上方抬起。 */
  readonly tiltDeg: number;
  /** 目标宽度占设计分辨率宽度的比例。 */
  readonly widthRatio: number;
  /**
   * 枪口在贴图内的归一化纵向位置（0=贴图顶边，1=贴图底边）。
   * 用于把枪口精确对齐到准心，而不是靠拍脑袋的像素偏移。
   */
  readonly muzzleV: number;
  /** 枪口相对准心的横向留白，正值表示枪口停在准心右下方一点。 */
  readonly muzzleGapXPx: number;
  /** 枪口相对准心的纵向留白，负值表示枪口略低于准心。 */
  readonly muzzleGapYPx: number;
}

// 仅用于屏幕空间构图，不参与武器数值或服务器判定。
// muzzleV 取自贴图实测：用脚本扫描最左侧不透明列的中点纵坐标。
const WEAPON_COMPOSITIONS: Readonly<Record<string, WeaponComposition>> = {
  liaoshi13: {
    tiltDeg: -20,
    widthRatio: 0.62,
    muzzleV: 0.138,
    muzzleGapXPx: 26,
    muzzleGapYPx: -18,
  },
  'lee-enfield': {
    tiltDeg: -20,
    widthRatio: 0.64,
    muzzleV: 0.14,
    muzzleGapXPx: 26,
    muzzleGapYPx: -18,
  },
  zb26: {
    tiltDeg: -18,
    widthRatio: 0.66,
    muzzleV: 0.16,
    muzzleGapXPx: 28,
    muzzleGapYPx: -20,
  },
  bren: {
    tiltDeg: -18,
    widthRatio: 0.66,
    muzzleV: 0.16,
    muzzleGapXPx: 28,
    muzzleGapYPx: -20,
  },
  grenade: {
    tiltDeg: -26,
    widthRatio: 0.34,
    muzzleV: 0.5,
    muzzleGapXPx: 40,
    muzzleGapYPx: -40,
  },
  // 重机枪是架设武器，走另一套居中构图，这里的值只作兜底。
  'type92-hmg': {
    tiltDeg: 0,
    widthRatio: 0.52,
    muzzleV: 0.176,
    muzzleGapXPx: 0,
    muzzleGapYPx: 0,
  },
};

/** 架设武器（重机枪）在屏幕上的构图约束。 */
const EMPLACEMENT_COMPOSITION = {
  /** 枪身最大占屏高比例，PRD 要求不超过 25%，避免挡住视野。 */
  maxHeightRatio: 0.25,
  /** 枪身最大占屏宽比例。 */
  maxWidthRatio: 0.52,
  /**
   * 枪口顶端与屏幕中心（准心）之间保留的空白，
   * 保证准心下方能看见敌人，不然没法瞄准。
   */
  muzzleGapBelowCrosshairPx: 46,
} as const;

const RELOAD_TILT_DELTA_DEG = 3;

export class WeaponView {
  private readonly root: Node;
  private readonly bolt: Node;
  private readonly weaponSpriteNode: Node;
  private readonly weaponSprite: Sprite;
  private readonly placeholderGraphics: Graphics;
  private readonly muzzleOpacity: UIOpacity;
  private readonly presentation: PresentationConfig;
  private readonly weapons: WeaponsConfig;
  private readonly basePosition: Vec3;
  private readonly boltBasePosition: Vec3;
  private readonly emplacementIds: ReadonlySet<string>;
  private currentWeaponId: string | null = null;
  private currentTiltDeg = -20;
  private isEmplacement = false;
  private loadGeneration = 0;
  private audioContext: AudioContext | null = null;

  constructor(
    canvas: Node,
    presentation: PresentationConfig,
    weapons: WeaponsConfig,
    defaultWeaponId: string,
  ) {
    this.presentation = presentation;
    this.weapons = weapons;
    this.emplacementIds = new Set(Object.keys(weapons.emplacement));
    this.root = new Node('WeaponView');
    this.root.layer = Layers.Enum.UI_2D;
    // 初始位置只是占位，贴图加载完后由 layoutHandheld /
    // layoutEmplacement 根据实际尺寸把枪口对齐到准心。
    this.basePosition = new Vec3(
      presentation.weaponOffsetXPx,
      presentation.weaponOffsetYPx,
      0,
    );
    this.root.setPosition(this.basePosition);
    this.root.setRotationFromEuler(0, 0, this.currentTiltDeg);
    this.root.setParent(canvas);

    this.placeholderGraphics = this.drawRifle();
    this.weaponSpriteNode = new Node('WeaponSprite');
    this.weaponSpriteNode.layer = Layers.Enum.UI_2D;
    this.weaponSpriteNode.setParent(this.root);
    this.weaponSprite = this.weaponSpriteNode.addComponent(Sprite);
    this.weaponSpriteNode.active = false;
    this.bolt = this.createBolt();
    this.boltBasePosition = this.bolt.position.clone();
    this.muzzleOpacity = this.createMuzzleFlash();
    this.setWeapon(defaultWeaponId);
  }

  setWeapon(weaponId: string): void {
    if (
      this.currentWeaponId === weaponId &&
      this.weaponSprite.spriteFrame &&
      this.isEmplacement === this.emplacementIds.has(weaponId)
    ) {
      return;
    }
    this.currentWeaponId = weaponId;
    this.isEmplacement = this.emplacementIds.has(weaponId);
    const composition =
      WEAPON_COMPOSITIONS[weaponId] ?? WEAPON_COMPOSITIONS.liaoshi13;
    this.currentTiltDeg = this.isEmplacement ? 0 : composition.tiltDeg;
    this.root.setRotationFromEuler(0, 0, this.currentTiltDeg);
    const weapon =
      this.weapons.player[weaponId] ?? this.weapons.emplacement[weaponId];
    const spritePath = weapon?.assets.firstPerson;
    const generation = ++this.loadGeneration;
    if (!spritePath) {
      this.weaponSpriteNode.active = false;
      this.placeholderGraphics.enabled = true;
      return;
    }
    loadSpriteFrame(
      spritePath,
      (frame) => {
        if (!this.root.isValid || generation !== this.loadGeneration) {
          return;
        }
        this.weaponSprite.spriteFrame = frame;
        this.weaponSpriteNode.active = true;
        this.placeholderGraphics.enabled = false;
        if (this.isEmplacement) {
          this.layoutEmplacement(frame.rect.width, frame.rect.height);
        } else {
          this.layoutHandheld(
            composition,
            frame.rect.width,
            frame.rect.height,
          );
        }
      },
      () => {
        // 贴图缺失时保留占位图形，不留一块空白让玩家以为武器丢了。
        if (!this.root.isValid || generation !== this.loadGeneration) {
          return;
        }
        this.weaponSpriteNode.active = false;
        this.placeholderGraphics.enabled = true;
      },
    );
  }

  /**
   * 手持武器构图：先按目标宽度缩放，再把「枪口」平移到准心附近。
   *
   * 关键点是枪口位置要在**旋转之后**的屏幕坐标里算。
   * 贴图里枪口在最左侧、纵向位于 muzzleV 处，旋转 tiltDeg 后
   * 该点会跑到别处，所以要用旋转矩阵反推根节点该放在哪里。
   */
  private layoutHandheld(
    composition: WeaponComposition,
    sourceWidth: number,
    sourceHeight: number,
  ): void {
    const targetWidth = this.presentation.designWidth * composition.widthRatio;
    const scale = targetWidth / Math.max(1, sourceWidth);
    this.weaponSpriteNode.setScale(scale, scale, 1);
    this.weaponSpriteNode.setPosition(0, 0, 0);

    const scaledWidth = sourceWidth * scale;
    const scaledHeight = sourceHeight * scale;
    // Sprite 以自身中心为原点，枪口相对中心的局部偏移：
    // 横向在最左端，纵向由 muzzleV 决定（贴图 V 轴向下，屏幕 Y 轴向上）。
    const localX = -scaledWidth / 2;
    const localY = (0.5 - composition.muzzleV) * scaledHeight;
    const radians = (this.currentTiltDeg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    // 旋转后枪口相对根节点的位移。
    const rotatedX = localX * cos - localY * sin;
    const rotatedY = localX * sin + localY * cos;
    // 让「根节点 + 旋转后位移」正好落在准心旁的目标点上。
    this.basePosition.set(
      composition.muzzleGapXPx - rotatedX,
      composition.muzzleGapYPx - rotatedY,
      0,
    );
    this.root.setPosition(this.basePosition);
  }

  /**
   * 架设武器（重机枪）构图：水平居中、贴在屏幕下方，
   * 枪口顶端停在准心下方一段距离，既能看清准心也能看见敌人。
   */
  private layoutEmplacement(
    sourceWidth: number,
    sourceHeight: number,
  ): void {
    const designWidth = this.presentation.designWidth;
    const designHeight = this.presentation.designHeight;
    // 同时受限于「占屏高不超过 25%」和「占屏宽不超过 52%」，取更严的那个。
    const scaleByHeight =
      (designHeight * EMPLACEMENT_COMPOSITION.maxHeightRatio) /
      Math.max(1, sourceHeight);
    const scaleByWidth =
      (designWidth * EMPLACEMENT_COMPOSITION.maxWidthRatio) /
      Math.max(1, sourceWidth);
    const scale = Math.min(scaleByHeight, scaleByWidth);
    this.weaponSpriteNode.setScale(scale, scale, 1);
    this.weaponSpriteNode.setPosition(0, 0, 0);

    const scaledHeight = sourceHeight * scale;
    // 枪身顶边落在准心下方 muzzleGapBelowCrosshairPx 处。
    const topY = -EMPLACEMENT_COMPOSITION.muzzleGapBelowCrosshairPx;
    let centerY = topY - scaledHeight / 2;
    // 若这样摆会让枪身悬在半空（底边离屏幕下沿还很远），
    // 就把它压到贴着下沿，看起来才像架在枪座上而不是飘着。
    const bottomLimit = -designHeight / 2;
    const bottomY = centerY - scaledHeight / 2;
    if (bottomY > bottomLimit) {
      centerY = bottomLimit + scaledHeight / 2;
    }
    this.basePosition.set(0, centerY, 0);
    this.root.setPosition(this.basePosition);
  }

  playFire(): void {
    Tween.stopAllByTarget(this.root);
    Tween.stopAllByTarget(this.bolt);
    Tween.stopAllByTarget(this.muzzleOpacity);

    this.root.setPosition(this.basePosition);
    // 手持武器斜向后坐（往右下退），架设重机枪固定在枪架上，
    // 只做纵向轻微下沉，横向乱窜会让人觉得枪没固定住。
    const recoilOffset = this.isEmplacement
      ? new Vec3(
          this.basePosition.x,
          this.basePosition.y - this.presentation.weaponRecoilPx * 0.5,
          0,
        )
      : new Vec3(
          this.basePosition.x + this.presentation.weaponRecoilPx,
          this.basePosition.y - this.presentation.weaponRecoilPx,
          0,
        );
    tween(this.root)
      .to(this.presentation.weaponRecoilSec, { position: recoilOffset })
      .to(this.presentation.weaponRecoilSec, {
        position: this.basePosition.clone(),
      })
      .start();

    // 重机枪是弹链供弹，没有手动枪机行程，隐藏这个占位件。
    this.bolt.active = !this.isEmplacement;
    this.bolt.setPosition(this.boltBasePosition);
    tween(this.bolt)
      .to(this.presentation.boltCycleSec / 2, {
        position: new Vec3(
          this.boltBasePosition.x + this.presentation.boltTravelPx,
          this.boltBasePosition.y,
          0,
        ),
      })
      .to(this.presentation.boltCycleSec / 2, {
        position: this.boltBasePosition.clone(),
      })
      .start();

    this.muzzleOpacity.opacity = 255;
    tween(this.muzzleOpacity)
      .to(this.presentation.muzzleFlashSec, { opacity: 0 })
      .start();
    this.playPlaceholderSound();
  }

  playReload(): void {
    Tween.stopAllByTarget(this.root);
    this.root.setRotationFromEuler(0, 0, this.currentTiltDeg);
    tween(this.root)
      .to(this.presentation.boltCycleSec, {
        eulerAngles: new Vec3(
          0,
          0,
          this.currentTiltDeg - RELOAD_TILT_DELTA_DEG,
        ),
      })
      .to(this.presentation.boltCycleSec, {
        eulerAngles: new Vec3(0, 0, this.currentTiltDeg),
      })
      .start();
  }

  setVisible(visible: boolean): void {
    this.root.active = visible;
  }

  destroy(): void {
    void this.audioContext?.close();
    this.audioContext = null;
    this.root.destroy();
  }

  private drawRifle(): Graphics {
    const graphics = this.root.addComponent(Graphics);
    graphics.fillColor = Color.fromHEX(new Color(), '#6B7A45');
    graphics.rect(
      -this.presentation.weaponLengthPx / 2,
      -this.presentation.weaponHeightPx / 2,
      this.presentation.weaponLengthPx,
      this.presentation.weaponHeightPx,
    );
    graphics.fill();

    graphics.fillColor = Color.fromHEX(new Color(), '#30383D');
    graphics.rect(
      -this.presentation.weaponLengthPx / 2 -
        this.presentation.weaponBarrelLengthPx,
      -this.presentation.weaponHeightPx / 4,
      this.presentation.weaponBarrelLengthPx,
      this.presentation.weaponHeightPx / 2,
    );
    graphics.fill();
    return graphics;
  }

  private createBolt(): Node {
    const node = new Node('Bolt');
    node.layer = Layers.Enum.UI_2D;
    node.setParent(this.root);
    node.setPosition(this.presentation.weaponLengthPx / 4, 0, 0);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = Color.fromHEX(new Color(), '#D4C49A');
    graphics.rect(
      -this.presentation.weaponHeightPx / 2,
      -this.presentation.weaponHeightPx / 3,
      this.presentation.weaponHeightPx,
      (this.presentation.weaponHeightPx * 2) / 3,
    );
    graphics.fill();
    return node;
  }

  private createMuzzleFlash(): UIOpacity {
    const node = new Node('MuzzleFlash');
    node.layer = Layers.Enum.UI_2D;
    node.setParent(this.root);
    node.setPosition(
      -this.presentation.weaponLengthPx / 2 -
        this.presentation.weaponBarrelLengthPx,
      0,
      0,
    );
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = Color.fromHEX(new Color(), '#FFD36A');
    graphics.circle(0, 0, this.presentation.muzzleFlashRadiusPx);
    graphics.fill();
    const opacity = node.addComponent(UIOpacity);
    opacity.opacity = 0;
    return opacity;
  }

  private playPlaceholderSound(): void {
    if (typeof AudioContext === 'undefined') {
      return;
    }
    this.audioContext ??= new AudioContext();
    const context = this.audioContext;
    void context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(
      this.presentation.placeholderShotFrequencyHz,
      context.currentTime,
    );
    gain.gain.setValueAtTime(1, context.currentTime);
    gain.gain.linearRampToValueAtTime(
      0,
      context.currentTime + this.presentation.placeholderShotDurationSec,
    );
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(
      context.currentTime + this.presentation.placeholderShotDurationSec,
    );
  }
}
