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
} from '../core/billboard';

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
  private idleTextureLoaded = false;
  private cameraNode: Node | null = null;
  private readonly nodes = new Map<string, Node>();
  private readonly heroNameByNode = new Map<string, string>();
  private readonly states = new Map<string, AllyAiState>();
  private readonly targetPositions = new Map<string, Vec3>();
  private readonly targetScales = new Map<string, Vec3>();
  private readonly interpolationPosition = new Vec3();
  private readonly interpolationScale = new Vec3();

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
      idle: baseSpritePath,
      run: baseSpritePath.replace(/\/idle$/, '/run'),
      fire: baseSpritePath.replace(/\/idle$/, '/fire'),
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
      (['idle', 'run', 'fire'] as const).forEach((state) => {
        const path = state === 'idle'
          ? spritePath
          : spritePath.replace(/\/idle$/, `/${state}`);
        loadTexture(path, (texture) => {
          if (!this.root.isValid) return;
          materials[state].setProperty('mainTexture', texture);
          for (const [allyId, node] of this.nodes) {
            this.updateBillboardState(
              node,
              this.states.get(allyId) ?? 'guard',
              this.heroNameByNode.get(allyId),
            );
          }
        });
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
    for (const ally of allies) {
      if (
        !ally.isBot ||
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
      this.applyState(node, ally, isNew);
    }

    for (const [allyId, node] of this.nodes) {
      if (!visibleIds.has(allyId)) {
        this.nodes.delete(allyId);
        this.states.delete(allyId);
        this.heroNameByNode.delete(allyId);
        this.targetPositions.delete(allyId);
        this.targetScales.delete(allyId);
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
      this.heroMaterials.get(heroName)?.idle ?? this.billboardMaterials.idle,
    );
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

  private applyState(node: Node, ally: AllyState, immediate: boolean): void {
    const baseHeight = this.gameplay.combat.enemyHitboxHeightM;
    const heightScale =
      ally.isCrouch || ally.aiState === 'engage'
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
    position.set(ally.position.x, ally.position.y, ally.position.z);
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

    if (ally.aiState && this.states.get(ally.id) !== ally.aiState) {
      this.getPlaceholderRenderer(node)
        ?.setSharedMaterial(
          ally.aiState === 'engage'
            ? this.engageMaterial
            : this.allyMaterial,
          0,
        );
      this.states.set(ally.id, ally.aiState);
      this.updateBillboardState(node, ally.aiState, ally.heroName);
    }
  }

  private getPlaceholderRenderer(node: Node): MeshRenderer | null {
    return node.getChildByName('Hitbox')?.getComponent(MeshRenderer) ?? null;
  }

  private getBillboardRenderer(node: Node): MeshRenderer | null {
    return node.getChildByName('Billboard')?.getComponent(MeshRenderer) ?? null;
  }

  private updateBillboardState(node: Node, state: AllyAiState, heroName?: string): void {
    const spriteState = state === 'engage' ? 'fire' : 'guard' === state || 'deploy' === state ? 'idle' : 'run';
    const heroMaterials = heroName ? this.heroMaterials.get(heroName) : undefined;
    const material = heroMaterials?.[spriteState]
      ?? (this.textures.has(spriteState)
        ? this.billboardMaterials[spriteState]
        : this.billboardMaterials.idle);
    this.getBillboardRenderer(node)?.setSharedMaterial(material, 0);
  }
}
