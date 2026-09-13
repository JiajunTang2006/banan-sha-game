import { cardDef, isSha } from '@content/cards';
import type { Driver, DriverCtx } from '../frames';
import { child, emptyOptions, makePending } from '../frames';
import type { GameState, Suit } from '../types';
import { card, describeCard, emit, isAlive, logPublic, moveCard, player, seatOrderFrom } from '../util';
import { hasSkill } from '../query';

/* ================================================================== */
/* 无懈可击                                                            */
/* ================================================================== */

/**
 * 响应要求与实际牌名的匹配。
 *
 * 规则文本里的「杀」是一个统称，实体牌名是普通杀 / 火杀 / 雷杀。
 * 直接比较牌名会让【南蛮入侵】【决斗】要杀时永远挑不出可打出的牌。
 */
export function matchesNeed(name: string, need: string): boolean {
  if (need === '杀') return isSha(name);
  return name === need;
}

export const nullifyDriver: Driver = ({ state, frame }: DriverCtx) => {
  const use = state.activeUses[frame.data.useId as string];
  switch (frame.step) {
    case 'begin': {
      frame.data.negated = false;
      frame.data.i = 0;
      frame.step = 'poll';
      return { t: 'next' as const };
    }
    case 'poll': {
      if (!use || use.noNullify) {
        frame.step = 'done';
        return { t: 'next' as const };
      }
      const targetSeat = frame.data.targetSeat as number;
      if (!isAlive(state, targetSeat)) {
        frame.step = 'done';
        return { t: 'next' as const };
      }
      const startSeat = state.turn.currentSeat ?? 0;
      const order = seatOrderFrom(state, startSeat, { includeSelf: true });
      let i = Number(frame.data.i ?? 0);
      // 单机优化：不持有【无懈可击】的座位直接跳过（联机需按 D04 公开轮询）。
      while (i < order.length && !holdsNullify(state, order[i])) i++;
      if (i >= order.length) {
        frame.step = 'done';
        return { t: 'next' as const };
      }
      frame.data.i = i;
      frame.data.responder = order[i];
      frame.step = 'apply';
      const seat = order[i];
      const selectable = player(state, seat).hand
        .filter((id) => card(state, id).name === '无懈可击')
        .map((id) => {
          const c = card(state, id);
          return { cardId: id, name: c.name, suit: c.suit, rank: c.rank, from: 'hand' as const };
        });
      return {
        t: 'wait' as const,
        pending: makePending(state, frame, {
          kind: 'choice',
          actorSeat: seat,
          type: 'nullify',
          title: '【无懈可击】响应窗口',
          detail: use
            ? `【${use.name}】即将对 ${player(state, targetSeat).displayName} 生效${frame.data.negated ? '（当前已被无懈，可再反制）' : ''}。`
            : `【${String(frame.data.useName ?? '延时锦囊')}】即将对 ${player(state, targetSeat).displayName} 生效${frame.data.negated ? '（当前已被无懈，可再反制）' : ''}。`,
          options: emptyOptions({
            selectableCards: selectable,
            minCards: 0,
            maxCards: 1,
            allowPass: true,
            passLabel: '放弃',
          }),
          cancelable: true,
          timeoutMs: 8000,
          defaultAnswer: { pass: true },
        }),
      };
    }
    case 'apply': {
      const ans = frame.data.answer as { cardIds?: string[] } | undefined;
      delete frame.data.answer;
      const seat = frame.data.responder as number;
      const cid = (ans?.cardIds ?? [])[0];
      const i = Number(frame.data.i ?? 0);
      if (cid && player(state, seat).hand.includes(cid) && card(state, cid).name === '无懈可击') {
        moveCard(state, cid, { zone: 'discard' }, 'nullify', seat);
        frame.data.negated = !frame.data.negated;
        logPublic(
          state,
          `${player(state, seat).displayName} 使用【无懈可击】${frame.data.negated ? '抵消' : '反制抵消'}对 ${player(state, frame.data.targetSeat as number).displayName} 的效果。`,
          'use',
        );
        emit(state, { type: 'NullifyUsed', actorSeat: seat, targetSeats: [frame.data.targetSeat as number], data: { cardId: cid } });
        frame.data.i = 0;
        frame.step = 'poll';
        return { t: 'next' as const };
      }
      frame.data.i = i + 1;
      frame.step = 'poll';
      return { t: 'next' as const };
    }
    default:
      return { t: 'done' as const, result: Boolean(frame.data.negated) };
  }
};

function holdsNullify(state: GameState, seat: number): boolean {
  return player(state, seat).hand.some((id) => card(state, id).name === '无懈可击');
}

/* ================================================================== */
/* 响应（闪 / 杀）                                                     */
/* ================================================================== */

export interface RespondSpec {
  targetSeat: number;
  sourceSeat: number;
  useId: string;
  /** 需要打出的牌名：'闪' 或 '杀'。 */
  need: '闪' | '杀';
  count: number;
  reason: string;
  unrespondable: boolean;
}

export const respondDriver: Driver = ({ state, frame }: DriverCtx) => {
  const spec = frame.data.spec as RespondSpec;
  switch (frame.step) {
    case 'begin': {
      frame.data.got = 0;
      frame.data.baguaUsed = false;
      frame.step = 'armor';
      return { t: 'next' as const };
    }
    case 'armor': {
      const p = player(state, spec.targetSeat);
      const bagua = p.equip.armor && card(state, p.equip.armor).name === '八卦阵';
      if (spec.need === '闪' && bagua && !frame.data.baguaUsed && spec.count > Number(frame.data.got ?? 0)) {
        frame.data.baguaUsed = true;
        frame.step = 'armorAnswer';
        return {
          t: 'wait' as const,
          pending: makePending(state, frame, {
            kind: 'choice',
            actorSeat: spec.targetSeat,
            type: 'optionalSkill',
            title: '是否发动【八卦阵】？',
            detail: '进行判定：红色视为使用 1 张【闪】，黑色则仍可自行出【闪】。同一次需求只判定一次。',
            options: emptyOptions({ allowPass: true, passLabel: '不发动' }),
            cancelable: true,
            timeoutMs: 10000,
            defaultAnswer: { pass: true },
          }),
        };
      }
      frame.step = 'ask';
      return { t: 'next' as const };
    }
    case 'armorAnswer': {
      const ans = frame.data.answer as { pass?: boolean } | undefined;
      delete frame.data.answer;
      if (ans && !ans.pass) {
        frame.step = 'armorJudge';
        return child('judge', 'reveal', { seat: spec.targetSeat, reason: '八卦阵' }, '_judge');
      }
      frame.step = 'ask';
      return { t: 'next' as const };
    }
    case 'armorJudge': {
      const r = frame.data._judge as { color: 'red' | 'black'; cardId: string } | null;
      if (r && r.color === 'red') {
        frame.data.got = Number(frame.data.got ?? 0) + 1;
        logPublic(state, `${player(state, spec.targetSeat).displayName} 的【八卦阵】判定为红色，视为使用 1 张【闪】。`, 'use');
        emit(state, { type: 'VirtualFlash', targetSeats: [spec.targetSeat], data: { source: '八卦阵' } });
      } else {
        logPublic(state, `${player(state, spec.targetSeat).displayName} 的【八卦阵】判定为黑色，仍需自行出【闪】。`, 'system');
      }
      frame.step = 'ask';
      return { t: 'next' as const };
    }
    case 'ask': {
      const p = player(state, spec.targetSeat);
      if (!p.alive) {
        frame.step = 'done';
        return { t: 'next' as const };
      }
      if (Number(frame.data.got ?? 0) >= spec.count) {
        frame.step = 'success';
        return { t: 'next' as const };
      }
      if (spec.unrespondable) {
        frame.step = 'fail';
        return { t: 'next' as const };
      }
      const selectable = p.hand
        .filter((id) => matchesNeed(card(state, id).name, spec.need))
        .map((id) => {
          const c = card(state, id);
          return { cardId: id, name: c.name, suit: c.suit, rank: c.rank, from: 'hand' as const };
        });
      const remain = spec.count - Number(frame.data.got ?? 0);
      frame.step = 'apply';
      return {
        t: 'wait' as const,
        pending: makePending(state, frame, {
          kind: 'choice',
          actorSeat: spec.targetSeat,
          type: 'respond',
          title: spec.need === '闪' ? '需要打出【闪】' : '需要打出【杀】',
          detail: `${spec.reason}。还需要 ${remain} 张【${spec.need}】${spec.count > 1 ? '（须连续使用）' : ''}。`,
          options: emptyOptions({
            selectableCards: selectable,
            minCards: 0,
            maxCards: 1,
            allowPass: true,
            passLabel: `不出【${spec.need}】`,
          }),
          cancelable: true,
          timeoutMs: 15000,
          defaultAnswer: { pass: true },
        }),
      };
    }
    case 'apply': {
      const ans = frame.data.answer as { cardIds?: string[] } | undefined;
      delete frame.data.answer;
      const cid = (ans?.cardIds ?? [])[0];
      if (cid && player(state, spec.targetSeat).hand.includes(cid) && matchesNeed(card(state, cid).name, spec.need)) {
        moveCard(state, cid, { zone: 'processing' }, 'respond', spec.targetSeat);
        frame.data.responses = [...((frame.data.responses as string[]) ?? []), cid];
        frame.data.got = Number(frame.data.got ?? 0) + 1;
        logPublic(state, `${player(state, spec.targetSeat).displayName} 打出 ${describeCard(card(state, cid))}。`, 'use');
        emit(state, { type: 'Responded', actorSeat: spec.targetSeat, data: { cardId: cid, need: spec.need } });
        frame.step = 'armor';
        return { t: 'next' as const };
      }
      frame.step = 'cleanupFail';
      return { t: 'next' as const };
    }
    case 'cleanupFail': {
      const done = Number(frame.data.got ?? 0) >= spec.count;
      cleanupResponses(state, frame);
      frame.step = 'done';
      frame.data.result = done;
      return { t: 'next' as const };
    }
    case 'success': {
      cleanupResponses(state, frame);
      frame.step = 'done';
      frame.data.result = true;
      return { t: 'next' as const };
    }
    case 'fail': {
      cleanupResponses(state, frame);
      frame.step = 'done';
      frame.data.result = false;
      return { t: 'next' as const };
    }
    default:
      return { t: 'done' as const, result: Boolean(frame.data.result) };
  }
};

function cleanupResponses(state: GameState, frame: { data: Record<string, any> }): void {
  const ids: string[] = frame.data.responses ?? [];
  for (const id of ids) {
    if (state.processing.includes(id)) moveCard(state, id, { zone: 'discard' }, 'respond-cleanup');
  }
  frame.data.responses = [];
}

/* ================================================================== */
/* 决斗                                                                */
/* ================================================================== */

export interface DuelSpec {
  userSeat: number;
  targetSeat: number;
  useId: string;
  nature: 'normal' | 'fire' | 'thunder';
}

export const duelDriver: Driver = ({ state, frame }: DriverCtx) => {
  const spec = frame.data.spec as DuelSpec;
  switch (frame.step) {
    case 'begin': {
      frame.data.duelist = spec.targetSeat;
      frame.data.opponent = spec.userSeat;
      frame.step = 'loop';
      return { t: 'next' as const };
    }
    case 'loop': {
      const cur = frame.data.duelist as number;
      const opp = frame.data.opponent as number;
      if (!isAlive(state, cur) || !isAlive(state, opp)) {
        frame.step = 'done';
        return { t: 'next' as const };
      }
      frame.step = 'answer';
      return child(
        'respond',
        'begin',
        {
          spec: {
            targetSeat: cur,
            sourceSeat: opp,
            useId: spec.useId,
            need: '杀',
            count: 1,
            reason: `【决斗】：请打出【杀】`,
            unrespondable: false,
          } satisfies RespondSpec,
        },
        '_respond',
      );
    }
    case 'answer': {
      const ok = Boolean(frame.data._respond);
      const cur = frame.data.duelist as number;
      const opp = frame.data.opponent as number;
      if (ok) {
        frame.data.duelist = opp;
        frame.data.opponent = cur;
        frame.step = 'loop';
        return { t: 'next' as const };
      }
      // 未打出者受到对方造成的 1 点普通伤害
      logPublic(state, `${player(state, cur).displayName} 未打出【杀】，输掉【决斗】。`, 'info');
      frame.step = 'damage';
      return child(
        'damage',
        'start',
        {
          spec: {
            sourceSeat: opp,
            targetSeat: cur,
            amount: 1,
            nature: 'normal',
            useId: spec.useId,
            cardIds: [],
            byCardName: '决斗',
            fromSha: false,
            reason: '决斗',
          },
        },
        '_damage',
      );
    }
    default:
      return { t: 'done' as const };
  }
};

export function isShaName(name: string): boolean {
  return isSha(name);
}

export function cardNatureOf(name: string): 'normal' | 'fire' | 'thunder' {
  return cardDef(name).nature;
}

export type { Suit };
