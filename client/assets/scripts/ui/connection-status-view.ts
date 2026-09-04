import { Color, Label, Node } from 'cc';

import type { ConnectionStatus } from '../net/net-client';

export class ConnectionStatusView {
  private readonly label: Label;

  private constructor(label: Label) {
    this.label = label;
  }

  static create(parent: Node): ConnectionStatusView {
    const node = new Node('ConnectionStatus');
    node.setParent(parent);

    const label = node.addComponent(Label);
    label.color = Color.WHITE;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;

    return new ConnectionStatusView(label);
  }

  render(status: ConnectionStatus): void {
    switch (status.kind) {
      case 'connecting':
        this.label.string = '正在连接…';
        break;
      case 'measuring':
        this.label.string = '已连接，正在测量延迟…';
        break;
      case 'connected':
        this.label.string = `已连接，延迟 ${status.latencyMs} ms`;
        break;
      case 'disconnected':
        this.label.string = '连接已断开';
        break;
      case 'error':
        this.label.string = `连接失败：${status.message}`;
        break;
    }
  }
}
