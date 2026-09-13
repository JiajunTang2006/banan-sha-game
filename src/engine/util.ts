import type {
  CardInstance,
  EquipSlot,
  GameEvent,
  GameState,
  LogEntry,
  Modifier,
  PlayerState,
  Suit,
} from './types';
import { rngInt } from './rng';

export const SUSPECT_SUITS: Suit[] = ['♠', '♥', '♣', '♦'];

export const COLOR_OF_SUIT: Record<Suit, 'red' | 'black'> = {
  '♥': 'red',
  '♦': 'red',
  '♠': 'black',
  '♣': 'black',
};

export type PlayerZoneRef = { zone: 'hand' | 'equip' | 'judge' | 'cai'; seat: number; slot?: EquipSlot };
export type GlobalZoneRef = { zone: 'deck' | 'discard' | 'processing' | 'outside' };
export type ZoneRef = PlayerZoneRef | GlobalZoneRef;

export function isPlayerZone(z: ZoneRef): z is PlayerZoneRef {
  return z.zone === 'hand' || z.zone === 'equip' || z.zone === 'judge' || z.zone === 'cai';
}

export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'armor', 'offenseMount', 'defenseMount'];

export const SLOT_LABEL: Record<EquipSlot, string> = {
  weapon: '武器',
  armor: '防具',
  offenseMount: '进攻坐骑',
  defenseMount: '防御坐骑',
};

/* ------------------------------------------------------------------ */
/* 基础访问                                                            */
/* ------------------------------------------------------------------ */

export function player(state: GameState, seat: number): PlayerState {
  const p = state.players[seat];
  if (!p) throw new Error('不存在的座位：' + seat);
  return p;
}

export function card(state: GameState, id: string): CardInstance {
  const c = state.cards[id];
  if (!c) throw new Error('不存在的牌 id：' + id);
  return c;
}

export function aliveSeats(state: GameState): number[] {
  return state.players.filter((p) => p.alive).map((p) => p.seat);
}

export function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.alive);
}

export function isAlive(state: GameState, seat: number): boolean {
  return !!state.players[seat]?.alive;
}

/** 从 from 起顺时针的下一个存活座位；找不到返回 null。 */
export function nextAliveSeat(state: GameState, from: number, skip: number[] = [], includeSelf = false): number | null {
  const n = state.playerCount;
  for (let i = includeSelf ? 0 : 1; i <= n; i++) {
    const s = (from + i) % n;
    if (state.players[s].alive && !skip.includes(s)) return s;
  }
  return null;
}

/** 从 from 起按座次顺序排列的存活座位（含 from 自己，若其存活）。 */
export function seatOrderFrom(state: GameState, from: number, opts: { includeSelf?: boolean; skip?: number[] } = {}): number[] {
  const { includeSelf = true, skip = [] } = opts;
  const out: number[] = [];
  const n = state.playerCount;
  for (let i = includeSelf ? 0 : 1; i < n; i++) {
    const s = (from + i) % n;
    if (state.players[s].alive && !skip.includes(s)) out.push(s);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 牌区                                                                */
/* ------------------------------------------------------------------ */

export function findCard(state: GameState, id: string): ZoneRef | null {
  for (const p of state.players) {
    if (p.hand.includes(id)) return { zone: 'hand', seat: p.seat };
    if (p.judge.includes(id)) return { zone: 'judge', seat: p.seat };
    if (p.cai.includes(id)) return { zone: 'cai', seat: p.seat };
    for (const slot of EQUIP_SLOTS) {
      if (p.equip[slot] === id) return { zone: 'equip', seat: p.seat, slot };
    }
  }
  if (state.deck.includes(id)) return { zone: 'deck' };
  if (state.discard.includes(id)) return { zone: 'discard' };
  if (state.processing.includes(id)) return { zone: 'processing' };
  return null;
}

export function locationLabel(loc: ZoneRef | null): string {
  if (!loc) return '游戏外';
  if (loc.zone === 'deck') return '牌堆';
  if (loc.zone === 'discard') return '弃牌堆';
  if (loc.zone === 'processing') return '处理区';
  if (loc.zone === 'outside') return '游戏外';
  const who = 'seat' in loc ? `座位 ${loc.seat}` : '';
  const z =
    loc.zone === 'hand' ? '手牌' : loc.zone === 'equip' ? '装备区' : loc.zone === 'judge' ? '判定区' : '财';
  return `${who} 的${z}`;
}

/** 从当前所在区域移除（不产生事件）。 */
export function detachCard(state: GameState, id: string): ZoneRef | null {
  const loc = findCard(state, id);
  if (!loc) return null;
  if (!isPlayerZone(loc)) {
    if (loc.zone === 'outside') return loc;
    const arr = state[loc.zone];
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    return loc;
  }
  const p = state.players[loc.seat];
  if (loc.zone === 'hand' || loc.zone === 'judge' || loc.zone === 'cai') {
    const arr = p[loc.zone];
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    return loc;
  }
  if (loc.slot && p.equip[loc.slot] === id) p.equip[loc.slot] = null;
  return loc;
}

export function putCard(state: GameState, id: string, to: ZoneRef): void {
  if (!isPlayerZone(to)) {
    if (to.zone === 'outside') return;
    state[to.zone].push(id);
    return;
  }
  const p = state.players[to.seat];
  if (to.zone === 'equip') {
    p.equip[to.slot!] = id;
    return;
  }
  p[to.zone].push(id);
}

/** 移动一张牌，产生 CardMoved 事件。返回原区域。 */
export function moveCard(state: GameState, id: string, to: ZoneRef, reason: string, actorSeat: number | null = null): ZoneRef | null {
  const from = detachCard(state, id);
  putCard(state, id, to);
  emit(state, {
    type: 'CardMoved',
    cardId: id,
    from,
    to,
    reason,
    actorSeat,
  });
  return from;
}

/* ------------------------------------------------------------------ */
/* 事件与日志                                                          */
/* ------------------------------------------------------------------ */

export interface EmitInput {
  type: string;
  parentSeq?: number | null;
  useId?: string | null;
  sourceSeat?: number | null;
  targetSeats?: number[];
  actorSeat?: number | null;
  reason?: string | null;
  amount?: number | null;
  data?: Record<string, unknown>;
  cardId?: string;
  from?: unknown;
  to?: unknown;
}

export function emit(state: GameState, ev: EmitInput): GameEvent {
  const e: GameEvent = {
    seq: ++state.eventSeq,
    type: ev.type,
    parentSeq: ev.parentSeq ?? null,
    useId: ev.useId ?? null,
    sourceSeat: ev.sourceSeat ?? null,
    targetSeats: ev.targetSeats ?? [],
    actorSeat: ev.actorSeat ?? null,
    reason: ev.reason ?? null,
    amount: ev.amount ?? null,
    data: ev.data ?? {},
  };
  if (ev.cardId) e.data.cardId = ev.cardId;
  if (ev.from !== undefined) e.data.from = ev.from;
  if (ev.to !== undefined) e.data.to = ev.to;
  state.events.push(e);
  return e;
}

export function logPublic(state: GameState, text: string, severity: LogEntry['severity'] = 'info'): void {
  state.log.push({
    seq: state.log.length + 1,
    visibility: 'public',
    ownerSeat: null,
    text,
    severity,
    turnSerial: state.turn.turnSerial,
  });
}

export function logPrivate(state: GameState, seat: number, text: string, severity: LogEntry['severity'] = 'info'): void {
  state.log.push({
    seq: state.log.length + 1,
    visibility: 'private',
    ownerSeat: seat,
    text,
    severity,
    turnSerial: state.turn.turnSerial,
  });
}

/* ------------------------------------------------------------------ */
/* 摸牌与获得                                                          */
/* ------------------------------------------------------------------ */

/** 补牌：牌堆不足时把弃牌堆洗成新牌堆（处理区与场上牌不回洗）。 */
export function ensureDeck(state: GameState, need: number): void {
  if (state.deck.length >= need) return;
  if (state.discard.length === 0) return;
  const recycled = state.discard.splice(0, state.discard.length);
  // 使用确定性随机打乱
  for (let i = recycled.length - 1; i > 0; i--) {
    const j = rngInt(state.rng, i + 1);
    const t = recycled[i];
    recycled[i] = recycled[j];
    recycled[j] = t;
  }
  state.deck.push(...recycled);
  logPublic(state, '牌堆已用尽，弃牌堆洗入成为新牌堆。', 'system');
}

/** 从牌堆顶摸 count 张进入某人的手牌，返回这批牌 id。 */
export function drawToHand(state: GameState, seat: number, count: number, reason: string): string[] {
  ensureDeck(state, count);
  const p = player(state, seat);
  const got: string[] = [];
  for (let i = 0; i < count; i++) {
    if (state.deck.length === 0) break;
    const id = state.deck.shift()!;
    p.hand.push(id);
    got.push(id);
  }
  if (got.length > 0) {
    emit(state, {
      type: 'CardsGained',
      sourceSeat: null,
      targetSeats: [seat],
      reason,
      amount: got.length,
      data: { cardIds: got, batch: true },
    });
  }
  return got;
}

/* ------------------------------------------------------------------ */
/* 随机取手牌                                                          */
/* ------------------------------------------------------------------ */

/** 从目标手牌中随机抽取 count 张（获得他人手牌时使用）。 */
export function takeRandomHandCards(state: GameState, seat: number, count: number): string[] {
  const p = player(state, seat);
  const picked: string[] = [];
  const n = Math.min(count, p.hand.length);
  for (let i = 0; i < n; i++) {
    const j = rngInt(state.rng, p.hand.length);
    picked.push(p.hand[j]);
    p.hand.splice(j, 1);
  }
  return picked;
}

/* ------------------------------------------------------------------ */
/* 修正条目                                                            */
/* ------------------------------------------------------------------ */

export function addModifier(state: GameState, seat: number, mod: Omit<Modifier, 'id'>): Modifier {
  const p = player(state, seat);
  const m: Modifier = { ...mod, id: `mod${state.eventSeq}-${p.modifiers.length}` };
  p.modifiers.push(m);
  return m;
}

export function removeModifiers(p: PlayerState, pred: (m: Modifier) => boolean): void {
  p.modifiers = p.modifiers.filter((m) => !pred(m));
}

export function findModifier(p: PlayerState, kind: string): Modifier | undefined {
  return p.modifiers.find((m) => m.kind === kind);
}

/* ------------------------------------------------------------------ */
/* 杂项                                                                */
/* ------------------------------------------------------------------ */

export function rankLabel(rank: number): string {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return String(rank);
}

export function describeCard(c: CardInstance): string {
  return `${c.suit}${rankLabel(c.rank)}【${c.name}】`;
}

export function allCardIds(state: GameState): string[] {
  return Object.keys(state.cards);
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function shuffleArray<T>(state: GameState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(state.rng, i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}
