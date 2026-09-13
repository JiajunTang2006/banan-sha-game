import { DEMO_POOL, type CharacterDef, characterOf } from '@content/characters';
import { BASE_DECK } from '@content/deckData';
import type { GameState, PlayerState, RoleId, Suit } from './types';
import { rngFromSeed, rngInt, rngShuffle } from './rng';
import { drawToHand, logPublic } from './util';
import { assignFrameId, makeFrame, pump } from './frames';

export const ENGINE_VERSION = '0.1.0';
export const RULES_VERSION = 'v0.9.1';
export const CONTENT_VERSION = 'c0-8chars-104cards';

/** 身份配置（v0.9 原文）。 */
export function roleConfig(playerCount: number): RoleId[] {
  switch (playerCount) {
    case 4:
      return ['lord', 'loyalist', 'rebel', 'traitor'];
    case 5:
      return ['lord', 'loyalist', 'rebel', 'rebel', 'traitor'];
    case 6:
      return ['lord', 'loyalist', 'rebel', 'rebel', 'rebel', 'traitor'];
    case 7:
      return ['lord', 'loyalist', 'loyalist', 'rebel', 'rebel', 'rebel', 'traitor'];
    case 8:
      return ['lord', 'loyalist', 'loyalist', 'rebel', 'rebel', 'rebel', 'rebel', 'traitor'];
    default:
      throw new Error('不支持的人数：' + playerCount);
  }
}

const BOT_NAMES = ['一号玩家', '二号玩家', '三号玩家', '四号玩家', '五号玩家', '六号玩家', '七号玩家'];

/* ------------------------------------------------------------------ */
/* 选将（D01）                                                         */
/* ------------------------------------------------------------------ */

export interface DraftOffer {
  seat: number;
  options: string[];
}

export interface DraftState {
  seed: string;
  playerCount: number;
  selfSeat: number;
  lordSeat: number;
  /** 已确定的选择（按座次）。 */
  picks: (string | null)[];
  /** 已选定的本体，未选中的候选立即回池。 */
  takenFamilies: string[];
  /** 剩余待选座次（按选将顺序）。 */
  queue: number[];
  /** 当前轮到谁。 */
  current: number | null;
  /** 当前候选。 */
  offer: DraftOffer | null;
  rng: ReturnType<typeof rngFromSeed>;
}

/** 抽候选：从尚未被选中的本体池中抽取至多 3 名；候选不占用池。 */
function makeOffer(draft: DraftState, seat: number): DraftOffer {
  const pool = DEMO_POOL.filter((c) => !draft.takenFamilies.includes(c.familyId));
  const picks: string[] = [];
  const localPool = pool.slice();
  const n = Math.min(3, localPool.length);
  for (let i = 0; i < n; i++) {
    const j = rngInt(draft.rng, localPool.length);
    picks.push(localPool[j].characterId);
    const idx = pool.findIndex((c) => c.characterId === localPool[j].characterId);
    if (idx >= 0) pool.splice(idx, 1);
    localPool.splice(j, 1);
  }
  return { seat, options: picks };
}

export function initDraft(seed: string, playerCount: number, selfSeat: number): DraftState {
  if (playerCount < 4 || playerCount > 8) throw new Error('人数必须在 4—8 之间');
  const rng = rngFromSeed(seed + '::draft');
  const lordSeat = rngInt(rng, playerCount);
  const queue: number[] = [];
  for (let i = 0; i < playerCount; i++) queue.push((lordSeat + i) % playerCount);
  const draft: DraftState = {
    seed,
    playerCount,
    selfSeat,
    lordSeat,
    picks: new Array(playerCount).fill(null),
    takenFamilies: [],
    queue,
    current: null,
    offer: null,
    rng,
  };
  advanceDraft(draft);
  return draft;
}

function botPick(draft: DraftState, options: string[]): string {
  // 固定评分：优先体力上限高、技能多；并列时用确定性随机决定。
  let best: CharacterDef | null = null;
  let bestScore = -1;
  for (const id of options) {
    const c = characterOf(id);
    const score = c.maxHp * 2 + c.skills.length;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  const tied = options.filter((id) => {
    const c = characterOf(id);
    return c.maxHp * 2 + c.skills.length === bestScore;
  });
  return tied[rngInt(draft.rng, tied.length)];
}

/** 推进选将，遇到真人座位时停下并给出候选。 */
export function advanceDraft(draft: DraftState): void {
  while (draft.queue.length > 0) {
    const seat = draft.queue[0];
    const offer = makeOffer(draft, seat);
    if (seat === draft.selfSeat) {
      draft.current = seat;
      draft.offer = offer;
      return;
    }
    const pick = botPick(draft, offer.options);
    applyPick(draft, pick);
  }
  draft.current = null;
  draft.offer = null;
}

export function applyPick(draft: DraftState, characterId: string): void {
  const seat = draft.queue.shift();
  if (seat === undefined) throw new Error('选将队列已空');
  const c = characterOf(characterId);
  draft.picks[seat] = characterId;
  draft.takenFamilies.push(c.familyId);
  draft.offer = null;
  draft.current = null;
}

/** 真人选定后继续推进到结束。 */
export function completeDraft(draft: DraftState, humanCharacterId: string): string[] {
  applyPick(draft, humanCharacterId);
  advanceDraft(draft);
  if (draft.queue.length > 0) throw new Error('选将未完成');
  return draft.picks.map((p) => {
    if (!p) throw new Error('存在未选将的座位');
    return p;
  });
}

/* ------------------------------------------------------------------ */
/* 建局                                                                */
/* ------------------------------------------------------------------ */

export interface CreateGameOptions {
  seed: string;
  playerCount: number;
  selfSeat: number;
  /** 每座位的角色 characterId。 */
  characters: string[];
  /** 强制指定身份（测试用）；不提供时随机。 */
  roles?: RoleId[];
  /** 固定初始手牌（测试用）。 */
  riggedHands?: Record<number, string[]>;
  displayNames?: Record<number, string>;
  /** 是否在建局后立即推进到第一个稳定等待点。默认为 true。 */
  autoBegin?: boolean;
}

export interface CreatedGame {
  state: GameState;
  lordSeat: number;
}

export function createGame(opts: CreateGameOptions): CreatedGame {
  const { seed, playerCount, selfSeat } = opts;
  if (opts.characters.length !== playerCount) throw new Error('角色数量与人数不符');

  const rng = rngFromSeed(seed);
  const roles = opts.roles ?? (() => {
    const base = roleConfig(playerCount);
    const arr = base.slice();
    rngShuffle(rng, arr);
    return arr;
  })();
  // 主公固定在一个随机座位，且其身份为 lord
  let lordSeat = 0;
  if (opts.roles) {
    lordSeat = roles.indexOf('lord');
  } else {
    lordSeat = rngInt(rng, playerCount);
    roles[lordSeat] = 'lord';
    // 重新分配其余身份
    const rest = roleConfig(playerCount).filter((r) => r !== 'lord');
    rngShuffle(rng, rest);
    let k = 0;
    for (let s = 0; s < playerCount; s++) {
      if (s !== lordSeat) roles[s] = rest[k++];
    }
  }
  if (lordSeat < 0) throw new Error('身份表缺少主公');

  const state: GameState = {
    gameId: 'g-' + seed.slice(0, 12),
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    contentVersion: CONTENT_VERSION,
    seed,
    rng,
    playerCount,
    players: [],
    seatOrder: [],
    cards: {},
    deck: [],
    discard: [],
    processing: [],
    enabledCardNames: [],
    turn: {
      round: 1,
      currentSeat: lordSeat,
      phase: null,
      turnSerial: 0,
      anchorSeat: lordSeat,
      skipped: [],
      fired: {},
    },
    stack: [],
    pending: null,
    log: [],
    events: [],
    activeUses: {},
    logCursor: 0,
    useSeq: 0,
    eventSeq: 0,
    frameSeq: 0,
    promptSeq: 0,
    status: 'running',
    lastCommandError: null,
    winner: null,
    lastHashes: [],
    version: 0,
    setup: {
      seed,
      playerCount,
      selfSeat,
      characters: opts.characters.slice(),
      ...(opts.roles ? { rolesInput: opts.roles.slice() } : {}),
      roles: roles.slice(),
      ...(opts.riggedHands ? { riggedHands: JSON.parse(JSON.stringify(opts.riggedHands)) } : {}),
      ...(opts.displayNames ? { displayNames: { ...opts.displayNames } } : {}),
    },
    replay: [],
  };

  // 实体牌目录
  for (const c of BASE_DECK) {
    state.cards[c.id] = { ...c, suit: c.suit as Suit };
  }

  // 本局已启用的牌名集合（D18）
  const enabled = new Set<string>(BASE_DECK.map((c) => c.name));
  const extra: string[] = [];
  for (const cid of opts.characters) {
    const ch = characterOf(cid);
    if (ch.skills.some((s) => s.skillId === 'b02.shenyu')) extra.push('君临天下');
    if (ch.skills.some((s) => s.skillId === 'b10.yauer')) extra.push('助听器');
    if (ch.skills.some((s) => s.skillId === 'm04.juexing')) extra.push('戟把');
  }
  for (const e of extra) enabled.add(e);
  state.enabledCardNames = [...enabled].sort();

  // 玩家
  const lordBonus = playerCount >= 5 ? 1 : 0;
  for (let s = 0; s < playerCount; s++) {
    const cid = opts.characters[s];
    const ch = characterOf(cid);
    const isLord = s === lordSeat;
    const p: PlayerState = {
      seat: s,
      id: 'p' + s,
      displayName: opts.displayNames?.[s] ?? (s === selfSeat ? '你' : BOT_NAMES[s % BOT_NAMES.length]),
      characterId: cid,
      familyId: ch.familyId,
      role: roles[s],
      roleRevealed: isLord,
      alive: true,
      hp: ch.hp + (isLord ? lordBonus : 0),
      maxHp: ch.maxHp + (isLord ? lordBonus : 0),
      faceDown: false,
      chained: false,
      armorZoneAbolished: false,
      hand: [],
      equip: { weapon: null, armor: null, offenseMount: null, defenseMount: null },
      judge: [],
      cai: [],
      turnFlags: {},
      roundFlags: {},
      skillFlags: {},
      modifiers: [],
      control: s === selfSeat ? 'human' : 'bot',
    };
    state.players.push(p);
    state.seatOrder.push(p.id);
  }

  // 洗牌
  const order = BASE_DECK.map((c) => c.id);
  rngShuffle(rng, order);
  state.deck = order;

  logPublic(state, `对局开始：${playerCount} 人身份局，主公为${state.players[lordSeat].displayName}。`, 'system');

  // 游戏开始时的区域变更（紫殇）：先于发牌
  runGameStartRegionEffects(state);

  // 发初始手牌
  for (const p of state.players) {
    if (opts.riggedHands && opts.riggedHands[p.seat]) {
      const ids = opts.riggedHands[p.seat];
      for (const id of ids) {
        const idx = state.deck.indexOf(id);
        if (idx >= 0) state.deck.splice(idx, 1);
        p.hand.push(id);
      }
    } else {
      drawToHand(state, p.seat, 4, '初始手牌');
    }
  }

  // 其余“游戏开始时”技能，自主公起按座次
  runGameStartSkills(state, lordSeat);

  state.turn.currentSeat = lordSeat;
  state.turn.anchorSeat = lordSeat;
  if (opts.autoBegin !== false) beginGame(state);
  return { state, lordSeat };
}

/**
 * 把回合结算帧压入结算栈并推进到第一个稳定等待点。
 * 必须在 setup 完成后调用；这样运行器拿到的状态一定带有待选项或已结束。
 */
export function beginGame(state: GameState): void {
  const frame = assignFrameId(state, makeFrame('turn', 'start', {}, { note: '根回合帧' }));
  state.stack.push(frame);
  pump(state);
}

function runGameStartRegionEffects(state: GameState): void {
  for (const p of state.players) {
    if (p.characterId === 'b12' || p.characterId === 'm02') {
      p.armorZoneAbolished = true;
      logPublic(state, `${p.displayName} 发动【紫殇】，废除防具区。`, 'system');
    }
  }
}

function runGameStartSkills(state: GameState, lordSeat: number): void {
  for (let i = 0; i < state.playerCount; i++) {
    const seat = (lordSeat + i) % state.playerCount;
    const p = state.players[seat];
    // 首发 8 将中没有其他开局技能；后续批次的观星 / 万贯 / 神谕 / 本格在此接入。
    void p;
  }
}
