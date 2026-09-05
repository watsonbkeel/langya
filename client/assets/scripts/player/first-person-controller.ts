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
  readonly onFocusChanged: (focused: boolean, message?: string) => void;
}

interface MountedAimLimits {
  readonly baseYaw: number;
  readonly yawLimitDeg: number;
  readonly pitchMinDeg: number;
  readonly pitchMaxDeg: number;
}

const MAX_MOUSE_DELTA_PX = 120;
const FOOTSTEP_INTERVAL_SEC = 0.42;

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
  private footstepAccumulatorSec = 0;
  private audioContext: AudioContext | null = null;
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
      document.addEventListener(
        'pointerlockerror',
        this.onPointerLockError,
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

  isPointerLocked(): boolean {
    const canvas = game.canvas;
    return Boolean(
      canvas &&
        typeof document !== 'undefined' &&
        document.pointerLockElement === canvas,
    );
  }

  getCameraNode(): Node {
    return this.cameraNode;
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
    this.applyAimRotation();
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
      this.applyAimRotation();
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

    if (this.isPointerLocked() && this.isMoving()) {
      this.footstepAccumulatorSec += deltaTime;
      if (this.footstepAccumulatorSec >= FOOTSTEP_INTERVAL_SEC) {
        this.footstepAccumulatorSec -= FOOTSTEP_INTERVAL_SEC;
        this.playFootstep();
      }
    } else {
      this.footstepAccumulatorSec = 0;
    }
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
      document.removeEventListener(
        'pointerlockerror',
        this.onPointerLockError,
      );
    }
    this.cameraNode.destroy();
    void this.audioContext?.close();
    this.audioContext = null;
  }

  private onKeyDown(event: EventKeyboard): void {
    if (this.spectatorMode) {
      if (event.keyCode === KeyCode.KEY_Q) {
        this.actions.onSwitchWeapon();
      }
      return;
    }
    if (!this.isPointerLocked()) {
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
    // Pointer Lock 每个事件只消费一次 delta，并限制异常大跳变，避免
    // 重新锁定鼠标时出现视角过冲、翻转或眩晕。
    const deltaX = Math.max(
      -MAX_MOUSE_DELTA_PX,
      Math.min(MAX_MOUSE_DELTA_PX, event.getDeltaX()),
    );
    const deltaY = Math.max(
      -MAX_MOUSE_DELTA_PX,
      Math.min(MAX_MOUSE_DELTA_PX, event.getDeltaY()),
    );
    this.aimYaw -= deltaX * this.presentation.mouseSensitivityDeg;
    // Cocos 相机与协议统一使用“正 pitch 向上”，因此鼠标上移
    // (deltaY<0) 会增加 pitch，方向符合直觉。
    this.aimPitch -= deltaY * this.presentation.mouseSensitivityDeg;
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
    this.applyAimRotation();
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
      canvas.focus();
      const isLocked = document.pointerLockElement === canvas;
      if (!isLocked) {
        if (!this.pointerLockAttempted) {
          this.pointerLockAttempted = true;
          this.ignoreMouseUntilMs =
            performance.now() +
            this.presentation.pointerLockSettleSec * 1000;
          try {
            const request = canvas.requestPointerLock();
            void request?.catch(() => {
              this.pointerLockAttempted = false;
              this.actions.onFocusChanged(
                false,
                '浏览器未能锁定鼠标，请再次点击画面重试',
              );
            });
          } catch {
            this.pointerLockAttempted = false;
            this.actions.onFocusChanged(
              false,
              '浏览器未能锁定鼠标，请再次点击画面重试',
            );
          }
        }
        this.actions.onFocusChanged(
          false,
          '点击画面进入战斗（需要锁定鼠标）',
        );
        return;
      }
    }
    if (!this.isPointerLocked()) {
      return;
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
    this.fireHeld = false;
    if (this.isPointerLocked()) {
      this.actions.onFocusChanged(true);
    } else {
      this.pressedKeys.clear();
      this.actions.onFocusChanged(false, '鼠标已释放，点击画面继续');
    }
  };

  private readonly onPointerLockError = (): void => {
    this.pointerLockAttempted = false;
    this.fireHeld = false;
    this.pressedKeys.clear();
    this.actions.onFocusChanged(
      false,
      '浏览器未能锁定鼠标，请再次点击画面重试',
    );
  };

  private isMoving(): boolean {
    return (
      this.pressedKeys.has(KeyCode.KEY_W) ||
      this.pressedKeys.has(KeyCode.KEY_A) ||
      this.pressedKeys.has(KeyCode.KEY_S) ||
      this.pressedKeys.has(KeyCode.KEY_D)
    );
  }

  private playFootstep(): void {
    if (typeof AudioContext === 'undefined') {
      return;
    }
    this.audioContext ??= new AudioContext();
    const context = this.audioContext;
    void context.resume().catch(() => {
      // 浏览器尚未收到手势时静音，下一次移动继续尝试。
    });
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(78, context.currentTime);
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      context.currentTime + 0.08,
    );
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
  }

  private applyAimRotation(): void {
    // 始终显式清零 roll；只允许 yaw/pitch 两个自由度。
    this.cameraNode.setRotationFromEuler(this.aimPitch, this.aimYaw, 0);
  }
}
