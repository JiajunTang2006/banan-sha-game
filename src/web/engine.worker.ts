import { deserialize, projectForPlayer, serialize } from '@engine/engine';
import type { Command, PlayerView } from '@engine/types';
import { LocalGame } from '../runner/localGame';

let game: LocalGame | null = null;

function post(msg: Record<string, unknown>): void {
  (self as unknown as Worker).postMessage(msg);
}

function postView(): void {
  if (!game) return;
  const view = projectForPlayer(game.state, game.selfSeat);
  post({ type: 'view', view });
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as { type: string; reqId?: number; [k: string]: unknown };
  try {
    switch (msg.type) {
      case 'load': {
        const state = deserialize(msg.stateJson as string);
        game = new LocalGame(state, msg.selfSeat as number);
        game.start();
        post({ type: 'loaded', reqId: msg.reqId, ok: true });
        postView();
        break;
      }
      case 'command': {
        if (!game) throw new Error('尚未载入对局');
        const r = game.send(msg.command as Command);
        post({ type: 'ack', reqId: msg.reqId, ok: r.ok, error: r.error });
        postView();
        break;
      }
      case 'snapshot': {
        post({ type: 'snap', reqId: msg.reqId, stateJson: game ? serialize(game.state) : null });
        break;
      }
      case 'project': {
        if (!game) throw new Error('尚未载入对局');
        const view: PlayerView = projectForPlayer(game.state, msg.seat as number);
        post({ type: 'view', reqId: msg.reqId, view });
        break;
      }
      default:
        throw new Error('未知的 Worker 消息：' + msg.type);
    }
  } catch (err) {
    post({ type: 'error', reqId: msg.reqId, error: err instanceof Error ? err.message : String(err) });
  }
};
