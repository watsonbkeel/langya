import {
  Color,
  DirectionalLight,
  EffectAsset,
  Material,
  Mesh,
  MeshRenderer,
  Node,
  Vec3,
  Vec4,
  director,
  primitives,
  resources,
  utils,
} from 'cc';

import { terrainHeightAt } from '../shared/terrain';
import type {
  EnvironmentConfig,
  GameplayConfig,
  MountainLayerConfig,
  PropItemConfig,
  WavesConfig,
} from '../config/game-config';
import {
  createBillboard,
  createBillboardMaterial,
  createBillboardMesh,
  faceBillboardToCamera,
  loadTexture,
} from '../core/billboard';

/**
 * M7 环境层：天空穹顶、方向光、环境光、雾、远山视差、工事线与场景小件散布。
 *
 * 设计取舍：
 * - 天空用「跟随摄像机的反向球体 + 等距柱状全景图」而不是引擎 Skybox。
 *   Skybox 需要 TextureCube，运行时把全景图切成六面要自己写重投影；
 *   球体方案一张图直接贴，且地平线处的远山和雾色天然衔接。
 * - 雾走引擎 FogInfo（线性雾），地面/掩体/角色都会吃到。天空球和远山层
 *   在 fogEnd 之外，若用 builtin-unlit 会被整片抹成雾色（CC_USE_FOG 是
 *   pipeline 级宏，材质关不掉），所以它们改用 resources/scene/sky-unlit.effect
 *   （不走雾的 unlit），「大气透视」由代码按层混 mainColor 手动模拟。
 * - 所有小件都是 billboard，只做画面层次，不参与命中与服务器判定。
 * - 散布用确定性伪随机（seed 进配置），多端看到的布局完全一致。
 */
export class M7Environment {
  private readonly root: Node;
  private readonly config: EnvironmentConfig;
  private readonly gameplay: GameplayConfig;
  private readonly waves: WavesConfig;
  private readonly billboardMesh: Mesh;
  private readonly skyMesh: Mesh;
  private skyMaterial: Material | null = null;
  private readonly skyNode: Node;
  /** 不吃雾的 unlit effect；天空与远山共用。加载失败回退 builtin-unlit。 */
  private noFogEffect: EffectAsset | null = null;
  private readonly noFogWaiters: Array<(effect: EffectAsset | null) => void> = [];
  private readonly sunNode: Node;
  private readonly materials: Material[] = [];
  private readonly billboardRoots: Node[] = [];
  private cameraNode: Node | null = null;
  private readonly cameraPos = new Vec3();

  constructor(
    sceneRoot: Node,
    gameplay: GameplayConfig,
    waves: WavesConfig,
    config: EnvironmentConfig,
  ) {
    this.config = config;
    this.gameplay = gameplay;
    this.waves = waves;
    this.root = new Node('M7Environment');
    this.root.setParent(sceneRoot);
    this.billboardMesh = createBillboardMesh();

    this.skyMesh = utils.createMesh(this.createSkyGeometry());
    this.loadNoFogEffect();
    this.skyNode = this.createSkyDome();
    this.sunNode = this.createSun();
    this.applySceneGlobals();
    this.createMountainLayers();
    this.createFortificationLine();
    this.scatterProps();
  }

  setCameraNode(cameraNode: Node): void {
    this.cameraNode = cameraNode;
  }

  update(): void {
    if (this.cameraNode) {
      // 天空球跟着摄像机走，玩家永远在球心，远处永远是天。
      this.cameraPos.set(this.cameraNode.worldPosition);
      this.cameraPos.y += this.config.skyDomeOffsetYM;
      this.skyNode.setWorldPosition(this.cameraPos);
    }
    for (const node of this.billboardRoots) {
      faceBillboardToCamera(
        node.getChildByName('Billboard') ?? node,
        this.cameraNode,
      );
    }
  }

  destroy(): void {
    this.root.destroy();
    this.skyMesh.destroy();
    this.billboardMesh.destroy();
    this.skyMaterial?.destroy();
    for (const material of this.materials) {
      material.destroy();
    }
  }

  // ---------------------------------------------------------------- 天空

  /**
   * 引擎 sphere 的 UV：u=lon/segments（u=0 在 -X 方向、逆时针），
   * v=lat/segments 且 lat=0 是**底极**。Cocos 采样 v=0 对应图片顶行
   * （billboard.ts 已实测），直接用会把天空贴到脚下，所以翻转 V。
   *
   * 全景图太阳在 u=0.64 → 球体局部方位角 0.64*360-90 = 140°；
   * 方向光 sunYawDeg 对应太阳方位角 = sunYawDeg，
   * 因此 presentation.json 的 skyDomeYawDeg = sunYawDeg - 140。
   */
  private createSkyGeometry(): ReturnType<typeof primitives.sphere> {
    const geometry = primitives.sphere(this.config.skyDomeRadiusM, {
      segments: 48,
    });
    const uvs = geometry.uvs;
    if (uvs) {
      for (let i = 1; i < uvs.length; i += 2) {
        uvs[i] = 1 - uvs[i];
      }
    }
    return geometry;
  }

  private loadNoFogEffect(): void {
    resources.load('scene/sky-unlit', EffectAsset, (error, effect) => {
      if (!this.root.isValid) {
        return;
      }
      if (error || !effect) {
        console.warn('[m7] sky-unlit effect 加载失败，天空/远山回退 builtin-unlit', error);
      }
      this.noFogEffect = effect ?? null;
      for (const waiter of this.noFogWaiters.splice(0)) {
        waiter(this.noFogEffect);
      }
    });
  }

  private whenNoFogEffect(
    callback: (effect: EffectAsset | null) => void,
  ): void {
    if (this.noFogEffect) {
      callback(this.noFogEffect);
      return;
    }
    this.noFogWaiters.push(callback);
  }

  /**
   * 不走雾的贴图材质。`alphaTest` 用于远山（要抠天空），天空球不需要。
   */
  private createNoFogMaterial(
    effect: EffectAsset | null,
    alphaTest: boolean,
  ): Material {
    if (!effect) {
      return alphaTest ? createBillboardMaterial() : this.createFallbackSkyMaterial();
    }
    const material = new Material();
    material.initialize({
      effectAsset: effect,
      technique: alphaTest ? 1 : 0,
      defines: alphaTest ? { USE_ALPHA_TEST: true } : {},
    });
    material.setProperty('mainColor', Color.WHITE);
    if (alphaTest) {
      material.setProperty('alphaThreshold', 0.1);
    }
    return material;
  }

  private createFallbackSkyMaterial(): Material {
    const material = new Material();
    material.initialize({
      effectName: 'builtin-unlit',
      defines: { USE_TEXTURE: true },
    });
    material.setProperty('mainColor', Color.WHITE);
    return material;
  }

  private createSkyMaterial(effect: EffectAsset | null): Material {
    const material = this.createNoFogMaterial(effect, false);
    // 从球体内部看：剔除正面、只画背面。
    const pass = material.passes[0];
    if (pass) {
      pass.rasterizerState.cullMode = 1 as typeof pass.rasterizerState.cullMode; // FRONT
      // 天空永远在最后面，不写深度以免遮挡远山。
      pass.depthStencilState.depthWrite = false;
    }
    return material;
  }

  private createSkyDome(): Node {
    const node = new Node('SkyDome');
    node.setParent(this.root);
    node.setRotationFromEuler(0, this.config.skyDomeYawDeg, 0);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = this.skyMesh;
    // cc.d.ts 声明为 number：ModelShadowCastingMode.OFF=0 / ModelShadowReceivingMode.OFF=0
    renderer.shadowCastingMode = 0;
    renderer.receiveShadow = 0;
    renderer.enabled = false;
    this.whenNoFogEffect((effect) => {
      const material = this.createSkyMaterial(effect);
      this.skyMaterial = material;
      renderer.setSharedMaterial(material, 0);
      loadTexture(this.config.skyPanorama, (texture) => {
        if (!this.root.isValid) {
          return;
        }
        material.setProperty('mainTexture', texture);
        renderer.enabled = true;
      });
    });
    return node;
  }

  // ---------------------------------------------------------------- 光照与雾

  private createSun(): Node {
    const node = new Node('Sun');
    node.setParent(this.root);
    // Cocos 方向光沿节点 -Z 照射；先绕 X 抬仰角，再绕 Y 转方位。
    node.setRotationFromEuler(
      -this.config.sunPitchDeg,
      this.config.sunYawDeg,
      0,
    );
    const light = node.addComponent(DirectionalLight);
    light.color = Color.fromHEX(new Color(), this.config.sunColor);
    light.illuminance = this.config.sunIlluminance;
    light.shadowEnabled = false;
    return node;
  }

  private applySceneGlobals(): void {
    const scene = director.getScene();
    if (!scene) {
      return;
    }
    const globals = scene.globals;

    const skyColor = Color.fromHEX(new Color(), this.config.ambientSkyColor);
    const groundColor = Color.fromHEX(
      new Color(),
      this.config.ambientGroundColor,
    );
    globals.ambient.skyColor = new Vec4(
      skyColor.r / 255,
      skyColor.g / 255,
      skyColor.b / 255,
      1,
    );
    globals.ambient.groundAlbedo = new Vec4(
      groundColor.r / 255,
      groundColor.g / 255,
      groundColor.b / 255,
      1,
    );
    globals.ambient.skyIllum = this.config.ambientSkyIllum;

    globals.fog.type = 0; // LINEAR
    globals.fog.fogColor = Color.fromHEX(new Color(), this.config.fogColor);
    globals.fog.fogStart = this.config.fogStartM;
    globals.fog.fogEnd = this.config.fogEndM;
    globals.fog.accurate = false;
    globals.fog.enabled = true;

    // 平面阴影：查过 builtin-unlit / builtin-standard 的 planar-shadow pass，
    // 片元阶段**不采样贴图**，billboard 会投出一整块矩形黑影而不是剪影。
    // 因此场上所有 billboard 都保持 shadowCastingMode=OFF，这里只准备好
    // 阴影颜色，供将来真正的网格物件（如有）打开投射时使用。
    globals.shadows.enabled = false;
    globals.shadows.type = 0; // PLANAR
    globals.shadows.shadowColor = Color.fromHEX(
      new Color(),
      this.config.shadowColor,
    );
    globals.shadows.planeDirection = new Vec3(0, 1, 0);
    globals.shadows.planeHeight = 0;
  }

  // ---------------------------------------------------------------- 远山

  private createMountainLayers(): void {
    this.config.mountainLayers.forEach((layer, index) => {
      const nodes = this.placeMountainLayer(layer, index);
      this.whenNoFogEffect((effect) => {
        const material = this.createNoFogMaterial(effect, true);
        // 远山越远越接近雾色；用 mainColor 混一次雾色做「大气透视」。
        const tint = this.mixColor(
          Color.WHITE,
          Color.fromHEX(new Color(), this.config.fogColor),
          index === 0 ? 0.25 : 0.5,
        );
        material.setProperty('mainColor', tint);
        this.materials.push(material);
        const renderers = nodes
          .map((node) =>
            node.getChildByName('Billboard')?.getComponent(MeshRenderer),
          )
          .filter((renderer): renderer is MeshRenderer => !!renderer);
        for (const renderer of renderers) {
          renderer.setSharedMaterial(material, 0);
        }
        loadTexture(layer.texture, (texture) => {
          if (!this.root.isValid) {
            return;
          }
          material.setProperty('mainTexture', texture);
          for (const renderer of renderers) {
            renderer.enabled = true;
          }
        });
      });
    });
  }

  private placeMountainLayer(
    layer: MountainLayerConfig,
    index: number,
  ): Node[] {
    const nodes: Node[] = [];
    const z = -layer.distanceM;
    // 底边压到地平线以下：山脚高度 0 再减 sinkM，避免露出硬边。
    const y = layer.heightM / 2 - layer.sinkM;
    const copies = Math.max(0, Math.floor(layer.wrapCopies));
    for (let copy = -copies; copy <= copies; copy += 1) {
      const node = new Node(`Mountain:${index}:${copy}`);
      node.setParent(this.root);
      // 环绕副本略微后退，形成弧形而不是一条直线。
      const arcBack = Math.abs(copy) * layer.distanceM * 0.18;
      node.setPosition(copy * layer.widthM * 0.92, y, z - arcBack);
      node.setScale(layer.widthM, layer.heightM, 1);
      const renderer = this.attachStaticQuad(node, null);
      renderer.enabled = false;
      nodes.push(node);
    }
    return nodes;
  }

  // ---------------------------------------------------------------- 工事线

  private createFortificationLine(): void {
    const fort = this.config.props.fortification;
    const straight = createBillboardMaterial();
    const corner = createBillboardMaterial();
    this.materials.push(straight, corner);

    const width = this.gameplay.arena.widthM;
    const laneSpacing = width / 3;
    const laneXs = [-laneSpacing, 0, laneSpacing];
    const halfWidth = width / 2;
    const step = fort.segmentWidthM * 0.96;
    const created: { node: Node; isCorner: boolean }[] = [];

    for (let x = -halfWidth + step / 2; x <= halfWidth; x += step) {
      // 在三条路线的正对面留缺口，敌人冲进阵地的路径不被工事贴图挡住视线。
      const nearLane = laneXs.some(
        (laneX) => Math.abs(x - laneX) < fort.gapM / 2,
      );
      if (nearLane) {
        continue;
      }
      const isCorner =
        x - step / 2 <= -halfWidth + 0.01 || x + step / 2 >= halfWidth - 0.01;
      const z = fort.lineZM;
      const node = this.createProp(
        `Sandbag:${created.length}`,
        isCorner ? corner : straight,
        x,
        terrainHeightAt(x, z) + fort.heightM / 2 - 0.06,
        z,
        fort.segmentWidthM,
        fort.heightM,
      );
      created.push({ node, isCorner });
    }

    this.loadPropTexture(
      fort.straightTexture,
      straight,
      created.filter((item) => !item.isCorner).map((item) => item.node),
    );
    this.loadPropTexture(
      fort.cornerTexture,
      corner,
      created.filter((item) => item.isCorner).map((item) => item.node),
    );
  }

  // ---------------------------------------------------------------- 小件散布

  private scatterProps(): void {
    const props = this.config.props;
    const random = createSeededRandom(props.seed);
    const width = this.gameplay.arena.widthM;
    const laneSpacing = width / 3;
    const laneXs = [-laneSpacing, 0, laneSpacing];
    const maxRouteLengthM = Math.max(
      this.waves.routes.A.lengthM,
      this.waves.routes.B.lengthM,
      this.waves.routes.C.lengthM,
    );
    // 散布范围：横向比战场略宽（坡面两侧），纵深从阵地前沿到山脚再往外一点。
    const spanX = width * 0.75;
    const minZ = -maxRouteLengthM - 18;
    const maxZ = -props.summitClearDepthM;

    for (const item of props.items) {
      const material = createBillboardMaterial();
      this.materials.push(material);
      const nodes: Node[] = [];
      let attempts = 0;
      while (nodes.length < item.count && attempts < item.count * 12) {
        attempts += 1;
        const x = (random() * 2 - 1) * spanX;
        const z = minZ + random() * (maxZ - minZ);
        // 路线中心两侧留空，别把树种在敌人冲锋的路中间。
        const blocksLane = laneXs.some(
          (laneX) => Math.abs(x - laneX) < props.laneClearHalfWidthM,
        );
        if (blocksLane) {
          continue;
        }
        const scale = 1 + (random() * 2 - 1) * item.scaleJitter;
        const propWidth = item.widthM * scale;
        const propHeight = item.heightM * scale;
        const node = this.createProp(
          `${item.texture}:${nodes.length}`,
          material,
          x,
          terrainHeightAt(x, z) + propHeight / 2 - item.sinkM,
          z,
          propWidth,
          propHeight,
        );
        nodes.push(node);
      }
      this.loadPropTexture(item.texture, material, nodes);
    }
  }

  // ---------------------------------------------------------------- 工具

  private createProp(
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
    const renderer = createBillboard(node, null, this.billboardMesh, material, {
      centerY: 0,
      widthScale: 1,
    });
    renderer.enabled = false;
    this.billboardRoots.push(node);
    return node;
  }

  /** 远山不随摄像机转向（它们太远，转向会穿帮），用静止面片。 */
  private attachStaticQuad(
    node: Node,
    material: Material | null,
  ): MeshRenderer {
    const quad = new Node('Billboard');
    quad.setParent(node);
    const renderer = quad.addComponent(MeshRenderer);
    renderer.mesh = this.billboardMesh;
    if (material) {
      renderer.setSharedMaterial(material, 0);
    }
    // cc.d.ts 声明为 number：ModelShadowCastingMode.OFF=0 / ModelShadowReceivingMode.OFF=0
    renderer.shadowCastingMode = 0;
    renderer.receiveShadow = 0;
    return renderer;
  }

  private loadPropTexture(
    path: string,
    material: Material,
    nodes: readonly Node[],
  ): void {
    loadTexture(path, (texture) => {
      if (!this.root.isValid) {
        return;
      }
      material.setProperty('mainTexture', texture);
      for (const node of nodes) {
        const renderer = node
          .getChildByName('Billboard')
          ?.getComponent(MeshRenderer);
        if (renderer) {
          renderer.enabled = true;
        }
      }
    });
  }

  private mixColor(a: Color, b: Color, t: number): Color {
    return new Color(
      Math.round(a.r + (b.r - a.r) * t),
      Math.round(a.g + (b.g - a.g) * t),
      Math.round(a.b + (b.b - a.b) * t),
      255,
    );
  }
}

/** mulberry32：够快够均匀的确定性伪随机，多端布局一致。 */
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
