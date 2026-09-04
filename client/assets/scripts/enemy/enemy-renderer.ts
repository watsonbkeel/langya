import {
  Color,
  Material,
  Mesh,
  MeshRenderer,
  Node,
  primitives,
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

export class EnemyRenderer {
  private readonly worldRoot: Node;
  private readonly boxMesh: Mesh;
  private readonly enemyMaterial: Material;
  private readonly engageMaterial: Material;
  private readonly hitMaterial: Material;
  private readonly warningMaterial: Material;
  private readonly gameplay: GameplayConfig;
  private readonly presentation: PresentationConfig;
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
  ) {
    this.gameplay = gameplay;
    this.presentation = presentation;
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
    const renderer = node?.getComponent(MeshRenderer);
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
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = this.boxMesh;
    renderer.setSharedMaterial(this.enemyMaterial, 0);

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
    node.name = `Enemy:${enemyId}`;
    node.active = true;
    node
      .getComponent(MeshRenderer)
      ?.setSharedMaterial(this.enemyMaterial, 0);
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
    targetPosition.set(
      enemy.position.x,
      enemy.position.y + height / 2,
      enemy.position.z,
    );
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
      node
        .getComponent(MeshRenderer)
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
      warning.setPosition(0, 0, -0.6);
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
}
