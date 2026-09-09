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

/**
 * 大厅当前停留的界面。战斗开始后整个大厅节点隐藏。
 * briefing 是进游戏的第一屏：历史背景 + 任务目标 + 操作提示 + 动员，
 * 玩家点「接受任务」后才到 entry 选进入方式。
 */
export type RoomViewStage =
  | 'briefing'
  | 'entry'
  | 'joining'
  | 'room'
  | 'hidden';

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

  private readonly briefingPanel: Node;
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
  /** 动员页只看一次；没看完之前，所有回 entry 的请求都停在动员页。 */
  private briefingAccepted = false;
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
      // 放到动员页按钮下方，重连提示在任何阶段都不压正文。
      new Vec3(0, -gap * 7.2, 0),
      '#D9B86C',
    );

    this.briefingPanel = this.createPanel('RoomBriefingPanel');
    this.buildBriefingPanel(waves);
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

  setStage(requested: RoomViewStage): void {
    // 还没接受任务就不让进大厅；重连直接进战斗（hidden）不受影响。
    const stage: RoomViewStage =
      requested === 'entry' && !this.briefingAccepted ? 'briefing' : requested;
    this.stage = stage;
    this.root.active = stage !== 'hidden';
    this.briefingPanel.active = stage === 'briefing';
    this.entryPanel.active = stage === 'entry';
    this.joinPanel.active = stage === 'joining';
    this.roomPanel.active = stage === 'room';
    this.titleLabel.node.active = stage !== 'briefing';
    this.hintLabel.node.active = stage !== 'briefing';
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

  /**
   * 开场动员页。数字（分钟、波数、敌军总数、补给窗口）全部从 waves.json 读，
   * 改配置不用改文案。
   */
  private buildBriefingPanel(waves: WavesConfig): void {
    const panel = this.briefingPanel;
    const p = this.presentation;
    const body = p.hudFontSizePx;
    const minutes = Math.round(waves.matchDurationSec / 60);
    const routeList =
      `${waves.routes.A.name} / ${waves.routes.B.name} / ${waves.routes.C.name}`;

    this.createLabel(
      panel,
      'BriefingTitle',
      '狼牙山五壮士',
      p.reportTitleFontSizePx,
      new Vec3(0, 200, 0),
      '#F4E8C1',
    );
    this.createLabel(
      panel,
      'BriefingDate',
      '1941 年 9 月 25 日 · 河北易县 · 棋盘陀',
      body,
      new Vec3(0, 158, 0),
      '#C8F4FF',
    );

    const story = [
      '日军三千五百余人合围狼牙山，主力部队和数万乡亲正在转移。',
      '七连六班五名战士奉命断后，把敌人引上棋盘陀绝顶——你就是其中之一。',
    ];
    story.forEach((text, index) => {
      this.createLabel(
        panel,
        `BriefingStory${index}`,
        text,
        body,
        new Vec3(0, 112 - index * 28, 0),
        '#DDE7EA',
      );
    });

    this.createLabel(
      panel,
      'BriefingTaskTitle',
      '作战任务',
      body,
      new Vec3(0, 42, 0),
      '#FFD56A',
    );
    const tasks = [
      `① 坚守棋盘陀 ${minutes} 分钟，顶住 ${waves.waves.length} 波、共 ${waves.totalEnemies} 名敌军`,
      `② 三条上山路：${routeList}，队友分守，哪里吃紧你就去哪里`,
      `③ 波次之间有 ${waves.intermissionSec} 秒补给窗口，抓紧捡弹药、补血包、上重机枪`,
    ];
    tasks.forEach((text, index) => {
      this.createLabel(
        panel,
        `BriefingTask${index}`,
        text,
        body,
        new Vec3(0, 12 - index * 28, 0),
        '#DDE7EA',
      );
    });

    this.createLabel(
      panel,
      'BriefingControls',
      'WASD 移动 · 鼠标瞄准 · 左键射击 · R 换弹 · Q 换枪 · G 手榴弹 · H 血包 · F 上重机枪 / 拾取',
      p.helpFontSizePx,
      new Vec3(0, -84, 0),
      '#8FA3AD',
    );

    this.createLabel(
      panel,
      'BriefingRally0',
      '身后是转移中的乡亲和大部队，退无可退。',
      p.reportLineFontSizePx,
      new Vec3(0, -130, 0),
      '#FFD56A',
    );
    this.createLabel(
      panel,
      'BriefingRally1',
      '子弹打光就用石头——这座山，一定要拿下！',
      p.reportLineFontSizePx,
      new Vec3(0, -162, 0),
      '#FFD56A',
    );

    this.createButton(
      panel,
      'BriefingAcceptButton',
      '接受任务，上山！',
      new Vec3(0, -236, 0),
      '#D9B86C',
      () => this.acceptBriefing(),
    );
    this.createLabel(
      panel,
      'BriefingKeyHint',
      '按回车 / 空格也可继续',
      p.helpFontSizePx,
      new Vec3(0, -272, 0),
      '#8FA3AD',
    );
  }

  private acceptBriefing(): void {
    if (this.briefingAccepted) {
      return;
    }
    this.briefingAccepted = true;
    this.setStage('entry');
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
      if (this.stage === 'briefing') {
        if (event.key === 'Enter' || event.key === ' ') {
          this.acceptBriefing();
        }
        return;
      }
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
