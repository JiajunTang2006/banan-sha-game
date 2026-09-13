import type { ActionDescriptor, Answer, Command, Pending, PlayerView, SelectableCard } from '@engine/types';

/**
 * 电脑玩家。
 *
 * 只读取该座位的 PlayerView（自己合法看到的身份、手牌与公共历史），
 * 不读取服务器 GameState 的全局身份表，也不读取其他玩家的暗牌。
 * 首版使用固定规则评分，不做搜索、不接大模型。
 */

const CARD_VALUE: Record<string, number> = {
  桃: 100,
  酒: 40,
  闪: 80,
  普通杀: 70,
  火杀: 74,
  雷杀: 74,
  无懈可击: 68,
  无中生有: 62,
  决斗: 46,
  顺手牵羊: 52,
  过河拆桥: 50,
  南蛮入侵: 44,
  万箭齐发: 44,
  铁索连环: 26,
  乐不思蜀: 42,
  寒冰剑: 30,
  方天画戟: 30,
  诸葛连弩: 30,
  长刀: 30,
  八卦阵: 34,
  藤甲: 28,
  进攻坐骑: 26,
  防御坐骑: 26,
};

function valueOf(c: SelectableCard): number {
  if (c.name === null) return 20; // 未知的他人手牌
  return CARD_VALUE[c.name] ?? 20;
}

/** 由提示 ID 推导的确定性伪随机，不与牌堆随机共用。 */
function det(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ */
/* 目标评估                                                            */
/* ------------------------------------------------------------------ */

function isHostileToLord(view: PlayerView): boolean {
  const me = view.players[view.selfSeat];
  const role = view.knownRoles[view.selfSeat];
  if (role === 'rebel' || role === 'traitor') return true;
  if (role === 'lord' || role === 'loyalist') return false;
  void me;
  return false;
}

/** 给一个候选目标打分（越高越优先攻击）。 */
function targetScore(view: PlayerView, seat: number): number {
  const p = view.players[seat];
  if (!p.alive) return -1;
  const me = view.selfSeat;
  const lordSeat = view.players.find((x) => view.knownRoles[x.seat] === 'lord')?.seat;
  let score = 0;
  if (isHostileToLord(view)) {
    if (seat === lordSeat) score += 60;
    else score += 10;
  } else {
    if (seat === lordSeat) score += 5;
    else score += 30;
  }
  // 体力越低越优先
  score += Math.max(0, 4 - p.hp) * 4;
  // 手牌多者威胁更大
  score += Math.min(4, p.handCount);
  void me;
  return score;
}

function orderedTargets(view: PlayerView, legal: number[]): number[] {
  return legal.slice().sort((a, b) => targetScore(view, b) - targetScore(view, a));
}

/* ------------------------------------------------------------------ */
/* 出牌阶段                                                            */
/* ------------------------------------------------------------------ */

function scoreAction(view: PlayerView, a: ActionDescriptor): number {
  if (a.note) return -1;
  const me = view.players[view.selfSeat];
  switch (a.kind) {
    case 'endPhase':
      return 0;
    case 'activateSkill': {
      if (a.skillId === 'b13.chouka') return 34;
      if (a.skillId === 'b08.qiti') return 26;
      if (a.skillId === 'b11.huoba') return 18;
      if (a.skillId === 'b01.lambda') return 12;
      return 5;
    }
    case 'recast':
      return 6;
    default:
      break;
  }
  const name = a.asName ?? '';
  if (name === '桃') return me.hp < me.maxHp ? (me.hp <= 1 ? 95 : 46) : -1;
  if (name === '无中生有') return 40;
  if (name === '酒') return 14;
  if (name === '普通杀' || name === '火杀' || name === '雷杀') return 30;
  if (name === '决斗') return 18;
  if (name === '顺手牵羊') return 24;
  if (name === '过河拆桥') return 22;
  if (name === '南蛮入侵' || name === '万箭齐发') return 16;
  if (name === '乐不思蜀') return 19;
  if (name === '铁索连环') return 4;
  if (['寒冰剑', '方天画戟', '诸葛连弩', '长刀', '八卦阵', '藤甲', '进攻坐骑', '防御坐骑'].includes(name)) {
    return equipScore(view, name);
  }
  if (name === '君临天下') return 20;
  return 5;
}

function equipScore(view: PlayerView, name: string): number {
  const me = view.players[view.selfSeat];
  const equip = me.equip;
  if (name === '寒冰剑' || name === '方天画戟' || name === '诸葛连弩' || name === '长刀') {
    if (!equip.weapon) return 30;
    const cur = equip.weapon.name;
    const rangeCur = cur === '寒冰剑' ? 2 : cur === '方天画戟' ? 4 : cur === '长刀' ? 3 : 1;
    const rangeNew = name === '寒冰剑' ? 2 : name === '方天画戟' ? 4 : name === '长刀' ? 3 : 1;
    return rangeNew > rangeCur ? 26 : -1;
  }
  if (name === '八卦阵' || name === '藤甲') {
    if (me.armorZoneAbolished) return -1;
    return equip.armor ? -1 : 30;
  }
  if (name === '进攻坐骑' || name === '防御坐骑') {
    const slot = name === '进攻坐骑' ? equip.offenseMount : equip.defenseMount;
    return slot ? -1 : 24;
  }
  return -1;
}

export function choosePlayCommand(view: PlayerView): Command {
  const actions = view.actions.filter((a) => a.kind !== 'endPhase');
  let best: ActionDescriptor | null = null;
  let bestScore = -1;
  for (const a of actions) {
    const s = scoreAction(view, a);
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  const THRESHOLD = 12;
  if (!best || bestScore < THRESHOLD) {
    return { type: 'END_PLAY_PHASE' };
  }
  if (best.kind === 'activateSkill') {
    const choice: Record<string, unknown> = {};
    if (best.skillId === 'b08.qiti' && best.cardIds.length === 2) choice.cardIds = best.cardIds;
    return { type: 'ACTIVATE_SKILL', skillId: best.skillId!, choice };
  }
  if (best.kind === 'recast') {
    return { type: 'RECAST', cardIds: best.cardIds };
  }
  const targets = pickTargets(view, best);
  return { type: 'PLAY_CARD', cardIds: best.cardIds, as: best.asName, targets };
}

function pickTargets(view: PlayerView, a: ActionDescriptor): number[] {
  const spec = a.targetSpec;
  if (!spec) return [];
  const ordered = orderedTargets(view, spec.legal);
  const n = Math.max(spec.min, Math.min(spec.max, spec.min));
  return ordered.slice(0, n);
}

/* ------------------------------------------------------------------ */
/* 提示回答                                                            */
/* ------------------------------------------------------------------ */

export function chooseAnswer(view: PlayerView, pending: Pending): Answer {
  switch (pending.type) {
    case 'respond':
    case 'dying':
      return answerResponse(view, pending);
    case 'nullify':
      return answerNullify(view, pending);
    case 'pickCards':
      return answerPickCards(view, pending);
    case 'pickTargets':
      return answerPickTargets(view, pending);
    case 'discard':
      return answerDiscard(view, pending);
    case 'optionalSkill':
      return answerOptional(view, pending);
    default:
      return { pass: true };
  }
}

function answerResponse(view: PlayerView, pending: Pending): Answer {
  const cards = pending.options.selectableCards;
  if (cards.length === 0) return { pass: true };
  if (pending.type === 'dying') {
    const dyingName = pending.title;
    const me = view.players[view.selfSeat];
    const isSelf = dyingName.includes(me.displayName);
    const role = view.knownRoles[view.selfSeat];
    const lordSeat = view.players.find((x) => view.knownRoles[x.seat] === 'lord')?.seat;
    const dyingIsLord = dyingName.includes(view.players.find((x) => x.seat === lordSeat)?.displayName ?? '\u0000');
    if (isSelf) return { cardIds: [cards[0].cardId] };
    if (role === 'lord' || role === 'loyalist') {
      if (dyingIsLord) return { cardIds: [cards[0].cardId] };
      return { pass: true };
    }
    if (dyingIsLord) return { cardIds: [cards[0].cardId] };
    return det(pending.promptId) < 0.5 ? { cardIds: [cards[0].cardId] } : { pass: true };
  }
  // 闪 / 杀响应：有就出
  return { cardIds: [cards[0].cardId] };
}

function answerNullify(view: PlayerView, pending: Pending): Answer {
  const cards = pending.options.selectableCards;
  if (cards.length === 0) return { pass: true };
  // 简单判断：如果被无懈的目标是主公而自己属于反贼阵营，则抵消；反之亦然。
  const hostile = isHostileToLord(view);
  return hostile ? { cardIds: [cards[0].cardId] } : { pass: true };
}

function answerPickCards(view: PlayerView, pending: Pending): Answer {
  const cards = pending.options.selectableCards;
  const min = pending.options.minCards;
  const max = pending.options.maxCards;
  if (cards.length === 0) return { pass: true };
  const title = pending.title;
  if (title.includes('λ法') || title.includes('火把') || title.includes('寒冰剑') || title.includes('无懈')) {
    // 成本类选择：付出最低价值的牌
    const sorted = cards.slice().sort((a, b) => valueOf(a) - valueOf(b));
    return { cardIds: sorted.slice(0, Math.max(min, 1)).map((c) => c.cardId) };
  }
  if (title.includes('翻开')) {
    const pick = cards[Math.floor(det(pending.promptId) * cards.length) % cards.length];
    return { cardIds: [pick.cardId] };
  }
  if (title.includes('君临天下')) {
    const sorted = cards.slice().sort((a, b) => valueOf(a) - valueOf(b));
    return { cardIds: sorted.slice(0, Math.max(min, 1)).map((c) => c.cardId) };
  }
  if (title.includes('顺手牵羊')) {
    // 优先拿装备，其次暗牌
    const equip = cards.filter((c) => c.from === 'equip');
    const pick = (equip.length > 0 ? equip : cards)[0];
    return { cardIds: [pick.cardId] };
  }
  if (title.includes('过河拆桥')) {
    const equip = cards.filter((c) => c.from === 'equip');
    const pick = (equip.length > 0 ? equip : cards)[0];
    return { cardIds: [pick.cardId] };
  }
  const sorted = cards.slice().sort((a, b) => valueOf(a) - valueOf(b));
  return { cardIds: sorted.slice(0, Math.max(min, 1)).map((c) => c.cardId) };
}

function answerPickTargets(view: PlayerView, pending: Pending): Answer {
  const legal = pending.options.targetSeats ?? [];
  const n = pending.options.minTargets;
  if (legal.length === 0) return { pass: true };
  const title = pending.title;
  if (title.includes('火把')) {
    // 前者对后者使用决斗：让自己之外的两人互相消耗，优先让敌对目标打对方
    const ordered = orderedTargets(view, legal);
    return { targets: ordered.slice(0, Math.min(2, ordered.length)) };
  }
  const ordered = orderedTargets(view, legal);
  return { targets: ordered.slice(0, n) };
}

function answerDiscard(view: PlayerView, pending: Pending): Answer {
  const cards = pending.options.selectableCards;
  const need = pending.options.minCards;
  const sorted = cards.slice().sort((a, b) => valueOf(a) - valueOf(b));
  return { cardIds: sorted.slice(0, need).map((c) => c.cardId) };
}

function answerOptional(view: PlayerView, pending: Pending): Answer {
  if (pending.title.includes('叶障')) return { pass: false };
  if (pending.title.includes('八卦阵')) return { pass: false };
  if (pending.title.includes('寒冰剑')) {
    // 对敌人拆牌
    return { pass: det(pending.promptId) < 0.7 ? false : true };
  }
  return { pass: false };
}

/* ------------------------------------------------------------------ */

export function botCommandId(prefix: string): string {
  botCounter += 1;
  return `bot-${prefix}-${botCounter}`;
}

let botCounter = 0;
