import type { CardDef } from '@content/cards';
import { cardDef, isSha } from '@content/cards';
import { characterOf } from '@content/characters';
import type { CardInstance, CardView, EquipSlot, GameState, PlayerState, Suit } from './types';
import { COLOR_OF_SUIT, EQUIP_SLOTS, card, player } from './util';

/* ------------------------------------------------------------------ */
/* 距离与范围                                                          */
/* ------------------------------------------------------------------ */

/** 环形存活座次的较短步数。 */
export function baseDistance(state: GameState, a: number, b: number): number {
  if (a === b) return 0;
  const alive = state.players.filter((p) => p.alive).map((p) => p.seat);
  if (alive.length <= 1) return 0;
  const n = alive.length;
  const ia = alive.indexOf(a);
  const ib = alive.indexOf(b);
  if (ia < 0 || ib < 0) return 0;
  const d = Math.abs(ia - ib);
  return Math.min(d, n - d);
}

export function hasSkill(p: PlayerState, skillId: string): boolean {
  const ch = characterOf(p.characterId);
  if (ch.skills.some((s) => s.skillId === skillId)) return true;
  // 技能可能被临时授予（例如化神派生技）；统一从 skillFlags.granted 读取
  const granted = p.skillFlags.granted;
  return Array.isArray(granted) && granted.includes(skillId);
}

/** 有效的武器（含【冰神】视为装备的虚拟【寒冰剑】）。无武器则为 null。 */
export function effectiveWeapon(state: GameState, seat: number): { cardId: string | null; def: CardDef; virtual: boolean } | null {
  const p = player(state, seat);
  const realId = p.equip.weapon;
  if (realId) {
    const c = card(state, realId);
    return { cardId: realId, def: cardDef(c.name), virtual: false };
  }
  if (hasSkill(p, 'b08.bingshen')) {
    return { cardId: null, def: cardDef('寒冰剑'), virtual: true };
  }
  return null;
}

export function attackRange(state: GameState, seat: number): number {
  const p = player(state, seat);
  const w = effectiveWeapon(state, seat);
  let base = w ? w.def.range ?? 1 : 1;
  // 干拔：攻击范围 +3
  if (hasSkill(p, 'b04.ganba')) base += 3;
  for (const m of p.modifiers) {
    if (m.kind === 'rangeDelta') base += Number(m.data.delta ?? 0);
  }
  return Math.max(0, base);
}

/** from 计算与 to 的最终距离（含技能与坐骑修正），最小为 1，自身为 0。 */
export function distance(state: GameState, from: number, to: number): number {
  if (from === to) return 0;
  if (!state.players[from].alive || !state.players[to].alive) return 0;
  let d = baseDistance(state, from, to);
  const pFrom = player(state, from);
  const pTo = player(state, to);

  // 狭目：程俊铭计算与其他角色的距离 +1
  if (hasSkill(pFrom, 'b16.xiamu')) d += 1;
  // SP【飞柱】：其他角色计算与你的距离 -1（未启用，登记用）
  if (hasSkill(pTo, 's03.feizhu')) d -= 1;
  // 进攻坐骑 -1
  if (pFrom.equip.offenseMount) d -= 1;
  // 防御坐骑：其他角色计算与你的距离 +1
  if (pTo.equip.defenseMount) d += 1;

  // 技能造成的临时距离修正
  for (const m of pFrom.modifiers) {
    if (m.kind === 'distanceOut') d += Number(m.data.delta ?? 0);
  }
  for (const m of pTo.modifiers) {
    if (m.kind === 'distanceIn') d += Number(m.data.delta ?? 0);
  }
  return Math.max(1, d);
}

export function inAttackRange(state: GameState, seat: number, target: number): boolean {
  if (seat === target) return false;
  return distance(state, seat, target) <= attackRange(state, seat);
}

/* ------------------------------------------------------------------ */
/* 牌信息                                                              */
/* ------------------------------------------------------------------ */

export function cardViewOf(state: GameState, id: string): CardView {
  const c = card(state, id);
  const def = cardDef(c.name);
  return { id, name: c.name, suit: c.suit, rank: c.rank, nature: def.nature, virtual: false };
}

export function colorOf(c: { suit: Suit | null }): 'red' | 'black' | null {
  if (!c.suit) return null;
  return COLOR_OF_SUIT[c.suit];
}

export function isEquipCard(c: CardInstance): boolean {
  return cardDef(c.name).category === 'equip';
}

export function isTrickCard(c: CardInstance): boolean {
  const cat = cardDef(c.name).category;
  return cat === 'trick' || cat === 'delayedTrick';
}

export function handLimit(state: GameState, seat: number): number {
  const p = player(state, seat);
  let base = Math.max(0, p.hp);
  // 替换型技能：目前只有【老鼠】把上限改成体力上限
  if (hasSkill(p, 'b15.laoshu')) base = Math.max(0, p.maxHp);
  for (const m of p.modifiers) {
    if (m.kind === 'handLimitDelta') base += Number(m.data.delta ?? 0);
  }
  return Math.max(0, base);
}

/** 每阶段允许的杀次数上限；返回 Infinity 表示无限。 */
export function shaLimit(state: GameState, seat: number): number {
  const p = player(state, seat);
  if (hasSkill(p, 'b04.ganba')) return Infinity;
  const w = effectiveWeapon(state, seat);
  if (w && w.def.name === '诸葛连弩') return Infinity;
  for (const m of p.modifiers) {
    if (m.kind === 'shaLimit') return Number(m.data.value ?? 1);
  }
  return 1;
}

export function countShaThisTurn(p: PlayerState): number {
  return Number(p.turnFlags.shaUsed ?? 0);
}

/** 当前是否为该座位自己的回合。 */
export function isSelfTurn(state: GameState, seat: number): boolean {
  return state.turn.currentSeat === seat;
}

export function equipCardIn(state: GameState, seat: number, slot: EquipSlot): CardInstance | null {
  const id = player(state, seat).equip[slot];
  return id ? card(state, id) : null;
}

export function equipName(state: GameState, seat: number, slot: EquipSlot): string | null {
  const c = equipCardIn(state, seat, slot);
  return c ? c.name : null;
}

/** 目标区域内是否有牌（顺手牵羊 / 过河拆桥的前提）。 */
export function hasCardsInRegions(state: GameState, seat: number): boolean {
  const p = player(state, seat);
  if (p.judge.length > 0 || p.hand.length > 0) return true;
  return EQUIP_SLOTS.some((s) => p.equip[s]);
}

/** 某目标“可被弃置/获得”的牌的分区集合。 */
export function regionCardsOf(state: GameState, seat: number): { cardId: string; zone: 'hand' | 'equip' | 'judge'; slot?: EquipSlot }[] {
  const p = player(state, seat);
  const out: { cardId: string; zone: 'hand' | 'equip' | 'judge'; slot?: EquipSlot }[] = [];
  for (const id of p.hand) out.push({ cardId: id, zone: 'hand' });
  for (const s of EQUIP_SLOTS) {
    const id = p.equip[s];
    if (id) out.push({ cardId: id, zone: 'equip', slot: s });
  }
  for (const id of p.judge) out.push({ cardId: id, zone: 'judge' });
  return out;
}

export function shaNamesInHand(state: GameState, seat: number): string[] {
  return player(state, seat).hand.filter((id) => isSha(card(state, id).name));
}

/** 检查“不能响应”类禁制。 */
export function canRespondTo(state: GameState, seat: number): boolean {
  const p = player(state, seat);
  for (const m of p.modifiers) {
    if (m.kind === 'cannotRespond') return false;
  }
  return true;
}

export function describeSeat(state: GameState, seat: number): string {
  const p = player(state, seat);
  const ch = characterOf(p.characterId);
  return `座位${seat + 1}·${p.displayName}（${ch.name}）`;
}
