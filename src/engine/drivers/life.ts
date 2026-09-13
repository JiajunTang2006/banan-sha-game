import type { Driver, DriverCtx } from '../frames';
import { child, emptyOptions, makePending } from '../frames';
import type { GameState, Nature } from '../types';
import {
  COLOR_OF_SUIT,
  card,
  describeCard,
  drawToHand,
  emit,
  ensureDeck,
  isAlive,
  logPublic,
  moveCard,
  player,
  seatOrderFrom,
} from '../util';
import { effectiveWeapon, hasSkill } from '../query';
import { checkVictory, finishGame } from './victory';

/* ================================================================== */
/* 判定                                                                */
/* ================================================================== */

export interface JudgeResult {
  cardId: string;
  suit: string;
  rank: number;
  color: 'red' | 'black';
  name: string;
}

export const judgeDriver: Driver = ({ state, frame }: DriverCtx) => {
  switch (frame.step) {
    case 'reveal': {
      ensureDeck(state, 1);
      if (state.deck.length === 0) {
        frame.data.result = null;
        frame.step = 'done';
        return { t: 'next' as const };
      }
      const id = state.deck.shift()!;
      state.processing.push(id);
      const c = card(state, id);
      frame.data.cardId = id;
      emit(state, {
        type: 'JudgeRevealed',
        targetSeats: [frame.data.seat as number],
        reason: (frame.data.reason as string) ?? 'judge',
        data: { cardId: id },
      });
      logPublic(state, `【判定】亮出 ${describeCard(c)}。`, 'system');
      frame.step = 'read';
      return { t: 'next' as const };
    }
    case 'read': {
      const id = frame.data.cardId as string;
      const c = card(state, id);
      frame.data.result = {
        cardId: id,
        suit: c.suit,
        rank: c.rank,
        color: COLOR_OF_SUIT[c.suit],
        name: c.name,
      } satisfies JudgeResult;
      frame.step = 'cleanup';
      return { t: 'next' as const };
    }
    case 'cleanup': {
      const id = frame.data.cardId as string;
      if (id && state.processing.includes(id)) {
        moveCard(state, id, { zone: 'discard' }, 'judge-cleanup');
      }
      frame.step = 'done';
      return { t: 'next' as const };
    }
    default:
      return { t: 'done' as const, result: frame.data.result ?? null };
  }
};

/* ================================================================== */
/* 伤害                                                                */
/* ================================================================== */

export interface DamageSpec {
  sourceSeat: number | null;
  targetSeat: number;
  amount: number;
  nature: Nature;
  useId: string | null;
  cardIds: string[];
  byCardName: string | null;
  fromSha: boolean;
  reason: string;
  /** 传导伤害不再生成新的传导队列。 */
  noPropagate?: boolean;
}

export const damageDriver: Driver = ({ state, frame }: DriverCtx) => {
  switch (frame.step) {
    case 'start': {
      const spec = frame.data.spec as DamageSpec;
      if (!isAlive(state, spec.targetSeat)) {
        frame.data.finalAmount = 0;
        frame.step = 'done';
        return { t: 'next' as const };
      }
      let amount = spec.amount;
      const target = player(state, spec.targetSeat);

      if (target.equip.armor && card(state, target.equip.armor).name === '藤甲') {
        const blocked =
          spec.nature === 'normal' &&
          (spec.byCardName === '普通杀' || spec.byCardName === '南蛮入侵' || spec.byCardName === '万箭齐发');
        if (blocked) {
          logPublic(state, `${target.displayName} 的【藤甲】使此伤害无效。`, 'system');
          amount = 0;
        } else if (spec.nature === 'fire') {
          amount += 1;
          logPublic(state, `【藤甲】使 ${target.displayName} 受到的火焰伤害 +1。`, 'system');
        }
      }
      frame.data.amount = Math.max(0, amount);
      frame.data.weiqiStage = 'pending';
      frame.step = 'weaponAsk';
      return { t: 'next' as const };
    }

    case 'weaponAsk': {
      const spec = frame.data.spec as DamageSpec;
      const amount = Number(frame.data.amount);
      const stage = frame.data.weiqiStage as string;

      if (stage === 'pending') {
        if (amount <= 0 || !spec.fromSha || spec.sourceSeat === null) {
          frame.data.weiqiStage = 'apply';
          frame.step = 'apply';
          return { t: 'next' as const };
        }
        const target = player(state, spec.targetSeat);
        const w = effectiveWeapon(state, spec.sourceSeat);
        const targetCards =
          target.hand.length +
          (['weapon', 'armor', 'offenseMount', 'defenseMount'] as const).filter((s) => target.equip[s]).length;
        if (!w || w.def.name !== '寒冰剑' || targetCards <= 0) {
          frame.data.weiqiStage = 'apply';
          frame.step = 'apply';
          return { t: 'next' as const };
        }
        const source = player(state, spec.sourceSeat);
        frame.data.weiqiStage = 'asked';
        frame.data.weiqiMax = Math.min(2, targetCards);
        return {
          t: 'wait' as const,
          pending: makePending(state, frame, {
            kind: 'choice',
            actorSeat: spec.sourceSeat,
            type: 'optionalSkill',
            title: '是否发动【寒冰剑】？',
            detail: `防止对 ${target.displayName} 造成的 ${amount} 点伤害，改为依次弃置其至多两张牌（不足两张则全部弃置）。`,
            options: emptyOptions({ allowPass: true, passLabel: '不发动' }),
            cancelable: true,
            timeoutMs: 10000,
            defaultAnswer: { pass: true },
          }),
        };
      }

      if (stage === 'asked') {
        const ans = frame.data.answer;
        delete frame.data.answer;
        if (ans && !ans.pass) {
          const source = player(state, spec.sourceSeat!);
          const target = player(state, spec.targetSeat);
          frame.data.amount = 0;
          logPublic(state, `${source.displayName} 发动【寒冰剑】，防止伤害并改为弃置 ${target.displayName} 的牌。`, 'use');
          frame.data.weiqiStage = 'discarding';
          return child(
            'discardFromPlayer',
            'begin',
            {
              seat: spec.targetSeat,
              executor: spec.sourceSeat,
              max: Number(frame.data.weiqiMax ?? 2),
              reason: '寒冰剑',
            },
            '_child',
          );
        }
        frame.data.weiqiStage = 'apply';
        frame.step = 'apply';
        return { t: 'next' as const };
      }

      // discarding 完成后
      frame.data.weiqiStage = 'apply';
      frame.step = 'apply';
      return { t: 'next' as const };
    }

    case 'apply': {
      const spec = frame.data.spec as DamageSpec;
      const amount = Number(frame.data.amount);
      const target = player(state, spec.targetSeat);
      if (amount <= 0) {
        emit(state, {
          type: 'DamagePrevented',
          sourceSeat: spec.sourceSeat,
          targetSeats: [spec.targetSeat],
          amount: 0,
          reason: spec.reason,
          useId: spec.useId,
        });
        frame.data.finalAmount = 0;
        frame.step = 'done';
        return { t: 'next' as const };
      }
      target.hp -= amount;
      emit(state, {
        type: 'Damage',
        sourceSeat: spec.sourceSeat,
        targetSeats: [spec.targetSeat],
        amount,
        reason: spec.reason,
        useId: spec.useId,
        data: { nature: spec.nature, cardIds: spec.cardIds, byCardName: spec.byCardName },
      });
      const srcName = spec.sourceSeat !== null ? player(state, spec.sourceSeat).displayName : '无来源';
      const natText = spec.nature === 'fire' ? '火焰' : spec.nature === 'thunder' ? '雷电' : '';
      logPublic(
        state,
        `${target.displayName} 受到来自 ${srcName} 的 ${amount} 点${natText}伤害，体力 ${target.hp + amount} → ${target.hp}。`,
        'damage',
      );
      if (spec.sourceSeat !== null) {
        const src = player(state, spec.sourceSeat);
        src.turnFlags.damageDealt = Number(src.turnFlags.damageDealt ?? 0) + amount;
      }
      frame.data.finalAmount = amount;

      // 铁索连环：横置角色受到正数火焰 / 雷电伤害时立即记录并全部解除横置
      if (
        !spec.noPropagate &&
        amount > 0 &&
        target.chained &&
        (spec.nature === 'fire' || spec.nature === 'thunder')
      ) {
        const others = state.players.filter((x) => x.alive && x.chained && x.seat !== spec.targetSeat).map((x) => x.seat);
        target.chained = false;
        for (const s of others) player(state, s).chained = false;
        if (others.length > 0) {
          logPublic(
            state,
            `属性伤害触发【铁索连环】，${others.map((s) => player(state, s).displayName).join('、')} 解除横置并将受到传导。`,
            'info',
          );
        }
        frame.data.propagate = { others, base: amount };
      }

      frame.step = 'dying';
      return { t: 'next' as const };
    }

    case 'dying': {
      const spec = frame.data.spec as DamageSpec;
      const target = player(state, spec.targetSeat);
      frame.step = 'afterDying';
      if (target.hp <= 0 && target.alive) {
        return child('dying', 'begin', { seat: spec.targetSeat, killerSeat: spec.sourceSeat, useId: spec.useId }, '_dying');
      }
      return { t: 'next' as const };
    }

    case 'afterDying': {
      const prop = frame.data.propagate as { others: number[]; base: number } | undefined;
      if (prop && prop.others.some((s) => isAlive(state, s))) {
        frame.step = 'done';
        return child('chainPropagate', 'begin', { propagate: prop, spec: frame.data.spec }, '_child');
      }
      frame.step = 'done';
      return { t: 'next' as const };
    }

    default:
      return { t: 'done' as const, result: Number(frame.data.finalAmount ?? 0) };
  }
};

/* ================================================================== */
/* 濒死                                                                */
/* ================================================================== */

export const dyingDriver: Driver = ({ state, frame }: DriverCtx) => {
  const seat = frame.data.seat as number;
  const p = player(state, seat);
  switch (frame.step) {
    case 'begin': {
      if (p.hp > 0 || !p.alive) {
        frame.step = 'done';
        return { t: 'next' as const };
      }
      logPublic(state, `${p.displayName} 体力不大于 0，进入濒死状态。`, 'death');
      frame.data.i = 0;
      frame.step = 'loop';
      return { t: 'next' as const };
    }
    case 'loop': {
      if (p.hp > 0 || !p.alive) {
        frame.step = 'done';
        return { t: 'next' as const };
      }
      const order = seatOrderFrom(state, seat, { includeSelf: true });
      let i = Number(frame.data.i ?? 0);
      while (i < order.length && !isAlive(state, order[i])) i++;
      if (i >= order.length) {
        frame.step = 'death';
        return { t: 'next' as const };
      }
      frame.data.i = i;
      const rescuer = order[i];
      frame.data.rescuer = rescuer;
      frame.step = 'rescue';
      return {
        t: 'wait' as const,
        pending: makePending(state, frame, {
          kind: 'choice',
          actorSeat: rescuer,
          type: 'dying',
          title: `${p.displayName} 濒死（体力 ${p.hp}）`,
          detail:
            rescuer === seat
              ? '你可以使用【桃】或【酒】自救，每张回复 1 点体力。'
              : '你可以对濒死者使用【桃】，每张回复 1 点体力。',
          options: emptyOptions({
            selectableCards: dyingOptions(state, rescuer, seat),
            minCards: 0,
            maxCards: 1,
            allowPass: true,
            passLabel: '不救',
          }),
          cancelable: true,
          timeoutMs: 15000,
          defaultAnswer: { pass: true },
        }),
      };
    }
    case 'rescue': {
      const ans = frame.data.answer;
      delete frame.data.answer;
      const rescuer = frame.data.rescuer as number;
      const cardIds: string[] = ans?.cardIds ?? [];
      if (cardIds.length > 0) {
        const cid = cardIds[0];
        const c = card(state, cid);
        let asName = c.name;
        if (c.name === '酒' && hasSkill(player(state, rescuer), 'b12.zongyu') && rescuer !== seat) asName = '桃';
        moveCard(state, cid, { zone: 'discard' }, 'dying-rescue', rescuer);
        p.hp += 1;
        logPublic(state, `${player(state, rescuer).displayName} 使用【${asName}】救援 ${p.displayName}，体力 → ${p.hp}。`, 'life');
        emit(state, { type: 'DyingRescued', actorSeat: rescuer, targetSeats: [seat], amount: 1, data: { cardId: cid } });
        frame.step = 'loop';
        return { t: 'next' as const };
      }
      frame.data.i = Number(frame.data.i ?? 0) + 1;
      frame.step = 'loop';
      return { t: 'next' as const };
    }
    case 'death': {
      frame.step = 'done';
      return child('death', 'begin', { seat, killerSeat: frame.data.killerSeat ?? null }, '_death');
    }
    default:
      return { t: 'done' as const, result: p.hp > 0 };
  }
};

function dyingOptions(state: GameState, rescuer: number, dyingSeat: number) {
  const p = player(state, rescuer);
  const zongyu = hasSkill(p, 'b12.zongyu');
  const out: any[] = [];
  for (const id of p.hand) {
    const c = card(state, id);
    if (c.name === '桃') out.push({ cardId: id, name: c.name, suit: c.suit, rank: c.rank, from: 'hand' });
    else if (c.name === '酒') {
      if (rescuer === dyingSeat) out.push({ cardId: id, name: c.name, suit: c.suit, rank: c.rank, from: 'hand' });
      else if (zongyu)
        out.push({ cardId: id, name: c.name, suit: c.suit, rank: c.rank, from: 'hand', label: '纵欲·当【桃】' });
    }
  }
  return out;
}

/* ================================================================== */
/* 铁索连环传导                                                        */
/* ================================================================== */

export const chainPropagateDriver: Driver = ({ state, frame }: DriverCtx) => {
  const prop = frame.data.propagate as { others: number[]; base: number };
  const spec = frame.data.spec as DamageSpec;
  switch (frame.step) {
    case 'begin': {
      const start = spec.sourceSeat ?? state.turn.currentSeat ?? 0;
      const ordered: number[] = [];
      for (let i = 1; i <= state.playerCount; i++) {
        const s = (start + i) % state.playerCount;
        if (prop.others.includes(s)) ordered.push(s);
      }
      frame.data.list = ordered;
      frame.data.pi = 0;
      frame.step = 'loop';
      return { t: 'next' as const };
    }
    case 'loop': {
      const list: number[] = frame.data.list ?? [];
      let i = Number(frame.data.pi ?? 0);
      while (i < list.length && !isAlive(state, list[i])) i++;
      if (i >= list.length) {
        frame.step = 'done';
        return { t: 'done' as const };
      }
      frame.data.pi = i;
      const t = list[i];
      frame.step = 'afterOne';
      return child(
        'damage',
        'start',
        {
          spec: {
            sourceSeat: spec.sourceSeat,
            targetSeat: t,
            amount: prop.base,
            nature: spec.nature,
            useId: spec.useId,
            cardIds: spec.cardIds,
            byCardName: spec.byCardName,
            fromSha: false,
            reason: '铁索连环传导',
            noPropagate: true,
          } as DamageSpec,
        },
        '_damage',
      );
    }
    case 'afterOne':
      frame.data.pi = Number(frame.data.pi ?? 0) + 1;
      frame.step = 'loop';
      return { t: 'next' as const };
    default:
      return { t: 'done' as const };
  }
};

/* ================================================================== */
/* 死亡                                                                */
/* ================================================================== */

export const deathDriver: Driver = ({ state, frame }: DriverCtx) => {
  switch (frame.step) {
    case 'begin': {
      const seat = frame.data.seat as number;
      const p = player(state, seat);
      if (!p.alive) {
        frame.step = 'done';
        return { t: 'next' as const };
      }
      p.alive = false;
      p.roleRevealed = true;
      emit(state, { type: 'Death', targetSeats: [seat], sourceSeat: frame.data.killerSeat ?? null, data: { role: p.role } });
      const roleName = { lord: '主公', loyalist: '忠臣', rebel: '反贼', traitor: '内奸' }[p.role];
      logPublic(state, `${p.displayName} 死亡，身份为【${roleName}】。`, 'death');
      const all = [
        ...p.hand,
        ...p.judge,
        ...p.cai,
        ...(['weapon', 'armor', 'offenseMount', 'defenseMount'] as const).map((s) => p.equip[s]).filter((x): x is string => !!x),
      ];
      for (const id of all) moveCard(state, id, { zone: 'discard' }, 'death-cleanup', seat);
      p.hand = [];
      p.judge = [];
      p.cai = [];
      p.equip = { weapon: null, armor: null, offenseMount: null, defenseMount: null };
      p.modifiers = [];
      frame.step = 'reward';
      return { t: 'next' as const };
    }
    case 'reward': {
      const seat = frame.data.seat as number;
      const killerSeat = frame.data.killerSeat as number | null;
      const p = player(state, seat);
      if (killerSeat !== null && killerSeat !== seat && isAlive(state, killerSeat)) {
        const killer = player(state, killerSeat);
        if (p.role === 'rebel') {
          const got = drawToHand(state, killerSeat, 3, '击杀反贼奖惩');
          logPublic(state, `${killer.displayName} 击杀反贼，摸 ${got.length} 张牌。`, 'info');
        } else if (p.role === 'loyalist' && killer.role === 'lord') {
          const all = [
            ...killer.hand,
            ...(['weapon', 'armor', 'offenseMount', 'defenseMount'] as const).map((s) => killer.equip[s]).filter((x): x is string => !!x),
          ];
          for (const id of all) moveCard(state, id, { zone: 'discard' }, 'lord-kill-loyalist', killerSeat);
          killer.hand = [];
          for (const s of ['weapon', 'armor', 'offenseMount', 'defenseMount'] as const) killer.equip[s] = null;
          logPublic(state, `主公 ${killer.displayName} 杀死忠臣，弃置全部手牌与装备。`, 'info');
        }
        if (hasSkill(killer, 'b12.jianshen')) {
          killer.maxHp += 1;
          killer.hp = Math.min(killer.maxHp, killer.hp + 1);
          logPublic(state, `${killer.displayName} 发动【健身】，体力上限 +1 并回复 1 点体力。`, 'life');
        }
      }
      frame.step = 'victory';
      return { t: 'next' as const };
    }
    case 'victory': {
      const winner = checkVictory(state);
      if (winner) finishGame(state, winner);
      frame.step = 'done';
      return { t: 'next' as const };
    }
    default:
      return { t: 'done' as const };
  }
};
