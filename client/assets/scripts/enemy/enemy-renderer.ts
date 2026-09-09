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
// 走 assets 内的镜像副本：Cocos 无法从 assets 之外做值导入。
// 镜像由 tools/sync-terrain.js 从 shared/terrain.ts 同步并校验。
import { terrainHeightAt } from '../shared/terrain';
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

export class EnemyRenderer {
  private readonly worldRoot: Node;
  private readonly boxMesh: Mesh;
  /** 山顶兜底底板的网格（贴合高度场，见 createGround 的说明）。 */
  private groundMesh: Mesh | null = null;
  private readonly enemyMaterial: Material;
  private readonly engageMaterial: Material;
  private readonly hitMaterial: Material;
  private readonly warningMaterial: Material;
  private readonly billboardMesh: Mesh;
  private readonly billboardMaterials: Readonly<Record<'idle' | 'run' | 'fire', Material>>;
  private readonly shadowMaterial: Material;
  private readonly gameplay: GameplayConfig;
  private readonly presentation: PresentationConfig;
  private readonly spritePaths: Readonly<Record<'idle' | 'run' | 'fire', string>>;
  private readonly textures = new Map<'idle' | 'run' | 'fire', Texture2D>();
  private idleTextureLoaded = false;
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
    const baseSpritePath = combatSpritePath(enemySpritePath);
    // 路径解析统一走 spriteStatePath，同时兼容文件式（.../idle）
    // 与目录式（.../seat-0）两种配置写法。
    this.spritePaths = {
      idle: spriteStatePath(baseSpritePath, 'idle'),
      run: spriteStatePath(baseSpritePath, 'run'),
      fire: spriteStatePath(baseSpritePath, 'fire'),
    };
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
    this.billboardMaterials = {
      idle: createBillboardMaterial(),
      run: createBillboardMaterial(),
      fire: createBillboardMaterial(),
    };
    this.shadowMaterial = createSoftShadowMaterial();
    (['idle', 'run', 'fire'] as const).forEach((state) => {
      loadTexture(this.spritePaths[state], (texture) => {
        if (!this.worldRoot.isValid) {
          return;
        }
        this.textures.set(state, texture);
        this.billboardMaterials[state].setProperty('mainTexture', texture);
        for (const [enemyId, node] of this.activeEnemies) {
          this.updateBillboardState(
            node,
            this.enemyStates.get(enemyId) ?? 'advance',
          );
        }
        if (state === 'idle') {
          this.idleTextureLoaded = true;
          for (const node of this.activeEnemies.values()) {
            const placeholder = this.getPlaceholderRenderer(node);
            if (placeholder) {
              placeholder.enabled = false;
            }
          }
        }
      });
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
    this.groundMesh?.destroy();
    this.groundMesh = null;
    this.enemyMaterial.destroy();
    this.engageMaterial.destroy();
    this.hitMaterial.destroy();
    this.warningMaterial.destroy();
    this.billboardMesh.destroy();
    this.billboardMaterials.idle.destroy();
    this.billboardMaterials.run.destroy();
    this.billboardMaterials.fire.destroy();
    this.shadowMaterial.destroy();
  }

  private createGround(): void {
    const ground = new Node('Plateau');
    ground.setParent(this.worldRoot);
    // ⚠️ 这块板子只是「M4 岩石地面贴图还没加载完」时的兜底底色，
    // 真正的地面是 M4SceneDecorations 里贴合高度场的 RockyGround 网格。
    //
    // 历史 bug（2026-09-09 修复）：这里曾经是一块**水平**平板，
    // 中心取 terrainHeightAt(0, 0)（山顶中线 = 20m），
    // 但高度场有横向山脊衰减（RIDGE_FALLOFF_M），x=±30 处只有 17.89m，
    // 于是平板两侧比真实地形高出 2.06m，而玩家眼高仅 1.7m
    // —— 结果就是从山顶望出去，这块板的边缘糊满上半屏幕的一大片军绿。
    //
    // 修法：改成贴合高度场的网格，并整体下沉一个厚度，
    // 保证它永远躲在真实地面之下，只在贴图缺失时透出底色。
    this.groundMesh = createTerrainPatchMesh(
      this.gameplay.arena.widthM,
      this.gameplay.arena.depthM,
      -this.presentation.groundThicknessM,
    );
    ground.setPosition(0, 0, 0);
    const renderer = ground.addComponent(MeshRenderer);
    renderer.mesh = this.groundMesh;
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
      null,
      this.billboardMesh,
      this.billboardMaterials.idle,
    );
    renderer.enabled = !this.idleTextureLoaded;

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
      placeholder.enabled = !this.idleTextureLoaded;
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
      this.updateBillboardState(node, enemy.aiState);
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

  private getBillboardRenderer(node: Node): MeshRenderer | null {
    return node.getChildByName('Billboard')?.getComponent(MeshRenderer) ?? null;
  }

  private updateBillboardState(
    node: Node,
    state: EnemyAiState,
  ): void {
    const spriteState = state === 'engage' ? 'fire' : state === 'advance' ? 'run' : 'idle';
    const material = this.textures.has(spriteState)
      ? this.billboardMaterials[spriteState]
      : this.billboardMaterials.idle;
    this.getBillboardRenderer(node)?.setSharedMaterial(material, 0);
  }

  private resetVisualState(node: Node): void {
    node.setPosition(0, 0, 0);
    node.setRotationFromEuler(0, 0, 0);
    node.setScale(1, 1, 1);
    const billboard = node.getChildByName('Billboard');
    this.getBillboardRenderer(node)?.setSharedMaterial(
      this.billboardMaterials.idle,
      0,
    );
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

/** 兜底底板的采样边长（米）。只是底色垫片，不需要 M4 地面那么密。 */
const GROUND_PATCH_SEGMENT_SIZE_M = 4;

/**
 * 生成一块贴合地形高度场的山顶底板网格（世界坐标，节点不再缩放）。
 *
 * 每个顶点的 y 都取自 `terrainHeightAt` 再加 `heightOffsetM`（传负值即下沉），
 * 因此这块板子会完整跟随山脊的横向衰减，
 * 不会像旧的水平平板那样在两侧翘起来挡住玩家视野。
 */
function createTerrainPatchMesh(
  widthM: number,
  depthM: number,
  heightOffsetM: number,
): Mesh {
  const halfWidth = widthM / 2;
  const halfDepth = depthM / 2;
  const segmentsX = Math.max(
    1,
    Math.round(widthM / GROUND_PATCH_SEGMENT_SIZE_M),
  );
  const segmentsZ = Math.max(
    1,
    Math.round(depthM / GROUND_PATCH_SEGMENT_SIZE_M),
  );

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row <= segmentsZ; row += 1) {
    const vRatio = row / segmentsZ;
    const z = -halfDepth + depthM * vRatio;
    for (let column = 0; column <= segmentsX; column += 1) {
      const uRatio = column / segmentsX;
      const x = -halfWidth + widthM * uRatio;
      positions.push(x, terrainHeightAt(x, z) + heightOffsetM, z);
      // 兜底底板用纯色材质，法线只需朝上占位。
      normals.push(0, 1, 0);
      uvs.push(uRatio, vRatio);
    }
  }

  const stride = segmentsX + 1;
  for (let row = 0; row < segmentsZ; row += 1) {
    for (let column = 0; column < segmentsX; column += 1) {
      const topLeft = row * stride + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + stride;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, bottomLeft, topRight);
      indices.push(topRight, bottomLeft, bottomRight);
    }
  }

  return utils.createMesh({ positions, normals, uvs, indices });
}
