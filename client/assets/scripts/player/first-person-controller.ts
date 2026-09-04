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
  private pointerLockAttempted = false;
  private ignoreMouseUntilMs = 0;
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
    if (typeof document !== 'undefined') {
      document.addEventListener('contextmenu', this.preventContextMenu);
      document.addEventListener(
        'pointerlockchange',
        this.onPointerLockChange,
      );
    }
  }

  setAuthoritativePosition(position: Vector3): void {
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
    const firstPress = !this.pressedKeys.has(event.keyCode);
    this.pressedKeys.add(event.keyCode);
    if (firstPress && event.keyCode === KeyCode.KEY_R) {
      this.actions.onReload();
    }
  }

  private onKeyUp(event: EventKeyboard): void {
    this.pressedKeys.delete(event.keyCode);
  }

  private onMouseMove(event: EventMouse): void {
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
    this.aimPitch = Math.min(
      this.gameplay.player.aimPitchMaxDeg,
      Math.max(this.gameplay.player.aimPitchMinDeg, this.aimPitch),
    );
    this.cameraNode.setRotationFromEuler(this.aimPitch, this.aimYaw, 0);
  }

  private onMouseDown(event: EventMouse): void {
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
    this.actions.onFire();
  }

  private readonly onPointerLockChange = (): void => {
    this.pointerLockAttempted = false;
    this.ignoreMouseUntilMs =
      performance.now() + this.presentation.pointerLockSettleSec * 1000;
  };
}
