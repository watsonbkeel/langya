import {
  Color,
  Material,
  Mesh,
  MeshRenderer,
  Node,
  primitives,
  Texture2D,
  tween,
  Tween,
  utils,
  Vec3,
} from 'cc';

import type {
  EnemyAiState,
  EnemyState,
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

export class EnemyRenderer {
  private readonly worldRoot: Node;
  private readonly boxMesh: Mesh;
  private readonly enemyMaterial: Material;
  private readonly engageMaterial: Material;
  private readonly hitMaterial: Material;
  private readonly warningMaterial: Material;
  private readonly billboardMesh: Mesh;
  private readonly billboardMaterial: Material;
  private readonly shadowMaterial: Material;
  private readonly gameplay: GameplayConfig;
  private readonly presentation: PresentationConfig;
  private readonly enemySpritePath: string;
  private enemyTexture: Texture2D | null = null;
  private cameraNode: Node | null = null;
  private readonly pool: Node[] = [];
  private readonly activeEnemies = new Map<string, Node>();
  private readonly enemyStates = new Map<string, EnemyAiState>();
  private readonly targetPositions = new Map<string, Vec3>();
  private readonly targetScales = new Map<string, Vec3>();
  private readonly interpolationPosition = new Vec3();
  private readonly interpolationScale = new Vec3();

  constructor(
    sceneRoot: Node,
    gameplay: GameplayConfig,
    presentation: PresentationConfig,
    poolSize: number,
    enemySpritePath: string,
  ) {
    this.gameplay = gameplay;
    this.presentation = presentation;
    this.enemySpritePath = combatSpritePath(enemySpritePath);
    this.worldRoot = new Node('M1World');
    this.worldRoot.setParent(sceneRoot);
    this.boxMesh = utils.createMesh(
      primitives.box({ width: 1, height: 1, length: 1 }),
    );
    this.enemyMaterial = this.createMaterial(presentation.enemyColor);
    this.engageMaterial = this.createMaterial(
      presentation.enemyEngageColor,
    );
    this.hitMaterial = this.createMaterial(presentation.enemyHitColor);
    this.warningMaterial = this.createMaterial(
      presentation.fireWarningColor,
    );
    this.billboardMesh = createBillboardMesh();
    this.billboardMaterial = createBillboardMaterial();
    this.shadowMaterial = createSoftShadowMaterial();
    loadTexture(this.enemySpritePath, (texture) => {
      if (!this.worldRoot.isValid) {
        return;
      }
      this.enemyTexture = texture;
      this.billboardMaterial.setProperty('mainTexture', texture);
      for (const node of this.activeEnemies.values()) {
        const placeholder = this.getPlaceholderRenderer(node);
        if (placeholder) {
          placeholder.enabled = false;
        }
      }
    });
    this.createGround();

    for (let index = 0; index < poolSize; index += 1) {
      const enemy = this.createEnemyNode();
      enemy.active = false;
      this.pool.push(enemy);
    }
  }

  sync(enemies: readonly EnemyState[], serverTimeMs: number): void {
    const visibleIds = new Set<string>();
    for (const enemy of enemies) {
      if (!enemy.alive) {
        continue;
      }
      visibleIds.add(enemy.id);
      let node = this.activeEnemies.get(enemy.id);
      const isNew = !node;
      if (!node) {
        node = this.acquire(enemy.id);
        this.activeEnemies.set(enemy.id, node);
      }
      this.applyState(node, enemy, serverTimeMs, isNew);
    }

    for (const [enemyId, node] of this.activeEnemies) {
      if (!visibleIds.has(enemyId)) {
        this.activeEnemies.delete(enemyId);
        this.enemyStates.delete(enemyId);
        this.targetPositions.delete(enemyId);
        this.targetScales.delete(enemyId);
        this.release(node);
      }
    }
  }

  flash(enemyId: string): void {
    const node = this.activeEnemies.get(enemyId);
    const renderer = node ? this.getPlaceholderRenderer(node) : undefined;
    if (!node || !renderer) {
      return;
    }

    renderer.setSharedMaterial(this.hitMaterial, 0);
    setTimeout(() => {
      if (node.isValid && node.active) {
        renderer.setSharedMaterial(
          this.enemyStates.get(enemyId) === 'engage'
            ? this.engageMaterial
            : this.enemyMaterial,
          0,
        );
      }
    }, this.presentation.hitFeedbackSec * 1000);
  }

  update(deltaTime: number): void {
    const factor = 1 - Math.exp(
      -this.presentation.entityPositionSmoothing * deltaTime,
    );
    for (const [enemyId, node] of this.activeEnemies) {
      faceBillboardToCamera(
        node.getChildByName('Billboard') ?? node,
        this.cameraNode,
      );
      const targetPosition = this.targetPositions.get(enemyId);
      const targetScale = this.targetScales.get(enemyId);
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

  remove(enemyId: string): void {
    const node = this.activeEnemies.get(enemyId);
    if (!node) {
      return;
    }
    this.activeEnemies.delete(enemyId);
    this.enemyStates.delete(enemyId);
    this.targetPositions.delete(enemyId);
    this.targetScales.delete(enemyId);
    const warning = node.getChildByName('FireWarning');
    if (warning) {
      warning.active = false;
    }

    const currentScale = node.scale.clone();
    tween(node)
      .to(this.presentation.hitFeedbackSec, {
        scale: new Vec3(currentScale.x, 0, currentScale.z),
      })
      .call(() => this.release(node))
      .start();
  }

  getActiveCount(): number {
    return this.activeEnemies.size;
  }

  getWarningCount(): number {
    let count = 0;
    for (const node of this.activeEnemies.values()) {
      if (node.getChildByName('FireWarning')?.active) {
        count += 1;
      }
    }
    return count;
  }

  setCameraNode(cameraNode: Node): void {
    this.cameraNode = cameraNode;
  }

  destroy(): void {
    this.activeEnemies.clear();
    this.enemyStates.clear();
    this.targetPositions.clear();
    this.targetScales.clear();
    this.pool.length = 0;
    this.worldRoot.destroy();
    this.enemyMaterial.destroy();
    this.engageMaterial.destroy();
    this.hitMaterial.destroy();
    this.warningMaterial.destroy();
    this.billboardMesh.destroy();
    this.billboardMaterial.destroy();
    this.shadowMaterial.destroy();
  }

  private createGround(): void {
    const ground = new Node('Plateau');
    ground.setParent(this.worldRoot);
    ground.setPosition(0, -this.presentation.groundThicknessM, 0);
    ground.setScale(
      this.gameplay.arena.widthM,
      this.presentation.groundThicknessM,
      this.gameplay.arena.depthM,
    );
    const renderer = ground.addComponent(MeshRenderer);
    renderer.mesh = this.boxMesh;
    renderer.setSharedMaterial(
      this.createMaterial(this.presentation.groundColor),
      0,
    );
  }

  private createEnemyNode(): Node {
    const node = new Node('EnemyPlaceholder');
    node.setParent(this.worldRoot);
    const hitbox = new Node('Hitbox');
    hitbox.setParent(node);
    hitbox.setPosition(0, 0.5, 0);
    const renderer = hitbox.addComponent(MeshRenderer);
    renderer.mesh = this.boxMesh;
    renderer.setSharedMaterial(this.enemyMaterial, 0);
    createBillboard(
      node,
      this.enemyTexture,
      this.billboardMesh,
      this.billboardMaterial,
    );
    renderer.enabled = this.enemyTexture === null;

    const shadow = new Node('GroundShadow');
    shadow.setParent(node);
    shadow.setPosition(0, 0.005, 0);
    // 根节点 Y 缩放是角色身高，阴影必须保持薄片而不能变成黑色立方体。
    shadow.setScale(1.25, 0.02, 0.75);
    const shadowRenderer = shadow.addComponent(MeshRenderer);
    shadowRenderer.mesh = this.boxMesh;
    shadowRenderer.setSharedMaterial(this.shadowMaterial, 0);

    const warning = new Node('FireWarning');
    warning.setParent(node);
    const warningRenderer = warning.addComponent(MeshRenderer);
    warningRenderer.mesh = this.boxMesh;
    warningRenderer.setSharedMaterial(this.warningMaterial, 0);
    warning.active = false;
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

  private acquire(enemyId: string): Node {
    const node = this.pool.pop() ?? this.createEnemyNode();
    Tween.stopAllByTarget(node);
    this.resetVisualState(node);
    node.name = `Enemy:${enemyId}`;
    node.active = true;
    const placeholder = this.getPlaceholderRenderer(node);
    if (placeholder) {
      placeholder.enabled = this.enemyTexture === null;
    }
    placeholder?.setSharedMaterial(this.enemyMaterial, 0);
    return node;
  }

  private release(node: Node): void {
    Tween.stopAllByTarget(node);
    node.active = false;
    node.name = 'EnemyPlaceholder';
    const warning = node.getChildByName('FireWarning');
    if (warning) {
      warning.active = false;
    }
    this.resetVisualState(node);
    this.pool.push(node);
  }

  private applyState(
    node: Node,
    enemy: EnemyState,
    serverTimeMs: number,
    immediate: boolean,
  ): void {
    const { enemyHitboxRadiusM, enemyHitboxHeightM } =
      this.gameplay.combat;
    const heightScale =
      enemy.aiState === 'engage'
        ? this.presentation.engageHeightScale
        : 1;
    const height = enemyHitboxHeightM * heightScale;
    let targetPosition = this.targetPositions.get(enemy.id);
    if (!targetPosition) {
      targetPosition = new Vec3();
      this.targetPositions.set(enemy.id, targetPosition);
    }
    // 根节点原点固定在脚底，碰撞盒和立绘子节点都在本地上移半个身高。
    targetPosition.set(enemy.position.x, enemy.position.y, enemy.position.z);
    let targetScale = this.targetScales.get(enemy.id);
    if (!targetScale) {
      targetScale = new Vec3();
      this.targetScales.set(enemy.id, targetScale);
    }
    targetScale.set(
      enemyHitboxRadiusM * 2,
      height,
      enemyHitboxRadiusM * 2,
    );
    if (immediate) {
      node.setPosition(targetPosition);
      node.setScale(targetScale);
    }

    if (this.enemyStates.get(enemy.id) !== enemy.aiState) {
      this.getPlaceholderRenderer(node)
        ?.setSharedMaterial(
          enemy.aiState === 'engage'
            ? this.engageMaterial
            : this.enemyMaterial,
          0,
        );
      this.enemyStates.set(enemy.id, enemy.aiState);
    }

    const warning = node.getChildByName('FireWarning');
    if (warning) {
      const diameter = enemyHitboxRadiusM * 2;
      warning.setPosition(0, 0.5, -0.6);
      warning.setScale(
        this.presentation.fireWarningSizeM / diameter,
        this.presentation.fireWarningSizeM / height,
        this.presentation.fireWarningSizeM / diameter,
      );
      warning.active =
        enemy.fireWarningEndsAtMs !== undefined &&
        enemy.fireWarningEndsAtMs > serverTimeMs;
    }
  }

  private getPlaceholderRenderer(node: Node): MeshRenderer | null {
    return node.getChildByName('Hitbox')?.getComponent(MeshRenderer) ?? null;
  }

  private resetVisualState(node: Node): void {
    node.setPosition(0, 0, 0);
    node.setRotationFromEuler(0, 0, 0);
    node.setScale(1, 1, 1);
    const billboard = node.getChildByName('Billboard');
    billboard?.setPosition(0, 0.5, 0);
    billboard?.setRotationFromEuler(0, 0, 0);
    billboard?.setScale(2, 1, 1);
    const hitbox = node.getChildByName('Hitbox');
    hitbox?.setPosition(0, 0.5, 0);
    hitbox?.setRotationFromEuler(0, 0, 0);
    hitbox?.setScale(1, 1, 1);
    node.getChildByName('FireWarning')?.setPosition(0, 0.5, -0.6);
    const shadow = node.getChildByName('GroundShadow');
    shadow?.setPosition(0, 0.005, 0);
    shadow?.setRotationFromEuler(0, 0, 0);
    shadow?.setScale(1.25, 0.02, 0.75);
  }
}
