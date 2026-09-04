import { _decorator, Component } from 'cc';

import { NetClient } from '../net/net-client';
import { ConnectionStatusView } from '../ui/connection-status-view';

const { ccclass } = _decorator;

@ccclass('GameEntry')
export class GameEntry extends Component {
  private netClient: NetClient | null = null;

  onLoad(): void {
    const view = ConnectionStatusView.create(this.node.parent ?? this.node);
    this.netClient = new NetClient((status) => view.render(status));
    void this.netClient.connect();
  }

  onDestroy(): void {
    this.netClient?.disconnect();
    this.netClient = null;
  }
}
