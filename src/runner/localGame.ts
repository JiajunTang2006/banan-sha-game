import type { Command, GameState, PlayerView } from '@engine/types';
import { advance, projectForPlayer } from '@engine/engine';
import { botCommandId, chooseAnswer, choosePlayCommand } from '@bot/bot';

export interface SubmitResult {
  ok: boolean;
  error?: string;
  /** 电脑自动推进的步数，用于诊断。 */
  botSteps: number;
}

/**
 * 单机运行器。
 *
 * 页面只与它交互；它持有权威 GameState，并在轮到电脑时用同一套动作接口
 * 提交命令。将来联机时替换为 WebSocket 适配器，页面组件不需要改动。
 */
export class LocalGame {
  state: GameState;
  /** 真人座位；-1 表示全部由电脑托管（自对局）。 */
  selfSeat: number;
  private seq = 0;
  lastBotSteps = 0;

  constructor(state: GameState, selfSeat: number) {
    this.state = state;
    this.selfSeat = selfSeat;
  }

  view(seat?: number): PlayerView {
    const s = seat ?? (this.selfSeat >= 0 ? this.selfSeat : 0);
    return projectForPlayer(this.state, s);
  }

  send(command: Command): SubmitResult {
    if (this.selfSeat < 0) return { ok: false, error: '本地运行器没有真人座位。', botSteps: 0 };
    const r = advance(
      this.state,
      { seat: this.selfSeat, playerId: 'p' + this.selfSeat, commandId: `c${++this.seq}` },
      command,
    );
    const botSteps = this.runBots();
    return { ok: r.ok, error: r.error, botSteps };
  }

  start(): number {
    return this.runBots();
  }

  /** 让电脑回答所有属于电脑的提示，直到轮到真人或对局结束。 */
  runBots(): number {
    let steps = 0;
    const MAX = 4000;
    while (this.state.status === 'running' && this.state.pending && this.state.pending.actorSeat !== this.selfSeat) {
      if (++steps > MAX) break;
      const pending = this.state.pending;
      const seat = pending.actorSeat;
      const view = projectForPlayer(this.state, seat);
      const cmd: Command =
        pending.kind === 'playPhase'
          ? choosePlayCommand(view)
          : {
              type: 'ANSWER_PROMPT',
              promptId: pending.promptId,
              promptRevision: pending.revision,
              answer: chooseAnswer(view, pending),
            };
      advance(this.state, { seat, playerId: 'p' + seat, commandId: botCommandId(pending.promptId) }, cmd);
    }
    this.lastBotSteps = steps;
    return steps;
  }
}

/** 全电脑自对局，用于稳定性、守恒与停滞检查。 */
export function runBotGame(state: GameState, maxTurns = 300): { steps: number; state: GameState } {
  const game = new LocalGame(state, -1);
  let steps = 0;
  const cap = maxTurns * 60;
  while (state.status === 'running' && steps < cap) {
    if (!state.pending) break;
    const pending = state.pending;
    const seat = pending.actorSeat;
    const view = projectForPlayer(state, seat);
    const cmd: Command =
      pending.kind === 'playPhase'
        ? choosePlayCommand(view)
        : {
            type: 'ANSWER_PROMPT',
            promptId: pending.promptId,
            promptRevision: pending.revision,
            answer: chooseAnswer(view, pending),
          };
    advance(state, { seat, playerId: 'p' + seat, commandId: botCommandId('sim') }, cmd);
    steps += 1;
    if (state.turn.turnSerial > maxTurns) break;
  }
  void game;
  return { steps, state };
}
