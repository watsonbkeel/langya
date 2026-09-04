import {
  Color,
  Material,
  Mesh,
  MeshRenderer,
  Node,
  primitives,
  utils,
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
  private readonly mesh: Mesh;
  private readonly supplyMaterial: Material;
  private readonly rackMaterial: Material;
  private readonly machineGunMaterial: Material;
  private readonly hotMachineGunMaterial: Material;
  private readonly gameplay: GameplayConfig;
  private readonly presentation: PresentationConfig;
  private readonly weapons: WeaponsConfig;
  private readonly itemNodes = new Map<string, Node>();
  private readonly machineGunNodes = new Map<string, Node>();
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
    this.mesh = utils.createMesh(
      primitives.box({ width: 1, height: 1, length: 1 }),
    );
    this.supplyMaterial = this.createMaterial(presentation.supplyColor);
    this.rackMaterial = this.createMaterial(presentation.weaponRackColor);
    this.machineGunMaterial = this.createMaterial(
      presentation.machineGunColor,
    );
    this.hotMachineGunMaterial = this.createMaterial(
      presentation.machineGunHotColor,
    );
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
    this.supplyMaterial.destroy();
    this.rackMaterial.destroy();
    this.machineGunMaterial.destroy();
    this.hotMachineGunMaterial.destroy();
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
        node = this.createNode(`Item:${item.id}`);
        this.itemNodes.set(item.id, node);
      }
      const size = this.presentation.worldItemSizeM;
      node.setPosition(item.position.x, item.position.y + size / 2, item.position.z);
      node.setScale(size, size, size);
      node
        .getComponent(MeshRenderer)
        ?.setSharedMaterial(
          item.kind === 'airdrop_medkit'
            ? this.supplyMaterial
            : this.rackMaterial,
          0,
        );
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
        node = this.createNode(`MachineGun:${gun.id}`);
        this.machineGunNodes.set(gun.id, node);
      }
      node.setPosition(gun.position.x, gun.position.y, gun.position.z);
      node.setRotationFromEuler(0, gun.baseYaw, 0);
      node.setScale(
        this.presentation.machineGunWidthM,
        this.presentation.machineGunHeightM,
        this.presentation.machineGunLengthM,
      );
      node
        .getComponent(MeshRenderer)
        ?.setSharedMaterial(
          gun.isOverheated
            ? this.hotMachineGunMaterial
            : this.machineGunMaterial,
          0,
        );
    }
    for (const [gunId, node] of this.machineGunNodes) {
      if (!visibleIds.has(gunId)) {
        this.machineGunNodes.delete(gunId);
        node.destroy();
      }
    }
  }

  private createNode(name: string): Node {
    const node = new Node(name);
    node.setParent(this.root);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = this.mesh;
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
