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
  readonly tiltDeg: number;
  readonly widthFactor: number;
}

// 仅用于屏幕空间构图，不参与武器数值或服务器判定。
const WEAPON_COMPOSITIONS: Readonly<Record<string, WeaponComposition>> = {
  liaoshi13: { tiltDeg: -16, widthFactor: 1 },
  'lee-enfield': { tiltDeg: -17, widthFactor: 1.08 },
  zb26: { tiltDeg: -13, widthFactor: 1.05 },
  bren: { tiltDeg: -13, widthFactor: 1.03 },
  grenade: { tiltDeg: -24, widthFactor: 0.62 },
  'type92-hmg': { tiltDeg: -10, widthFactor: 1.18 },
};
const RELOAD_TILT_DELTA_DEG = 3;
const WEAPON_ANCHOR_X_BIAS_PX = -210;
const WEAPON_ANCHOR_Y_BIAS_PX = 18;

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
  private currentWeaponId: string | null = null;
  private currentTiltDeg = -16;
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
    this.root = new Node('RiflePlaceholder');
    this.root.layer = Layers.Enum.UI_2D;
    this.basePosition = new Vec3(
      presentation.weaponOffsetXPx + WEAPON_ANCHOR_X_BIAS_PX,
      presentation.weaponOffsetYPx + WEAPON_ANCHOR_Y_BIAS_PX,
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
    if (this.currentWeaponId === weaponId && this.weaponSprite.spriteFrame) {
      return;
    }
    this.currentWeaponId = weaponId;
    const composition = WEAPON_COMPOSITIONS[weaponId] ?? WEAPON_COMPOSITIONS.liaoshi13;
    this.currentTiltDeg = composition.tiltDeg;
    this.root.setRotationFromEuler(0, 0, this.currentTiltDeg);
    const weapon = this.weapons.player[weaponId] ?? this.weapons.emplacement[weaponId];
    const spritePath = weapon?.assets.firstPerson;
    const generation = ++this.loadGeneration;
    if (!spritePath) {
      this.weaponSpriteNode.active = false;
      this.placeholderGraphics.enabled = true;
      return;
    }
    loadSpriteFrame(spritePath, (frame) => {
      if (!this.root.isValid || generation !== this.loadGeneration) {
        return;
      }
      this.weaponSprite.spriteFrame = frame;
      this.weaponSpriteNode.active = true;
      this.placeholderGraphics.enabled = false;
      const sourceWidth = Math.max(1, frame.rect.width);
      const targetWidth =
        this.presentation.weaponLengthPx +
        this.presentation.weaponBarrelLengthPx;
      const scale = (targetWidth * composition.widthFactor) / sourceWidth;
      this.weaponSpriteNode.setScale(scale, scale, 1);
    });
  }

  playFire(): void {
    Tween.stopAllByTarget(this.root);
    Tween.stopAllByTarget(this.bolt);
    Tween.stopAllByTarget(this.muzzleOpacity);

    this.root.setPosition(this.basePosition);
    tween(this.root)
      .to(this.presentation.weaponRecoilSec, {
        position: new Vec3(
          this.basePosition.x + this.presentation.weaponRecoilPx,
          this.basePosition.y - this.presentation.weaponRecoilPx,
          0,
        ),
      })
      .to(this.presentation.weaponRecoilSec, {
        position: this.basePosition.clone(),
      })
      .start();

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
