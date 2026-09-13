import { characterOf } from '@content/characters';
import './drivers/index';
import { pump } from './frames';
import { registerDrivers } from './drivers/index';
import { getActions } from './play';
import { createGame } from './setup';
import type {
  ActorContext,
  CardView,
  Command,
  EquipSlot,
  GameSetupRecord,
  GameState,
  LogEntry,
  PlayerState,
  PlayerView,
  PlayerViewItem,
  RoleId,
  Transition,
} from './types';
import { EQUIP_SLOTS, allCardIds, card, findCard, player } from './util';
import { hasSkill } from './query';

registerDrivers();

/* ------------------------------------------------------------------ */
/* 命令推进                                                            */
/* ------------------------------------------------------------------ */

export function advance(state: GameState, actor: ActorContext, command: Command): Transition {
  const before = state.log.length;
  state.lastCommandError = null;
  // 提交时刻的轮次与阶段：命令被接受后状态可能已经推进，必须在分发前取样。
  const submitRound = state.turn.round;
  const submitPhase = state.turn.phase;

  const statusNow: GameState['status'] = state.status;
  if (statusNow === 'finished') return { ok: false, error: '对局已经结束。', logs: [] };
  if (statusNow === 'techPause') return { ok: false, error: '对局处于技术暂停，请导出诊断。', logs: [] };

  if (command.type === 'ANSWER_PROMPT' || command.type === 'SYSTEM_TIMEOUT') {
    const pending = state.pending;
    if (!pending) return { ok: false, error: '当前没有待处理的提示。', logs: [] };
    if (pending.promptId !== command.promptId) return { ok: false, error: '提示已过期，请以最新提示为准。', logs: [] };
    if (pending.revision !== command.promptRevision)
      return { ok: false, error: '提示版本已变化，请重新确认。', logs: [] };
    if (pending.actorSeat !== actor.seat && command.type !== 'SYSTEM_TIMEOUT')
      return { ok: false, error: '你不是该提示的应答者。', logs: [] };
    const top = state.stack[state.stack.length - 1];
    if (!top || top.id !== pending.frameId) return { ok: false, error: '提示的结算上下文已失效。', logs: [] };
    if (command.type === 'SYSTEM_TIMEOUT') {
      // 出牌阶段没有「默认答案」这一说法：超时的语义就是结束出牌阶段。
      // 否则超时只会重新生成同一个提示，对局卡死。
      if (pending.kind === 'playPhase') top.data.cmd = { type: 'END_PLAY_PHASE' };
      else top.data.answer = pending.defaultAnswer as Record<string, unknown>;
    } else {
      top.data.answer = (command as { answer: unknown }).answer;
    }
    state.pending = null;
    pump(state);
  } else {
    const pending = state.pending;
    if (!pending || pending.kind !== 'playPhase')
      return { ok: false, error: '当前不是等待出牌的状态，请等待其他玩家。', logs: [] };
    if (pending.actorSeat !== actor.seat) return { ok: false, error: '当前不是你的回合。', logs: [] };
    const top = state.stack[state.stack.length - 1];
    if (!top || top.id !== pending.frameId) return { ok: false, error: '出牌阶段的结算上下文已失效。', logs: [] };
    top.data.cmd = command;
    state.pending = null;
    pump(state);
  }

  state.version += 1;
  const logs = state.log.slice(before);
  const statusAfter: GameState['status'] = state.status;
  if (statusAfter === 'techPause') {
    return { ok: false, error: '技术暂停：' + (state.techPause?.detail ?? ''), logs };
  }
  if (state.lastCommandError) {
    return { ok: false, error: state.lastCommandError, logs };
  }
  state.replay.push({
    i: state.replay.length,
    round: submitRound,
    phase: submitPhase,
    seat: actor.seat,
    command,
    timeout: command.type === 'SYSTEM_TIMEOUT',
  });
  return { ok: true, logs };
}

/* ------------------------------------------------------------------ */
/* 玩家视图（白名单投影）                                              */
/* ------------------------------------------------------------------ */

export function projectForPlayer(state: GameState, seat: number): PlayerView {
  const me = player(state, seat);
  const knownRoles: Record<number, RoleId> = {};
  for (const p of state.players) {
    if (p.seat === seat || p.roleRevealed || !p.alive) knownRoles[p.seat] = p.role;
  }

  const players: PlayerViewItem[] = state.players.map((p) => viewItem(state, p, seat));

  let pending = null as PlayerView['pending'];
  if (state.pending && state.pending.actorSeat === seat) {
    pending = sanitizePending(state, state.pending, seat);
  }

  let actions: PlayerView['actions'] = [];
  if (state.pending && state.pending.kind === 'playPhase' && state.pending.actorSeat === seat) {
    actions = getActions(state, seat);
  }

  const log: LogEntry[] = state.log
    .filter((l) => l.visibility === 'public' || l.ownerSeat === seat)
    .map((l) => (l.visibility === 'public' ? l : { ...l, text: `（私密）${l.text}` }));

  return {
    gameId: state.gameId,
    playerCount: state.playerCount,
    status: state.status,
    selfSeat: seat,
    turn: { round: state.turn.round, currentSeat: state.turn.currentSeat, phase: state.turn.phase },
    players,
    hand: me.hand.map((id) => cardViewPublic(state, id)),
    equip: Object.fromEntries(
      EQUIP_SLOTS.filter((s) => me.equip[s]).map((s) => [s, cardViewPublic(state, me.equip[s]!)]),
    ) as Partial<Record<EquipSlot, CardView>>,
    judge: me.judge.map((id) => cardViewPublic(state, id)),
    cai: me.cai.map((id) => cardViewPublic(state, id)),
    discardTop: state.discard.slice(-8).reverse().map((id) => cardViewPublic(state, id)),
    pending,
    actions,
    log,
    winner: state.winner,
    knownRoles,
    version: state.version,
  };
}

function cardViewPublic(state: GameState, id: string): CardView {
  const c = card(state, id);
  const { cardDef } = cardDefCache;
  const def = cardDef(c.name);
  return { id, name: c.name, suit: c.suit, rank: c.rank, nature: def.nature, virtual: false };
}

import * as cardsMod from '@content/cards';
const cardDefCache = { cardDef: cardsMod.cardDef };

function viewItem(state: GameState, p: PlayerState, selfSeat: number): PlayerViewItem {
  const ch = characterOf(p.characterId);
  const equip: PlayerViewItem['equip'] = {};
  for (const s of EQUIP_SLOTS) {
    const id = p.equip[s];
    if (id) {
      const c = card(state, id);
      equip[s] = { name: c?.name ?? '未知', suit: c?.suit, rank: c?.rank };
    }
  }
  const marks: { key: string; label: string; value: string }[] = [];
  const shaUsed = Number(p.turnFlags.shaUsed ?? 0);
  if (shaUsed > 0) marks.push({ key: 'sha', label: '本回合出杀', value: String(shaUsed) });
  if (p.chained) marks.push({ key: 'chain', label: '横置', value: '●' });
  if (p.armorZoneAbolished) marks.push({ key: 'armorAbolished', label: '防具区废除', value: '●' });
  const lambdaCards = p.skillFlags.lambdaCards;
  if (Array.isArray(lambdaCards) && lambdaCards.length > 0 && p.seat === selfSeat)
    marks.push({ key: 'lambda', label: '“λ”记录', value: String(lambdaCards.length) });
  if (p.skillFlags.lambdaLocked && p.seat === selfSeat) marks.push({ key: 'lambdaLock', label: 'λ法已封锁', value: '●' });
  if (p.turnFlags.qitiUsed) marks.push({ key: 'qiti', label: '气体已用', value: '●' });
  if (p.turnFlags.huobaUsed) marks.push({ key: 'huoba', label: '火把已用', value: '●' });
  if (p.turnFlags.choukaUsed) marks.push({ key: 'chouka', label: '抽卡已用', value: '●' });
  if (p.turnFlags.wine) marks.push({ key: 'wine', label: '酒意', value: '●' });
  if (p.skillFlags.frozenWeaponVirtual) marks.push({ key: 'ice', label: '虚拟武器', value: '●' });

  return {
    seat: p.seat,
    id: p.id,
    displayName: p.displayName,
    characterId: p.characterId,
    characterName: ch.name,
    alive: p.alive,
    hp: p.hp,
    maxHp: p.maxHp,
    handCount: p.hand.length,
    faceDown: p.faceDown,
    chained: p.chained,
    armorZoneAbolished: p.armorZoneAbolished,
    equip,
    judgeCount: p.judge.length,
    judgeNames: p.judge.map((id) => card(state, id).name),
    caiCount: p.cai.length,
    role: p.seat === selfSeat || p.roleRevealed || !p.alive ? p.role : null,
    isSelf: p.seat === selfSeat,
    control: p.control,
    skills: ch.skills.map((s) => ({ skillId: s.skillId, name: s.name })),
    marks,
  };
}

function sanitizePending(state: GameState, pending: NonNullable<GameState['pending']>, seat: number): PlayerView['pending'] {
  const p = structuredClone(pending) as NonNullable<GameState['pending']>;
  // 隐藏他人手牌的 cardId（防止通过编号推断牌面）
  const mine = new Set(player(state, seat).hand);
  p.options.selectableCards = p.options.selectableCards.map((c) => {
    if (c.from === 'hand' && !mine.has(c.cardId) && c.name !== null) {
      return { ...c, cardId: `hidden#${c.faceDownSlot ?? Math.abs(hashStr(c.cardId)) % 997}`, name: null, suit: null, rank: null };
    }
    return c;
  });
  return p;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* 不变量与确定性                                                      */
/* ------------------------------------------------------------------ */

const SLOT_LIST = ['weapon', 'armor', 'offenseMount', 'defenseMount'] as const;

/** 检查全部实体牌是否恰好存在于一个区域。 */
export function checkCardConservation(state: GameState): string[] {
  const seen = new Map<string, string>();
  const errors: string[] = [];
  const add = (id: string, where: string) => {
    if (seen.has(id)) errors.push(`实体牌 ${id} 同时存在于 ${seen.get(id)} 与 ${where}`);
    else seen.set(id, where);
  };
  state.deck.forEach((id) => add(id, '牌堆'));
  state.discard.forEach((id) => add(id, '弃牌堆'));
  state.processing.forEach((id) => add(id, '处理区'));
  for (const p of state.players) {
    p.hand.forEach((id) => add(id, `${p.displayName}手牌`));
    p.judge.forEach((id) => add(id, `${p.displayName}判定区`));
    p.cai.forEach((id) => add(id, `${p.displayName}财区`));
    for (const s of SLOT_LIST) {
      const id = p.equip[s];
      if (id) add(id, `${p.displayName}装备区`);
    }
  }
  for (const id of allCardIds(state)) {
    if (!seen.has(id)) errors.push(`实体牌 ${id} 不在任何区域（丢失）`);
  }
  return errors;
}

export function checkInvariants(state: GameState): string[] {
  const errors = checkCardConservation(state);
  for (const p of state.players) {
    if (p.alive && p.hp <= 0) {
      // 处于濒死正在结算时允许；稳定点不允许
      errors.push(`${p.displayName} 存活但体力为 ${p.hp}`);
    }
    if (p.hp > p.maxHp && p.maxHp > 0) errors.push(`${p.displayName} 体力 ${p.hp} 超过上限 ${p.maxHp}`);
  }
  return errors;
}

/** 确定性状态哈希，用于回放比对。 */
export function hashState(state: GameState): string {
  const canonical = {
    players: state.players.map((p) => [
      p.seat,
      p.hp,
      p.maxHp,
      p.alive,
      p.faceDown,
      p.chained,
      [...p.hand].sort(),
      SLOT_LIST.map((s) => p.equip[s]),
      [...p.judge],
      [...p.cai],
      p.turnFlags,
      p.skillFlags,
    ]),
    deck: state.deck,
    discard: state.discard,
    processing: state.processing,
    turn: [state.turn.round, state.turn.currentSeat, state.turn.turnSerial],
    useSeq: state.useSeq,
    status: state.status,
    winner: state.winner,
  };
  const text = JSON.stringify(canonical);
  let h1 = 2166136261;
  let h2 = 5381;
  for (let i = 0; i < text.length; i++) {
    h1 ^= text.charCodeAt(i);
    h1 = Math.imul(h1, 16777619);
    h2 = (Math.imul(h2, 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).padStart(16, '0');
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(text: string): GameState {
  const s = JSON.parse(text) as GameState;
  if (!s.cards) throw new Error('存档缺少牌实例目录');
  // 兼容加入复现凭据之前写入的旧存档：补齐字段，避免 replay.push 直接抛错。
  if (!Array.isArray(s.replay)) s.replay = [];
  if (!s.setup) {
    s.setup = {
      seed: s.seed,
      playerCount: s.playerCount,
      selfSeat: 0,
      characters: s.players.map((p) => p.characterId),
      roles: s.players.map((p) => p.role),
    };
  }
  return s;
}

/** 只读的稳定状态诊断：供技术暂停与测试使用。 */
export function diagnose(state: GameState): string {
  const loc = findCard(state, state.deck[0] ?? '');
  void loc;
  return JSON.stringify(
    { stack: state.stack.map((f) => `${f.kind}:${f.step}`), pending: state.pending?.type ?? null, status: state.status },
    null,
    2,
  );
}

/* ------------------------------------------------------------------ */
/* 复现凭据                                                            */
/* ------------------------------------------------------------------ */

/** 可以完整重放一局的复现文件。 */
export interface ReplayFile {
  format: 'banan-sha/replay';
  formatVersion: 1;
  engineVersion: string;
  rulesVersion: string;
  contentVersion: string;
  gameId: string;
  seed: string;
  /** 建局输入。重放时原样传回 createGame 即可得到同一初始状态。 */
  setup: GameSetupRecord;
  commandCount: number;
  /** 按提交顺序记录的全部已接受命令（含超时自动提交）。 */
  commands: { i: number; round: number; phase: string | null; seat: number; timeout: boolean; command: Command }[];
  finalHash: string;
  finalVersion: number;
  finalStatus: GameState['status'];
  winner: GameState['winner'];
  techPause?: GameState['techPause'];
  lastErrorMessage: string | null;
  /** 便于人工定位问题的日志尾部。 */
  logTail: string[];
  /** 序列化的最终状态，用于直接恢复存档。 */
  state: string;
}

const REPLAY_FORMAT_VERSION = 1;

/**
 * 生成复现文件。
 *
 * 复现文件同时携带「建局输入 + 全部已接受命令」和「最终状态」两份信息：
 * 前者用于确定性重放并比对哈希，后者用于直接恢复存档。
 */
export function exportReplay(state: GameState, logTail = 80): ReplayFile {
  return {
    format: 'banan-sha/replay',
    formatVersion: REPLAY_FORMAT_VERSION,
    engineVersion: state.engineVersion,
    rulesVersion: state.rulesVersion,
    contentVersion: state.contentVersion,
    gameId: state.gameId,
    seed: state.seed,
    setup: state.setup,
    commandCount: state.replay.length,
    commands: state.replay.map((e) => ({
      i: e.i,
      round: e.round,
      phase: e.phase,
      seat: e.seat,
      timeout: e.timeout,
      command: e.command,
    })),
    finalHash: hashState(state),
    finalVersion: state.version,
    finalStatus: state.status,
    winner: state.winner,
    ...(state.techPause ? { techPause: state.techPause } : {}),
    lastErrorMessage: state.lastCommandError,
    logTail: state.log.slice(-logTail).map((l) => l.text),
    state: serialize(state),
  };
}

export interface ReplayResult {
  state: GameState;
  /** 重放得到的最终哈希是否与复现文件一致。 */
  match: boolean;
  finalHash: string;
  /** 第几条命令开始偏离；未偏离为 null。 */
  divergeAt: number | null;
  error: string | null;
}

/**
 * 从复现文件重建对局并逐条重放。
 *
 * 逐步比对每个稳定点的哈希，因此「第几步开始不一致」可以直接定位。
 */
export function replayFromFile(file: ReplayFile): ReplayResult {
  const setup = file.setup;
  // createGame 默认 autoBegin=true，与建局时的路径保持一致：
  // 压入根回合帧并推进到第一个稳定等待点，之后才是第一条命令。
  const { state } = createGame({
    seed: setup.seed,
    playerCount: setup.playerCount,
    selfSeat: setup.selfSeat,
    characters: setup.characters,
    ...(setup.rolesInput ? { roles: setup.rolesInput } : {}),
    ...(setup.riggedHands ? { riggedHands: setup.riggedHands } : {}),
    ...(setup.displayNames ? { displayNames: setup.displayNames } : {}),
  });

  for (const entry of file.commands) {
    const r = advance(
      state,
      { seat: entry.seat, playerId: 'p' + entry.seat, commandId: `replay-${entry.i}` },
      entry.command,
    );
    if (!r.ok) {
      return { state, match: false, finalHash: hashState(state), divergeAt: entry.i, error: r.error ?? '命令被拒绝' };
    }
  }
  const finalHash = hashState(state);
  return { state, match: finalHash === file.finalHash, finalHash, divergeAt: null, error: null };
}

export { hasSkill };
