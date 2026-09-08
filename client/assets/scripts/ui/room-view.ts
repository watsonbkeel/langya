import {
  Button,
  Color,
  Graphics,
  Label,
  Layers,
  Node,
  UITransform,
  Vec3,
} from 'cc';

import type {
  RoomActionResultPayload,
  RoomSeatState,
  RoomStatePayload,
  RouteId,
} from '../../../../shared/protocol';
import type {
  PresentationConfig,
  WavesConfig,
} from '../config/game-config';

/** 大厅当前停留的界面。战斗开始后整个大厅节点隐藏。 */
export type RoomViewStage = 'entry' | 'joining' | 'room' | 'hidden';

export interface RoomViewHandlers {
  readonly onSoloStart: () => void;
  readonly onCreateRoom: () => void;
  readonly onJoinRoom: (roomCode: string) => void;
  readonly onQuickMatch: () => void;
  readonly onPlayerReady: () => void;
  readonly onStartMatch: () => void;
}

const REJECT_TEXT: Readonly<
  Record<NonNullable<RoomActionResultPayload['rejectReason']>, string>
> = {
  invalid_state: '当前状态不能做这个操作',
  invalid_room: '房间码不存在，请核对后重试',
  room_full: '这个房间已经满员了',
  already_started: '这一局已经开打，进不去了',
  not_host: '只有房主可以开始战斗',
  invalid_token: '重连凭证已失效，请重新进入',
};

/** 房间码只允许大写字母和数字，长度由服务器决定，这里只做输入侧净化。 */
const ROOM_CODE_PATTERN = /[^A-Z0-9]/g;

export class RoomView {
  private readonly root: Node;
  private readonly presentation: PresentationConfig;
  private readonly routeNames: Readonly<Record<RouteId, string>>;
  private readonly handlers: RoomViewHandlers;

  private readonly entryPanel: Node;
  private readonly joinPanel: Node;
  private readonly roomPanel: Node;

  private readonly titleLabel: Label;
  private readonly hintLabel: Label;
  private readonly codeInputLabel: Label;
  private readonly roomCodeLabel: Label;
  private readonly roomStatusLabel: Label;
  private readonly seatLabels: Label[] = [];
  private readonly readyButton: Node;
  private readonly startButton: Node;
  private readonly reconnectLabel: Label;

  private stage: RoomViewStage = 'entry';
  private codeInput = '';
  private isHost = false;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(
    canvas: Node,
    presentation: PresentationConfig,
    waves: WavesConfig,
    seatCount: number,
    handlers: RoomViewHandlers,
  ) {
    this.presentation = presentation;
    this.handlers = handlers;
    this.routeNames = {
      A: waves.routes.A.name,
      B: waves.routes.B.name,
      C: waves.routes.C.name,
    };

    this.root = new Node('RoomView');
    this.setUiLayer(this.root);
    this.root.setParent(canvas);

    const line = presentation.reportLineFontSizePx;
    const gap = presentation.reportLineGapPx;

    // 半透明底板，避免大厅文字直接压在 3D 战场上看不清。
    this.createBackdrop();

    this.titleLabel = this.createLabel(
      this.root,
      'RoomTitle',
      '狼牙山五壮士 · 集结',
      presentation.reportTitleFontSizePx,
      new Vec3(0, gap * 3, 0),
      '#F4E8C1',
    );
    this.hintLabel = this.createLabel(
      this.root,
      'RoomHint',
      '选择进入方式',
      line,
      new Vec3(0, gap * 2, 0),
      '#C8F4FF',
    );
    this.reconnectLabel = this.createLabel(
      this.root,
      'RoomReconnect',
      '',
      line,
      new Vec3(0, -gap * 4, 0),
      '#D9B86C',
    );

    this.entryPanel = this.createPanel('RoomEntryPanel');
    this.joinPanel = this.createPanel('RoomJoinPanel');
    this.roomPanel = this.createPanel('RoomSeatPanel');

    this.buildEntryPanel();
    this.codeInputLabel = this.createLabel(
      this.joinPanel,
      'RoomCodeInput',
      '_ _ _ _',
      presentation.reportTitleFontSizePx,
      new Vec3(0, gap, 0),
      '#F4E8C1',
    );
    this.buildJoinPanel();

    this.roomCodeLabel = this.createLabel(
      this.roomPanel,
      'RoomCodeDisplay',
      '',
      presentation.reportTitleFontSizePx,
      new Vec3(0, gap * 1.2, 0),
      '#F4E8C1',
    );
    this.roomStatusLabel = this.createLabel(
      this.roomPanel,
      'RoomStatus',
      '',
      presentation.helpFontSizePx,
      new Vec3(0, gap * 0.4, 0),
      '#DDE7EA',
    );
    for (let index = 0; index < seatCount; index += 1) {
      this.seatLabels.push(
        this.createLabel(
          this.roomPanel,
          `RoomSeat${index}`,
          '',
          line,
          new Vec3(0, -gap * 0.3 - index * line * 1.3, 0),
          '#DDE7EA',
        ),
      );
    }
    const buttonRowY = -gap * 0.3 - seatCount * line * 1.3 - gap * 0.8;
    this.readyButton = this.createButton(
      this.roomPanel,
      'RoomReadyButton',
      '我准备好了',
      new Vec3(-gap * 2.2, buttonRowY, 0),
      '#45B7C9',
      () => this.handlers.onPlayerReady(),
    );
    this.startButton = this.createButton(
      this.roomPanel,
      'RoomStartButton',
      '开始战斗',
      new Vec3(gap * 2.2, buttonRowY, 0),
      '#D9B86C',
      () => this.handlers.onStartMatch(),
    );

    this.bindKeyboard();
    this.setStage('entry');
  }

  /** 大厅是否还在挡着战斗画面。战斗输入要靠它判断能不能接管鼠标。 */
  isVisible(): boolean {
    return this.stage !== 'hidden';
  }

  getStage(): RoomViewStage {
    return this.stage;
  }

  setStage(stage: RoomViewStage): void {
    this.stage = stage;
    this.root.active = stage !== 'hidden';
    this.entryPanel.active = stage === 'entry';
    this.joinPanel.active = stage === 'joining';
    this.roomPanel.active = stage === 'room';
    if (stage === 'entry') {
      this.titleLabel.string = '狼牙山五壮士 · 集结';
      this.hintLabel.string = '选择进入方式';
    } else if (stage === 'joining') {
      this.titleLabel.string = '输入房间码';
      this.hintLabel.string = '键盘输入字母数字 · 回车确认 · ESC 返回';
    } else if (stage === 'room') {
      this.titleLabel.string = '等待队友集结';
    }
  }

  /** 大厅期间的通用提示：连接中、正在建房、被服务器拒绝等。 */
  setHint(text: string): void {
    this.hintLabel.string = text;
  }

  showRejectReason(payload: RoomActionResultPayload): void {
    const reason = payload.rejectReason;
    this.hintLabel.string = reason
      ? REJECT_TEXT[reason]
      : '服务器拒绝了这个操作';
  }

  /** 断线重连过程中的独立提示，不占用大厅主提示位。 */
  setReconnectNotice(text: string): void {
    this.reconnectLabel.string = text;
  }

  renderRoomState(payload: RoomStatePayload, selfId: string | null): void {
    this.roomCodeLabel.string = `房间码 ${payload.roomId}`;
    const humanCount = payload.seats.filter((seat) => !seat.isBot).length;
    this.roomStatusLabel.string =
      `真人 ${humanCount} / ${payload.seats.length} 席 · ` +
      `把房间码告诉同伴即可加入`;

    for (let index = 0; index < this.seatLabels.length; index += 1) {
      const label = this.seatLabels[index];
      if (!label) {
        continue;
      }
      const seat = payload.seats[index];
      if (!seat) {
        label.string = '';
        continue;
      }
      label.string = this.describeSeat(seat, selfId);
      label.color = Color.fromHEX(
        new Color(),
        seat.isBot ? '#8FA3AD' : seat.occupantId === selfId
          ? '#D9B86C'
          : '#C8F4FF',
      );
    }

    // 只有房主能开局，非房主看到的是灰掉的按钮而不是空白，避免困惑。
    this.startButton.active = this.isHost;
  }

  setHost(isHost: boolean): void {
    this.isHost = isHost;
    this.startButton.active = isHost;
  }

  destroy(): void {
    if (this.keyHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.root.destroy();
  }

  private describeSeat(seat: RoomSeatState, selfId: string | null): string {
    const route = this.routeNames[seat.routeId];
    const who = seat.isBot ? 'AI 队友' : seat.displayName;
    const mine = !seat.isBot && seat.occupantId === selfId ? '（你）' : '';
    return `${seat.seatIndex + 1}. ${seat.heroName} · ${who}${mine} · 守 ${route}`;
  }

  private buildEntryPanel(): void {
    const gap = this.presentation.reportLineGapPx;
    this.createButton(
      this.entryPanel,
      'SoloButton',
      '单人上阵（4 名 AI 队友）',
      new Vec3(0, gap * 0.8, 0),
      '#D9B86C',
      () => this.handlers.onSoloStart(),
    );
    this.createButton(
      this.entryPanel,
      'CreateRoomButton',
      '创建房间',
      new Vec3(0, 0, 0),
      '#45B7C9',
      () => this.handlers.onCreateRoom(),
    );
    this.createButton(
      this.entryPanel,
      'JoinRoomButton',
      '输入房间码加入',
      new Vec3(0, -gap * 0.8, 0),
      '#45B7C9',
      () => {
        this.codeInput = '';
        this.refreshCodeInput();
        this.setStage('joining');
      },
    );
    this.createButton(
      this.entryPanel,
      'QuickMatchButton',
      '快速匹配',
      new Vec3(0, -gap * 1.6, 0),
      '#45B7C9',
      () => this.handlers.onQuickMatch(),
    );
  }

  private buildJoinPanel(): void {
    const gap = this.presentation.reportLineGapPx;
    this.createButton(
      this.joinPanel,
      'JoinConfirmButton',
      '确认加入',
      new Vec3(-gap * 2, -gap * 0.6, 0),
      '#D9B86C',
      () => this.submitCode(),
    );
    this.createButton(
      this.joinPanel,
      'JoinBackButton',
      '返回',
      new Vec3(gap * 2, -gap * 0.6, 0),
      '#8FA3AD',
      () => this.setStage('entry'),
    );
  }

  private submitCode(): void {
    if (this.codeInput.length === 0) {
      this.hintLabel.string = '请先输入房间码';
      return;
    }
    this.handlers.onJoinRoom(this.codeInput);
  }

  /**
   * Cocos 没有现成的轻量文本框，房间码这种短输入直接接管键盘事件即可，
   * 比引入 EditBox 预制体更符合「场景由代码生成」的约束。
   */
  private bindKeyboard(): void {
    if (typeof window === 'undefined') {
      return;
    }
    this.keyHandler = (event: KeyboardEvent) => {
      if (this.stage !== 'joining') {
        return;
      }
      if (event.key === 'Enter') {
        this.submitCode();
        return;
      }
      if (event.key === 'Escape') {
        this.setStage('entry');
        return;
      }
      if (event.key === 'Backspace') {
        this.codeInput = this.codeInput.slice(0, -1);
        this.refreshCodeInput();
        return;
      }
      if (event.key.length === 1) {
        const next = event.key.toUpperCase().replace(ROOM_CODE_PATTERN, '');
        if (next.length === 1) {
          this.codeInput += next;
          this.refreshCodeInput();
        }
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  private refreshCodeInput(): void {
    this.codeInputLabel.string =
      this.codeInput.length > 0 ? this.codeInput : '_ _ _ _';
  }

  private createBackdrop(): void {
    const node = new Node('RoomBackdrop');
    this.setUiLayer(node);
    node.setParent(this.root);
    const graphics = node.addComponent(Graphics);
    // 略透一点，能隐约看到后面的战场，但不影响读字。
    const backdrop = Color.fromHEX(new Color(), '#183040');
    backdrop.a = 224;
    graphics.fillColor = backdrop;
    graphics.rect(
      -this.presentation.designWidth / 2,
      -this.presentation.designHeight / 2,
      this.presentation.designWidth,
      this.presentation.designHeight,
    );
    graphics.fill();
  }

  private createPanel(name: string): Node {
    const node = new Node(name);
    this.setUiLayer(node);
    node.setParent(this.root);
    return node;
  }

  private createButton(
    parent: Node,
    name: string,
    text: string,
    position: Vec3,
    colorHex: string,
    onClick: () => void,
  ): Node {
    const width = this.presentation.reportLineFontSizePx * 12;
    const height = this.presentation.reportLineFontSizePx * 2;
    const node = new Node(name);
    this.setUiLayer(node);
    node.setParent(parent);
    node.setPosition(position);
    node.addComponent(UITransform).setContentSize(width, height);

    const background = node.addComponent(Graphics);
    background.fillColor = Color.fromHEX(new Color(), colorHex);
    background.rect(-width / 2, -height / 2, width, height);
    background.fill();

    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    node.on(Button.EventType.CLICK, onClick, this);

    const labelNode = new Node(`${name}Label`);
    this.setUiLayer(labelNode);
    labelNode.setParent(node);
    labelNode.addComponent(UITransform).setContentSize(width, height);
    const label = labelNode.addComponent(Label);
    label.string = text;
    label.fontSize = this.presentation.reportLineFontSizePx;
    label.lineHeight = this.presentation.reportLineFontSizePx;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.NONE;
    label.color = Color.fromHEX(new Color(), '#183040');
    return node;
  }

  private createLabel(
    parent: Node,
    name: string,
    text: string,
    fontSize: number,
    position: Vec3,
    colorHex: string,
  ): Label {
    const node = new Node(name);
    this.setUiLayer(node);
    node.setParent(parent);
    node.setPosition(position);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.NONE;
    label.color = Color.fromHEX(new Color(), colorHex);
    return label;
  }

  private setUiLayer(node: Node): void {
    node.layer = Layers.Enum.UI_2D;
  }
}
