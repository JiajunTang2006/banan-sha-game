import type { GameState } from '../types';
import { alivePlayers, logPublic } from '../util';

/**
 * 每次角色死亡结算完毕后立即检查胜负。
 * 主公死亡时：仅剩内奸一人则内奸胜，否则反贼阵营胜。
 * 主公存活且反贼、内奸全部死亡时，主公与忠臣阵营胜。
 */
export function checkVictory(state: GameState): 'lord' | 'rebel' | 'traitor' | 'draw' | null {
  const lord = state.players.find((p) => p.role === 'lord');
  if (!lord) return null;
  const alive = alivePlayers(state);

  if (!lord.alive) {
    if (alive.length === 1 && alive[0].role === 'traitor') return 'traitor';
    return 'rebel';
  }
  const hostile = alive.filter((p) => p.role === 'rebel' || p.role === 'traitor');
  if (hostile.length === 0) return 'lord';
  return null;
}

export function finishGame(state: GameState, winner: 'lord' | 'rebel' | 'traitor' | 'draw'): void {
  state.status = 'finished';
  state.winner = winner;
  const text =
    winner === 'lord'
      ? '主公与忠臣阵营获胜。'
      : winner === 'rebel'
        ? '反贼阵营获胜。'
        : winner === 'traitor'
          ? '内奸获胜。'
          : '本局以平局结束。';
  logPublic(state, text, 'system');
}
