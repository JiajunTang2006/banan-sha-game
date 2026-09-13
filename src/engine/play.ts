import { cardDef, isSha } from '@content/cards';
import { characterOf } from '@content/characters';
import type { ActionDescriptor, GameState, PlayerState } from './types';
import { EQUIP_SLOTS, card, player } from './util';
import { attackRange, distance, hasCardsInRegions, hasSkill } from './query';

export interface TargetSpec {
  min: number;
  max: number;
  legal: number[];
}

/** 计算某个牌名在指定素材下的合法目标。返回 null 表示该牌名不以“选目标”的方式使用。 */
export function targetSpecFor(state: GameState, seat: number, asName: string, cardIds: string[]): TargetSpec | null {
  const others = state.players.filter((p) => p.alive && p.seat !== seat).map((p) => p.seat);
  const def = cardDef(asName);
  switch (asName) {
    case '普通杀':
    case '火杀':
    case '雷杀': {
      const legal = others.filter((t) => distance(state, seat, t) <= attackRange(state, seat));
      let max = 1;
      // 方天画戟：消耗当时全部手牌（至少 1 张）可额外指定至多 2 名攻击范围内的其他角色
      const p = player(state, seat);
      const wName = weaponName(state, seat);
      if (wName === '方天画戟' && cardIds.length === p.hand.length && cardIds.length >= 1) max = 3;
      return { min: 1, max, legal };
    }
    case '决斗':
    case '过河拆桥':
      return { min: 1, max: 1, legal: asName === '决斗' ? others : others.filter((t) => hasCardsInRegions(state, t)) };
    case '顺手牵羊':
      return { min: 1, max: 1, legal: others.filter((t) => distance(state, seat, t) === 1 && hasCardsInRegions(state, t)) };
    case '南蛮入侵':
    case '万箭齐发':
    case '君临天下':
      // 规则文本是「所有其他角色」：不接受只指定一部分目标。
      return { min: others.length, max: others.length, legal: others };
    case '乐不思蜀':
      return {
        min: 1,
        max: 1,
        legal: others.filter((t) => !player(state, t).judge.some((id) => card(state, id).name === '乐不思蜀')),
      };
    case '铁索连环':
      return { min: 1, max: 2, legal: state.players.filter((p) => p.alive).map((p) => p.seat) };
    default:
      if (def.category === 'equip' || asName === '桃' || asName === '酒' || asName === '无中生有') return null;
      return null;
  }
}

export function weaponName(state: GameState, seat: number): string | null {
  const w = player(state, seat).equip.weapon;
  if (w) return card(state, w).name;
  if (hasSkill(player(state, seat), 'b08.bingshen')) return '寒冰剑';
  return null;
}

/** 是否为群体牌（自动指向所有其他角色）。 */
export function isMassCard(name: string): boolean {
  return name === '南蛮入侵' || name === '万箭齐发' || name === '君临天下';
}

/** 生成出牌阶段的可选动作。 */
export function getActions(state: GameState, seat: number): ActionDescriptor[] {
  const p = player(state, seat);
  const out: ActionDescriptor[] = [];
  const push = (a: Omit<ActionDescriptor, 'id' | 'cancelable'> & { cancelable?: boolean }) => {
    out.push({ ...a, id: `${a.kind}:${a.asName ?? a.skillId ?? 'x'}:${a.cardIds.join('+')}`, cancelable: a.cancelable ?? true });
  };

  const shaUsed = Number(p.turnFlags.shaUsed ?? 0);
  const limit = shaLimitOf(state, seat);

  for (const id of p.hand) {
    const c = card(state, id);
    const def = cardDef(c.name);
    const base: string[] = [c.name];

    // 纵欲：桃当酒 / 酒当桃
    if (hasSkill(p, 'b12.zongyu')) {
      if (c.name === '桃') base.push('酒');
      if (c.name === '酒') base.push('桃');
    }

    for (const asName of base) {
      const as = asName === c.name ? undefined : asName;
      // 【闪】只能响应，不能在出牌阶段主动使用
      if (asName === '闪') continue;
      if (asName === '杀' || isSha(asName)) {
        if (shaUsed >= limit) continue;
      }
      const spec = targetSpecFor(state, seat, asName, [id]);
      if (spec && spec.legal.length === 0) continue;
      if (asName === '桃' && p.hp >= p.maxHp) continue;
      if (asName === '酒' && p.turnFlags.wine) continue;
      if (def.category === 'equip' && def.slot === 'armor' && p.armorZoneAbolished) continue;
      push({
        kind: 'useCard',
        label: `${as ? `${c.name}→` : ''}【${asName}】`,
        cardIds: [id],
        asName,
        targetSpec: spec,
        detail: def.desc,
      });
    }

    // 重铸
    if (def.recastable) {
      push({ kind: 'recast', label: `重铸【${c.name}】`, cardIds: [id], asName: c.name, targetSpec: null });
    }
  }

  // 气体（王清阳）：两张同花色手牌当【万箭齐发】
  if (hasSkill(p, 'b08.qiti') && !p.turnFlags.qitiUsed) {
    const combos = pairs(p.hand);
    for (const [a, b] of combos) {
      if (comboMatchesSuit(state, a, b, p)) {
        push({
          kind: 'activateSkill',
          label: `【气体】${card(state, a).name}+${card(state, b).name} → 【万箭齐发】`,
          cardIds: [a, b],
          skillId: 'b08.qiti',
          asName: '万箭齐发',
          targetSpec: targetSpecFor(state, seat, '万箭齐发', [a, b]),
        });
      }
    }
  }

  // 技能动作
  const ch = characterOf(p.characterId);
  for (const s of ch.skills) {
    const g = skillGate(state, seat, s.skillId);
    push({
      kind: 'activateSkill',
      label: `发动【${s.name}】`,
      cardIds: [],
      skillId: s.skillId,
      targetSpec: null,
      detail: s.text,
      note: g.ok ? undefined : g.reason,
    });
  }

  push({
    kind: 'endPhase',
    label: '结束出牌阶段',
    cardIds: [],
    targetSpec: null,
    cancelable: false,
  });

  return out;
}

function shaLimitOf(state: GameState, seat: number): number {
  const p = player(state, seat);
  if (hasSkill(p, 'b04.ganba')) return Infinity;
  const w = weaponName(state, seat);
  if (w === '诸葛连弩') return Infinity;
  return 1;
}

function pairs(ids: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
  }
  return out;
}

function comboMatchesSuit(state: GameState, a: string, b: string, p: PlayerState): boolean {
  const ca = card(state, a);
  const cb = card(state, b);
  if (ca.suit === cb.suit) return true;
  // 小方：至多一张 ♦ 可视为任意花色
  if (hasSkill(p, 'b08.xiaofang') && (ca.suit === '♦' || cb.suit === '♦')) return true;
  return false;
}

export interface SkillGate {
  ok: boolean;
  reason: string;
}

/** 技能在出牌阶段是否具备发动条件。 */
export function skillGate(state: GameState, seat: number, skillId: string): SkillGate {
  const p = player(state, seat);
  switch (skillId) {
    case 'b01.lambda': {
      if (p.skillFlags.lambdaLocked) return { ok: false, reason: '本回合已翻出“λ”牌，不能再发动。' };
      const nonLambda = p.hand.filter((id) => !isLambda(p, id)).length;
      if (nonLambda < 2) return { ok: false, reason: '需要至少两张未记录为“λ”的手牌。' };
      return { ok: true, reason: '' };
    }
    case 'b08.qiti': {
      if (p.turnFlags.qitiUsed) return { ok: false, reason: '出牌阶段限一次，本阶段已发动。' };
      const combos = pairs(p.hand);
      if (!combos.some(([a, b]) => comboMatchesSuit(state, a, b, p))) return { ok: false, reason: '需要两张花色相同的手牌。' };
      return { ok: true, reason: '' };
    }
    case 'b08.xiaofang':
    case 'b08.bingshen':
    case 'b04.ganba':
    case 'b12.zishang':
    case 'b12.jianshen':
    case 'b12.zongyu':
    case 'b16.xiamu':
    case 'b17.neijuan':
    case 'b17.zenghen':
      return { ok: false, reason: '锁定技 / 转化技，自动生效，无需主动发动。' };
    case 'b11.huoba': {
      if (p.turnFlags.huobaUsed) return { ok: false, reason: '出牌阶段限一次，本阶段已发动。' };
      const cost = p.hand.length + EQUIP_SLOTS.filter((s) => p.equip[s]).length;
      if (cost < 1) return { ok: false, reason: '需要弃置一张手牌或装备区的牌。' };
      if (state.players.filter((x) => x.alive).length < 2) return { ok: false, reason: '需要两名不同角色。' };
      return { ok: true, reason: '' };
    }
    case 'b13.chouka': {
      if (p.turnFlags.choukaUsed) return { ok: false, reason: '出牌阶段限一次，本阶段已发动。' };
      return { ok: true, reason: '' };
    }
    case 'b13.jiangjun':
    case 'b16.yezhang':
      return { ok: false, reason: '结束阶段自动检查的技能。' };
    default:
      return { ok: false, reason: '该技能未在出牌阶段主动发动。' };
  }
}

export function isLambda(p: { skillFlags: Record<string, unknown> }, cardId: string): boolean {
  const arr = p.skillFlags.lambdaCards;
  return Array.isArray(arr) && arr.includes(cardId);
}
