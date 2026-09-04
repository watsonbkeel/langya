import {
  Camera,
  Color,
  EventKeyboard,
  EventMouse,
  game,
  input,
  Input,
  KeyCode,
  Layers,
  Node,
  Vec3,
} from 'cc';

import type { Vector2, Vector3 } from '../../../../shared/protocol';
import type {
  GameplayConfig,
  PresentationConfig,
} from '../config/game-config';

export interface FirstPersonActions {
  readonly onFire: () => void;
  readonly onReload: () => void;
  readonly onSwitchWeapon: () => void;
  readonly onUseMedkit: () => void;
  readonly onThrowGrenade: () => void;
  readonly onInteract: () => void;
}

interface MountedAimLimits {
  readonly baseYaw: number;
  readonly yawLimitDeg: number;
  readonly pitchMinDeg: number;
  readonly pitchMaxDeg: number;
}

export class FirstPersonController {
  private readonly cameraNode: Node;
  private readonly gameplay: GameplayConfig;
  private readonly presentation: PresentationConfig;
  private readonly actions: FirstPersonActions;
  private readonly pressedKeys = new Set<KeyCode>();
  private readonly targetPosition = new Vec3();
  private readonly renderedPosition = new Vec3();
  private aimYaw = 0;
  private aimPitch = 0;
  private hasPosition = false;
  private mountedAimLimits: MountedAimLimits | null = null;
  private pointerLockAttempted = false;
  private ignoreMouseUntilMs = 0;
  private fireHeld = false;
  private spectatorMode = false;
  private readonly preventContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  constructor(
    sceneRoot: Node,
    gameplay: GameplayConfig,
    presentation: PresentationConfig,
    actions: FirstPersonActions,
  ) {
    this.gameplay = gameplay;
    this.presentation = presentation;
    this.actions = actions;

    this.cameraNode = new Node('FirstPersonCamera');
    this.cameraNode.setParent(sceneRoot);
    const camera = this.cameraNode.addComponent(Camera);
    camera.projection = Camera.ProjectionType.PERSPECTIVE;
    camera.fov = presentation.cameraFovDeg;
    camera.near = presentation.cameraNearM;
    camera.far = presentation.cameraFarM;
    camera.priority = 0;
    camera.visibility = Layers.Enum.DEFAULT;
    camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    camera.clearColor = Color.fromHEX(new Color(), presentation.skyColor);

    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
    input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
    input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    if (typeof document !== 'undefined') {
      document.addEventListener('contextmenu', this.preventContextMenu);
      document.addEventListener(
        'pointerlockchange',
        this.onPointerLockChange,
      );
    }
  }

  setAuthoritativePosition(position: Vector3): void {
    if (this.spectatorMode) {
      return;
    }
    this.targetPosition.set(position.x, position.y, position.z);
    if (!this.hasPosition) {
      this.renderedPosition.set(this.targetPosition);
      this.cameraNode.setPosition(this.renderedPosition);
      this.hasPosition = true;
    }
  }

  getInputState(): {
    readonly moveDir: Vector2;
    readonly aimYaw: number;
    readonly aimPitch: number;
    readonly isCrouch: boolean;
  } {
    const horizontal =
      (this.pressedKeys.has(KeyCode.KEY_D) ? 1 : 0) -
      (this.pressedKeys.has(KeyCode.KEY_A) ? 1 : 0);
    const forward =
      (this.pressedKeys.has(KeyCode.KEY_W) ? 1 : 0) -
      (this.pressedKeys.has(KeyCode.KEY_S) ? 1 : 0);

    return {
      moveDir: { x: horizontal, y: forward },
      aimYaw: this.aimYaw,
      aimPitch: this.aimPitch,
      isCrouch:
        this.pressedKeys.has(KeyCode.CTRL_LEFT) ||
        this.pressedKeys.has(KeyCode.CTRL_RIGHT),
    };
  }

  getAimDirection(): Vector3 {
    const yaw = (this.aimYaw * Math.PI) / 180;
    const pitch = (this.aimPitch * Math.PI) / 180;
    const horizontal = Math.cos(pitch);
    return {
      x: -Math.sin(yaw) * horizontal,
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * horizontal,
    };
  }

  isFireHeld(): boolean {
    return !this.spectatorMode && this.fireHeld;
  }

  setSpectatorTarget(
    position: Vector3,
    aimYaw: number,
    aimPitch: number,
  ): void {
    this.spectatorMode = true;
    this.fireHeld = false;
    this.pressedKeys.clear();
    this.targetPosition.set(position.x, position.y, position.z);
    this.aimYaw = aimYaw;
    this.aimPitch = aimPitch;
    this.cameraNode.setRotationFromEuler(aimPitch, aimYaw, 0);
    if (!this.hasPosition) {
      this.renderedPosition.set(this.targetPosition);
      this.cameraNode.setPosition(this.renderedPosition);
      this.hasPosition = true;
    }
  }

  leaveSpectatorMode(): void {
    this.spectatorMode = false;
  }

  setMountedAimLimits(limits: MountedAimLimits | null): void {
    this.mountedAimLimits = limits;
    if (limits) {
      this.aimYaw = limits.baseYaw;
      this.aimPitch = Math.min(
        limits.pitchMaxDeg,
        Math.max(limits.pitchMinDeg, this.aimPitch),
      );
      this.cameraNode.setRotationFromEuler(
        this.aimPitch,
        this.aimYaw,
        0,
      );
    }
  }

  update(deltaTime: number): void {
    if (!this.hasPosition) {
      return;
    }

    const interpolation = Math.min(
      1,
      this.presentation.cameraPositionSmoothing * deltaTime,
    );
    Vec3.lerp(
      this.renderedPosition,
      this.renderedPosition,
      this.targetPosition,
      interpolation,
    );
    this.cameraNode.setPosition(this.renderedPosition);
  }

  destroy(): void {
    input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
    input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
    input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
    input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    if (typeof document !== 'undefined') {
      document.removeEventListener('contextmenu', this.preventContextMenu);
      document.removeEventListener(
        'pointerlockchange',
        this.onPointerLockChange,
      );
    }
    this.cameraNode.destroy();
  }

  private onKeyDown(event: EventKeyboard): void {
    if (this.spectatorMode) {
      if (event.keyCode === KeyCode.KEY_Q) {
        this.actions.onSwitchWeapon();
      }
      return;
    }
    const firstPress = !this.pressedKeys.has(event.keyCode);
    this.pressedKeys.add(event.keyCode);
    if (firstPress && event.keyCode === KeyCode.KEY_R) {
      this.actions.onReload();
    } else if (firstPress && event.keyCode === KeyCode.KEY_Q) {
      this.actions.onSwitchWeapon();
    } else if (firstPress && event.keyCode === KeyCode.KEY_H) {
      this.actions.onUseMedkit();
    } else if (firstPress && event.keyCode === KeyCode.KEY_G) {
      this.actions.onThrowGrenade();
    } else if (firstPress && event.keyCode === KeyCode.KEY_F) {
      this.actions.onInteract();
    }
  }

  private onKeyUp(event: EventKeyboard): void {
    if (this.spectatorMode) {
      return;
    }
    this.pressedKeys.delete(event.keyCode);
  }

  private onMouseMove(event: EventMouse): void {
    if (this.spectatorMode) {
      return;
    }
    const canvas = game.canvas;
    if (
      canvas &&
      typeof document !== 'undefined' &&
      document.pointerLockElement !== canvas
    ) {
      return;
    }
    if (performance.now() < this.ignoreMouseUntilMs) {
      return;
    }
    this.aimYaw -= event.getDeltaX() * this.presentation.mouseSensitivityDeg;
    this.aimPitch -=
      event.getDeltaY() * this.presentation.mouseSensitivityDeg;
    const pitchMin =
      this.mountedAimLimits?.pitchMinDeg ??
      this.gameplay.player.aimPitchMinDeg;
    const pitchMax =
      this.mountedAimLimits?.pitchMaxDeg ??
      this.gameplay.player.aimPitchMaxDeg;
    this.aimPitch = Math.min(
      pitchMax,
      Math.max(pitchMin, this.aimPitch),
    );
    if (this.mountedAimLimits) {
      this.aimYaw = Math.min(
        this.mountedAimLimits.baseYaw +
          this.mountedAimLimits.yawLimitDeg,
        Math.max(
          this.mountedAimLimits.baseYaw -
            this.mountedAimLimits.yawLimitDeg,
          this.aimYaw,
        ),
      );
    }
    this.cameraNode.setRotationFromEuler(this.aimPitch, this.aimYaw, 0);
  }

  private onMouseDown(event: EventMouse): void {
    if (this.spectatorMode) {
      return;
    }
    if (event.getButton() !== EventMouse.BUTTON_LEFT) {
      return;
    }

    const canvas = game.canvas;
    if (canvas && typeof document !== 'undefined') {
      const isLocked = document.pointerLockElement === canvas;
      if (!isLocked && !this.pointerLockAttempted) {
        this.pointerLockAttempted = true;
        this.ignoreMouseUntilMs =
          performance.now() +
          this.presentation.pointerLockSettleSec * 1000;
        void canvas.requestPointerLock().catch(() => {
          // 内嵌浏览器可能禁用 Pointer Lock，下一次点击会走兼容开火路径。
        });
        return;
      }
    }
    this.fireHeld = true;
    this.actions.onFire();
  }

  private onMouseUp(event: EventMouse): void {
    if (event.getButton() === EventMouse.BUTTON_LEFT) {
      this.fireHeld = false;
    }
  }

  private readonly onPointerLockChange = (): void => {
    this.pointerLockAttempted = false;
    this.ignoreMouseUntilMs =
      performance.now() + this.presentation.pointerLockSettleSec * 1000;
  };
}
