import {
  Color,
  Material,
  Mesh,
  MeshRenderer,
  Node,
  primitives,
  resources,
  utils,
} from 'cc';

import type { RouteId } from '../../../../shared/protocol';
// 走 assets 内的镜像副本：Cocos 无法从 assets 之外做值导入。
// 镜像由 tools/sync-terrain.js 从 shared/terrain.ts 同步并校验。
import { terrainHeightAt } from '../shared/terrain';
import type {
  GameplayConfig,
  PresentationConfig,
  WavesConfig,
} from '../config/game-config';
import {
  billboardNodeOf,
  createBillboard,
  createBillboardMaterial,
  createBillboardMesh,
  loadTexture,
  StaticBillboardGroup,
} from '../core/billboard';

const GROUND_UV_REPEAT = 8;

/**
 * 地面网格的采样边长（米）。
 * 2m 在 60m x 150m 的战场上约 30 x 75 格，
 * 既能把 18° 的坡面画得平滑，也不会把顶点数推到移动端吃不消的量级。
 */
const GROUND_SEGMENT_SIZE_M = 2;

/**
 * 战场核心网格之外的「裙边」（2026-09-11 修复「两侧笔直的河」）。
 *
 * 原地面只盖 x∈±40.5、z∈[-140,10]。摄像机 FOV 70°（横向约 102°）从山顶
 * 往下看，视野两侧远远超出 ±40.5m，越过网格边缘直接露出天空球**地平线
 * 以下**的贴图（全景图下半部是灰蓝色），两条笔直的边看起来就像两条河。
 *
 * 修法：核心区仍用 2m 细网格保证坡面与判定一致；外围用 8m 粗网格一直铺到
 * 雾外（fogEndM=320，铺到 360m），边缘落在纯雾色里，不再有可见硬边。
 * 裙边远端再把高度平滑抬向天空球地平线（见 HORIZON_RIM_*），
 * 否则 z<-130 的 y=0 平原在 350m 外仍比地平线低约 2.6°，会露出一条
 * 地平线以下的暗带。裙边完全在战场之外（敌人最远出生点 z=-130，
 * 横向 ±30），不影响任何判定。
 */
const GROUND_SKIRT_SEGMENT_SIZE_M = 8;
const GROUND_SKIRT_EXTENT_M = 360;
/** 视觉地平线抬升：距原点超过 START 后开始把地面高度混向 HEIGHT，END 处到位。 */
const HORIZON_RIM_START_M = 200;
const HORIZON_RIM_END_M = 360;
/**
 * 天空球中心 = 摄像机 y + skyDomeOffsetYM(-6)，全景图地平线在眼下 0.9°。
 * 眼位在山顶约 19.9–21m，裙边远端 16m/360m 对应眼下 0.6–0.8°，
 * 略高于地平线：宁可雾色地面盖掉 1–3px 天空，也不能让地平线以下的暗带露出来。
 */
const HORIZON_RIM_HEIGHT_M = 16;
/**
 * 山脊两侧（|x| 超出核心区后）按比例压低：terrainHeightAt 在 |x|>40 处不再下降，
 * 直接铺出去会是一块与山顶等高、一直延伸到雾里的平原，不像「山」。
 * 这里只在**视觉层**把两侧按山体高度的 60% 缓降（山脚 terrain=0 处自然无变化），
 * 让山顶阵地看起来是一道脊，两侧是塌下去的谷。核心区内（|x|≤40.5）不受影响。
 */
const SIDE_FALLOFF_START_M = 44;
const SIDE_FALLOFF_END_M = 200;
const SIDE_FALLOFF_RATIO = 0.6;

interface GroundBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}
/**
 * 路线标记的宽度（米）与每段的填充比例。
 *
 * 原先是 arena 宽度 / 42（约 1.4m）的**实心不透明**长条，从山顶望下去
 * 是三条贯穿整个坡面的大色块，喧宾夺主。现在收窄并留白，
 * 配合半透明材质只留下「踩踏痕迹」级别的提示。
 */
const ROUTE_MARKER_WIDTH_M = 0.55;
const ROUTE_MARKER_FILL_RATIO = 0.45;

/** 路线标记的不透明度（0-255）。压低到让岩石地面清晰透出。 */
const ROUTE_MARKER_OPACITY = 90;

/**
 * 工事 billboard 的世界尺寸（米）。
 *
 * 贴图已用 tools/asset-pipeline/crop-transparent-margins.py 裁掉四周透明边距，
 * 内容底边 = 画布底边，因此「面片底边贴地」就等于「工事贴地」
 * （2026-09-10 修复：原 512×512 整图上下各留 ~26% 空白，工事看起来悬空 0.4–0.55m）。
 *
 * 宽高比尽量贴近贴图本身（石垒 485×236 ≈ 2.05、机枪工事 485×250 ≈ 1.94），
 * 原先 8m×1.4m 把石垒横向拉成 6 倍宽的条纹，这里一并收敛。
 */
// 工事贴图已用 tools/asset-pipeline/crop-transparent-margins.py 裁掉透明边距，
// 内容底边即画布底边；下列宽高按裁后贴图真实比例取值（石垒 485×236≈2.06，
// 机枪工事 485×250≈1.94），比例不一致会把石头横向拉成条纹。
const COVER_WIDTH_M = 3.3;
const COVER_HEIGHT_M = 1.6;
const MACHINE_GUN_NEST_WIDTH_M = 4.85;
const MACHINE_GUN_NEST_HEIGHT_M = 2.5;

/**
 * M4 纯客户端场景装饰。
 * 这些节点只负责画面层次和路线辨识，不参与物理、命中或服务器判定。
 */
export class M4SceneDecorations {
  private readonly root: Node;
  private readonly boxMesh: Mesh;
  private readonly billboardMesh: Mesh;
  private readonly groundMesh: Mesh;
  private readonly routeMaterials: Readonly<Record<RouteId, Material>>;
  private groundTextureMaterial: Material | null = null;
  private readonly machineGunNestMaterial: Material;
  private readonly coverMaterial: Material;
  private readonly gameplay: GameplayConfig;
  private readonly waves: WavesConfig;
  private readonly maxRouteLengthM: number;
  private cameraNode: Node | null = null;
  private readonly billboardRoots: Node[] = [];
  /** 工事/沙袋只在摄像机移动时才重新转向（见 StaticBillboardGroup 说明）。 */
  private readonly billboardGroup = new StaticBillboardGroup();
  private groundRenderer: MeshRenderer | null = null;

  constructor(
    sceneRoot: Node,
    gameplay: GameplayConfig,
    waves: WavesConfig,
    _presentation: PresentationConfig,
  ) {
    this.gameplay = gameplay;
    this.waves = waves;
    this.maxRouteLengthM = Math.max(
      waves.routes.A.lengthM,
      waves.routes.B.lengthM,
      waves.routes.C.lengthM,
    );
    this.root = new Node('M4SceneDecorations');
    this.root.setParent(sceneRoot);
    this.boxMesh = utils.createMesh(
      primitives.box({ width: 1, height: 1, length: 1 }),
    );
    this.billboardMesh = createBillboardMesh();
    this.groundMesh = createGroundMesh(
      this.createGroundBounds(),
      GROUND_UV_REPEAT,
    );
    this.routeMaterials = {
      // 路线标记走半透明材质：只作路线提示，不喧宾夺主。
      A: this.createRouteMaterial('#8E734F'),
      B: this.createRouteMaterial('#667B70'),
      C: this.createRouteMaterial('#726A82'),
    };
    this.machineGunNestMaterial = createBillboardMaterial();
    this.coverMaterial = createBillboardMaterial();

    this.createTexturedGround();
    this.createRouteMarkers();
    this.createCoverLine();
    this.createMachineGunNests();
    // 注意：这里不再放「装饰补给箱」。它们与 M3 的空投血包同贴图却不可拾取，
    // 玩家会误以为「捷不了」（2026-09-09 反馈）。可交互物一律由服务端下发。
    this.loadSceneTextures();
  }

  setCameraNode(cameraNode: Node): void {
    this.cameraNode = cameraNode;
  }

  update(): void {
    this.billboardGroup.update(this.cameraNode);
  }

  destroy(): void {
    this.billboardGroup.clear();
    this.root.destroy();
    this.boxMesh.destroy();
    this.billboardMesh.destroy();
    this.groundMesh.destroy();
    this.groundTextureMaterial?.destroy();
    this.machineGunNestMaterial.destroy();
    this.coverMaterial.destroy();
    for (const material of [
      this.routeMaterials.A,
      this.routeMaterials.B,
      this.routeMaterials.C,
    ]) {
      material.destroy();
    }
  }

  /** 地面网格覆盖的世界范围：横向留出余量，纵深盖满最长路线到山顶后方。 */
  private createGroundBounds(): GroundBounds {
    const halfWidth = (this.gameplay.arena.widthM * 1.35) / 2;
    return {
      minX: -halfWidth,
      maxX: halfWidth,
      minZ: -this.maxRouteLengthM - this.gameplay.arena.depthM / 2,
      maxZ: this.gameplay.arena.depthM / 2,
    };
  }

  private createTexturedGround(): void {
    const ground = new Node('RockyGround');
    ground.setParent(this.root);
    // 网格顶点已是世界坐标（含地形高度），节点不再位移或缩放；
    // 仅抬高一点点避免与路线标记 z-fighting。
    ground.setPosition(0, 0.012, 0);
    this.groundRenderer = ground.addComponent(MeshRenderer);
    this.groundRenderer.mesh = this.groundMesh;
    // 材质在 loadSceneTextures 里异步就位（见 loadGroundMaterial 的说明）。
    // 地面接收平面阴影，让掩体/树/角色在坡上有落脚感。
    // cc.d.ts 声明为 number：ModelShadowReceivingMode.ON=1 / ModelShadowCastingMode.OFF=0
    this.groundRenderer.receiveShadow = 1;
    this.groundRenderer.shadowCastingMode = 0;
    this.groundRenderer.enabled = false;
  }

  private createRouteMarkers(): void {
    const width = this.gameplay.arena.widthM;
    const depth = this.gameplay.arena.depthM;
    const laneSpacing = width / 3;
    const routeXs: Readonly<Record<RouteId, number>> = {
      A: -laneSpacing,
      B: 0,
      C: laneSpacing,
    };
    const routeDepths: Readonly<Record<RouteId, number>> = {
      A: this.waves.routes.A.lengthM,
      B: this.waves.routes.B.lengthM,
      C: this.waves.routes.C.lengthM,
    };
    // 路线标记跨越整段坡面，单个长条无法贴合起伏，
    // 改成沿路线分段铺设，每段各自取当地地面高度。
    const segmentLengthM = 4;
    for (const routeId of ['A', 'B', 'C'] as const) {
      const x = routeXs[routeId];
      const routeDepth = routeDepths[routeId];
      const segments = Math.max(
        1,
        Math.round(routeDepth / segmentLengthM),
      );
      for (let index = 0; index < segments; index += 1) {
        const z = -routeDepth * ((index + 0.5) / segments);
        this.createBlock(
          `Route:${routeId}:${index}`,
          x,
          terrainHeightAt(x, z) + 0.024,
          z,
          ROUTE_MARKER_WIDTH_M,
          0.025,
          // 段之间留白，形成断续的「踩踏痕迹」而不是一条整幅涂色带。
          (routeDepth / segments) * ROUTE_MARKER_FILL_RATIO,
          this.routeMaterials[routeId],
        );
      }
    }
  }

  private createCoverLine(): void {
    const width = this.gameplay.arena.widthM;
    const depth = this.gameplay.arena.depthM;
    const positions: readonly [number, number][] = [
      [-width * 0.38, -depth * 0.16],
      [-width * 0.17, -depth * 0.28],
      [width * 0.05, -depth * 0.16],
      [width * 0.27, -depth * 0.28],
      [-width * 0.28, -depth * 0.48],
      [width * 0.34, -depth * 0.48],
    ];
    positions.forEach(([x, z], index) => {
      this.createBillboardProp(
        `StoneCover:${index}`,
        this.coverMaterial,
        x,
        terrainHeightAt(x, z) + COVER_HEIGHT_M / 2,
        z,
        COVER_WIDTH_M,
        COVER_HEIGHT_M,
      );
    });
  }

  private createMachineGunNests(): void {
    const width = this.gameplay.arena.widthM;
    const depth = this.gameplay.arena.depthM;
    const nestZ = -depth * 0.1;
    for (const [index, x] of [-width / 3, width / 3].entries()) {
      this.createBillboardProp(
        `MachineGunNest:${index}`,
        this.machineGunNestMaterial,
        x,
        terrainHeightAt(x, nestZ) + MACHINE_GUN_NEST_HEIGHT_M / 2,
        nestZ,
        MACHINE_GUN_NEST_WIDTH_M,
        MACHINE_GUN_NEST_HEIGHT_M,
      );
    }
  }

  private loadSceneTextures(): void {
    this.loadGroundMaterial((material) => {
      loadTexture('scene/rocky-ground', (texture) => {
        if (!this.root.isValid || !this.groundRenderer) {
          return;
        }
        material.setProperty('mainTexture', texture);
        this.groundRenderer.setSharedMaterial(material, 0);
        this.groundRenderer.enabled = true;
      });
    });
    this.loadBillboardTexture(
      'scene/mg-emplacement',
      this.machineGunNestMaterial,
      (name) => name.startsWith('MachineGunNest:'),
    );
    this.loadBillboardTexture(
      'scene/stone-barricade',
      this.coverMaterial,
      (name) => name.startsWith('StoneCover:'),
    );
  }

  private loadBillboardTexture(
    path: string,
    material: Material,
    matches: (name: string) => boolean,
  ): void {
    loadTexture(path, (texture) => {
      if (!this.root.isValid) {
        return;
      }
      material.setProperty('mainTexture', texture);
      for (const node of this.billboardRoots) {
        if (!matches(node.name)) {
          continue;
        }
        const renderer = billboardNodeOf(node).getComponent(MeshRenderer);
        if (renderer) {
          renderer.enabled = true;
        }
      }
    });
  }

  private createBillboardProp(
    name: string,
    material: Material,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
  ): Node {
    const node = new Node(name);
    node.setParent(this.root);
    node.setPosition(x, y, z);
    node.setScale(width, height, 1);
    const renderer = createBillboard(
      node,
      null,
      this.billboardMesh,
      material,
      { centerY: 0, widthScale: 1 },
    );
    renderer.enabled = false;
    this.billboardRoots.push(node);
    this.billboardGroup.add(node);
    return node;
  }

  private createBlock(
    name: string,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    material: Material,
  ): Node {
    const node = new Node(name);
    node.setParent(this.root);
    node.setPosition(x, y, z);
    node.setScale(width, height, depth);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = this.boxMesh;
    renderer.setSharedMaterial(material, 0);
    return node;
  }

  private createColorMaterial(colorHex: string): Material {
    const material = new Material();
    material.initialize({
      effectName: 'builtin-unlit',
      defines: { USE_COLOR: true },
    });
    material.setProperty('mainColor', Color.fromHEX(new Color(), colorHex));
    return material;
  }

  /**
   * 半透明的路线标记材质。
   *
   * 与 createColorMaterial 的区别是开启了 alpha 混合，
   * 让下方岩石地面的纹理透上来，避免整条路线变成一块纯色贴纸。
   * BlendFactor 未包含在 `cc` 的公共类型导出中，这里沿用
   * billboard.ts 里同一套引擎枚举序号：SRC_ALPHA=2、ONE_MINUS_SRC_ALPHA=4。
   */
  private createRouteMaterial(colorHex: string): Material {
    const material = new Material();
    material.initialize({
      effectName: 'builtin-unlit',
      defines: { USE_COLOR: true },
    });
    const color = Color.fromHEX(new Color(), colorHex);
    color.a = ROUTE_MARKER_OPACITY;
    material.setProperty('mainColor', color);
    const target = material.passes[0]?.blendState.targets[0];
    if (target) {
      target.blend = true;
      target.blendSrc = 2 as typeof target.blendSrc;
      target.blendDst = 4 as typeof target.blendDst;
      target.blendSrcAlpha = 1 as typeof target.blendSrcAlpha;
      target.blendDstAlpha = 4 as typeof target.blendDstAlpha;
    }
    return material;
  }

  /**
   * 地面走 builtin-standard：吃方向光与环境光，坡面才有明暗，
   * 「居高临下」的高低差才看得出来（M7 环境层之前全场 unlit，画面是平的）。
   *
   * ⚠️ 不能像 unlit 那样 `new Material().initialize({ effectName })`：
   * Cocos 构建只打包被资产引用的 effect，代码里的字符串引用不算数，
   * 线上包里根本没有 builtin-standard，初始化会崩在
   * `localSetLayout of undefined`（2026-09-09 踩坑）。
   * 所以真正的引用锚点是 `resources/scene/ground-standard.mtl`
   * （USE_ALBEDO_MAP、roughness 0.95、metallic 0 都写在资产里），
   * 这里只负责把它加载出来。加载失败则回退 unlit，宁可画面平也不能不出图。
   */
  private loadGroundMaterial(onReady: (material: Material) => void): void {
    resources.load('scene/ground-standard', Material, (error, asset) => {
      if (!this.root.isValid) {
        return;
      }
      if (error || !asset) {
        console.warn('[m4] 地面 standard 材质加载失败，回退 unlit', error);
        this.groundTextureMaterial = createBillboardMaterial();
      } else {
        // 用实例而不是共享资产，避免 setProperty 污染资源缓存。
        this.groundTextureMaterial = new Material();
        this.groundTextureMaterial.copy(asset);
        this.groundTextureMaterial.setProperty('mainColor', Color.WHITE);
      }
      onReady(this.groundTextureMaterial);
    });
  }
}

/**
 * 生成贴合地形高度场的地面网格。
 *
 * 与旧的 4 顶点平板不同，这里直接用**世界坐标**建网格（节点不再缩放），
 * 每个顶点的 y 都取自 `terrainHeightAt` —— 与服务端判定同一函数，
 * 因此「看到的坡面」和「打得中的位置」不会脱节。
 */
function createGroundMesh(
  bounds: GroundBounds,
  uvRepeat: number,
): Mesh {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  // 一张规则拓扑的网格，但采样间距不均匀：核心区 2m、裙边 8m。
  // 同一张网格天然没有 T 形接缝，也只占一个 draw call。
  const xs = buildGroundAxis(bounds.minX, bounds.maxX);
  const zs = buildGroundAxis(bounds.minZ, bounds.maxZ);
  // 贴图密度沿用原核心区的比例（横向 spanX/uvRepeat、纵深 spanZ/uvRepeat 一格），
  // 改成按世界坐标取 UV，裙边与核心区的纹理无缝连续。
  const tileX = spanX / uvRepeat;
  const tileZ = spanZ / uvRepeat;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const z of zs) {
    for (const x of xs) {
      const y = groundHeightAt(x, z);

      positions.push(x, y, z);
      const normal = groundNormalAt(x, z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(x / tileX, z / tileZ);

      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  const stride = xs.length;
  for (let row = 0; row < zs.length - 1; row += 1) {
    for (let column = 0; column < xs.length - 1; column += 1) {
      const topLeft = row * stride + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + stride;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, bottomLeft, topRight);
      indices.push(topRight, bottomLeft, bottomRight);
    }
  }

  return utils.createMesh({
    positions,
    normals,
    uvs,
    indices,
    minPos: { x: xs[0], y: minY, z: zs[0] },
    maxPos: { x: xs[xs.length - 1], y: maxY, z: zs[zs.length - 1] },
  });
}

/**
 * 一条轴上的采样坐标：[-SKIRT, coreMin] 粗步、[coreMin, coreMax] 细步、
 * [coreMax, SKIRT] 粗步，端点严格落在核心区边界上。
 */
function buildGroundAxis(coreMin: number, coreMax: number): number[] {
  const values: number[] = [];
  const pushRange = (from: number, to: number, step: number): void => {
    const count = Math.max(1, Math.round((to - from) / step));
    for (let i = 0; i < count; i += 1) {
      values.push(from + ((to - from) * i) / count);
    }
  };
  pushRange(-GROUND_SKIRT_EXTENT_M, coreMin, GROUND_SKIRT_SEGMENT_SIZE_M);
  pushRange(coreMin, coreMax, GROUND_SEGMENT_SIZE_M);
  pushRange(coreMax, GROUND_SKIRT_EXTENT_M, GROUND_SKIRT_SEGMENT_SIZE_M);
  values.push(GROUND_SKIRT_EXTENT_M);
  return values;
}

/**
 * 地面渲染高度 = 判定地形高度，只在裙边远端（离原点 200m 外）平滑混向
 * 天空球地平线。战场（|x|≤40.5、z≥-140，离原点 ≤146m）内与 terrainHeightAt 完全一致。
 */
function groundHeightAt(x: number, z: number): number {
  let height = terrainHeightAt(x, z);
  const side = Math.abs(x);
  if (side > SIDE_FALLOFF_START_M) {
    const t = smooth01(
      (side - SIDE_FALLOFF_START_M) /
        (SIDE_FALLOFF_END_M - SIDE_FALLOFF_START_M),
    );
    height *= 1 - SIDE_FALLOFF_RATIO * t;
  }
  const distance = Math.hypot(x, z);
  if (distance > HORIZON_RIM_START_M) {
    const t = smooth01(
      (distance - HORIZON_RIM_START_M) /
        (HORIZON_RIM_END_M - HORIZON_RIM_START_M),
    );
    height += (HORIZON_RIM_HEIGHT_M - height) * t;
  }
  return height;
}

function smooth01(value: number): number {
  const t = value <= 0 ? 0 : value >= 1 ? 1 : value;
  return t * t * (3 - 2 * t);
}

function groundNormalAt(
  x: number,
  z: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  return finiteDifferenceNormal(groundHeightAt, x, z);
}

/**
 * 用有限差分求地形法线，让坡面有正确的明暗过渡而不是一片死平。
 */
function finiteDifferenceNormal(
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  const epsilon = 0.5;
  const slopeX =
    (heightAt(x + epsilon, z) - heightAt(x - epsilon, z)) / (2 * epsilon);
  const slopeZ =
    (heightAt(x, z + epsilon) - heightAt(x, z - epsilon)) / (2 * epsilon);
  const length = Math.hypot(slopeX, 1, slopeZ);
  return {
    x: -slopeX / length,
    y: 1 / length,
    z: -slopeZ / length,
  };
}
