import type { Driver, DriverCtx } from '../frames';
import { child, emptyOptions, makePending } from '../frames';
import type { GameState, PlayerState } from '../types';
import {
  EQUIP_SLOTS,
  card,
  describeCard,
  drawToHand,
  emit,
  isAlive,
  logPrivate,
  logPublic,
  moveCard,
  player,
  shuffleArray,
} from '../util';
import { hasSkill } from '../query';

/* ================================================================== */
/* 获得牌后的统一触发（内卷等）                                        */
/* ================================================================== */

export function afterGain(state: GameState, seat: number, cardIds: string[], reason: string): void {
  if (cardIds.length === 0) return;
  const p = player(state, seat);
  if (!p.alive) return;
  // 【内卷】：你的回合内，非因【内卷】获得一批手牌后摸一张
  if (hasSkill(p, 'b17.neijuan') && state.turn.currentSeat === seat && reason !== '内卷') {
    const got = drawToHand(state, seat, 1, '内卷');
    if (got.length > 0) logPublic(state, `${p.displayName} 发动【内卷】，额外摸 1 张牌。`, 'info');
  }
}

/* ================================================================== */
/* 技能帧派发                                                          */
/* ================================================================== */

export const SKILL_FRAME: Record<string, string> = {
  'b01.lambda': 'skillLambda',
  'b08.qiti': 'skillQiti',
  'b11.huoba': 'skillHuoba',
  'b13.chouka': 'skillChouka',
};

/* ================================================================== */
/* λ法（b01 巫力凡）                                                   */
/* ================================================================== */

interface LambdaCard {
  cardId: string;
  slot: string;
}

export const skillLambdaDriver: Driver = ({ state, frame }: DriverCtx) => {
  const seat = frame.data.seat as number;
  const p = player(state, seat);
  switch (frame.step) {
    case 'begin': {
      pruneLambda(p);
      if (p.skillFlags.lambdaLocked) {
        state.lastCommandError = '本回合已翻出“λ”牌，不能再发动【λ法】。';
        frame.step = 'done';
        return { t: 'done' as const };
      }
      const nonLambda = p.hand.filter((id) => !isLambdaCard(p, id)).length;
      if (nonLambda < 2) {
        state.lastCommandError = '发动【λ法】需要至少两张未记录为“λ”的手牌。';
        frame.step = 'done';
        return { t: 'done' as const };
      }
      const got = drawToHand(state, seat, 1, 'λ法');
      if (got.length === 0) {
        logPublic(state, `${p.displayName} 发动【λ法】，但未能摸到牌，本次发动结束。`, 'info');
        frame.step = 'done';
        return { t: 'done' as const };
      }
      const cid = got[0];
      const arr = (p.skillFlags.lambdaCards as string[] | undefined) ?? [];
      p.skillFlags.lambdaCards = [...arr, cid];
      logPublic(state, `${p.displayName} 发动【λ法】，摸一张牌并展示：${describeCard(card(state, cid))}（记录为“λ”）。`, 'use');
      emit(state, { type: 'LambdaRecorded', actorSeat: seat, data: { cardId: cid } });
      frame.step = 'pickExtra';
      return { t: 'next' as const };
    }

    case 'pickExtra': {
      const selectable = p.hand
        .filter((id) => !isLambdaCard(p, id))
        .map((id) => {
          const c = card(state, id);
          return { cardId: id, name: c.name, suit: c.suit, rank: c.rank, from: 'hand' as const };
        });
      frame.step = 'afterExtra';
      return {
        t: 'wait' as const,
        pending: makePending(state, frame, {
          kind: 'choice',
          actorSeat: seat,
          type: 'pickCards',
          title: '【λ法】选择混入的另外两张牌',
          detail: '选择两张未记录为“λ”的手牌，与所有“λ”牌一起扣置混匀。',
          options: emptyOptions({
            selectableCards: selectable,
            minCards: 2,
            maxCards: 2,
            allowPass: false,
            passLabel: '确认',
          }),
          cancelable: false,
          timeoutMs: 15000,
          defaultAnswer: { cardIds: selectable.slice(0, 2).map((s) => s.cardId) },
        }),
      };
    }

    case 'afterExtra': {
      const ans = frame.data.answer as { cardIds?: string[] } | undefined;
      delete frame.data.answer;
      const picked = (ans?.cardIds ?? []).filter((id) => p.hand.includes(id) && !isLambdaCard(p, id));
      if (picked.length !== 2) {
        state.lastCommandError = '【λ法】需要选择两张未记录为“λ”的手牌。';
        frame.step = 'pickExtra';
        return { t: 'next' as const };
      }
      const lambdaIds = p.hand.filter((id) => isLambdaCard(p, id));
      const pool = [...lambdaIds, ...picked];
      frame.data.lambdaCards = lambdaIds.slice();
      frame.data.pool = pool.slice();
      shuffleArray(state, pool);
      frame.data.shuffled = pool.slice();
      frame.step = 'pickFlipper';
      return { t: 'next' as const };
    }

    case 'pickFlipper': {
      const others = state.players.filter((x) => x.alive && x.seat !== seat).map((x) => x.seat);
      frame.step = 'afterFlipper';
      return {
        t: 'wait' as const,
        pending: makePending(state, frame, {
          kind: 'choice',
          actorSeat: seat,
          type: 'pickTargets',
          title: '【λ法】选择翻开者',
          detail: '选择一名其他角色，由其从扣置的牌中翻开一张。',
          options: emptyOptions({
            targetSeats: others,
            minTargets: 1,
            maxTargets: 1,
            allowPass: false,
            passLabel: '确认',
          }),
          cancelable: false,
          timeoutMs: 15000,
          defaultAnswer: { targets: others.slice(0, 1) },
        }),
      };
    }

    case 'afterFlipper': {
      const ans = frame.data.answer as { targets?: number[] } | undefined;
      delete frame.data.answer;
      const t = (ans?.targets ?? [])[0];
      if (t === undefined || !isAlive(state, t) || t === seat) {
        state.lastCommandError = '【λ法】需要选择一名其他角色。';
        frame.step = 'pickFlipper';
        return { t: 'next' as const };
      }
      frame.data.flipper = t;
      frame.step = 'flipAsk';
      logPublic(state, `${p.displayName} 将 ${frame.data.shuffled.length} 张牌扣置混匀，请 ${player(state, t).displayName} 翻开其中一张。`, 'info');
      return { t: 'next' as const };
    }

    case 'flipAsk': {
      const flipper = frame.data.flipper as number;
      const n = (frame.data.shuffled as string[]).length;
      const slots: LambdaCard[] = (frame.data.shuffled as string[]).map((id, i) => ({ cardId: id, slot: `λ${i + 1}` }));
      frame.data.slots = slots;
      const selectable = slots.map((s, i) => ({
        cardId: s.slot,
        name: null,
        suit: null,
        rank: null,
        from: 'hand' as const,
        faceDownSlot: i + 1,
      }));
      frame.step = 'afterFlip';
      return {
        t: 'wait' as const,
        pending: makePending(state, frame, {
          kind: 'choice',
          actorSeat: flipper,
          type: 'pickCards',
          title: '翻开一张扣置的牌',
          detail: '这些牌已混匀，任何人不得查看位置。',
          options: emptyOptions({
            selectableCards: selectable,
            minCards: 1,
            maxCards: 1,
            allowPass: false,
            passLabel: '翻开',
          }),
          cancelable: false,
          timeoutMs: 15000,
          defaultAnswer: { cardIds: [selectable[0].cardId] },
        }),
      };
    }

    case 'afterFlip': {
      const ans = frame.data.answer as { cardIds?: string[] } | undefined;
      delete frame.data.answer;
      const slots = frame.data.slots as LambdaCard[];
      const raw = (ans?.cardIds ?? [])[0];
      const hit = slots.find((s) => s.slot === raw) ?? slots[0];
      const revealed = hit.cardId;
      const isLambda = (frame.data.lambdaCards as string[]).includes(revealed);
      logPublic(state, `翻开的牌是 ${describeCard(card(state, revealed))}${isLambda ? '（“λ”牌）' : ''}。`, 'info');
      if (isLambda) {
        p.skillFlags.lambdaLocked = true;
        logPublic(state, `${p.displayName} 翻出“λ”牌，失去 1 点体力，本回合不能再发动【λ法】。`, 'life');
        frame.step = 'done';
        return child('loseHp', 'begin', { seat, amount: 1, reason: 'λ法' }, '_child');
      }
      logPublic(state, `未翻出“λ”牌，${p.displayName} 收回全部牌。`, 'info');
      frame.step = 'done';
      return { t: 'next' as const };
    }

    default:
      return { t: 'done' as const };
  }
};

function isLambdaCard(p: PlayerState, cardId: string): boolean {
  const arr = p.skillFlags.lambdaCards;
  return Array.isArray(arr) && arr.includes(cardId);
}

export function pruneLambda(p: PlayerState): void {
  const arr = p.skillFlags.lambdaCards;
  if (!Array.isArray(arr)) return;
  p.skillFlags.lambdaCards = arr.filter((id) => p.hand.includes(id));
}

/* ================================================================== */
/* 气体（b08 王清阳）                                                  */
/* ================================================================== */

export const skillQitiDriver: Driver = ({ state, frame }: DriverCtx) => {
  const seat = frame.data.seat as number;
  const p = player(state, seat);
  switch (frame.step) {
    case 'begin': {
      if (p.turnFlags.qitiUsed) {
        state.lastCommandError = '【气体】出牌阶段限一次。';
        frame.step = 'done';
        return { t: 'done' as const };
      }
      const choice = (frame.data.choice ?? {}) as { cardIds?: string[] };
      const ids = (choice.cardIds ?? []).filter((id) => p.hand.includes(id));
      if (ids.length !== 2) {
        state.lastCommandError = '【气体】需要选择两张花色相同的手牌。';
        frame.step = 'done';
        return { t: 'done' as const };
      }
      const [a, b] = ids;
      const ca = card(state, a);
      const cb = card(state, b);
      const xiaofang = hasSkill(p, 'b08.xiaofang') && (ca.suit === '♦' || cb.suit === '♦');
      if (ca.suit !== cb.suit && !xiaofang) {
        state.lastCommandError = '【气体】的两张手牌花色必须相同。';
        frame.step = 'done';
        return { t: 'done' as const };
      }
      p.turnFlags.qitiUsed = 1;
      const targets = state.players.filter((x) => x.alive && x.seat !== seat).map((x) => x.seat);
      logPublic(
        state,
        `${p.displayName} 发动【气体】，将 ${ca.name}+${cb.name} 视为使用【万箭齐发】${xiaofang ? '（【小方】调整花色匹配）' : ''}。`,
        'use',
      );
      frame.step = 'done';
      return child(
        'cardUse',
        'init',
        {
          spec: {
            useId: `u${++state.useSeq}`,
            userSeat: seat,
            cardIds: ids,
            asName: '万箭齐发',
            targets,
            played: false,
            reason: '气体',
          },
        },
        '_child',
      );
    }
    default:
      return { t: 'done' as const };
  }
};

/* ================================================================== */
/* 火把（b11 刘禹韬）                                                  */
/* ================================================================== */

export const skillHuobaDriver: Driver = ({ state, frame }: DriverCtx) => {
  const seat = frame.data.seat as number;
  const p = player(state, seat);
  switch (frame.step) {
    case 'begin': {
      if (p.turnFlags.huobaUsed) {
        state.lastCommandError = '【火把】出牌阶段限一次。';
        frame.step = 'done';
        return { t: 'done' as const };
      }
      frame.step = 'pickCost';
      return { t: 'next' as const };
    }
    case 'pickCost': {
      const selectable = [
        ...p.hand.map((id) => ({ cardId: id, name: card(state, id).name, suit: card(state, id).suit, rank: card(state, id).rank, from: 'hand' as const })),
        ...EQUIP_SLOTS.filter((s) => p.equip[s]).map((s) => ({
          cardId: p.equip[s]!,
          name: card(state, p.equip[s]!).name,
          suit: card(state, p.equip[s]!).suit,
          rank: card(state, p.equip[s]!).rank,
          from: 'equip' as const,
          slot: s,
        })),
      ];
      if (selectable.length === 0) {
        state.lastCommandError = '【火把】需要弃置一张手牌或装备区的牌。';
        frame.step = 'done';
        return { t: 'done' as const };
      }
      frame.step = 'afterCost';
      return {
        t: 'wait' as const,
        pending: makePending(state, frame, {
          kind: 'choice',
          actorSeat: seat,
          type: 'pickCards',
          title: '【火把】弃置一张牌',
          detail: '弃置一张手牌或装备区的牌，作为发动【火把】的代价。',
          options: emptyOptions({ selectableCards: selectable, minCards: 1, maxCards: 1, allowPass: false, passLabel: '确认' }),
          cancelable: false,
          timeoutMs: 15000,
          defaultAnswer: { cardIds: [selectable[0].cardId] },
        }),
      };
    }
    case 'afterCost': {
      const ans = frame.data.answer as { cardIds?: string[] } | undefined;
      delete frame.data.answer;
      const cid = (ans?.cardIds ?? [])[0];
      if (!cid) {
        state.lastCommandError = '【火把】需要弃置一张牌。';
        frame.step = 'pickCost';
        return { t: 'next' as const };
      }
      moveCard(state, cid, { zone: 'discard' }, '火把', seat);
      p.turnFlags.discarded = Number(p.turnFlags.discarded ?? 0) + 1;
      logPublic(state, `${p.displayName} 弃置 ${describeCard(card(state, cid))} 发动【火把】。`, 'use');
      frame.step = 'pickPair';
      return { t: 'next' as const };
    }
    case 'pickPair': {
      const all = state.players.filter((x) => x.alive).map((x) => x.seat);
      frame.step = 'afterPair';
      return {
        t: 'wait' as const,
        pending: makePending(state, frame, {
          kind: 'choice',
          actorSeat: seat,
          type: 'pickTargets',
          title: '【火把】选择两名不同角色',
          detail: '前者视为对后者使用一张不能被【无懈可击】响应的【决斗】。',
          options: emptyOptions({ targetSeats: all, minTargets: 2, maxTargets: 2, allowPass: false, passLabel: '确认' }),
          cancelable: false,
          timeoutMs: 15000,
          defaultAnswer: { targets: all.slice(0, 2) },
        }),
      };
    }
    case 'afterPair': {
      const ans = frame.data.answer as { targets?: number[] } | undefined;
      delete frame.data.answer;
      const pair = (ans?.targets ?? []).filter((s) => isAlive(state, s));
      if (pair.length !== 2 || pair[0] === pair[1]) {
        state.lastCommandError = '【火把】需要选择两名不同的存活角色。';
        frame.step = 'pickPair';
        return { t: 'next' as const };
      }
      p.turnFlags.huobaUsed = 1;
      const [first, second] = pair;
      logPublic(state, `${p.displayName} 发动【火把】，令 ${player(state, first).displayName} 视为对 ${player(state, second).displayName} 使用【决斗】。`, 'use');
      frame.step = 'done';
      return child(
        'cardUse',
        'init',
        {
          spec: {
            useId: `u${++state.useSeq}`,
            userSeat: first,
            cardIds: [],
            asName: '决斗',
            targets: [second],
            played: false,
            reason: '火把',
            noNullify: true,
          },
        },
        '_child',
      );
    }
    default:
      return { t: 'done' as const };
  }
};

/* ================================================================== */
/* 抽卡（b13 陈越来）                                                  */
/* ================================================================== */

export const skillChoukaDriver: Driver = ({ state, frame }: DriverCtx) => {
  const seat = frame.data.seat as number;
  const p = player(state, seat);
  switch (frame.step) {
    case 'begin': {
      if (p.turnFlags.choukaUsed) {
        state.lastCommandError = '【抽卡】出牌阶段限一次。';
        frame.step = 'done';
        return { t: 'done' as const };
      }
      p.turnFlags.choukaUsed = 1;
      const n = Math.min(3, state.deck.length);
      if (n === 0) {
        logPublic(state, `${p.displayName} 发动【抽卡】，但牌堆不足，本次发动结束。`, 'info');
        frame.step = 'done';
        return { t: 'done' as const };
      }
      const ids: string[] = [];
      for (let i = 0; i < n; i++) ids.push(state.deck.shift()!);
      state.processing.push(...ids);
      const sum = ids.reduce((s, id) => s + card(state, id).rank, 0);
      logPublic(
        state,
        `${p.displayName} 发动【抽卡】，亮出 ${ids.map((id) => describeCard(card(state, id))).join('、')}，点数和为 ${sum}。`,
        'use',
      );
      emit(state, { type: 'ChoukaRevealed', actorSeat: seat, data: { cardIds: ids, sum } });
      frame.data.ids = ids;
      frame.data.sum = sum;
      frame.step = 'resolve';
      return { t: 'next' as const };
    }
    case 'resolve': {
      const ids: string[] = frame.data.ids ?? [];
      const sum = Number(frame.data.sum ?? 0);
      if (sum <= 15) {
        for (const id of ids) {
          if (state.processing.includes(id)) moveCard(state, id, { zone: 'hand', seat }, '抽卡', seat);
        }
        logPublic(state, `点数和不大于 15，${p.displayName} 获得这些牌。`, 'info');
        afterGain(state, seat, ids, '抽卡');
      } else {
        for (const id of ids) {
          if (state.processing.includes(id)) moveCard(state, id, { zone: 'discard' }, '抽卡-失败', seat);
        }
        logPublic(state, `点数之和大于 15，${ids.length} 张牌置入弃牌堆（不计为弃置）。`, 'info');
      }
      frame.step = 'done';
      return { t: 'next' as const };
    }
    default:
      return { t: 'done' as const };
  }
};

/* ================================================================== */
/* 失去体力                                                            */
/* ================================================================== */

export const loseHpDriver: Driver = ({ state, frame }: DriverCtx) => {
  const seat = frame.data.seat as number;
  const amount = Number(frame.data.amount ?? 1);
  const p = player(state, seat);
  switch (frame.step) {
    case 'begin': {
      if (!p.alive) {
        frame.step = 'done';
        return { t: 'done' as const };
      }
      p.hp -= amount;
      emit(state, { type: 'LoseHp', targetSeats: [seat], amount, reason: String(frame.data.reason ?? '') });
      logPublic(state, `${p.displayName} 失去 ${amount} 点体力，体力 → ${p.hp}。`, 'life');
      frame.step = 'dying';
      return { t: 'next' as const };
    }
    case 'dying': {
      if (p.hp <= 0 && p.alive) {
        frame.step = 'done';
        return child('dying', 'begin', { seat, killerSeat: null, useId: null }, '_dying');
      }
      frame.step = 'done';
      return { t: 'next' as const };
    }
    default:
      return { t: 'done' as const };
  }
};

export { logPrivate };
