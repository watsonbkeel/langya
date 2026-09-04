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
  AllyAiState,
  AllyState,
} from '../../../../shared/protocol';
import type {
  GameplayConfig,
  PresentationConfig,
} from '../config/game-config';

export class AllyRenderer {
  private readonly root: Node;
  private readonly mesh: Mesh;
  private readonly allyMaterial: Material;
  private readonly engageMaterial: Material;
  private readonly damagedMaterial: Material;
  private readonly gameplay: GameplayConfig;
  private readonly presentation: PresentationConfig;
  private readonly nodes = new Map<string, Node>();
  private readonly states = new Map<string, AllyAiState>();

  constructor(
    sceneRoot: Node,
    gameplay: GameplayConfig,
    presentation: PresentationConfig,
  ) {
    this.gameplay = gameplay;
    this.presentation = presentation;
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
  }

  sync(allies: readonly AllyState[], playerId: string | null): void {
    const visibleIds = new Set<string>();
    for (const ally of allies) {
      if (!ally.isBot || ally.id === playerId || ally.hp <= 0) {
        continue;
      }
      visibleIds.add(ally.id);
      let node = this.nodes.get(ally.id);
      const isNew = !node;
      if (!node) {
        node = this.createNode(ally.id);
        this.nodes.set(ally.id, node);
      }
      this.applyState(node, ally, isNew);
    }

    for (const [allyId, node] of this.nodes) {
      if (!visibleIds.has(allyId)) {
        this.nodes.delete(allyId);
        this.states.delete(allyId);
        node.destroy();
      }
    }
  }

  flashDamaged(allyId: string): void {
    const node = this.nodes.get(allyId);
    const renderer = node?.getComponent(MeshRenderer);
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

  getActiveCount(): number {
    return this.nodes.size;
  }

  destroy(): void {
    this.nodes.clear();
    this.states.clear();
    this.root.destroy();
    this.allyMaterial.destroy();
    this.engageMaterial.destroy();
    this.damagedMaterial.destroy();
  }

  private createNode(allyId: string): Node {
    const node = new Node(`Ally:${allyId}`);
    node.setParent(this.root);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = this.mesh;
    renderer.setSharedMaterial(this.allyMaterial, 0);
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
    const position = new Vec3(
      ally.position.x,
      ally.position.y + height / 2,
      ally.position.z,
    );
    const scale = new Vec3(radius * 2, height, radius * 2);
    if (immediate) {
      node.setPosition(position);
      node.setScale(scale);
    } else {
      Tween.stopAllByTarget(node);
      tween(node)
        .to(1 / this.gameplay.server.tickRateHz, { position, scale })
        .start();
    }

    if (ally.aiState && this.states.get(ally.id) !== ally.aiState) {
      node
        .getComponent(MeshRenderer)
        ?.setSharedMaterial(
          ally.aiState === 'engage'
            ? this.engageMaterial
            : this.allyMaterial,
          0,
        );
      this.states.set(ally.id, ally.aiState);
    }
  }
}
