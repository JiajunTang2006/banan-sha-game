import { createGame } from '@engine/setup';
import { advance } from '@engine/engine';
import { allCardIds, card, moveCard, player } from '@engine/util';
import { getActions } from '@engine/play';
import { LocalGame } from '../src/runner/localGame';
import type { Answer, Command, GameState, RoleId, Suit } from '@engine/types';

/** 首发 8 将的 characterId。 */
export const CHAR = {
  wulifan: 'b01',
  guyuanhao: 'b04',
  wangqingyang: 'b08',
  liuyutao: 'b11',
  qianyiwen: 'b12',
  chenyuelai: 'b13',
  chengjunming: 'b16',
  tangjiajun: 'b17',
} as const;

/** 默认对手挑选顺序，与 DEMO_POOL 的前几位一致。 */
const CHAR_POOL: string[] = [
  CHAR.guyuanhao,
  CHAR.liuyutao,
  CHAR.wulifan,
  CHAR.chengjunming,
  CHAR.chenyuelai,
  CHAR.wangqingyang,
  CHAR.qianyiwen,
  CHAR.tangjiajun,
];

/**
 * 5 人局脚手架：座位 0 固定为主公且是真人，其余座位按 others 指定。
 * 自己当主公可以保证建局后的第一个等待点就是自己的出牌阶段，无需推演前置回合。
 *
 * 默认自己用陈越来：两个技能（抽卡、将军）都只在主动发动或结束阶段生效，
 * 不会干扰出牌阶段的牌效断言。默认对手也避开了会影响伤害数值的技能
 * （冰神视为寒冰剑、紫殇废除防具区、内卷额外摸牌、憎恨要求双闪）。
 */
export function build(opts: {
  seed?: string;
  self?: string;
  others?: string[];
  n?: number;
  roles?: RoleId[];
  hands?: Record<number, string[]>;
}): GameState {
  const self = opts.self ?? CHAR.chenyuelai;
  // 默认对手池：与真实选将流程一致，同一位角色不会同时出现两次。
  // 同时避开会影响伤害数值的技能（冰神视为寒冰剑、紫殇废除防具区、
  // 内卷额外摸牌、憎恨要求双闪）。
  const others = opts.others ?? CHAR_POOL.filter((c) => c !== self).slice(0, 4);
  const chars = [self, ...others];
  const n = opts.n ?? chars.length;
  const seed = opts.seed ?? 'harness';
  const roles: RoleId[] = opts.roles ?? (['lord', ...Array(n - 1).fill('loyalist')] as RoleId[]);
  const displayNames: Record<number, string> = {};
  for (let i = 0; i < n; i++) displayNames[i] = 'P' + i;
  const { state } = createGame({
    seed,
    playerCount: n,
    selfSeat: 0,
    characters: chars.slice(0, n),
    roles,
    displayNames,
  });
  if (opts.hands) {
    for (const k of Object.keys(opts.hands)) setHand(state, Number(k), opts.hands[Number(k)]);
  }
  return state;
}

/** 把一批牌放进某座位的手牌（从原位置取出，含牌堆之外）。 */
export function setHand(state: GameState, seat: number, ids: string[]): void {
  const p = player(state, seat);
  for (const id of p.hand.slice()) moveCard(state, id, { zone: 'deck' }, 'test-setup');
  for (const id of ids) moveCard(state, id, { zone: 'hand', seat }, 'test-setup');
}

/** 从牌堆里取出一张指定牌名的实体牌。 */
export function fromDeck(state: GameState, name: string): string {
  const id = state.deck.find((c) => card(state, c).name === name);
  if (!id) throw new Error('牌堆里没有：' + name);
  return id;
}

/**
 * 把若干张指定牌名的牌直接塞进某座位的手牌。
 * 优先用牌堆里的；牌堆没有时从其他区域（含别人手上）取。
 * 一张实体牌只会被取一次，避免同一张牌被重复塞进手里。
 */
export function giveFromDeck(state: GameState, seat: number, names: string[]): string[] {
  const taken: string[] = [];
  const pick = (ids: string[]) => ids.find((id) => !taken.includes(id));
  for (const n of names) {
    const byName = (ids: string[]) => ids.filter((c) => card(state, c).name === n);
    const id = pick(byName(state.deck)) ?? pick(byName(allCardIds(state)));
    if (!id) throw new Error('全场没有：' + n);
    taken.push(id);
    moveCard(state, id, { zone: 'hand', seat }, 'test-setup');
  }
  return taken;
}

/** 手牌中的牌名列表。 */
export function handNames(state: GameState, seat: number): string[] {
  return player(state, seat).hand.map((id) => card(state, id).name);
}

/** 手牌中第一张指定牌名的实体 id。 */
export function inHand(state: GameState, seat: number, name: string): string {
  const id = player(state, seat).hand.find((c) => card(state, c).name === name);
  if (!id) throw new Error(`座位 ${seat} 手上没有 ${name}（当前：${handNames(state, seat).join('/')}）`);
  return id;
}

/** 直接把一张牌装备到某座位，绕过出牌流程。 */
export function forceEquip(state: GameState, seat: number, name: string): string {
  const id = fromDeck(state, name);
  const def = card(state, id);
  void def;
  moveCard(state, id, { zone: 'equip', seat, slot: equipSlotOf(name) }, 'test-setup');
  return id;
}

function equipSlotOf(name: string): 'weapon' | 'armor' | 'offenseMount' | 'defenseMount' {
  const table: Record<string, 'weapon' | 'armor' | 'offenseMount' | 'defenseMount'> = {
    寒冰剑: 'weapon',
    方天画戟: 'weapon',
    诸葛连弩: 'weapon',
    长刀: 'weapon',
    八卦阵: 'armor',
    藤甲: 'armor',
    进攻坐骑: 'offenseMount',
    防御坐骑: 'defenseMount',
  };
  const slot = table[name];
  if (!slot) throw new Error('不是装备牌：' + name);
  return slot;
}

/** 直接改体力，用于构造边界场景。 */
export function setHp(state: GameState, seat: number, hp: number): void {
  player(state, seat).hp = hp;
}

export function setMaxHp(state: GameState, seat: number, maxHp: number): void {
  const p = player(state, seat);
  p.maxHp = maxHp;
  if (p.hp > maxHp) p.hp = maxHp;
}

/** 建局并推进到自己的出牌阶段。座位 0 须为主公，否则会先由电脑行动。 */
export function toPlay(state: GameState, selfSeat = 0): LocalGame {
  const game = new LocalGame(state, selfSeat);
  game.start();
  return game;
}

/** 提交命令并让电脑自动应答，返回是否被接受。 */
export function send(game: LocalGame, cmd: Command): { ok: boolean; error?: string } {
  const r = game.send(cmd);
  return { ok: r.ok, error: r.error };
}

/**
 * 以指定座位直接提交命令，不自动推进电脑。
 * 需要逐座位精确控制流程（例如让某个座位决定是否使用无懈可击）时使用。
 */
export function sendAs(state: GameState, seat: number, cmd: Command): { ok: boolean; error?: string } {
  return advance(state, { seat, playerId: 'p' + seat, commandId: 'test-' + seat }, cmd);
}

/** 以当前待选项的应答者身份回答。 */
export function answerCurrent(state: GameState, answer: Answer): { ok: boolean; error?: string } {
  const p = state.pending;
  if (!p) throw new Error('当前没有待处理的提示');
  return sendAs(state, p.actorSeat, {
    type: 'ANSWER_PROMPT',
    promptId: p.promptId,
    promptRevision: p.revision,
    answer,
  });
}

/** 放弃当前待选项（无待选项时抛错，避免测试静默通过）。 */
export function answerPass(state: GameState): { ok: boolean; error?: string } {
  return answerCurrent(state, { cardIds: [], targets: [], pass: true });
}

/**
 * 按序号选择当前提示里的第 idx 个可选项。
 * 用于「从对方手牌里选一张」这类只给背面槽位的提示。
 */
export function answerPick(state: GameState, idx = 0): { ok: boolean; error?: string } {
  const p = state.pending;
  if (!p) throw new Error('当前没有待处理的提示');
  const cards = p.options.selectableCards;
  const pick = cards[idx];
  if (!pick) throw new Error(`可选牌不足：需要第 ${idx + 1} 项，实际 ${cards.length} 项`);
  return answerCurrent(state, { cardIds: [pick.cardId], targets: [], pass: false });
}

/** 当前提示的可选牌数量。 */
export function optionCount(state: GameState): number {
  return state.pending ? state.pending.options.selectableCards.length : 0;
}

/** 一直回答当前提示，直到提示不归属于该座位或对局结束。 */
export function drain(state: GameState, seat: number, max = 20): number {
  let n = 0;
  while (state.pending && state.pending.actorSeat === seat && n < max) {
    answerPass(state);
    n += 1;
  }
  return n;
}

/** 让所有电脑回答当前提示，直到轮到 selfSeat 或对局结束。 */
export function runBots(state: GameState, selfSeat = 0): number {
  return new LocalGame(state, selfSeat).runBots();
}

/**
 * 把其他座位手上的某牌名全部收回牌堆。
 * 电脑的初始手牌是随机的，会让「只给某一个座位发无懈可击」这类用例变得不确定。
 */
export function stripFromOthers(state: GameState, name: string, keep: number[] = []): number {
  let n = 0;
  for (const p of state.players) {
    if (keep.includes(p.seat)) continue;
    for (const id of p.hand.slice()) {
      if (card(state, id).name === name) {
        moveCard(state, id, { zone: 'deck' }, 'test-strip');
        n += 1;
      }
    }
  }
  return n;
}

/** 当前等待的座位（无提示返回 null）。 */
export function waitingSeat(state: GameState): number | null {
  return state.pending ? state.pending.actorSeat : null;
}

/** 当前待选项标题。 */
export function promptTitle(state: GameState): string | null {
  return state.pending ? state.pending.title : null;
}

/** 出牌阶段的可用动作 id 列表。 */
export function actionIds(state: GameState, seat: number): string[] {
  return getActions(state, seat).map((a) => a.id);
}

export function suitOf(state: GameState, id: string): Suit {
  return card(state, id).suit;
}

/**
 * 从全场实体牌里按条件挑 id，优先取还在牌堆里的。
 * 用于构造需要确定花色 / 点数的场景，避免依赖随机发牌。
 */
export function findCards(
  state: GameState,
  pred: (c: { name: string; suit: Suit; rank: number }) => boolean,
  n = 1,
): string[] {
  const all = allCardIds(state);
  const hit = (id: string) => pred(card(state, id));
  const deck = all.filter((id) => state.deck.includes(id) && hit(id));
  const rest = all.filter((id) => !state.deck.includes(id) && hit(id));
  const out = [...deck, ...rest].slice(0, n);
  if (out.length < n) throw new Error(`符合条件的牌不足：需要 ${n} 张，实际 ${out.length} 张`);
  return out;
}

/** 把指定牌按给定顺序放到牌堆顶（用于【抽卡】等依赖牌堆顶的用例）。 */
export function stackDeck(state: GameState, ids: string[]): void {
  state.deck = [...ids, ...state.deck.filter((id) => !ids.includes(id))];
}

/** 某个技能动作在当前出牌阶段的禁用原因；可用时返回 null，动作不存在时返回特殊标记。 */
export function skillNote(state: GameState, seat: number, skillId: string): string | null {
  const a = getActions(state, seat).find((x) => x.kind === 'activateSkill' && x.skillId === skillId);
  return a ? a.note ?? null : '（动作不存在）';
}

/** 当前提示的 detail 文本（无提示返回 null）。 */
export function promptDetail(state: GameState): string | null {
  return state.pending ? state.pending.detail : null;
}

/** 一直回答非出牌阶段的提示，直到回到自己的出牌阶段或没有提示。 */
export function answerAll(state: GameState, max = 24): number {
  let n = 0;
  while (state.pending && state.pending.kind !== 'playPhase' && n < max) {
    answerPass(state);
    n += 1;
  }
  return n;
}
