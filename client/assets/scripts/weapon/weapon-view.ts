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

/**
 * 手持武器（步枪 / 轻机枪）的第一视角构图。
 *
 * 真实的第一视角只能看到枪的前段：枪口、护木、机匣的一部分，
 * 枪托在肩膀上，视野里根本看不见。所以这里不是把整张贴图缩放摆上去，
 * 而是把枪口钉在准心旁，让枪身从准心斜向右下延伸，
 * 枪托那一段自然落到屏幕外面。
 */
interface HandheldComposition {
  /** 枪身倾角，负值表示枪口朝左上抬起、枪托朝右下压。 */
  readonly tiltDeg: number;
  /**
   * 贴图缩放后的宽度占设计分辨率宽度的比例。
   * 注意这是**整根枪**的宽度，实际只有前段留在屏幕内。
   */
  readonly widthRatio: number;
  /**
   * 枪口在贴图内的归一化纵向位置（0=顶边，1=底边）。
   * 由脚本扫描贴图**最左侧**不透明列实测，不要凭感觉填。
   */
  readonly muzzleV: number;
  /** 枪口相对准心的横向留白，正值让枪口停在准心右侧一点。 */
  readonly muzzleGapXPx: number;
  /** 枪口相对准心的纵向留白，负值让枪口略低于准心。 */
  readonly muzzleGapYPx: number;
}

// 仅用于屏幕空间构图，不参与武器数值或服务器判定。
// 倾角约 40°、整枪宽约 0.64 屏宽：枪口钉在准心旁，枪身斜向右下，
// 从屏幕**底边中间偏右**出屏（不是从右边缘出去），
// 屏幕里留下枪的前 60% 左右——枪托和后半段机匣都在屏外，
// 这才是端枪时眼睛看到的样子。数值用 tools 下的几何脚本验过。
const HANDHELD_COMPOSITIONS: Readonly<Record<string, HandheldComposition>> = {
  liaoshi13: {
    tiltDeg: -42,
    widthRatio: 0.64,
    muzzleV: 0.138,
    muzzleGapXPx: 20,
    muzzleGapYPx: -12,
  },
  'lee-enfield': {
    tiltDeg: -42,
    widthRatio: 0.66,
    muzzleV: 0.199,
    muzzleGapXPx: 20,
    muzzleGapYPx: -12,
  },
  // 轻机枪贴图带弹匣和两脚架，纵向占比大，倾角略平一点免得弹匣戳到准心。
  zb26: {
    tiltDeg: -38,
    widthRatio: 0.66,
    muzzleV: 0.397,
    muzzleGapXPx: 22,
    muzzleGapYPx: -14,
  },
  bren: {
    tiltDeg: -38,
    widthRatio: 0.66,
    muzzleV: 0.402,
    muzzleGapXPx: 22,
    muzzleGapYPx: -14,
  },
};

/**
 * 手持物（手榴弹）构图：它不是枪，没有枪口要对准心，
 * 就是握在右手里、举在画面右下角，等着扔出去。
 */
const HELD_ITEM_COMPOSITION = {
  /** 贴图缩放后的高度占屏高比例。 */
  heightRatio: 0.34,
  /** 相对屏幕右下角的内缩，让物件贴角但不裁边。 */
  insetXPx: 160,
  insetYPx: -40,
  /** 略向内倾斜，像握在手里而不是立在桌上。 */
  tiltDeg: 14,
} as const;

/**
 * 架设武器（重机枪）构图。
 *
 * 贴图是**枪口朝右**的侧视图，且三脚架占了贴图高度的 2/3。
 * 第一视角要的是从枪尾往前看、枪口指向准心，所以：
 * 1. 水平镜像，让枪口朝左上方的准心；
 * 2. 只按**枪身本体**（不含三脚架）的高度控制占屏比例，
 *    否则整图缩到 25% 屏高后枪身只剩 8%，像个玩具；
 * 3. 枪口对准心，其余部分（枪身、三脚架）自然落到准心右下方。
 */
interface EmplacementComposition {
  readonly tiltDeg: number;
  /** 枪身本体（不含三脚架）缩放后的高度占屏高比例上限。 */
  readonly bodyHeightRatio: number;
  /** 枪身本体在贴图中的纵向范围（归一化），由脚本扫描逐行填充率得到。 */
  readonly bodyTopV: number;
  readonly bodyBottomV: number;
  /** 枪口在贴图内的归一化纵向位置（镜像前在最右列实测）。 */
  readonly muzzleV: number;
  readonly muzzleGapXPx: number;
  readonly muzzleGapYPx: number;
}

const EMPLACEMENT_COMPOSITIONS: Readonly<
  Record<string, EmplacementComposition>
> = {
  'type92-hmg': {
    tiltDeg: -36,
    bodyHeightRatio: 0.16,
    bodyTopV: 0.04,
    bodyBottomV: 0.33,
    muzzleV: 0.143,
    muzzleGapXPx: 26,
    muzzleGapYPx: -18,
  },
};

const DEFAULT_EMPLACEMENT_COMPOSITION: EmplacementComposition =
  EMPLACEMENT_COMPOSITIONS['type92-hmg'];

const RELOAD_TILT_DELTA_DEG = 3;

export class WeaponView {
  private readonly root: Node;
  private readonly bolt: Node;
  private readonly weaponSpriteNode: Node;
  private readonly weaponSprite: Sprite;
  private readonly placeholderGraphics: Graphics;
  private readonly muzzleFlashNode: Node;
  private readonly muzzleOpacity: UIOpacity;
  private readonly presentation: PresentationConfig;
  private readonly weapons: WeaponsConfig;
  private readonly basePosition: Vec3;
  private readonly boltBasePosition: Vec3;
  private readonly emplacementIds: ReadonlySet<string>;
  private readonly throwableIds: ReadonlySet<string>;
  private currentWeaponId: string | null = null;
  private currentTiltDeg = -20;
  private isEmplacement = false;
  private isThrowable = false;
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
    const throwableIds = new Set<string>();
    for (const weaponId in weapons.player) {
      if (weapons.player[weaponId]?.isThrowable === true) {
        throwableIds.add(weaponId);
      }
    }
    this.throwableIds = throwableIds;
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
    // 武器要压在 HUD 文字**下面**：Cocos UI 按兄弟顺序绘制，后建的盖前建的。
    // HUD 比武器先建，所以把武器挪到 HUD 前面，交互提示、弹药数才不会被枪身盖住。
    const hud = canvas.getChildByName('M1HUD');
    if (hud) {
      this.root.setSiblingIndex(hud.getSiblingIndex());
    }

    this.placeholderGraphics = this.drawRifle();
    this.weaponSpriteNode = new Node('WeaponSprite');
    this.weaponSpriteNode.layer = Layers.Enum.UI_2D;
    this.weaponSpriteNode.setParent(this.root);
    this.weaponSprite = this.weaponSpriteNode.addComponent(Sprite);
    this.weaponSpriteNode.active = false;
    this.bolt = this.createBolt();
    this.boltBasePosition = this.bolt.position.clone();
    this.muzzleFlashNode = this.createMuzzleFlash();
    const muzzleOpacity = this.muzzleFlashNode.getComponent(UIOpacity);
    if (!muzzleOpacity) {
      throw new Error('枪口闪光节点缺少 UIOpacity');
    }
    this.muzzleOpacity = muzzleOpacity;
    this.setWeapon(defaultWeaponId);
  }

  setWeapon(weaponId: string): void {
    if (this.currentWeaponId === weaponId && this.weaponSprite.spriteFrame) {
      return;
    }
    this.currentWeaponId = weaponId;
    this.isEmplacement = this.emplacementIds.has(weaponId);
    this.isThrowable = this.throwableIds.has(weaponId);
    const handheld =
      HANDHELD_COMPOSITIONS[weaponId] ?? HANDHELD_COMPOSITIONS.liaoshi13;
    const emplacement =
      EMPLACEMENT_COMPOSITIONS[weaponId] ?? DEFAULT_EMPLACEMENT_COMPOSITION;
    this.currentTiltDeg = this.isEmplacement
      ? emplacement.tiltDeg
      : this.isThrowable
        ? HELD_ITEM_COMPOSITION.tiltDeg
        : handheld.tiltDeg;
    this.root.setRotationFromEuler(0, 0, this.currentTiltDeg);
    // 枪口闪光和枪机只对「有枪口的枪」有意义；手榴弹一个都不该有。
    this.muzzleFlashNode.active = !this.isThrowable;
    this.bolt.active = !this.isEmplacement && !this.isThrowable;
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
        const width = frame.rect.width;
        const height = frame.rect.height;
        if (this.isEmplacement) {
          this.layoutEmplacement(emplacement, width, height);
        } else if (this.isThrowable) {
          this.layoutHeldItem(width, height);
        } else {
          this.layoutHandheld(handheld, width, height);
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
   * 枪身另一头（枪托）会因为 widthRatio > 1 自然落到屏幕外。
   */
  private layoutHandheld(
    composition: HandheldComposition,
    sourceWidth: number,
    sourceHeight: number,
  ): void {
    const targetWidth = this.presentation.designWidth * composition.widthRatio;
    const scale = targetWidth / Math.max(1, sourceWidth);
    this.weaponSpriteNode.setScale(scale, scale, 1);
    this.weaponSpriteNode.setPosition(0, 0, 0);
    this.pinMuzzleToCrosshair(
      sourceWidth * scale,
      sourceHeight * scale,
      composition.muzzleV,
      composition.muzzleGapXPx,
      composition.muzzleGapYPx,
    );
    this.placeMuzzleFlashAtMuzzle(
      sourceWidth * scale,
      sourceHeight * scale,
      composition.muzzleV,
    );
  }

  /**
   * 把贴图最左侧、纵向 muzzleV 处的「枪口点」钉到准心旁。
   * 根节点已经带旋转，所以枪口相对根节点的位移要过一遍旋转矩阵。
   */
  private pinMuzzleToCrosshair(
    scaledWidth: number,
    scaledHeight: number,
    muzzleV: number,
    gapXPx: number,
    gapYPx: number,
  ): void {
    // Sprite 以自身中心为原点，枪口相对中心的局部偏移：
    // 横向在最左端，纵向由 muzzleV 决定（贴图 V 轴向下，屏幕 Y 轴向上）。
    const localX = -scaledWidth / 2;
    const localY = (0.5 - muzzleV) * scaledHeight;
    const radians = (this.currentTiltDeg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const rotatedX = localX * cos - localY * sin;
    const rotatedY = localX * sin + localY * cos;
    // 让「根节点 + 旋转后位移」正好落在准心旁的目标点上。
    this.basePosition.set(gapXPx - rotatedX, gapYPx - rotatedY, 0);
    this.root.setPosition(this.basePosition);
  }

  /** 枪口闪光要长在真正的枪口上，而不是占位矩形算出来的老位置。 */
  private placeMuzzleFlashAtMuzzle(
    scaledWidth: number,
    scaledHeight: number,
    muzzleV: number,
  ): void {
    this.muzzleFlashNode.setPosition(
      -scaledWidth / 2,
      (0.5 - muzzleV) * scaledHeight,
      0,
    );
  }

  /**
   * 架设武器（重机枪）构图：水平镜像让枪口朝左，
   * 按枪身本体高度定缩放，再把枪口钉到准心旁。
   * 三脚架和枪尾会落到准心右下方，视野中央和上方保持干净。
   */
  private layoutEmplacement(
    composition: EmplacementComposition,
    sourceWidth: number,
    sourceHeight: number,
  ): void {
    const designHeight = this.presentation.designHeight;
    const bodyHeightPx =
      sourceHeight * (composition.bodyBottomV - composition.bodyTopV);
    const scale =
      (designHeight * composition.bodyHeightRatio) / Math.max(1, bodyHeightPx);
    // 贴图原图枪口朝右，X 轴取负做水平镜像，枪口就朝向左上方的准心了。
    this.weaponSpriteNode.setScale(-scale, scale, 1);
    this.weaponSpriteNode.setPosition(0, 0, 0);
    // 镜像后原来的最右列变成最左列，muzzleV 是纵向的，不受镜像影响。
    this.pinMuzzleToCrosshair(
      sourceWidth * scale,
      sourceHeight * scale,
      composition.muzzleV,
      composition.muzzleGapXPx,
      composition.muzzleGapYPx,
    );
    this.placeMuzzleFlashAtMuzzle(
      sourceWidth * scale,
      sourceHeight * scale,
      composition.muzzleV,
    );
  }

  /**
   * 手持物（手榴弹）构图：按高度缩放后放在画面右下角，
   * 不对准心——它没有枪口，也不该挡住准心。
   */
  private layoutHeldItem(sourceWidth: number, sourceHeight: number): void {
    const designWidth = this.presentation.designWidth;
    const designHeight = this.presentation.designHeight;
    const scale =
      (designHeight * HELD_ITEM_COMPOSITION.heightRatio) /
      Math.max(1, sourceHeight);
    this.weaponSpriteNode.setScale(scale, scale, 1);
    this.weaponSpriteNode.setPosition(0, 0, 0);
    const scaledWidth = sourceWidth * scale;
    const scaledHeight = sourceHeight * scale;
    this.basePosition.set(
      designWidth / 2 - HELD_ITEM_COMPOSITION.insetXPx - scaledWidth / 2,
      -designHeight / 2 + scaledHeight / 2 + HELD_ITEM_COMPOSITION.insetYPx,
      0,
    );
    this.root.setPosition(this.basePosition);
  }

  playFire(): void {
    Tween.stopAllByTarget(this.root);
    Tween.stopAllByTarget(this.bolt);
    Tween.stopAllByTarget(this.muzzleOpacity);

    this.root.setPosition(this.basePosition);
    const recoilPx = this.presentation.weaponRecoilPx;
    // 手榴弹是「扔」不是「打」：手往前上方甩一下，没有后坐力。
    // 架设重机枪固定在枪架上只做纵向轻微下沉，横向乱窜会让人觉得枪没固定住。
    // 手持枪械沿枪身方向往后（右下）退。
    const recoilOffset = this.isThrowable
      ? new Vec3(
          this.basePosition.x - recoilPx * 2,
          this.basePosition.y + recoilPx * 3,
          0,
        )
      : this.isEmplacement
        ? new Vec3(this.basePosition.x, this.basePosition.y - recoilPx * 0.5, 0)
        : new Vec3(
            this.basePosition.x + recoilPx,
            this.basePosition.y - recoilPx,
            0,
          );
    tween(this.root)
      .to(this.presentation.weaponRecoilSec, { position: recoilOffset })
      .to(this.presentation.weaponRecoilSec, {
        position: this.basePosition.clone(),
      })
      .start();

    // 只有手动枪机的步枪才有枪机行程；重机枪弹链供弹、手榴弹没有枪机。
    if (this.bolt.active) {
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
    }

    if (this.muzzleFlashNode.active) {
      this.muzzleOpacity.opacity = 255;
      tween(this.muzzleOpacity)
        .to(this.presentation.muzzleFlashSec, { opacity: 0 })
        .start();
      this.playPlaceholderSound();
    }
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

  private createMuzzleFlash(): Node {
    const node = new Node('MuzzleFlash');
    node.layer = Layers.Enum.UI_2D;
    node.setParent(this.root);
    // 初始位置对应占位矩形的枪口；贴图加载后会挪到真实枪口。
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
    return node;
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
