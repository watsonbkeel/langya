import { randomInt } from 'node:crypto';

import type { RouteId } from '../../../shared/protocol';
import {
  MultiplayerRoom,
  type MultiplayerRoomConfig,
} from './multiplayer-room';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomManager<TRouteId extends RouteId> {
  private readonly rooms = new Map<
    string,
    MultiplayerRoom<TRouteId>
  >();

  constructor(private readonly config: MultiplayerRoomConfig<TRouteId>) {}

  create(
    hostId: string,
    hostName: string,
  ): MultiplayerRoom<TRouteId> {
    const roomCode = this.createUniqueCode();
    const room = new MultiplayerRoom({
      roomCode,
      hostId,
      hostName,
      config: this.config,
    });
    this.rooms.set(roomCode, room);
    return room;
  }

  get(roomCode: string): MultiplayerRoom<TRouteId> | undefined {
    return this.rooms.get(roomCode.toUpperCase());
  }

  delete(roomCode: string): boolean {
    return this.rooms.delete(roomCode.toUpperCase());
  }

  listActive(): readonly MultiplayerRoom<TRouteId>[] {
    const result: MultiplayerRoom<TRouteId>[] = [];
    for (const room of this.rooms.values()) {
      if (room.status !== 'ended') {
        result.push(room);
      }
    }
    return result;
  }

  private createUniqueCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = '';
      for (let index = 0; index < 4; index += 1) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    throw new Error('暂时无法生成唯一房间码');
  }
}
