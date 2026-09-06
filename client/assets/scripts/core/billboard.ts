import {
  Color,
  Material,
  Mesh,
  Node,
  MeshRenderer,
  primitives,
  resources,
  SpriteFrame,
  Texture2D,
  utils,
} from 'cc';

export function loadTexture(
  path: string,
  onLoaded: (texture: Texture2D) => void,
): void {
  // PNG 在 Cocos 运行时以 ImageAsset 暴露，显式加载其 texture 子资源。
  resources.load(`${path}/texture`, Texture2D, (error, texture) => {
    if (error || !texture) {
      return;
    }
    onLoaded(texture);
  });
}

export function loadSpriteFrame(
  path: string,
  onLoaded: (frame: SpriteFrame) => void,
): void {
  loadTexture(path, (texture) => {
    const frame = new SpriteFrame();
    frame.texture = texture;
    onLoaded(frame);
  });
}

export function combatSpritePath(path: string): string {
  // 生成素材 Agent 已提供自然站立 idle；保留配置路径作为状态基准，
  // run/fire 由渲染器按 AI 状态切换，不再把 T-Pose 或 side 当最终姿态。
  return path;
}

export function createBillboard(
  parent: Node,
  texture: Texture2D | null,
  mesh: Mesh,
  material: Material,
  options: {
    readonly centerY?: number;
    readonly widthScale?: number;
  } = {},
): MeshRenderer {
  const node = new Node('Billboard');
  node.setParent(parent);
  // 角色默认以脚底为根节点，因此中心上移 0.5；场景道具可显式传 0。
  node.setPosition(0, options.centerY ?? 0.5, 0);
  // 角色命中盒较窄，需要默认补回横向比例；场景道具使用 widthScale=1，
  // 避免把整张场景图横向拉伸成条纹。
  node.setScale(options.widthScale ?? 2, 1, 1);
  const renderer = node.addComponent(MeshRenderer);
  renderer.mesh = mesh;
  renderer.setSharedMaterial(material, 0);
  if (texture) {
    material.setProperty('mainTexture', texture);
  }
  return renderer;
}

export function createBillboardMesh(): Mesh {
  // 不直接依赖 primitives.quad 的默认 UV 方向：Cocos 的纹理原点与
  // 概念图导出方向不同，显式把 V 轴翻回“底部=0、顶部=1”，保证头脚
  // 姿态不会随材质或平台改变。
  const geometry = primitives.quad({ includeNormal: true, includeUV: true });
  geometry.uvs = [0, 1, 0, 0, 1, 0, 1, 1];
  return utils.createMesh(geometry);
}

export function createBillboardMaterial(): Material {
  const material = new Material();
  material.initialize({
    effectName: 'builtin-unlit',
    defines: { USE_TEXTURE: true },
  });
  material.setProperty('mainColor', Color.WHITE);
  const target = material.passes[0]?.blendState.targets[0];
  if (target) {
    // BlendFactor 在 Cocos 3.8 的运行时导出未包含在 `cc` 公共类型中，
    // 这里使用引擎枚举的固定序号：SRC_ALPHA=2、ONE_MINUS_SRC_ALPHA=4。
    target.blend = true;
    target.blendSrc = 2 as typeof target.blendSrc;
    target.blendDst = 4 as typeof target.blendDst;
    target.blendSrcAlpha = 1 as typeof target.blendSrcAlpha;
    target.blendDstAlpha = 4 as typeof target.blendDstAlpha;
  }
  return material;
}

export function createSoftShadowMaterial(): Material {
  const material = new Material();
  material.initialize({
    effectName: 'builtin-unlit',
    defines: { USE_COLOR: true },
  });
  material.setProperty('mainColor', new Color(18, 24, 20, 92));
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

export function faceBillboardToCamera(
  node: Node,
  cameraNode: Node | null,
): void {
  if (!cameraNode) {
    return;
  }

  const cameraPosition = cameraNode.worldPosition;
  const nodePosition = node.worldPosition;
  const deltaX = cameraPosition.x - nodePosition.x;
  const deltaZ = cameraPosition.z - nodePosition.z;
  if (deltaX * deltaX + deltaZ * deltaZ < 0.0001) {
    return;
  }

  // Billboard 只绕 Y 轴朝向摄像机，保持角色始终直立。
  node.setRotationFromEuler(
    0,
    (Math.atan2(deltaX, deltaZ) * 180) / Math.PI,
    0,
  );
}
