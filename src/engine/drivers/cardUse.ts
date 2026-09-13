import { cardDef, isSha } from '@content/cards';
import type { CardUse, GameState } from '../types';
import type { Driver, DriverCtx } from '../frames';
import { child } from '../frames';
import { EQUIP_SLOTS, card, drawToHand, emit, findCard, isAlive, logPublic, moveCard, player } from '../util';
import { hasSkill, regionCardsOf } from '../query';
import { afterGain } from './skills';
import type { Candidate } from './ask';
import type { DamageSpec } from './life';
import type { RespondSpec } from './combat';

export interface CardUseSpec {
  useId: string;
  userSeat: number;
  cardIds: string[];
  asName: string;
  targets: number[];
  /** 打出（响应）而非使用。 */
  played: boolean;
  reason: string;
  /** 禁止被响应（例如谋金轮，未启用）。 */
  unrespondable?: boolean;
  /** 禁止无懈可击响应（火把）。 */
  noNullify?: boolean;
}

export const cardUseDriver: Driver = ({ state, frame }: DriverCtx) => {
  const spec = frame.data.spec as CardUseSpec;
  const use = state.activeUses[spec.useId];
  switch (frame.step) {
    case 'init': {
      const def = cardDef(spec.asName);
      const single = spec.cardIds.length === 1;
      const first = single ? card(state, spec.cardIds[0]) : null;
      const u: CardUse = {
        useId: spec.useId,
        cardIds: spec.cardIds.slice(),
        name: spec.asName,
        category: def.category,
        suit: first ? first.suit : null,
        rank: first ? first.rank : null,
        nature: def.nature ?? 'normal',
        virtual: !(single && first && first.name === spec.asName),
        userSeat: spec.userSeat,
        declaredTargets: spec.targets.slice(),
        targets: spec.targets.slice(),
        unrespondable: Boolean(spec.unrespondable),
        noNullify: Boolean(spec.noNullify),
        played: spec.played,
        damageBonus: {},
        extra: {},
      };
      // 无目标牌（桃 / 酒 / 无中生有 / 装备）的结算循环仍然需要一个目标座位，
      // 这类牌的目标就是使用者本人。协议上客户端提交空 targets，
      // 由引擎在这里补全，避免把「自己」当成一个可选目标暴露给界面。
      const selfTarget =
        spec.targets.length === 0 &&
        (def.category === 'equip' || spec.asName === '桃' || spec.asName === '酒' || spec.asName === '无中生有');
      if (selfTarget) {
        u.declaredTargets = [spec.userSeat];
        u.targets = [spec.userSeat];
      }
      state.activeUses[spec.useId] = u;

      for (const id of spec.cardIds) {
        if (findCard(state, id)) moveCard(state, id, { zone: 'processing' }, 'use', spec.userSeat);
      }

      const user = player(state, spec.userSeat);
      if (isSha(spec.asName) && !spec.played) {
        user.turnFlags.shaUsed = Number(user.turnFlags.shaUsed ?? 0) + 1;
        if (user.turnFlags.wine) {
          u.extra.wine = true;
          delete user.turnFlags.wine;
        }
      }

      const targetText = spec.targets.length > 0 ? spec.targets.map((t) => player(state, t).displayName).join('、') : '自己';
      const srcText =
        spec.cardIds.length > 1 ? `（${spec.cardIds.map((id) => card(state, id).name).join(' + ')}）` : '';
      // 提交时没有指定目标的牌（装备 / 桃 / 酒 / 无中生有），日志不该出现「→ 自己」：
      // 那会被读成指向自己的锦囊。给别处濒死角色使用的【桃】是有目标的，照常显示。
      const equip = cardDef(spec.asName).category === 'equip';
      const verb = spec.played ? '打出' : equip ? '装备' : '使用';
      const tail = spec.targets.length === 0 ? '。' : ` → ${targetText}。`;
      logPublic(state, `${user.displayName} ${verb}【${spec.asName}】${srcText}${tail}`, 'use');
      emit(state, {
        type: spec.played ? 'CardPlayed' : 'CardUsed',
        useId: spec.useId,
        sourceSeat: spec.userSeat,
        actorSeat: spec.userSeat,
        targetSeats: spec.targets.slice(),
        reason: spec.reason,
        data: { name: spec.asName, cardIds: spec.cardIds.slice() },
      });

      frame.data.idx = 0;
      frame.data.negation = {};
      frame.step = 'targets';
      return { t: 'next' as const };
    }

    case 'targets': {
      const idx = Number(frame.data.idx ?? 0);
      if (idx >= use.targets.length) {
        frame.step = 'finish';
        return { t: 'next' as const };
      }
      const t = use.targets[idx];
      if (!isAlive(state, t)) {
        frame.data.idx = idx + 1;
        return { t: 'next' as const };
      }
      const needsNullify = use.category === 'trick' && !use.noNullify && !use.played;
      const alreadyAsked = Boolean(frame.data[`nul_${idx}`]);
      if (needsNullify && !alreadyAsked) {
        frame.data[`nul_${idx}`] = true;
        frame.step = 'afterNullify';
        return child('nullify', 'begin', { useId: use.useId, targetSeat: t }, '_nullify');
      }
      frame.step = 'resolve';
      return { t: 'next' as const };
    }

    case 'afterNullify': {
      const idx = Number(frame.data.idx ?? 0);
      const t = use.targets[idx];
      if (frame.data._nullify) {
        (frame.data.negation as Record<number, boolean>)[idx] = true;
        logPublic(state, `对 ${player(state, t).displayName} 的【${use.name}】被【无懈可击】抵消。`, 'info');
        frame.data.idx = idx + 1;
        frame.step = 'targets';
        return { t: 'next' as const };
      }
      frame.step = 'resolve';
      return { t: 'next' as const };
    }

    case 'resolve': {
      const idx = Number(frame.data.idx ?? 0);
      const t = use.targets[idx];
      if ((frame.data.negation as Record<number, boolean>)[idx]) {
        frame.data.idx = idx + 1;
        frame.step = 'targets';
        return { t: 'next' as const };
      }
      return resolveTarget(state, frame, use, t);
    }

    case 'afterRespond': {
      const ok = Boolean(frame.data._respond);
      const pd = frame.data.pendingDamage as Omit<DamageSpec, 'reason'> | null;
      if (!ok && pd) {
        frame.step = 'afterDamage';
        return child('damage', 'start', { spec: { ...pd, reason: use.name } as DamageSpec }, '_damage');
      }
      frame.step = 'advance';
      return { t: 'next' as const };
    }

    case 'afterDamage':
      frame.step = 'advance';
      return { t: 'next' as const };

    case 'advance':
      frame.data.idx = Number(frame.data.idx ?? 0) + 1;
      frame.step = 'targets';
      return { t: 'next' as const };

    case 'finish': {
      for (const id of use.cardIds) {
        if (state.processing.includes(id)) moveCard(state, id, { zone: 'discard' }, 'use-cleanup', use.userSeat);
      }
      emit(state, { type: 'CardUseFinished', useId: use.useId, sourceSeat: use.userSeat, reason: use.name });
      delete state.activeUses[use.useId];
      frame.step = 'done';
      return { t: 'next' as const };
    }

    default:
      return { t: 'done' as const };
  }
};

function resolveTarget(state: GameState, frame: { step: string; data: Record<string, any> }, use: CardUse, t: number) {
  const user = player(state, use.userSeat);
  const target = player(state, t);
  const name = use.name;

  if (isSha(name)) {
    const need = flashNeeded(state, use, t);
    frame.step = 'afterRespond';
    frame.data.pendingDamage = {
      sourceSeat: use.userSeat,
      targetSeat: t,
      amount: 1 + (use.extra.wine ? 1 : 0),
      nature: use.nature,
      useId: use.useId,
      cardIds: use.cardIds.slice(),
      byCardName: name,
      fromSha: true,
    };
    return child(
      'respond',
      'begin',
      {
        spec: {
          targetSeat: t,
          sourceSeat: use.userSeat,
          useId: use.useId,
          need: '闪',
          count: need,
          reason: `${user.displayName} 对你使用【${name}】`,
          unrespondable: use.unrespondable,
        } satisfies RespondSpec,
      },
      '_respond',
    );
  }

  switch (name) {
    case '桃': {
      if (user.hp < user.maxHp) {
        user.hp = Math.min(user.maxHp, user.hp + 1);
        logPublic(state, `${user.displayName} 回复 1 点体力，体力 → ${user.hp}。`, 'life');
        emit(state, { type: 'Recover', actorSeat: use.userSeat, targetSeats: [t], amount: 1 });
      } else {
        logPublic(state, `${user.displayName} 的体力已满，【桃】无效果。`, 'system');
      }
      frame.step = 'advance';
      return { t: 'next' as const };
    }
    case '酒': {
      user.turnFlags.wine = 1;
      // 不重复播报「使用【酒】」：`begin` 阶段已经记过一条同文日志，
      // 这里只补主日志没有的信息（效果），否则一次用酒会出现两行。
      logPublic(state, `${user.displayName} 的下一张【杀】首个伤害 +1。`, 'info');
      frame.step = 'advance';
      return { t: 'next' as const };
    }
    case '无中生有': {
      const got = drawToHand(state, use.userSeat, 2, '无中生有');
      logPublic(state, `${user.displayName} 摸 ${got.length} 张牌。`, 'info');
      afterGain(state, use.userSeat, got, '无中生有');
      frame.step = 'advance';
      return { t: 'next' as const };
    }
    case '顺手牵羊':
    case '过河拆桥': {
      const cands: Candidate[] = regionCardsOf(state, t).map((r) => ({
        cardId: r.cardId,
        from: r.zone,
        slot: r.slot,
        hidden: r.zone === 'hand',
      }));
      if (cands.length === 0) {
        frame.step = 'advance';
        return { t: 'next' as const };
      }
      const isGain = name === '顺手牵羊';
      frame.step = 'advance';
      return child(
        'askCards',
        'begin',
        {
          spec: {
            actorSeat: use.userSeat,
            fromSeat: t,
            candidates: cands,
            min: 1,
            max: 1,
            title: `【${name}】`,
            detail: `${isGain ? '获得' : '弃置'} ${target.displayName} 区域内的一张牌（手牌为随机背面）。`,
            mode: isGain ? 'gain' : 'discard',
            executor: use.userSeat,
            reason: name,
          },
        },
        '_child',
      );
    }
    case '决斗': {
      frame.step = 'advance';
      return child('duel', 'begin', { spec: { userSeat: use.userSeat, targetSeat: t, useId: use.useId } }, '_child');
    }
    case '南蛮入侵':
    case '万箭齐发': {
      if (target.equip.armor && card(state, target.equip.armor).name === '藤甲') {
        logPublic(state, `${target.displayName} 的【藤甲】使【${name}】无效。`, 'system');
        frame.step = 'advance';
        return { t: 'next' as const };
      }
      const need = name === '南蛮入侵' ? '杀' : '闪';
      frame.step = 'afterRespond';
      frame.data.pendingDamage = {
        sourceSeat: use.userSeat,
        targetSeat: t,
        amount: 1,
        nature: use.nature,
        useId: use.useId,
        cardIds: use.cardIds.slice(),
        byCardName: name,
        fromSha: false,
      };
      return child(
        'respond',
        'begin',
        {
          spec: {
            targetSeat: t,
            sourceSeat: use.userSeat,
            useId: use.useId,
            need,
            count: 1,
            reason: `${user.displayName} 使用【${name}】`,
            unrespondable: false,
          } satisfies RespondSpec,
        },
        '_respond',
      );
    }
    case '铁索连环': {
      target.chained = !target.chained;
      logPublic(state, `${target.displayName} ${target.chained ? '横置' : '重置'}。`, 'info');
      emit(state, { type: 'ChainToggled', targetSeats: [t], actorSeat: use.userSeat, data: { chained: target.chained } });
      frame.step = 'advance';
      return { t: 'next' as const };
    }
    case '乐不思蜀': {
      const cid = use.cardIds[0];
      if (cid && state.processing.includes(cid)) moveCard(state, cid, { zone: 'judge', seat: t }, 'delayed-trick', use.userSeat);
      logPublic(state, `${target.displayName} 的判定区置入【乐不思蜀】。`, 'info');
      frame.step = 'advance';
      return { t: 'next' as const };
    }
    case '君临天下': {
      const cands: Candidate[] = [
        ...target.hand.map((id) => ({ cardId: id, from: 'hand' as const })),
        ...EQUIP_SLOTS.filter((s) => target.equip[s]).map((s) => ({ cardId: target.equip[s]!, from: 'equip' as const, slot: s })),
      ];
      if (cands.length === 0) {
        frame.step = 'advance';
        return { t: 'next' as const };
      }
      frame.step = 'advance';
      return child(
        'askCards',
        'begin',
        {
          spec: {
            actorSeat: t,
            fromSeat: t,
            candidates: cands,
            min: 1,
            max: 1,
            title: '【君临天下】',
            detail: '弃置一张手牌或装备牌。',
            mode: 'discard',
            executor: t,
            reason: '君临天下',
          },
        },
        '_child',
      );
    }
    default: {
      const def = cardDef(name);
      if (def.category === 'equip') {
        const slot = def.slot!;
        const cid = use.cardIds[0];
        if (target.armorZoneAbolished && slot === 'armor') {
          logPublic(state, `${target.displayName} 的防具区已被废除，无法装备【${name}】。`, 'system');
        } else {
          const old = target.equip[slot];
          if (old) moveCard(state, old, { zone: 'discard' }, 'equip-replace', t);
          if (cid && state.processing.includes(cid)) {
            state.processing.splice(state.processing.indexOf(cid), 1);
            target.equip[slot] = cid;
            emit(state, { type: 'CardMoved', cardId: cid, targetSeats: [t], reason: 'equip', useId: use.useId });
          }
          // 成功路径不再单独记日志：`begin` 阶段已按牌名分类输出过「X 装备【Y】。」
          // 这里再记一次会让同一次装备在战斗记录里出现两行（状态本身是对的）。
          // 仅保留上面「防具区已被废除」的失败说明，那一条是主日志没有的信息。
        }
      }
      frame.step = 'advance';
      return { t: 'next' as const };
    }
  }
}

/** 计算目标需要的【闪】数量（憎恨等）。 */
export function flashNeeded(state: GameState, use: CardUse, targetSeat: number): number {
  let need = 1;
  const user = player(state, use.userSeat);
  const target = player(state, targetSeat);
  if (hasSkill(user, 'b17.zenghen') && target.hand.length > user.hand.length) need = Math.max(need, 2);
  if (hasSkill(target, 'b17.zenghen') && user.hand.length > target.hand.length) need = Math.max(need, 2);
  return need;
}
