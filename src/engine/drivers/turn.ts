import type { Driver, DriverCtx } from '../frames';
import { child, emptyOptions, makePending } from '../frames';
import type { GameState, PhaseId } from '../types';
import { card, drawToHand, isAlive, logPublic, moveCard, nextAliveSeat, player } from '../util';
import { hasSkill, handLimit } from '../query';
import { getActions } from '../play';
import { afterGain, SKILL_FRAME } from './skills';

export const PHASES: PhaseId[] = ['prepare', 'judge', 'draw', 'play', 'discard', 'end'];

/** 顺序无关的牌组相等判断：客户端提交的牌序不作要求。 */
function sameCardSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export const PHASE_LABEL: Record<PhaseId, string> = {
  prepare: '准备阶段',
  judge: '判定阶段',
  draw: '摸牌阶段',
  play: '出牌阶段',
  discard: '弃牌阶段',
  end: '结束阶段',
};

/* ------------------------------------------------------------------ */
/* 回合                                                                */
/* ------------------------------------------------------------------ */

export const turnDriver: Driver = ({ state, frame }: DriverCtx) => {
  if (state.status === 'finished') return { t: 'done' as const };
  switch (frame.step) {
    case 'start': {
      const seat = state.turn.currentSeat;
      if (seat === null || !isAlive(state, seat)) {
        const nxt = seat === null ? state.players.find((p) => p.alive)?.seat ?? null : nextAliveSeat(state, seat);
        if (nxt === null) {
          frame.step = 'done';
          return { t: 'done' as const };
        }
        state.turn.currentSeat = nxt;
        return { t: 'next' as const };
      }
      state.turn.turnSerial += 1;
      state.turn.fired = {};
      state.turn.skipped = [];
      for (const p of state.players) {
        p.turnFlags = {};
        expireTurnModifiers(state, p);
      }
      const p = player(state, seat);
      logPublic(state, `—— 第 ${state.turn.round} 轮 · ${p.displayName} 的回合 ——`, 'system');
      if (p.faceDown) {
        p.faceDown = false;
        logPublic(state, `${p.displayName} 翻回正面，跳过本回合。`, 'info');
        frame.step = 'finish';
        return { t: 'next' as const };
      }
      frame.data.idx = 0;
      frame.step = 'loop';
      return { t: 'next' as const };
    }
    case 'loop': {
      const idx = Number(frame.data.idx ?? 0);
      if (idx >= PHASES.length) {
        frame.step = 'finish';
        return { t: 'next' as const };
      }
      const phase = PHASES[idx];
      frame.data.idx = idx + 1;
      if (state.turn.skipped.includes(phase)) {
        return { t: 'next' as const };
      }
      return child('phase', 'begin', { phase, seat: state.turn.currentSeat }, '_phase');
    }
    case 'finish': {
      const cur = state.turn.currentSeat;
      // 到期清理：本回合结束
      if (cur !== null) {
        const p = player(state, cur);
        // 回合结束时清空本回合的技能使用痕迹：【λ法】的“λ”记录、翻出锁定、【气体】限一次标记。
        if (p.skillFlags.lambdaCards) p.skillFlags.lambdaCards = [];
        delete p.skillFlags.lambdaLocked;
        delete p.skillFlags.qitiUsed;
      }
      state.turn.phase = null;
      if (cur === null) {
        frame.step = 'done';
        return { t: 'done' as const };
      }
      const nxt = nextAliveSeat(state, cur);
      if (nxt === null) {
        frame.step = 'done';
        return { t: 'done' as const };
      }
      if (nxt <= cur) {
        state.turn.round += 1;
        state.turn.anchorSeat = nxt;
      }
      state.turn.currentSeat = nxt;
      frame.step = 'start';
      return { t: 'next' as const };
    }
    default:
      return { t: 'done' as const };
  }
};

function expireTurnModifiers(state: GameState, p: { modifiers: { expires: { when: string; turnSerial?: number; round?: number } }[] }): void {
  p.modifiers = p.modifiers.filter((m) => {
    if (m.expires.when === 'turnEnd' && (m.expires.turnSerial ?? 0) < state.turn.turnSerial) return false;
    if (m.expires.when === 'roundEnd' && (m.expires.round ?? 0) < state.turn.round) return false;
    return true;
  }) as never;
  void handLimit;
}

/* ------------------------------------------------------------------ */
/* 阶段                                                                */
/* ------------------------------------------------------------------ */

export const phaseDriver: Driver = ({ state, frame }: DriverCtx) => {
  const phase = frame.data.phase as PhaseId;
  const seat = frame.data.seat as number;
  const p = player(state, seat);
  state.turn.phase = phase;

  switch (phase) {
    case 'prepare': {
      if (frame.step === 'begin') {
        // 首发 8 将在准备阶段没有技能；后续批次的阅片 / 弈客 / 导管在此接入。
        logPublic(state, `${p.displayName} 进入准备阶段。`, 'system');
        frame.step = 'done';
        return { t: 'next' as const };
      }
      return { t: 'done' as const };
    }

    case 'judge': {
      switch (frame.step) {
        case 'begin': {
          logPublic(state, `${p.displayName} 进入判定阶段。`, 'system');
          frame.data.list = [...p.judge].reverse();
          frame.data.ji = 0;
          frame.step = 'loop';
          return { t: 'next' as const };
        }
        case 'loop': {
          const list: string[] = frame.data.list ?? [];
          let ji = Number(frame.data.ji ?? 0);
          while (ji < list.length && !p.judge.includes(list[ji])) ji++;
          if (ji >= list.length) {
            frame.step = 'done';
            return { t: 'next' as const };
          }
          frame.data.ji = ji;
          const cid = list[ji];
          frame.data.current = cid;
          logPublic(state, `${p.displayName} 的判定区结算【${card(state, cid).name}】。`, 'system');
          frame.step = 'afterNullify';
          return child('nullify', 'begin', { useId: null, useName: card(state, cid).name, targetSeat: seat }, '_nullify');
        }
        case 'afterNullify': {
          const cid = frame.data.current as string;
          if (frame.data._nullify) {
            logPublic(state, `【${card(state, cid).name}】被【无懈可击】抵消。`, 'info');
            moveCard(state, cid, { zone: 'discard' }, 'delayed-nullified', seat);
            frame.data.ji = Number(frame.data.ji ?? 0) + 1;
            frame.step = 'loop';
            return { t: 'next' as const };
          }
          frame.step = 'afterJudge';
          return child('judge', 'reveal', { seat, reason: '乐不思蜀' }, '_judge');
        }
        case 'afterJudge': {
          const cid = frame.data.current as string;
          const r = frame.data._judge as { suit: string } | null;
          if (r && r.suit !== '♥') {
            state.turn.skipped.push('play');
            logPublic(state, `判定不为红桃，${p.displayName} 跳过本回合出牌阶段。`, 'info');
          } else {
            logPublic(state, `判定为红桃，【乐不思蜀】无效果。`, 'info');
          }
          if (p.judge.includes(cid)) moveCard(state, cid, { zone: 'discard' }, 'delayed-done', seat);
          frame.data.ji = Number(frame.data.ji ?? 0) + 1;
          frame.step = 'loop';
          return { t: 'next' as const };
        }
        default:
          return { t: 'done' as const };
      }
    }

    case 'draw': {
      if (frame.step === 'begin') {
        logPublic(state, `${p.displayName} 进入摸牌阶段。`, 'system');
        const got = drawToHand(state, seat, 2, '摸牌阶段');
        logPublic(state, `${p.displayName} 摸 ${got.length} 张牌（手牌 ${p.hand.length} 张）。`, 'info');
        afterGain(state, seat, got, '摸牌阶段');
        frame.step = 'done';
        return { t: 'next' as const };
      }
      return { t: 'done' as const };
    }

    case 'play':
      return playPhaseDriver({ state, frame });

    case 'discard': {
      if (frame.step === 'begin') {
        logPublic(state, `${p.displayName} 进入弃牌阶段。`, 'system');
        frame.step = 'done';
        return child('discardPhase', 'begin', { seat }, '_child');
      }
      return { t: 'done' as const };
    }

    case 'end':
      return endPhaseDriver({ state, frame });

    default:
      return { t: 'done' as const };
  }
};

/* ------------------------------------------------------------------ */
/* 出牌阶段                                                            */
/* ------------------------------------------------------------------ */

function playPhaseDriver({ state, frame }: DriverCtx) {
  const seat = frame.data.seat as number;
  const p = player(state, seat);
  switch (frame.step) {
    case 'begin': {
      logPublic(state, `${p.displayName} 进入出牌阶段。`, 'system');
      frame.step = 'await';
      return { t: 'next' as const };
    }
    case 'await': {
      if (!p.alive || state.status === 'finished') {
        frame.step = 'done';
        return { t: 'done' as const };
      }
      if (frame.data.cmd === undefined) {
        return {
          t: 'wait' as const,
          pending: makePending(state, frame, {
            kind: 'playPhase',
            actorSeat: seat,
            type: 'playPhase',
            title: '你的出牌阶段',
            detail: '选择手牌与目标后确认使用；也可以发动技能或结束出牌阶段。',
            options: emptyOptions({ allowPass: true, passLabel: '结束出牌阶段' }),
            cancelable: true,
            timeoutMs: 45000,
            defaultAnswer: { pass: true },
          }),
        };
      }
      frame.step = 'exec';
      return { t: 'next' as const };
    }
    case 'exec': {
      const cmd = frame.data.cmd as { type: string; [k: string]: unknown };
      delete frame.data.cmd;
      if (cmd.type === 'END_PLAY_PHASE' || cmd.type === 'ANSWER_PROMPT') {
        frame.step = 'done';
        return { t: 'done' as const };
      }
      // 客户端不可信：所有出牌指令都必须能在当前合法动作表里找到对应项，
      // 否则连点、过期按钮或构造出来的指令会绕过次数、距离与目标限制。
      const legal = getActions(state, seat);
      const reject = (msg: string) => {
        state.lastCommandError = msg;
        frame.step = 'await';
        return { t: 'next' as const };
      };

      if (cmd.type === 'RECAST') {
        const ids = (cmd.cardIds as string[]) ?? [];
        const act = legal.find((a) => a.kind === 'recast' && sameCardSet(a.cardIds, ids));
        if (!act) return reject(`不能重铸这些牌：${ids.join('、') || '（空）'}。`);
        for (const id of act.cardIds) moveCard(state, id, { zone: 'discard' }, 'recast', seat);
        p.turnFlags.discarded = Number(p.turnFlags.discarded ?? 0) + act.cardIds.length;
        const got = drawToHand(state, seat, 1, '重铸');
        logPublic(state, `${p.displayName} 重铸 ${act.cardIds.length} 张牌并摸 ${got.length} 张。`, 'info');
        afterGain(state, seat, got, '重铸');
        frame.step = 'await';
        return { t: 'next' as const };
      }

      if (cmd.type === 'ACTIVATE_SKILL') {
        const skillId = String(cmd.skillId ?? '');
        const kind = SKILL_FRAME[skillId];
        const allowed = legal.filter((a) => a.kind === 'activateSkill' && a.skillId === skillId && !a.note);
        if (!kind) return reject(`【${skillId}】不能在出牌阶段主动发动。`);
        if (allowed.length === 0) {
          const blocked = legal.find((a) => a.kind === 'activateSkill' && a.skillId === skillId);
          return reject(blocked?.note ? `【${skillId}】当前不能发动：${blocked.note}` : `【${skillId}】当前不能发动。`);
        }
        // 需要选牌的技能（例如【气体】）必须提交一组合法牌
        const needIds = allowed[0].cardIds.length > 0;
        if (needIds) {
          const chosen = ((cmd.choice ?? {}) as { cardIds?: string[] }).cardIds ?? [];
          if (!allowed.some((a) => sameCardSet(a.cardIds, chosen))) {
            return reject(`【${skillId}】选择的牌不合法。`);
          }
        }
        frame.step = 'resume';
        return child(kind, 'begin', { seat, choice: (cmd.choice as Record<string, unknown>) ?? {} }, '_child');
      }

      if (cmd.type !== 'PLAY_CARD') return reject(`未识别的出牌指令：${JSON.stringify(cmd)}`);

      const asName = String((cmd.as as string) ?? (cmd.asName as string) ?? '');
      const ids = (cmd.cardIds as string[]) ?? [];
      const act = legal.find((a) => a.kind === 'useCard' && (a.asName ?? '') === asName && sameCardSet(a.cardIds, ids));
      if (!act) {
        const blocked = legal.find((a) => a.kind === 'useCard' && (a.asName ?? '') === asName);
        return reject(
          blocked
            ? `【${asName}】当前不能这样使用（可选素材：${blocked.cardIds.map((i) => card(state, i).name).join('、')}）。`
            : `【${asName || '未知牌'}】当前不可使用。`,
        );
      }
      const targets = (cmd.targets as number[]) ?? [];
      if (new Set(targets).size !== targets.length) return reject('目标重复。');
      const spec = act.targetSpec;
      if (!spec) {
        if (targets.length > 0) return reject(`【${asName}】不指定目标。`);
      } else {
        if (targets.length < spec.min || targets.length > spec.max) {
          return reject(`【${asName}】需要 ${spec.min}—${spec.max} 个目标，收到 ${targets.length} 个。`);
        }
        for (const t of targets) {
          if (!spec.legal.includes(t)) return reject(`【${asName}】不能指定座位 ${t} 为目标。`);
        }
      }

      const useId = `u${++state.useSeq}`;
      frame.step = 'resume';
      return child(
        'cardUse',
        'init',
        {
          spec: {
            useId,
            userSeat: seat,
            cardIds: act.cardIds.slice(),
            asName: act.asName ?? asName,
            targets: targets.slice(),
            played: false,
            reason: '出牌阶段',
          },
        },
        '_child',
      );
    }
    case 'resume': {
      frame.step = 'await';
      return { t: 'next' as const };
    }
    default:
      return { t: 'done' as const };
  }
}

/* ------------------------------------------------------------------ */
/* 结束阶段                                                            */
/* ------------------------------------------------------------------ */

function endPhaseDriver({ state, frame }: DriverCtx) {
  const seat = frame.data.seat as number;
  const p = player(state, seat);
  switch (frame.step) {
    case 'begin':
      logPublic(state, `${p.displayName} 进入结束阶段。`, 'system');
      frame.step = 'jiangjun';
      return { t: 'next' as const };

    case 'jiangjun': {
      // 【将军】结束阶段开始时，若本回合未弃置过牌，回复 1 点体力
      if (hasSkill(p, 'b13.jiangjun') && !p.turnFlags.discarded && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + 1);
        logPublic(state, `${p.displayName} 发动【将军】，回复 1 点体力，体力 → ${p.hp}。`, 'life');
      } else if (hasSkill(p, 'b13.jiangjun') && !p.turnFlags.discarded && p.hp >= p.maxHp) {
        logPublic(state, `${p.displayName} 的【将军】触发，但体力已满。`, 'info');
      }
      frame.step = 'yezhang';
      return { t: 'next' as const };
    }

    case 'yezhang': {
      // 【叶障】结束阶段开始时，若本回合未造成过伤害，可以摸两张牌
      if (hasSkill(p, 'b16.yezhang') && !p.turnFlags.damageDealt) {
        frame.step = 'yezhangAnswer';
        return {
          t: 'wait' as const,
          pending: makePending(state, frame, {
            kind: 'choice',
            actorSeat: seat,
            type: 'optionalSkill',
            title: '是否发动【叶障】？',
            detail: '你本回合未造成过伤害，可以摸两张牌。',
            options: emptyOptions({ allowPass: true, passLabel: '不发动' }),
            cancelable: true,
            timeoutMs: 10000,
            defaultAnswer: { pass: false },
          }),
        };
      }
      frame.step = 'done';
      return { t: 'next' as const };
    }

    case 'yezhangAnswer': {
      const ans = frame.data.answer as { pass?: boolean } | undefined;
      delete frame.data.answer;
      if (ans && !ans.pass) {
        const got = drawToHand(state, seat, 2, '叶障');
        logPublic(state, `${p.displayName} 发动【叶障】，摸 ${got.length} 张牌。`, 'info');
        afterGain(state, seat, got, '叶障');
      }
      frame.step = 'done';
      return { t: 'next' as const };
    }

    default:
      return { t: 'done' as const };
  }
}

export function skippedPhases(state: GameState): PhaseId[] {
  void state;
  return [];
}
