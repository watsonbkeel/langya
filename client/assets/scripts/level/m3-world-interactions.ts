import {
  Color,
  Material,
  Mesh,
  MeshRenderer,
  Node,
} from 'cc';

import type {
  ItemState,
  MachineGunState,
  Vector3,
} from '../../../../shared/protocol';
import type {
  GameplayConfig,
  PresentationConfig,
  WeaponsConfig,
} from '../config/game-config';
import {
  createBillboard,
  createBillboardMaterial,
  createBillboardMesh,
  faceBillboardToCamera,
  loadTexture,
} from '../core/billboard';

export type InteractionTarget =
  | {
      readonly kind: 'pickup';
      readonly id: string;
      readonly label: string;
      readonly distanceM: number;
    }
  | {
      readonly kind: 'mount_mg';
      readonly id: string;
      readonly label: string;
      readonly distanceM: number;
    }
  | {
      readonly kind: 'unmount_mg';
      readonly id: string;
      readonly label: string;
      readonly distanceM: 0;
    };

export class M3WorldInteractions {
  private readonly root: Node;
  private readonly billboardMesh: Mesh;
  private readonly supplyMaterial: Material;
  private readonly rackMaterial: Material;
  private readonly machineGunMaterial: Material;
  private readonly hotMachineGunMaterial: Material;
  private readonly gameplay: GameplayConfig;
  private readonly presentation: PresentationConfig;
  private readonly weapons: WeaponsConfig;
  private readonly itemNodes = new Map<string, Node>();
  private readonly machineGunNodes = new Map<string, Node>();
  private cameraNode: Node | null = null;
  private supplyReady = false;
  private rackReady = false;
  private machineGunReady = false;
  private items: readonly ItemState[] = [];
  private machineGuns: readonly MachineGunState[] = [];

  constructor(
    sceneRoot: Node,
    gameplay: GameplayConfig,
    presentation: PresentationConfig,
    weapons: WeaponsConfig,
  ) {
    this.gameplay = gameplay;
    this.presentation = presentation;
    this.weapons = weapons;
    this.root = new Node('M3Interactions');
    this.root.setParent(sceneRoot);
    this.billboardMesh = createBillboardMesh();
    this.supplyMaterial = createBillboardMaterial();
    this.rackMaterial = createBillboardMaterial();
    this.machineGunMaterial = createBillboardMaterial();
    this.hotMachineGunMaterial = createBillboardMaterial();
    this.hotMachineGunMaterial.setProperty(
      'mainColor',
      Color.fromHEX(new Color(), presentation.machineGunHotColor),
    );
    this.loadVisualAssets();
  }

  setCameraNode(cameraNode: Node): void {
    this.cameraNode = cameraNode;
  }

  update(): void {
    for (const node of this.itemNodes.values()) {
      faceBillboardToCamera(
        node.getChildByName('Billboard') ?? node,
        this.cameraNode,
      );
    }
    for (const node of this.machineGunNodes.values()) {
      faceBillboardToCamera(
        node.getChildByName('Billboard') ?? node,
        this.cameraNode,
      );
    }
  }

  sync(
    items: readonly ItemState[],
    machineGuns: readonly MachineGunState[],
  ): void {
    this.items = items;
    this.machineGuns = machineGuns;
    this.syncItems(items);
    this.syncMachineGuns(machineGuns);
  }

  findInteraction(
    playerPosition: Vector3,
    mountedMgId: string | undefined,
    availableWeaponIds: readonly string[],
  ): InteractionTarget | undefined {
    if (mountedMgId) {
      return {
        kind: 'unmount_mg',
        id: mountedMgId,
        label: '按 F 下重机枪',
        distanceM: 0,
      };
    }

    const candidates: InteractionTarget[] = [];
    for (const item of this.items) {
      if (!item.available) {
        continue;
      }
      if (
        item.kind === 'weapon_rack' &&
        availableWeaponIds.indexOf(item.weaponId) >= 0
      ) {
        continue;
      }
      const distanceM = distanceBetween(playerPosition, item.position);
      if (distanceM > this.gameplay.arena.itemPickupRangeM) {
        continue;
      }
      candidates.push({
        kind: 'pickup',
        id: item.id,
        label:
          item.kind === 'airdrop_medkit'
            ? '按 F 拾取空投血包'
            : `按 F 拾取 ${this.weaponName(item.weaponId)}`,
        distanceM,
      });
    }
    for (const gun of this.machineGuns) {
      const distanceM = distanceBetween(playerPosition, gun.position);
      if (
        distanceM > this.gameplay.arena.machineGunMountRangeM ||
        gun.occupantId !== undefined
      ) {
        continue;
      }
      candidates.push({
        kind: 'mount_mg',
        id: gun.id,
        label: '按 F 上重机枪',
        distanceM,
      });
    }
    candidates.sort((first, second) => first.distanceM - second.distanceM);
    return candidates[0];
  }

  getMachineGun(id: string | undefined): MachineGunState | undefined {
    return id
      ? this.machineGuns.find((machineGun) => machineGun.id === id)
      : undefined;
  }

  destroy(): void {
    this.itemNodes.clear();
    this.machineGunNodes.clear();
    this.root.destroy();
    this.billboardMesh.destroy();
    this.supplyMaterial.destroy();
    this.rackMaterial.destroy();
    this.machineGunMaterial.destroy();
    this.hotMachineGunMaterial.destroy();
  }

  private loadVisualAssets(): void {
    loadTexture('scene/supply-crate', (texture) => {
      if (!this.root.isValid) {
        return;
      }
      this.supplyMaterial.setProperty('mainTexture', texture);
      this.supplyReady = true;
      this.refreshItemRenderers();
    });
    loadTexture('scene/weapon-rack', (texture) => {
      if (!this.root.isValid) {
        return;
      }
      this.rackMaterial.setProperty('mainTexture', texture);
      this.rackReady = true;
      this.refreshItemRenderers();
    });
    loadTexture('weapons/fp/type92-hmg', (texture) => {
      if (!this.root.isValid) {
        return;
      }
      this.machineGunMaterial.setProperty('mainTexture', texture);
      this.hotMachineGunMaterial.setProperty('mainTexture', texture);
      this.machineGunReady = true;
      for (const [gunId, node] of this.machineGunNodes) {
        const state = this.machineGuns.find((gun) => gun.id === gunId);
        this.applyMachineGunVisual(node, state?.isOverheated ?? false);
      }
    });
  }

  private syncItems(items: readonly ItemState[]): void {
    const visibleIds = new Set<string>();
    for (const item of items) {
      if (!item.available) {
        continue;
      }
      visibleIds.add(item.id);
      let node = this.itemNodes.get(item.id);
      if (!node) {
        node = this.createBillboardNode(`Item:${item.id}`);
        this.itemNodes.set(item.id, node);
      }
      const isSupply = item.kind === 'airdrop_medkit';
      const width = this.presentation.worldItemSizeM * (isSupply ? 2 : 3.2);
      const height = this.presentation.worldItemSizeM * (isSupply ? 1.5 : 3);
      node.setPosition(
        item.position.x,
        item.position.y + height / 2,
        item.position.z,
      );
      node.setScale(width, height, 1);
      const renderer = this.getBillboardRenderer(node);
      renderer?.setSharedMaterial(
        isSupply ? this.supplyMaterial : this.rackMaterial,
        0,
      );
      if (renderer) {
        renderer.enabled = isSupply ? this.supplyReady : this.rackReady;
      }
    }
    for (const [itemId, node] of this.itemNodes) {
      if (!visibleIds.has(itemId)) {
        this.itemNodes.delete(itemId);
        node.destroy();
      }
    }
  }

  private syncMachineGuns(machineGuns: readonly MachineGunState[]): void {
    const visibleIds = new Set<string>();
    for (const gun of machineGuns) {
      visibleIds.add(gun.id);
      let node = this.machineGunNodes.get(gun.id);
      if (!node) {
        node = this.createBillboardNode(`MachineGun:${gun.id}`);
        this.machineGunNodes.set(gun.id, node);
      }
      const width = this.presentation.machineGunLengthM * 1.5;
      const height = this.presentation.machineGunHeightM * 1.7;
      node.setPosition(
        gun.position.x,
        gun.position.y + height / 2,
        gun.position.z,
      );
      node.setScale(width, height, 1);
      this.applyMachineGunVisual(node, gun.isOverheated);
    }
    for (const [gunId, node] of this.machineGunNodes) {
      if (!visibleIds.has(gunId)) {
        this.machineGunNodes.delete(gunId);
        node.destroy();
      }
    }
  }

  private refreshItemRenderers(): void {
    for (const item of this.items) {
      const node = this.itemNodes.get(item.id);
      const renderer = node ? this.getBillboardRenderer(node) : null;
      if (!renderer) {
        continue;
      }
      const isSupply = item.kind === 'airdrop_medkit';
      renderer.setSharedMaterial(
        isSupply ? this.supplyMaterial : this.rackMaterial,
        0,
      );
      renderer.enabled = isSupply ? this.supplyReady : this.rackReady;
    }
  }

  private applyMachineGunVisual(node: Node, overheated: boolean): void {
    const renderer = this.getBillboardRenderer(node);
    if (!renderer) {
      return;
    }
    renderer.setSharedMaterial(
      overheated ? this.hotMachineGunMaterial : this.machineGunMaterial,
      0,
    );
    renderer.enabled = this.machineGunReady;
  }

  private createBillboardNode(name: string): Node {
    const node = new Node(name);
    node.setParent(this.root);
    const renderer = createBillboard(
      node,
      null,
      this.billboardMesh,
      this.supplyMaterial,
      { centerY: 0, widthScale: 1 },
    );
    renderer.enabled = false;
    return node;
  }

  private getBillboardRenderer(node: Node): MeshRenderer | null {
    return node.getChildByName('Billboard')?.getComponent(MeshRenderer) ?? null;
  }

  private weaponName(weaponId: string): string {
    return this.weapons.player[weaponId]?.displayName ?? weaponId;
  }
}

function distanceBetween(first: Vector3, second: Vector3): number {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    first.z - second.z,
  );
}
