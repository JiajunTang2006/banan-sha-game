import type { EquipSlot, GameState } from '../types';
import type { Driver, DriverCtx } from '../frames';
import { emptyOptions, makePending, child } from '../frames';
import { card, emit, logPublic, moveCard, player } from '../util';
import { handLimit } from '../query';
import { afterGain } from './skills';

export interface Candidate {
  cardId: string;
  from: 'hand' | 'equip' | 'judge' | 'cai';
  slot?: EquipSlot;
  /** 该候选对操作者是暗牌（他人手牌）。 */
  hidden?: boolean;
  /** 是否禁止被其他角色弃置（戟把觉醒保护，D11）。 */
  protectedFromDiscard?: boolean;
}

export interface AskSpec {
  actorSeat: number;
  /** 牌的来源座位。 */
  fromSeat: number;
  candidates: Candidate[];
  min: number;
  max: number;
  exact?: boolean;
  title: string;
  detail: string;
  /** discard = 弃置，gain = 获得，take = 移动到指定区域。 */
  mode: 'discard' | 'gain';
  /** 执行者（弃置记录归属，D06）。 */
  executor: number;
  reason: string;
}

/** 通用「从某个座位的区域内选择牌」结算帧。 */
export const askCardsDriver: Driver = ({ state, frame }: DriverCtx) => {
  const spec = frame.data.spec as AskSpec;
  switch (frame.step) {
    case 'begin': {
      const live = spec.candidates.filter((c) => {
        const loc = findLoc(state, c.cardId);
        return loc !== null;
      });
      if (live.length === 0) {
        frame.step = 'done';
        return { t: 'next' as const };
      }
      frame.data.live = live;
      frame.step = 'ask';
      return { t: 'next' as const };
    }
    case 'ask': {
      const live = frame.data.live as Candidate[];
      const slots = live.filter((c) => c.hidden).map((c, i) => ({ slot: `h${i + 1}`, cardId: c.cardId }));
      frame.data.hiddenSlots = slots;
      const selectable = live.map((c) => {
        const cd = card(state, c.cardId);
        const slot = slots.find((s) => s.cardId === c.cardId);
        return {
          cardId: slot ? slot.slot : c.cardId,
          name: c.hidden ? null : cd.name,
          suit: c.hidden ? null : cd.suit,
          rank: c.hidden ? null : cd.rank,
          from: c.from === 'equip' ? ('equip' as const) : c.from === 'judge' ? ('judge' as const) : c.from === 'cai' ? ('cai' as const) : ('hand' as const),
          slot: c.slot,
          faceDownSlot: c.hidden ? slots.findIndex((s) => s.cardId === c.cardId) + 1 : undefined,
          label: c.protectedFromDiscard ? '受保护·不可被弃置' : undefined,
        };
      });
      const min = Math.min(spec.min, selectable.length);
      const max = Math.min(spec.max, selectable.length);
      frame.step = 'apply';
      return {
        t: 'wait' as const,
        pending: makePending(state, frame, {
          kind: 'choice',
          actorSeat: spec.actorSeat,
          type: 'pickCards',
          title: spec.title,
          detail: spec.detail,
          options: emptyOptions({
            selectableCards: selectable,
            minCards: min,
            maxCards: max,
            allowPass: false,
            passLabel: '确认',
          }),
          cancelable: false,
          timeoutMs: 15000,
          defaultAnswer: { cardIds: selectable.slice(0, min).map((s) => s.cardId) },
        }),
      };
    }
    case 'apply': {
      const ans = frame.data.answer as { cardIds?: string[] } | undefined;
      delete frame.data.answer;
      const slots: { slot: string; cardId: string }[] = frame.data.hiddenSlots ?? [];
      const picked: string[] = [];
      for (const raw of ans?.cardIds ?? []) {
        const mapped = slots.find((s) => s.slot === raw);
        picked.push(mapped ? mapped.cardId : raw);
      }
      const live = frame.data.live as Candidate[];
      const legal = picked.filter((id) => live.some((c) => c.cardId === id));
      const need = Math.min(spec.min, live.length);
      if (legal.length < need) {
        frame.data.error = '选择数量不足';
        frame.step = 'ask';
        return { t: 'next' as const };
      }
      const chosen = legal.slice(0, spec.max);
      for (const id of chosen) {
        const target = spec.mode === 'gain' ? ({ zone: 'hand', seat: spec.actorSeat } as const) : ({ zone: 'discard' } as const);
        moveCard(state, id, target, spec.reason, spec.executor);
        emit(state, {
          type: spec.mode === 'gain' ? 'CardGained' : 'CardDiscarded',
          actorSeat: spec.executor,
          targetSeats: [spec.fromSeat],
          data: { cardId: id, reason: spec.reason },
        });
      }
      const verb = spec.mode === 'gain' ? '获得' : '弃置';
      const names = chosen.map((id) => card(state, id).name).join('、');
      logPublic(
        state,
        `${player(state, spec.executor).displayName} ${verb} ${player(state, spec.fromSeat).displayName} 的 ${names}。`,
        'info',
      );
      // 将军 / 抽卡等：记录“执行弃置”
      if (spec.mode === 'discard') {
        const ex = player(state, spec.executor);
        ex.turnFlags.discarded = Number(ex.turnFlags.discarded ?? 0) + chosen.length;
      } else {
        // 【内卷】按“获得一批手牌”触发，顺走别人的牌同样算获得。
        afterGain(state, spec.actorSeat, chosen, spec.reason);
      }
      frame.step = 'done';
      frame.data.result = chosen;
      return { t: 'next' as const, result: chosen };
    }
    default:
      return { t: 'done' as const, result: (frame.data.result as string[]) ?? [] };
  }
};

function findLoc(state: GameState, cardId: string) {
  for (const p of state.players) {
    if (p.hand.includes(cardId)) return { zone: 'hand', seat: p.seat };
    if (p.judge.includes(cardId)) return { zone: 'judge', seat: p.seat };
    if (p.cai.includes(cardId)) return { zone: 'cai', seat: p.seat };
    for (const s of ['weapon', 'armor', 'offenseMount', 'defenseMount'] as const) {
      if (p.equip[s] === cardId) return { zone: 'equip', seat: p.seat, slot: s };
    }
  }
  if (state.deck.includes(cardId)) return { zone: 'deck' };
  if (state.discard.includes(cardId)) return { zone: 'discard' };
  if (state.processing.includes(cardId)) return { zone: 'processing' };
  return null;
}

/* ------------------------------------------------------------------ */
/* 弃牌阶段                                                            */
/* ------------------------------------------------------------------ */

export const discardPhaseDriver: Driver = ({ state, frame }: DriverCtx) => {
  const seat = frame.data.seat as number;
  const p = player(state, seat);
  switch (frame.step) {
    case 'begin':
      frame.data.round = 0;
      frame.step = 'check';
      return { t: 'next' as const };
    case 'check': {
      frame.data.round = Number(frame.data.round ?? 0) + 1;
      const limit = handLimit(state, seat);
      const excess = p.hand.length - limit;
      if (excess <= 0) {
        frame.step = 'done';
        return { t: 'next' as const };
      }
      frame.data.excess = excess;
      frame.step = 'ask';
      return { t: 'next' as const };
    }
    case 'ask': {
      const excess = Number(frame.data.excess);
      frame.step = 'apply';
      const selectable = p.hand.map((id) => {
        const c = card(state, id);
        return { cardId: id, name: c.name, suit: c.suit, rank: c.rank, from: 'hand' as const };
      });
      return {
        t: 'wait' as const,
        pending: makePending(state, frame, {
          kind: 'choice',
          actorSeat: seat,
          type: 'discard',
          title: '弃牌阶段',
          detail: `手牌上限为 ${handLimit(state, seat)}，需要弃置 ${excess} 张牌。`,
          options: emptyOptions({
            selectableCards: selectable,
            minCards: excess,
            maxCards: excess,
            allowPass: false,
            passLabel: '确认弃置',
          }),
          cancelable: false,
          timeoutMs: 15000,
          defaultAnswer: { cardIds: selectable.slice(0, excess).map((s) => s.cardId) },
        }),
      };
    }
    case 'apply': {
      const ans = frame.data.answer as { cardIds?: string[] } | undefined;
      delete frame.data.answer;
      const excess = Number(frame.data.excess);
      const picked = (ans?.cardIds ?? []).filter((id) => p.hand.includes(id));
      if (picked.length !== excess) {
        frame.step = 'ask';
        return { t: 'next' as const };
      }
      for (const id of picked) {
        moveCard(state, id, { zone: 'discard' }, 'discard-phase', seat);
      }
      p.turnFlags.discarded = Number(p.turnFlags.discarded ?? 0) + picked.length;
      logPublic(state, `${p.displayName} 弃置 ${picked.length} 张牌。`, 'info');
      frame.step = 'check';
      return { t: 'next' as const };
    }
    default:
      return { t: 'done' as const };
  }
};

/**
 * 【寒冰剑】：由来源依次弃置目标至多两张手牌或装备。
 *
 * 「依次」是规则语义的一部分：每弃置一张之后，目标的剩余牌会重新计算，
 * 后一张的选择依据前一张的结果。所以这里按「一轮选一张」循环，而不是
 * 一次性要求选满两张——一次性选满会让「先弃装备还是先弃手牌」的顺序失去意义，
 * 也会让目标只剩一张牌时的补选逻辑无从判断。
 *
 * 每轮把单张选择委派给 askCards 子帧（复用背面槽位映射），子帧结束后
 * 由本帧的 round 步骤扣减剩余次数，直到弃满上限或目标无牌可弃。
 */
export const discardFromPlayerDriver: Driver = ({ state, frame }: DriverCtx) => {
  const seat = Number(frame.data.seat);
  const executor = Number(frame.data.executor ?? seat);
  const reason = String(frame.data.reason ?? '弃置');
  switch (frame.step) {
    case 'begin':
      frame.data.remaining = Number(frame.data.remaining ?? frame.data.max ?? 2);
      frame.step = 'round';
      return { t: 'next' as const };
    case 'round': {
      // 上一轮的子帧已经结算完：无论实际弃掉几张，这一轮都算消耗掉一次。
      if (frame.data.roundResult !== undefined) {
        delete frame.data.roundResult;
        frame.data.remaining = Number(frame.data.remaining ?? 0) - 1;
      }
      const p = player(state, seat);
      const remaining = Number(frame.data.remaining ?? 0);
      const candidates: Candidate[] = [
        ...p.hand.map((id) => ({ cardId: id, from: 'hand' as const, hidden: true })),
        ...(['weapon', 'armor', 'offenseMount', 'defenseMount'] as const)
          .filter((s) => p.equip[s])
          .map((s) => ({ cardId: p.equip[s]!, from: 'equip' as const, slot: s })),
      ];
      if (remaining <= 0 || candidates.length === 0) {
        frame.step = 'done';
        return { t: 'next' as const };
      }
      const spec: AskSpec = {
        actorSeat: executor,
        fromSeat: seat,
        candidates,
        min: 1,
        max: 1,
        title: `【寒冰剑】弃置目标牌${Number(frame.data.max ?? 2) > 1 ? `（第 ${Number(frame.data.max ?? 2) - remaining + 1} 张）` : ''}`,
        detail: `依次弃置 ${p.displayName} 的两张牌，不足两张则全部弃置。手牌为随机背面，装备可直接指定。`,
        mode: 'discard',
        executor,
        reason,
      };
      return child('askCards', 'begin', { spec }, 'roundResult');
    }
    default:
      return { t: 'done' as const };
  }
};

