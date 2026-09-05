import {
  Color,
  Material,
  Mesh,
  MeshRenderer,
  Node,
  primitives,
  utils,
} from 'cc';

import type { GameplayConfig, PresentationConfig } from '../config/game-config';
import type { RouteId } from '../../../../shared/protocol';

/**
 * M4 纯客户端场景装饰。
 * 这些节点只负责画面层次和路线辨识，不参与物理、命中或服务器判定。
 */
export class M4SceneDecorations {
  private readonly root: Node;
  private readonly boxMesh: Mesh;
  private readonly groundMaterial: Material;
  private readonly slopeMaterial: Material;
  private readonly stoneMaterial: Material;
  private readonly routeMaterials: Readonly<Record<RouteId, Material>>;
  private readonly gameplay: GameplayConfig;
  private readonly presentation: PresentationConfig;

  constructor(
    sceneRoot: Node,
    gameplay: GameplayConfig,
    presentation: PresentationConfig,
  ) {
    this.gameplay = gameplay;
    this.presentation = presentation;
    this.root = new Node('M4SceneDecorations');
    this.root.setParent(sceneRoot);
    this.boxMesh = utils.createMesh(
      primitives.box({ width: 1, height: 1, length: 1 }),
    );
    this.groundMaterial = this.createMaterial(presentation.groundColor);
    this.slopeMaterial = this.createMaterial('#53624A');
    this.stoneMaterial = this.createMaterial('#6B6B5B');
    this.routeMaterials = {
      A: this.createMaterial('#C69A62'),
      B: this.createMaterial('#8EB2A2'),
      C: this.createMaterial('#9C8FC4'),
    };

    this.createTerrainSteps();
    this.createRouteMarkers();
    this.createRouteSigns();
    this.createCoverLine();
    this.createMachineGunBases();
  }

  destroy(): void {
    this.root.destroy();
    this.boxMesh.destroy();
    this.groundMaterial.destroy();
    this.slopeMaterial.destroy();
    this.stoneMaterial.destroy();
    for (const material of [
      this.routeMaterials.A,
      this.routeMaterials.B,
      this.routeMaterials.C,
    ]) {
      material.destroy();
    }
  }

  private createTerrainSteps(): void {
    const width = this.gameplay.arena.widthM;
    const depth = this.gameplay.arena.depthM;
    // 三段低模坡地让镜头能看到山脚→中段→山顶的高低差。
    this.createBlock(
      'FootHill',
      0,
      -1.25,
      -depth * 0.82,
      width * 1.55,
      2.5,
      depth * 0.45,
      this.slopeMaterial,
    );
    this.createBlock(
      'MidHill',
      0,
      -0.55,
      -depth * 0.53,
      width * 1.28,
      1.1,
      depth * 0.42,
      this.slopeMaterial,
    );
    this.createBlock(
      'TopRidge',
      0,
      -0.17,
      -depth * 0.18,
      width * 1.12,
      0.34,
      depth * 0.3,
      this.groundMaterial,
    );
    // 两侧山脊只做视觉边界，不占用三条服务器路线。
    this.createBlock(
      'WestBank',
      -width * 0.58,
      0.6,
      -depth * 0.58,
      width / 18,
      1.2,
      depth * 0.8,
      this.slopeMaterial,
    );
    this.createBlock(
      'EastBank',
      width * 0.58,
      0.42,
      -depth * 0.72,
      width / 18,
      0.84,
      depth * 0.62,
      this.slopeMaterial,
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
      A: depth * 0.7,
      B: depth * 0.95,
      C: depth * 1.2,
    };
    for (const routeId of ['A', 'B', 'C'] as const) {
      const markerWidth = width / 18;
      this.createBlock(
        `Route:${routeId}`,
        routeXs[routeId],
        0.028,
        -routeDepths[routeId] / 2,
        markerWidth,
        0.04,
        routeDepths[routeId],
        this.routeMaterials[routeId],
      );
    }
  }

  private createCoverLine(): void {
    const width = this.gameplay.arena.widthM;
    const depth = this.gameplay.arena.depthM;
    const coverWidth = width / 9;
    const coverHeight = 0.65;
    const coverDepth = 0.9;
    const positions: readonly [number, number][] = [
      [-width * 0.38, -depth * 0.16],
      [-width * 0.17, -depth * 0.28],
      [width * 0.05, -depth * 0.16],
      [width * 0.27, -depth * 0.28],
      [-width * 0.28, -depth * 0.48],
      [width * 0.34, -depth * 0.48],
    ];
    positions.forEach(([x, z], index) => {
      this.createBlock(
        `StoneCover:${index}`,
        x,
        coverHeight / 2,
        z,
        coverWidth,
        coverHeight,
        coverDepth,
        this.stoneMaterial,
      );
    });
  }

  private createRouteSigns(): void {
    const width = this.gameplay.arena.widthM;
    const depth = this.gameplay.arena.depthM;
    const laneSpacing = width / 3;
    const routeXs: Readonly<Record<RouteId, number>> = {
      A: -laneSpacing,
      B: 0,
      C: laneSpacing,
    };
    for (const routeId of ['A', 'B', 'C'] as const) {
      const x = routeXs[routeId];
      const z = -depth * 0.44;
      this.createBlock(
        `RouteSignPost:${routeId}`,
        x,
        0.6,
        z,
        0.18,
        1.2,
        0.18,
        this.routeMaterials[routeId],
      );
      this.createBlock(
        `RouteSignCap:${routeId}`,
        x,
        1.18,
        z,
        0.55,
        0.12,
        0.22,
        this.routeMaterials[routeId],
      );
    }
  }

  private createMachineGunBases(): void {
    const width = this.gameplay.arena.widthM;
    const depth = this.gameplay.arena.depthM;
    const baseWidth = width / 10;
    for (const [index, x] of [-width / 3, width / 3].entries()) {
      this.createBlock(
        `MachineGunBase:${index}`,
        x,
        0.18,
        -depth * 0.12,
        baseWidth,
        0.36,
        depth / 14,
        this.stoneMaterial,
      );
    }
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

  private createMaterial(colorHex: string): Material {
    const material = new Material();
    material.initialize({
      effectName: 'builtin-unlit',
      defines: { USE_COLOR: true },
    });
    material.setProperty('mainColor', Color.fromHEX(new Color(), colorHex));
    return material;
  }
}
