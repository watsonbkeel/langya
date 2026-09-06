import {
  Color,
  Material,
  Mesh,
  MeshRenderer,
  Node,
  primitives,
  utils,
} from 'cc';

import type { RouteId } from '../../../../shared/protocol';
import type {
  GameplayConfig,
  PresentationConfig,
  WavesConfig,
} from '../config/game-config';
import {
  createBillboard,
  createBillboardMaterial,
  createBillboardMesh,
  faceBillboardToCamera,
  loadTexture,
} from '../core/billboard';

const GROUND_UV_REPEAT = 8;
const TERRAIN_BACKDROP_HEIGHT_M = 16;
const COVER_HEIGHT_M = 1.4;
const MACHINE_GUN_NEST_HEIGHT_M = 2.15;

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
  private readonly terrainBackdropMaterial: Material;
  private readonly groundTextureMaterial: Material;
  private readonly machineGunNestMaterial: Material;
  private readonly coverMaterial: Material;
  private readonly crateMaterial: Material;
  private readonly gameplay: GameplayConfig;
  private readonly waves: WavesConfig;
  private readonly maxRouteLengthM: number;
  private cameraNode: Node | null = null;
  private readonly billboardRoots: Node[] = [];
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
    this.groundMesh = createGroundMesh(GROUND_UV_REPEAT);
    this.routeMaterials = {
      A: this.createColorMaterial('#8E734F'),
      B: this.createColorMaterial('#667B70'),
      C: this.createColorMaterial('#726A82'),
    };
    this.terrainBackdropMaterial = createBillboardMaterial();
    this.groundTextureMaterial = this.createTextureMaterial();
    this.machineGunNestMaterial = createBillboardMaterial();
    this.coverMaterial = createBillboardMaterial();
    this.crateMaterial = createBillboardMaterial();

    this.createTexturedGround();
    this.createTerrainBackdrop();
    this.createRouteMarkers();
    this.createCoverLine();
    this.createMachineGunNests();
    this.createSupplyCrates();
    this.loadSceneTextures();
  }

  setCameraNode(cameraNode: Node): void {
    this.cameraNode = cameraNode;
  }

  update(): void {
    for (const node of this.billboardRoots) {
      faceBillboardToCamera(
        node.getChildByName('Billboard') ?? node,
        this.cameraNode,
      );
    }
  }

  destroy(): void {
    this.root.destroy();
    this.boxMesh.destroy();
    this.billboardMesh.destroy();
    this.groundMesh.destroy();
    this.terrainBackdropMaterial.destroy();
    this.groundTextureMaterial.destroy();
    this.machineGunNestMaterial.destroy();
    this.coverMaterial.destroy();
    this.crateMaterial.destroy();
    for (const material of [
      this.routeMaterials.A,
      this.routeMaterials.B,
      this.routeMaterials.C,
    ]) {
      material.destroy();
    }
  }

  private createTexturedGround(): void {
    const ground = new Node('RockyGround');
    ground.setParent(this.root);
    ground.setPosition(0, 0.012, -this.maxRouteLengthM / 2);
    ground.setScale(
      this.gameplay.arena.widthM * 1.35,
      1,
      this.maxRouteLengthM + this.gameplay.arena.depthM,
    );
    this.groundRenderer = ground.addComponent(MeshRenderer);
    this.groundRenderer.mesh = this.groundMesh;
    this.groundRenderer.setSharedMaterial(this.groundTextureMaterial, 0);
    this.groundRenderer.enabled = false;
  }

  private createTerrainBackdrop(): void {
    const width = this.gameplay.arena.widthM;
    this.createBillboardProp(
      'TerrainBackdrop',
      this.terrainBackdropMaterial,
      0,
      TERRAIN_BACKDROP_HEIGHT_M / 2 - 0.8,
      -this.maxRouteLengthM - this.gameplay.arena.depthM / 2,
      width * 2.5,
      TERRAIN_BACKDROP_HEIGHT_M,
    );
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
    for (const routeId of ['A', 'B', 'C'] as const) {
      this.createBlock(
        `Route:${routeId}`,
        routeXs[routeId],
        0.024,
        -routeDepths[routeId] / 2,
        width / 42,
        0.025,
        routeDepths[routeId],
        this.routeMaterials[routeId],
      );
    }
  }

  private createCoverLine(): void {
    const width = this.gameplay.arena.widthM;
    const depth = this.gameplay.arena.depthM;
    const coverWidth = width / 7.5;
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
        COVER_HEIGHT_M / 2,
        z,
        coverWidth,
        COVER_HEIGHT_M,
      );
    });
  }

  private createMachineGunNests(): void {
    const width = this.gameplay.arena.widthM;
    const depth = this.gameplay.arena.depthM;
    for (const [index, x] of [-width / 3, width / 3].entries()) {
      this.createBillboardProp(
        `MachineGunNest:${index}`,
        this.machineGunNestMaterial,
        x,
        MACHINE_GUN_NEST_HEIGHT_M / 2,
        -depth * 0.1,
        width / 7,
        MACHINE_GUN_NEST_HEIGHT_M,
      );
    }
  }

  private createSupplyCrates(): void {
    const width = this.gameplay.arena.widthM;
    const depth = this.gameplay.arena.depthM;
    const positions: readonly [number, number][] = [
      [-width * 0.22, -depth * 0.2],
      [0, -depth * 0.24],
      [width * 0.22, -depth * 0.2],
    ];
    positions.forEach(([x, z], index) => {
      this.createBillboardProp(
        `SupplyCrate:${index}`,
        this.crateMaterial,
        x,
        0.55,
        z,
        2.25,
        1.55,
      );
    });
  }

  private loadSceneTextures(): void {
    this.loadBillboardTexture(
      'scene/terrain-backdrop',
      this.terrainBackdropMaterial,
      (name) => name === 'TerrainBackdrop',
    );
    loadTexture('scene/rocky-ground', (texture) => {
      if (!this.root.isValid || !this.groundRenderer) {
        return;
      }
      this.groundTextureMaterial.setProperty('mainTexture', texture);
      this.groundRenderer.enabled = true;
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
    this.loadBillboardTexture(
      'scene/supply-crate',
      this.crateMaterial,
      (name) => name.startsWith('SupplyCrate:'),
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
        const renderer = node
          .getChildByName('Billboard')
          ?.getComponent(MeshRenderer);
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

  private createTextureMaterial(): Material {
    const material = new Material();
    material.initialize({
      effectName: 'builtin-unlit',
      defines: { USE_TEXTURE: true },
    });
    material.setProperty('mainColor', Color.WHITE);
    return material;
  }
}

function createGroundMesh(uvRepeat: number): Mesh {
  return utils.createMesh({
    positions: [
      -0.5, 0, -0.5,
      -0.5, 0, 0.5,
      0.5, 0, 0.5,
      0.5, 0, -0.5,
    ],
    normals: [
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ],
    uvs: [
      0, 0,
      0, uvRepeat,
      uvRepeat, uvRepeat,
      uvRepeat, 0,
    ],
    indices: [0, 1, 3, 3, 1, 2],
    minPos: { x: -0.5, y: 0, z: -0.5 },
    maxPos: { x: 0.5, y: 0, z: 0.5 },
  });
}
