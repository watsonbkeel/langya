import {
  Color,
  Material,
  Mesh,
  MeshRenderer,
  Node,
  primitives,
  Texture2D,
  utils,
  Vec3,
} from 'cc';

import type {
  AllyAiState,
  AllyState,
} from '../../../../shared/protocol';
import { playerEyeHeightM } from '../config/game-config';
import type {
  GameplayConfig,
  PresentationConfig,
} from '../config/game-config';
import {
  createBillboard,
  createBillboardMaterial,
  createBillboardMesh,
  combatSpritePath,
  createSoftShadowMaterial,
  faceBillboardToCamera,
  loadTexture,
  spriteStatePath,
} from '../core/billboard';

interface HumanTrace {
  magazineAmmo: number;
  x: number;
  z: number;
  firedUntilMs: number;
  movedUntilMs: number;
}

/** 两帧之间位移平方超过此值才算「在跑」，滤掉服务端浮点抖动。 */
const HUMAN_MOVE_EPSILON_M2 = 0.02 * 0.02;

export class AllyRenderer {
  private readonly root: Node;
  private readonly mesh: Mesh;
  private readonly allyMaterial: Material;
  private readonly engageMaterial: Material;
  private readonly damagedMaterial: Material;
  private readonly billboardMesh: Mesh;
  private readonly billboardMaterials: Readonly<Record<'idle' | 'run' | 'fire', Material>>;
  private readonly shadowMaterial: Material;
  private readonly gameplay: GameplayConfig;
  private readonly presentation: PresentationConfig;
  private readonly spritePaths: Readonly<Record<'idle' | 'run' | 'fire', string>>;
  private readonly heroSpritePaths: Readonly<Record<string, string>>;
  private readonly heroMaterials = new Map<string, Readonly<Record<'idle' | 'run' | 'fire', Material>>>();
  private readonly textures = new Map<'idle' | 'run' | 'fire', Texture2D>();
  // 记录哪些英雄的哪些状态贴图确实加载成功了。
  // 只有真正拿到纹理的材质才允许被选用，否则回退到通用中国军人立绘，
  // 避免材质停留在引擎缺省灰贴图（就是场上那个会移动的灰色方块）。
  private readonly heroTextureReady = new Map<string, Set<'idle' | 'run' | 'fire'>>();
  private idleTextureLoaded = false;
  private cameraNode: Node | null = null;
  private readonly nodes = new Map<string, Node>();
  private readonly heroNameByNode = new Map<string, string>();
  private readonly states = new Map<string, AllyAiState>();
  private readonly targetPositions = new Map<string, Vec3>();
  private readonly targetScales = new Map<string, Vec3>();
  private readonly interpolationPosition = new Vec3();
  private readonly interpolationScale = new Vec3();
  // 其他真人玩家没有 aiState，表现状态从连续快照推导：
  // 弹匣数下降 = 刚开火；位置有位移 = 在跑动；否则守备。
  private readonly humanTraces = new Map<string, HumanTrace>();

  constructor(
    sceneRoot: Node,
    gameplay: GameplayConfig,
    presentation: PresentationConfig,
    allySpritePath: string,
    heroSpritePaths: Readonly<Record<string, string>> = {},
  ) {
    this.gameplay = gameplay;
    this.presentation = presentation;
    const baseSpritePath = combatSpritePath(allySpritePath);
    this.spritePaths = {
      idle: spriteStatePath(baseSpritePath, 'idle'),
      run: spriteStatePath(baseSpritePath, 'run'),
      fire: spriteStatePath(baseSpritePath, 'fire'),
    };
    const normalizedHeroPaths: Record<string, string> = {};
    for (const heroName in heroSpritePaths) {
      normalizedHeroPaths[heroName] = combatSpritePath(heroSpritePaths[heroName]);
    }
    this.heroSpritePaths = normalizedHeroPaths;
    this.root = new Node('M2Allies');
    this.root.setParent(sceneRoot);
    this.mesh = utils.createMesh(
      primitives.box({ width: 1, height: 1, length: 1 }),
    );
    this.allyMaterial = this.createMaterial(presentation.allyColor);
    this.engageMaterial = this.createMaterial(
      presentation.allyEngageColor,
    );
    this.damagedMaterial = this.createMaterial(
      presentation.fireWarningColor,
    );
    this.billboardMesh = createBillboardMesh();
    this.billboardMaterials = {
      idle: createBillboardMaterial(),
      run: createBillboardMaterial(),
      fire: createBillboardMaterial(),
    };
    this.shadowMaterial = createSoftShadowMaterial();
    for (const heroName in this.heroSpritePaths) {
      const spritePath = this.heroSpritePaths[heroName];
      const materials = {
        idle: createBillboardMaterial(),
        run: createBillboardMaterial(),
        fire: createBillboardMaterial(),
      };
      this.heroMaterials.set(heroName, materials);
      this.heroTextureReady.set(heroName, new Set());
      (['idle', 'run', 'fire'] as const).forEach((state) => {
        const path = spriteStatePath(spritePath, state);
        loadTexture(
          path,
          (texture) => {
            if (!this.root.isValid) return;
            materials[state].setProperty('mainTexture', texture);
            this.heroTextureReady.get(heroName)?.add(state);
            this.refreshAllBillboards();
          },
          () => {
            // 加载失败时不标记就绪，updateBillboardState 会自动回退到通用立绘。
            this.refreshAllBillboards();
          },
        );
      });
    }
    (['idle', 'run', 'fire'] as const).forEach((state) => {
      loadTexture(this.spritePaths[state], (texture) => {
        if (!this.root.isValid) {
          return;
        }
        this.textures.set(state, texture);
        this.billboardMaterials[state].setProperty('mainTexture', texture);
        for (const [allyId, node] of this.nodes) {
          this.updateBillboardState(node, this.states.get(allyId) ?? 'guard');
        }
        if (state === 'idle') {
          this.idleTextureLoaded = true;
          for (const node of this.nodes.values()) {
            const placeholder = this.getPlaceholderRenderer(node);
            if (placeholder) {
              placeholder.enabled = false;
            }
          }
        }
      });
    });
  }

  sync(
    allies: readonly AllyState[],
    playerId: string | null,
    hiddenAllyId: string | null = null,
  ): void {
    const visibleIds = new Set<string>();
    const nowMs = Date.now();
    for (const ally of allies) {
      // 自己（第一视角）与正在被观战的那名队友不画；其余真人与 AI 队友
      // 统一走同一条渲染管线（PRD 8.2：allies[] 用 isBot 区分）。
      if (
        ally.id === playerId ||
        ally.id === hiddenAllyId ||
        ally.hp <= 0
      ) {
        continue;
      }
      visibleIds.add(ally.id);
      let node = this.nodes.get(ally.id);
      const isNew = !node;
      if (!node) {
        node = this.createNode(ally.id, ally.heroName);
        this.nodes.set(ally.id, node);
        this.heroNameByNode.set(ally.id, ally.heroName);
      }
      this.applyState(node, ally, isNew, nowMs);
    }

    for (const [allyId, node] of this.nodes) {
      if (!visibleIds.has(allyId)) {
        this.nodes.delete(allyId);
        this.states.delete(allyId);
        this.heroNameByNode.delete(allyId);
        this.targetPositions.delete(allyId);
        this.targetScales.delete(allyId);
        this.humanTraces.delete(allyId);
        node.destroy();
      }
    }
  }

  flashDamaged(allyId: string): void {
    const node = this.nodes.get(allyId);
    const renderer = node ? this.getPlaceholderRenderer(node) : undefined;
    if (!node || !renderer) {
      return;
    }
    renderer.setSharedMaterial(this.damagedMaterial, 0);
    setTimeout(() => {
      if (node.isValid) {
        renderer.setSharedMaterial(
          this.states.get(allyId) === 'engage'
            ? this.engageMaterial
            : this.allyMaterial,
          0,
        );
      }
    }, this.presentation.hitFeedbackSec * 1000);
  }

  update(deltaTime: number): void {
    const factor = 1 - Math.exp(
      -this.presentation.entityPositionSmoothing * deltaTime,
    );
    for (const [allyId, node] of this.nodes) {
      faceBillboardToCamera(
        node.getChildByName('Billboard') ?? node,
        this.cameraNode,
      );
      const targetPosition = this.targetPositions.get(allyId);
      const targetScale = this.targetScales.get(allyId);
      if (!targetPosition || !targetScale) {
        continue;
      }
      Vec3.lerp(
        this.interpolationPosition,
        node.position,
        targetPosition,
        factor,
      );
      Vec3.lerp(
        this.interpolationScale,
        node.scale,
        targetScale,
        factor,
      );
      node.setPosition(this.interpolationPosition);
      node.setScale(this.interpolationScale);
    }
  }

  getActiveCount(): number {
    return this.nodes.size;
  }

  setCameraNode(cameraNode: Node): void {
    this.cameraNode = cameraNode;
  }

  destroy(): void {
    this.nodes.clear();
    this.states.clear();
    this.targetPositions.clear();
    this.targetScales.clear();
    this.humanTraces.clear();
    this.root.destroy();
    this.allyMaterial.destroy();
    this.engageMaterial.destroy();
    this.damagedMaterial.destroy();
    this.billboardMesh.destroy();
    this.billboardMaterials.idle.destroy();
    this.billboardMaterials.run.destroy();
    this.billboardMaterials.fire.destroy();
    for (const materials of this.heroMaterials.values()) {
      materials.idle.destroy();
      materials.run.destroy();
      materials.fire.destroy();
    }
    this.shadowMaterial.destroy();
  }

  private createNode(allyId: string, heroName: string): Node {
    const node = new Node(`Ally:${allyId}`);
    node.setParent(this.root);
    const hitbox = new Node('Hitbox');
    hitbox.setParent(node);
    hitbox.setPosition(0, 0.5, 0);
    const renderer = hitbox.addComponent(MeshRenderer);
    renderer.mesh = this.mesh;
    renderer.setSharedMaterial(this.allyMaterial, 0);
    createBillboard(
      node,
      null,
      this.billboardMesh,
      // 初始先挂通用 idle，具体用哪张交给 updateBillboardState 按
      // “贴图是否真的就绪”判定，避免挂上空纹理的英雄材质变灰块。
      this.billboardMaterials.idle,
    );
    this.updateBillboardState(node, 'guard', heroName);
    renderer.enabled = !this.idleTextureLoaded;

    const shadow = new Node('GroundShadow');
    shadow.setParent(node);
    shadow.setPosition(0, 0.005, 0);
    // 根节点 Y 缩放是角色身高，阴影保持薄片避免变成黑色立方体。
    shadow.setScale(1.25, 0.02, 0.75);
    const shadowRenderer = shadow.addComponent(MeshRenderer);
    shadowRenderer.mesh = this.mesh;
    shadowRenderer.setSharedMaterial(this.shadowMaterial, 0);
    return node;
  }

  private createMaterial(colorHex: string): Material {
    const material = new Material();
    material.initialize({
      effectName: 'builtin-unlit',
      defines: { USE_COLOR: true },
    });
    material.setProperty('mainColor', Color.fromHEX(new Color(), colorHex));
    return material;
  }

  private applyState(
    node: Node,
    ally: AllyState,
    immediate: boolean,
    nowMs: number,
  ): void {
    const baseHeight = this.gameplay.combat.enemyHitboxHeightM;
    const state = ally.isBot
      ? ally.aiState
      : this.deriveHumanState(ally, nowMs);
    const heightScale =
      ally.isCrouch || state === 'engage'
        ? this.presentation.engageHeightScale
        : 1;
    const height = baseHeight * heightScale;
    const radius = this.gameplay.combat.enemyHitboxRadiusM;
    let position = this.targetPositions.get(ally.id);
    if (!position) {
      position = new Vec3();
      this.targetPositions.set(ally.id, position);
    }
    // 根节点原点固定在脚底，碰撞盒与立绘均在本地上移半个身高。
    // AI 队友的 position 已是脚底；真人的 position 是眼睛（服务端按眼高
    // 建模，与观战取眼位对称），落地要减回一个眼高。
    const footY = ally.isBot
      ? ally.position.y
      : ally.position.y - this.humanEyeHeightM();
    position.set(ally.position.x, footY, ally.position.z);
    let scale = this.targetScales.get(ally.id);
    if (!scale) {
      scale = new Vec3();
      this.targetScales.set(ally.id, scale);
    }
    scale.set(radius * 2, height, radius * 2);
    if (immediate) {
      node.setPosition(position);
      node.setScale(scale);
    }

    if (state && this.states.get(ally.id) !== state) {
      this.getPlaceholderRenderer(node)
        ?.setSharedMaterial(
          state === 'engage'
            ? this.engageMaterial
            : this.allyMaterial,
          0,
        );
      this.states.set(ally.id, state);
      this.updateBillboardState(node, state, ally.heroName);
    }
  }

  /** 真人眼高：与服务端建模、m1-game 观战取眼位保持同一口径。 */
  private humanEyeHeightM(): number {
    return playerEyeHeightM(this.gameplay);
  }

  /**
   * 协议里没有「别人开枪了」的广播，但每帧快照都带弹匣数与位置：
   * 弹匣变少（且不是在换弹）就是刚开了火，位移超过阈值就是在跑。
   * 开火表现保持 hitFeedbackSec，避免 20Hz 下一帧闪一下看不见。
   */
  private deriveHumanState(ally: AllyState, nowMs: number): AllyAiState {
    let trace = this.humanTraces.get(ally.id);
    if (!trace) {
      trace = {
        magazineAmmo: ally.weapon.magazineAmmo,
        x: ally.position.x,
        z: ally.position.z,
        firedUntilMs: 0,
        movedUntilMs: 0,
      };
      this.humanTraces.set(ally.id, trace);
      return 'guard';
    }
    const holdMs = this.presentation.hitFeedbackSec * 1000;
    if (
      !ally.weapon.isReloading &&
      ally.weapon.magazineAmmo < trace.magazineAmmo
    ) {
      trace.firedUntilMs = nowMs + holdMs;
    }
    trace.magazineAmmo = ally.weapon.magazineAmmo;
    const dx = ally.position.x - trace.x;
    const dz = ally.position.z - trace.z;
    if (dx * dx + dz * dz > HUMAN_MOVE_EPSILON_M2) {
      trace.movedUntilMs = nowMs + holdMs;
    }
    trace.x = ally.position.x;
    trace.z = ally.position.z;
    if (nowMs < trace.firedUntilMs) {
      return 'engage';
    }
    if (nowMs < trace.movedUntilMs) {
      return 'reassign';
    }
    return 'guard';
  }

  private getPlaceholderRenderer(node: Node): MeshRenderer | null {
    return node.getChildByName('Hitbox')?.getComponent(MeshRenderer) ?? null;
  }

  private getBillboardRenderer(node: Node): MeshRenderer | null {
    return node.getChildByName('Billboard')?.getComponent(MeshRenderer) ?? null;
  }

  private refreshAllBillboards(): void {
    for (const [allyId, node] of this.nodes) {
      this.updateBillboardState(
        node,
        this.states.get(allyId) ?? 'guard',
        this.heroNameByNode.get(allyId),
      );
    }
  }

  private updateBillboardState(node: Node, state: AllyAiState, heroName?: string): void {
    const spriteState = state === 'engage' ? 'fire' : 'guard' === state || 'deploy' === state ? 'idle' : 'run';
    // 选材质的唯一标准：贴图已经真的加载成功。
    // 优先英雄专属立绘 → 通用中国军人同状态 → 通用 idle；
    // 全都没就绪时宁可保留上一帧材质，也不换成空纹理的灰块。
    const heroReady = heroName ? this.heroTextureReady.get(heroName) : undefined;
    if (heroName && heroReady?.has(spriteState)) {
      const heroMaterial = this.heroMaterials.get(heroName)?.[spriteState];
      if (heroMaterial) {
        this.getBillboardRenderer(node)?.setSharedMaterial(heroMaterial, 0);
        return;
      }
    }
    if (this.textures.has(spriteState)) {
      this.getBillboardRenderer(node)?.setSharedMaterial(
        this.billboardMaterials[spriteState],
        0,
      );
      return;
    }
    if (this.textures.has('idle')) {
      this.getBillboardRenderer(node)?.setSharedMaterial(
        this.billboardMaterials.idle,
        0,
      );
    }
  }
}
