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

import type { EnemyState } from '../../../../shared/protocol';
import type {
  GameplayConfig,
  PresentationConfig,
} from '../config/game-config';

export class EnemyRenderer {
  private readonly worldRoot: Node;
  private readonly boxMesh: Mesh;
  private readonly enemyMaterial: Material;
  private readonly hitMaterial: Material;
  private readonly gameplay: GameplayConfig;
  private readonly presentation: PresentationConfig;
  private readonly pool: Node[] = [];
  private readonly activeEnemies = new Map<string, Node>();

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
    this.hitMaterial = this.createMaterial(presentation.enemyHitColor);
    this.createGround();

    for (let index = 0; index < poolSize; index += 1) {
      const enemy = this.createEnemyNode();
      enemy.active = false;
      this.pool.push(enemy);
    }
  }

  sync(enemies: readonly EnemyState[]): void {
    const visibleIds = new Set<string>();
    for (const enemy of enemies) {
      if (!enemy.alive) {
        continue;
      }
      visibleIds.add(enemy.id);
      let node = this.activeEnemies.get(enemy.id);
      if (!node) {
        node = this.acquire(enemy.id);
        this.activeEnemies.set(enemy.id, node);
      }
      this.applyState(node, enemy);
    }

    for (const [enemyId, node] of this.activeEnemies) {
      if (!visibleIds.has(enemyId)) {
        this.activeEnemies.delete(enemyId);
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
    tween(node)
      .delay(this.presentation.hitFeedbackSec)
      .call(() => {
        if (node.active) {
          renderer.setSharedMaterial(this.enemyMaterial, 0);
        }
      })
      .start();
  }

  remove(enemyId: string): void {
    const node = this.activeEnemies.get(enemyId);
    if (!node) {
      return;
    }
    this.activeEnemies.delete(enemyId);

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

  destroy(): void {
    this.activeEnemies.clear();
    this.pool.length = 0;
    this.worldRoot.destroy();
    this.enemyMaterial.destroy();
    this.hitMaterial.destroy();
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
    this.pool.push(node);
  }

  private applyState(node: Node, enemy: EnemyState): void {
    const { enemyHitboxRadiusM, enemyHitboxHeightM } =
      this.gameplay.combat;
    node.setPosition(
      enemy.position.x,
      enemy.position.y + enemyHitboxHeightM / 2,
      enemy.position.z,
    );
    node.setScale(
      enemyHitboxRadiusM * 2,
      enemyHitboxHeightM,
      enemyHitboxRadiusM * 2,
    );
  }
}
