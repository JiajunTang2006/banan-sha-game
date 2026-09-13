import { describe, expect, it } from 'vitest';
import {
  CHAR,
  answerAll,
  answerCurrent,
  answerPass,
  build,
  findCards,
  forceEquip,
  giveFromDeck,
  send,
  sendAs,
  setHand,
  setHp,
  skillNote,
  stackDeck,
  toPlay,
  promptDetail,
  optionCount,
} from './harness';
import { checkInvariants } from '@engine/engine';
import { attackRange, distance, effectiveWeapon, shaLimit } from '@engine/query';
import { afterGain } from '@engine/drivers/skills';
import { card, player } from '@engine/util';
import type { GameState } from '@engine/types';

/**
 * 首发 8 将技能测试。
 *
 * 每个技能至少覆盖三类场景：
 *   正常发动 / 生效 —— 断言可观察到的状态变化（体力、手牌、装备、日志）。
 *   禁止发动      —— 条件不满足时必须给出原因且命令被拒，不能静默无效。
 *   关键边界      —— 规则里最容易写错的临界点（不足两张、点数恰好、花色不符、死亡归属）。
 *
 * 约定：所有需要伤害落地的用例先清空相关座位的随机手牌，
 * 电脑不会在 sendAs 路径上自动应答，因此流程完全可控。
 */

const roles5 = ['lord', 'rebel', 'rebel', 'rebel', 'rebel'] as const;

/* ================================================================== */
/* b01 巫力凡【λ法】                                                   */
/* ================================================================== */

describe('b01 巫力凡【λ法】', () => {
  /** 走到「翻牌」提示，返回 λ 记录与槽位表。 */
  function setup(seed: string) {
    const st = build({ seed, self: CHAR.wulifan, hands: { 0: [], 1: [], 2: [], 3: [], 4: [] } });
    toPlay(st);
    setHand(st, 0, findCards(st, () => true, 3));
    expect(sendAs(st, 0, { type: 'ACTIVATE_SKILL', skillId: 'b01.lambda' }).ok).toBe(true);
    const flags = st.players[0].skillFlags.lambdaCards as string[];
    expect(flags.length).toBe(1);
    // 混入两张非 λ 手牌
    const nonLambda = st.players[0].hand.filter((id) => !flags.includes(id)).slice(0, 2);
    expect(answerCurrent(st, { cardIds: nonLambda, targets: [], pass: false }).ok).toBe(true);
    // 指定座位 1 翻开
    expect(answerCurrent(st, { cardIds: [], targets: [1], pass: false }).ok).toBe(true);
    expect(st.pending?.actorSeat).toBe(1);
    const frame = st.stack[st.stack.length - 1];
    const slots = frame.data.slots as { cardId: string; slot: string }[];
    return { st, flags, slots };
  }

  it('正常发动：摸一张牌记录为“λ”，混入两张手牌后由指定角色翻开', () => {
    const st = build({ seed: 'sk-lambda-1', self: CHAR.wulifan, hands: { 0: [], 1: [], 2: [], 3: [], 4: [] } });
    const g = toPlay(st);
    setHand(st, 0, findCards(st, () => true, 3));
    const before = player(st, 0).hand.length;
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b01.lambda' }).ok).toBe(true);
    const flags = st.players[0].skillFlags.lambdaCards as string[];
    expect(flags.length).toBe(1);
    expect(player(st, 0).hand.length, '摸一张并展示后记录为 λ').toBe(before + 1);
    expect(player(st, 0).hand).toContain(flags[0]);
    // 选择混入牌
    expect(st.pending?.title).toContain('λ法');
    const nonLambda = st.players[0].hand.filter((id) => !flags.includes(id)).slice(0, 2);
    expect(answerCurrent(st, { cardIds: nonLambda, targets: [], pass: false }).ok).toBe(true);
    // 选择翻开者
    expect(st.pending?.title).toContain('λ法');
    expect(answerCurrent(st, { cardIds: [], targets: [2], pass: false }).ok).toBe(true);
    expect(st.pending?.actorSeat, '由被指定的角色翻开').toBe(2);
    // 翻一张非 λ 牌：不失去体力
    const frame = st.stack[st.stack.length - 1];
    const slots = frame.data.slots as { cardId: string; slot: string }[];
    const safe = slots.find((s) => !flags.includes(s.cardId))!;
    const hp0 = player(st, 0).hp;
    expect(answerCurrent(st, { cardIds: [safe.slot], targets: [], pass: false }).ok).toBe(true);
    expect(player(st, 0).hp, '未翻出 λ 不失去体力').toBe(hp0);
    expect(st.players[0].skillFlags.lambdaLocked, '未锁定').toBeUndefined();
    expect(st.log.some((l) => l.text.includes('未翻出'))).toBe(true);
    expect(checkInvariants(st).length).toBe(0);
  });

  it('边界：翻开“λ”牌则失去 1 点体力并锁定本回合', () => {
    const { st, flags, slots } = setup('sk-lambda-2');
    const lambda = slots.find((s) => flags.includes(s.cardId))!;
    const hp0 = player(st, 0).hp;
    expect(answerCurrent(st, { cardIds: [lambda.slot], targets: [], pass: false }).ok).toBe(true);
    expect(player(st, 0).hp, '翻出 λ 失去 1 点体力').toBe(hp0 - 1);
    expect(st.players[0].skillFlags.lambdaLocked).toBe(true);
    expect(st.log.some((l) => l.text.includes('“λ”牌'))).toBe(true);
    // 锁定后本回合不能再发动
    expect(skillNote(st, 0, 'b01.lambda')).toContain('不能再发动');
    expect(sendAs(st, 0, { type: 'ACTIVATE_SKILL', skillId: 'b01.lambda' }).ok).toBe(false);
  });

  it('禁止发动：未记录为“λ”的手牌不足两张', () => {
    const st = build({ seed: 'sk-lambda-3', self: CHAR.wulifan, hands: { 0: [] } });
    const g = toPlay(st);
    setHand(st, 0, findCards(st, () => true, 1));
    expect(skillNote(st, 0, 'b01.lambda')).toContain('两张');
    const r = send(g, { type: 'ACTIVATE_SKILL', skillId: 'b01.lambda' });
    expect(r.ok).toBe(false);
    expect(player(st, 0).hand.length, '被拒绝的发动不产生任何副作用').toBe(1);
    expect(st.players[0].skillFlags.lambdaCards).toBeUndefined();
  });
});

/* ================================================================== */
/* b04 顾元昊【干拔】                                                  */
/* ================================================================== */

describe('b04 顾元昊【干拔】', () => {
  it('正常生效：攻击范围 +3，且【杀】无次数限制', () => {
    const st = build({ seed: 'sk-ganba-1', self: CHAR.guyuanhao, hands: { 0: [], 1: [], 2: [], 3: [], 4: [] } });
    const g = toPlay(st);
    expect(attackRange(st, 0), '无武器基础 1 + 3').toBe(4);
    expect(shaLimit(st, 0)).toBe(Infinity);
    const shas = findCards(st, (c) => c.name === '普通杀', 2);
    setHand(st, 0, shas);
    const hp1 = player(st, 1).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [shas[0]], as: '普通杀', targets: [1] }).ok).toBe(true);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [shas[1]], as: '普通杀', targets: [1] }).ok, '第二张杀仍可打出').toBe(true);
    expect(player(st, 1).hp).toBe(hp1 - 2);
  });

  it('边界：攻击范围只影响自己，且不视为装备武器', () => {
    const st = build({ seed: 'sk-ganba-2', self: CHAR.guyuanhao, hands: { 0: [] } });
    toPlay(st);
    expect(effectiveWeapon(st, 0), '干拔不是装备，不提供虚拟武器').toBe(null);
    // 距离是单向的：其他角色计算与我的距离不受影响
    const base = build({ seed: 'sk-ganba-2', self: CHAR.chenyuelai, hands: { 0: [] } });
    expect(distance(st, 1, 0)).toBe(distance(base, 1, 0));
    expect(distance(st, 0, 1)).toBe(distance(base, 0, 1));
  });

  it('禁止主动发动：锁定技', () => {
    const st = build({ seed: 'sk-ganba-3', self: CHAR.guyuanhao, hands: { 0: [] } });
    toPlay(st);
    expect(skillNote(st, 0, 'b04.ganba')).toContain('锁定技');
  });
});

/* ================================================================== */
/* b08 王清阳【冰神】【气体】【小方】                                   */
/* ================================================================== */

describe('b08 王清阳【冰神】', () => {
  it('正常生效：武器区为空时视为装备【寒冰剑】', () => {
    const st = build({ seed: 'sk-bingshen-1', self: CHAR.wangqingyang, hands: { 0: [] } });
    toPlay(st);
    const w = effectiveWeapon(st, 0);
    expect(w?.virtual).toBe(true);
    expect(w?.def.name).toBe('寒冰剑');
    expect(attackRange(st, 0), '寒冰剑范围 2').toBe(2);
  });

  it('边界：装上真武器后虚拟【寒冰剑】让位', () => {
    const st = build({ seed: 'sk-bingshen-2', self: CHAR.wangqingyang, hands: { 0: [] } });
    toPlay(st);
    forceEquip(st, 0, '方天画戟');
    const w = effectiveWeapon(st, 0);
    expect(w?.virtual).toBe(false);
    expect(w?.def.name).toBe('方天画戟');
    expect(attackRange(st, 0)).toBe(4);
  });

  it('边界：虚拟【寒冰剑】同样触发伤害替代', () => {
    const st = build({ seed: 'sk-bingshen-3', self: CHAR.wangqingyang, hands: { 0: [], 1: [] } });
    toPlay(st);
    // 目标手里不能有【闪】，否则伤害不会落地，替代效果也无从触发
    setHand(st, 1, findCards(st, (c) => c.name !== '闪' && c.name !== '桃', 3));
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    const hp1 = player(st, 1).hp;
    expect(sendAs(st, 0, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    // 先由目标选择是否出【闪】，未出闪后才轮到伤害替代
    expect(st.pending?.title).toContain('需要打出【闪】');
    expect(answerPass(st).ok).toBe(true);
    expect(st.pending?.title, '虚拟武器也要给出选项').toContain('寒冰剑');
    expect(answerCurrent(st, { cardIds: [], targets: [], pass: false }).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1);
    // 依次弃置两张
    for (let i = 0; i < 2; i++) {
      expect(optionCount(st)).toBeGreaterThan(0);
      const pick = st.pending!.options.selectableCards[0].cardId;
      expect(answerCurrent(st, { cardIds: [pick], targets: [], pass: false }).ok).toBe(true);
    }
    expect(player(st, 1).hand.length).toBe(1);
    expect(checkInvariants(st).length).toBe(0);
  });

  it('禁止主动发动：锁定技', () => {
    const st = build({ seed: 'sk-bingshen-4', self: CHAR.wangqingyang, hands: { 0: [] } });
    toPlay(st);
    expect(skillNote(st, 0, 'b08.bingshen')).toContain('锁定技');
  });
});

describe('b08 王清阳【气体】【小方】', () => {
  it('正常发动：两张同花色手牌当【万箭齐发】使用', () => {
    const st = build({ seed: 'sk-qiti-1', self: CHAR.wangqingyang, hands: { 0: [], 1: [], 2: [], 3: [], 4: [] } });
    const g = toPlay(st);
    const pair = findCards(st, (c) => c.suit === '♠', 2);
    setHand(st, 0, pair);
    expect(skillNote(st, 0, 'b08.qiti')).toBeNull();
    const hps = st.players.map((p) => p.hp);
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b08.qiti', choice: { cardIds: pair } }).ok).toBe(true);
    for (let s = 1; s < 5; s++) expect(player(st, s).hp, `座位 ${s} 无手牌，无法出闪`).toBe(hps[s] - 1);
    expect(st.log.some((l) => l.text.includes('气体') && l.text.includes('万箭齐发'))).toBe(true);
    expect(checkInvariants(st).length).toBe(0);
  });

  it('小方：一张♦手牌可视为任意花色，使花色不匹配也能发动', () => {
    const st = build({ seed: 'sk-qiti-2', self: CHAR.wangqingyang, hands: { 0: [], 1: [], 2: [], 3: [], 4: [] } });
    const g = toPlay(st);
    const pair = [...findCards(st, (c) => c.suit === '♠', 1), ...findCards(st, (c) => c.suit === '♦', 1)];
    setHand(st, 0, pair);
    expect(skillNote(st, 0, 'b08.qiti'), '小方调整花色匹配').toBeNull();
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b08.qiti', choice: { cardIds: pair } }).ok).toBe(true);
    expect(st.log.some((l) => l.text.includes('小方'))).toBe(true);
  });

  it('禁止发动：花色不同且没有♦可调整', () => {
    const st = build({ seed: 'sk-qiti-3', self: CHAR.wangqingyang, hands: { 0: [] } });
    const g = toPlay(st);
    const pair = [...findCards(st, (c) => c.suit === '♠', 1), ...findCards(st, (c) => c.suit === '♥', 1)];
    setHand(st, 0, pair);
    expect(skillNote(st, 0, 'b08.qiti')).toContain('花色相同');
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b08.qiti', choice: { cardIds: pair } }).ok).toBe(false);
    expect(player(st, 0).hand.length, '发动失败不消耗牌').toBe(2);
  });

  it('禁止发动：出牌阶段限一次', () => {
    const st = build({ seed: 'sk-qiti-4', self: CHAR.wangqingyang, hands: { 0: [], 1: [], 2: [], 3: [], 4: [] } });
    const g = toPlay(st);
    setHand(st, 0, findCards(st, (c) => c.suit === '♠', 4));
    const a = player(st, 0).hand.slice(0, 2);
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b08.qiti', choice: { cardIds: a } }).ok).toBe(true);
    expect(skillNote(st, 0, 'b08.qiti')).toContain('限一次');
    const b = player(st, 0).hand.slice(0, 2);
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b08.qiti', choice: { cardIds: b } }).ok).toBe(false);
    expect(checkInvariants(st).length).toBe(0);
  });
});

/* ================================================================== */
/* b11 刘禹韬【火把】                                                  */
/* ================================================================== */

describe('b11 刘禹韬【火把】', () => {
  it('正常发动：弃一张牌，令前者视为对后者使用【决斗】，且不能被【无懈可击】响应', () => {
    const st = build({ seed: 'sk-huoba-1', self: CHAR.liuyutao, hands: { 0: [], 1: [], 2: [], 3: [], 4: [] } });
    const g = toPlay(st);
    const [cost] = findCards(st, () => true, 1);
    setHand(st, 0, [cost]);
    const hp2 = player(st, 2).hp;
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b11.huoba' }).ok).toBe(true);
    expect(st.pending?.title).toContain('火把');
    expect(answerCurrent(st, { cardIds: [cost], targets: [], pass: false }).ok).toBe(true);
    expect(st.discard, '代价牌进入弃牌堆').toContain(cost);
    expect(st.pending?.title).toContain('火把');
    expect(answerCurrent(st, { cardIds: [], targets: [1, 2], pass: false }).ok).toBe(true);
    expect(st.log.some((l) => l.text.includes('火把') && l.text.includes('决斗'))).toBe(true);
    // 【决斗】由目标座位 2 先打【杀】；双方都无手牌 → 座位 2 一回合就输了决斗，
    // 伤害来源是座位 1。整个过程中没有出现无懈可击窗口。
    expect(st.pending?.actorSeat, '由目标先应答，没有无懈可击窗口').toBe(2);
    expect(answerPass(st).ok).toBe(true);
    expect(player(st, 2).hp).toBe(hp2 - 1);
    expect(st.log.some((l) => l.text.includes('输掉【决斗】'))).toBe(true);
    expect(skillNote(st, 0, 'b11.huoba')).toContain('限一次');
    expect(checkInvariants(st).length).toBe(0);
  });

  it('边界：可以用装备区的牌作为代价', () => {
    const st = build({ seed: 'sk-huoba-2', self: CHAR.liuyutao, hands: { 0: [], 1: [], 2: [], 3: [], 4: [] } });
    const g = toPlay(st);
    const weapon = forceEquip(st, 0, '方天画戟');
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b11.huoba' }).ok).toBe(true);
    expect(answerCurrent(st, { cardIds: [weapon], targets: [], pass: false }).ok).toBe(true);
    expect(player(st, 0).equip.weapon, '装备被弃置').toBeNull();
    expect(st.discard).toContain(weapon);
    expect(answerCurrent(st, { cardIds: [], targets: [1, 2], pass: false }).ok).toBe(true);
    expect(answerAll(st)).toBeGreaterThan(0);
    expect(checkInvariants(st).length).toBe(0);
  });

  it('禁止发动：没有可弃置的牌', () => {
    const st = build({ seed: 'sk-huoba-3', self: CHAR.liuyutao, hands: { 0: [] } });
    const g = toPlay(st);
    expect(skillNote(st, 0, 'b11.huoba')).toContain('弃置');
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b11.huoba' }).ok).toBe(false);
  });

  it('边界：不能选择重复的两名角色', () => {
    const st = build({ seed: 'sk-huoba-4', self: CHAR.liuyutao, hands: { 0: [], 1: [], 2: [], 3: [], 4: [] } });
    const g = toPlay(st);
    setHand(st, 0, findCards(st, () => true, 1));
    const cost = player(st, 0).hand[0];
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b11.huoba' }).ok).toBe(true);
    expect(answerCurrent(st, { cardIds: [cost], targets: [], pass: false }).ok).toBe(true);
    const bad = answerCurrent(st, { cardIds: [], targets: [1, 1], pass: false });
    expect(bad.ok).toBe(false);
    expect(st.pending?.title, '非法目标不推进流程，重新选择').toContain('火把');
  });
});

/* ================================================================== */
/* b13 陈越来【抽卡】【将军】                                          */
/* ================================================================== */

describe('b13 陈越来【抽卡】', () => {
  it('正常发动：点数和不大于 15 则获得这三张牌', () => {
    const st = build({ seed: 'sk-chouka-1', self: CHAR.chenyuelai, hands: { 0: [] } });
    const g = toPlay(st);
    const low = findCards(st, (c) => c.rank <= 4, 3);
    stackDeck(st, low);
    const before = player(st, 0).hand.length;
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b13.chouka' }).ok).toBe(true);
    expect(player(st, 0).hand.length).toBe(before + 3);
    for (const id of low) expect(player(st, 0).hand).toContain(id);
    expect(st.log.some((l) => l.text.includes('点数和为'))).toBe(true);
    expect(checkInvariants(st).length).toBe(0);
  });

  it('关键边界：点数和大于 15 则全部置入弃牌堆，且不计为弃置', () => {
    const st = build({ seed: 'sk-chouka-2', self: CHAR.chenyuelai, hands: { 0: [] } });
    const g = toPlay(st);
    const high = findCards(st, (c) => c.rank === 13, 3);
    stackDeck(st, high);
    const before = player(st, 0).hand.length;
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b13.chouka' }).ok).toBe(true);
    expect(player(st, 0).hand.length).toBe(before);
    for (const id of high) expect(st.discard).toContain(id);
    expect(player(st, 0).turnFlags.discarded, '置入弃牌堆不算“弃置”，【将军】仍可发动').toBeUndefined();
    expect(checkInvariants(st).length).toBe(0);
  });

  it('禁止发动：出牌阶段限一次', () => {
    const st = build({ seed: 'sk-chouka-3', self: CHAR.chenyuelai, hands: { 0: [] } });
    const g = toPlay(st);
    stackDeck(st, findCards(st, (c) => c.rank <= 4, 3));
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b13.chouka' }).ok).toBe(true);
    expect(skillNote(st, 0, 'b13.chouka')).toContain('限一次');
    expect(send(g, { type: 'ACTIVATE_SKILL', skillId: 'b13.chouka' }).ok).toBe(false);
  });
});

describe('b13 陈越来【将军】', () => {
  it('正常发动：结束阶段未弃置过牌则回复 1 点体力', () => {
    const st = build({ seed: 'sk-jiangjun-1', self: CHAR.chenyuelai, hands: { 0: [] } });
    toPlay(st);
    setHp(st, 0, 1);
    expect(sendAs(st, 0, { type: 'END_PLAY_PHASE' }).ok).toBe(true);
    expect(player(st, 0).hp).toBe(2);
    expect(st.log.some((l) => l.text.includes('将军'))).toBe(true);
  });

  it('禁止发动：本回合弃置过牌则不回复', () => {
    const st = build({ seed: 'sk-jiangjun-2', self: CHAR.chenyuelai, hands: { 0: [] } });
    const g = toPlay(st);
    setHp(st, 0, 1);
    // 重铸【铁索连环】= 弃置一张牌，且不造成伤害
    const [tie] = giveFromDeck(st, 0, ['铁索连环']);
    expect(send(g, { type: 'RECAST', cardIds: [tie] }).ok).toBe(true);
    expect(player(st, 0).turnFlags.discarded).toBe(1);
    expect(sendAs(st, 0, { type: 'END_PLAY_PHASE' }).ok).toBe(true);
    expect(player(st, 0).hp).toBe(1);
    expect(st.log.some((l) => l.text.includes('将军'))).toBe(false);
  });

  it('边界：体力已满时提示但不变动', () => {
    const st = build({ seed: 'sk-jiangjun-3', self: CHAR.chenyuelai, hands: { 0: [] } });
    toPlay(st);
    const hp0 = player(st, 0).hp;
    expect(sendAs(st, 0, { type: 'END_PLAY_PHASE' }).ok).toBe(true);
    expect(player(st, 0).hp).toBe(hp0);
    expect(st.log.some((l) => l.text.includes('体力已满'))).toBe(true);
  });

  it('禁止主动发动：只在结束阶段自动检查', () => {
    const st = build({ seed: 'sk-jiangjun-4', self: CHAR.chenyuelai, hands: { 0: [] } });
    toPlay(st);
    expect(skillNote(st, 0, 'b13.jiangjun')).toContain('结束阶段');
  });
});

/* ================================================================== */
/* b12 钱亦文【紫殇】【健身】【纵欲】                                   */
/* ================================================================== */

describe('b12 钱亦文【紫殇】', () => {
  it('正常生效：开局即废除防具区，防具无法装备', () => {
    const st = build({ seed: 'sk-zishang-1', self: CHAR.qianyiwen, hands: { 0: [] } });
    const g = toPlay(st);
    expect(player(st, 0).armorZoneAbolished).toBe(true);
    const [armor] = giveFromDeck(st, 0, ['八卦阵']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [armor], as: '八卦阵', targets: [] }).ok).toBe(false);
    expect(player(st, 0).equip.armor).toBeNull();
    expect(player(st, 0).hand).toContain(armor);
  });

  it('边界：武器区与坐骑区不受影响', () => {
    const st = build({ seed: 'sk-zishang-2', self: CHAR.qianyiwen, hands: { 0: [] } });
    const g = toPlay(st);
    const [weapon] = giveFromDeck(st, 0, ['方天画戟']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [weapon], as: '方天画戟', targets: [] }).ok).toBe(true);
    expect(player(st, 0).equip.weapon).toBe(weapon);
    const [mount] = giveFromDeck(st, 0, ['进攻坐骑']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [mount], as: '进攻坐骑', targets: [] }).ok).toBe(true);
    expect(player(st, 0).equip.offenseMount).toBe(mount);
  });

  it('禁止主动发动：锁定技', () => {
    const st = build({ seed: 'sk-zishang-3', self: CHAR.qianyiwen, hands: { 0: [] } });
    toPlay(st);
    expect(skillNote(st, 0, 'b12.zishang')).toContain('锁定技');
  });
});

describe('b12 钱亦文【健身】', () => {
  it('正常发动：击杀其他角色后体力上限 +1 并回复 1 点体力', () => {
    const st = build({
      seed: 'sk-jianshen-1',
      self: CHAR.qianyiwen,
      roles: [...roles5],
      hands: { 0: [], 1: [], 2: [], 3: [], 4: [] },
    });
    const g = toPlay(st);
    setHp(st, 1, 1);
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    const max0 = player(st, 0).maxHp;
    const hp0 = player(st, 0).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    answerAll(st);
    expect(player(st, 1).alive).toBe(false);
    expect(player(st, 0).maxHp).toBe(max0 + 1);
    expect(player(st, 0).hp).toBe(Math.min(max0 + 1, hp0 + 1));
    expect(st.log.some((l) => l.text.includes('健身'))).toBe(true);
    expect(checkInvariants(st).length).toBe(0);
  });

  it('禁止发动：不是自己造成的死亡不触发', () => {
    const st = build({
      seed: 'sk-jianshen-2',
      self: CHAR.qianyiwen,
      others: [CHAR.liuyutao, CHAR.guyuanhao, CHAR.chengjunming, CHAR.wulifan],
      roles: [...roles5],
      hands: { 0: [], 1: [], 2: [], 3: [], 4: [] },
    });
    toPlay(st);
    setHp(st, 2, 1);
    expect(sendAs(st, 0, { type: 'END_PLAY_PHASE' }).ok).toBe(true);
    expect(st.pending?.actorSeat, '轮到下家刘禹韬').toBe(1);
    const [cost] = giveFromDeck(st, 1, ['普通杀']);
    const max0 = player(st, 0).maxHp;
    const hp0 = player(st, 0).hp;
    // 座位 1 用【火把】令自己对座位 2 使用【决斗】，伤害来源是座位 1
    expect(sendAs(st, 1, { type: 'ACTIVATE_SKILL', skillId: 'b11.huoba' }).ok).toBe(true);
    expect(answerCurrent(st, { cardIds: [cost], targets: [], pass: false }).ok).toBe(true);
    expect(answerCurrent(st, { cardIds: [], targets: [1, 2], pass: false }).ok).toBe(true);
    for (let i = 0; i < 10 && st.pending && st.pending.kind !== 'playPhase'; i++) answerPass(st);
    expect(player(st, 2).alive).toBe(false);
    expect(player(st, 0).maxHp, '自己不是伤害来源').toBe(max0);
    expect(player(st, 0).hp).toBe(hp0);
    expect(st.log.some((l) => l.text.includes('健身'))).toBe(false);
    expect(checkInvariants(st).length).toBe(0);
  });

  it('边界：击杀反贼的摸牌奖惩与【健身】同时结算，顺序不影响结果', () => {
    const st = build({
      seed: 'sk-jianshen-3',
      self: CHAR.qianyiwen,
      roles: [...roles5],
      hands: { 0: [], 1: [], 2: [], 3: [], 4: [] },
    });
    const g = toPlay(st);
    setHp(st, 1, 1);
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    const max0 = player(st, 0).maxHp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    answerAll(st);
    expect(player(st, 1).role).toBe('rebel');
    expect(player(st, 0).maxHp).toBe(max0 + 1);
    expect(st.log.some((l) => l.text.includes('击杀反贼'))).toBe(true);
    expect(checkInvariants(st).length).toBe(0);
  });
});

describe('b12 钱亦文【纵欲】', () => {
  it('正常发动：一张【桃】当【酒】使用', () => {
    const st = build({ seed: 'sk-zongyu-1', self: CHAR.qianyiwen, hands: { 0: [] } });
    const g = toPlay(st);
    const [tao] = giveFromDeck(st, 0, ['桃']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [tao], as: '酒', targets: [] }).ok).toBe(true);
    expect(player(st, 0).turnFlags.wine).toBe(1);
    expect(st.log.some((l) => l.text.includes('酒'))).toBe(true);
    expect(checkInvariants(st).length).toBe(0);
  });

  it('正常发动：一张【酒】当【桃】使用', () => {
    const st = build({ seed: 'sk-zongyu-2', self: CHAR.qianyiwen, hands: { 0: [] } });
    const g = toPlay(st);
    setHp(st, 0, 2);
    const [jiu] = giveFromDeck(st, 0, ['酒']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [jiu], as: '桃', targets: [] }).ok).toBe(true);
    expect(player(st, 0).hp).toBe(3);
  });

  it('边界：本回合已使用【酒】后，第二张【桃】不能再当酒', () => {
    const st = build({ seed: 'sk-zongyu-3', self: CHAR.qianyiwen, hands: { 0: [] } });
    const g = toPlay(st);
    const [t1, t2] = giveFromDeck(st, 0, ['桃', '桃']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [t1], as: '酒', targets: [] }).ok).toBe(true);
    const r = send(g, { type: 'PLAY_CARD', cardIds: [t2], as: '酒', targets: [] });
    expect(r.ok).toBe(false);
    expect(player(st, 0).hand).toContain(t2);
  });

  it('边界：体力已满时【酒】不能当【桃】使用', () => {
    const st = build({ seed: 'sk-zongyu-4', self: CHAR.qianyiwen, hands: { 0: [] } });
    const g = toPlay(st);
    const [jiu] = giveFromDeck(st, 0, ['酒']);
    expect(player(st, 0).hp).toBe(player(st, 0).maxHp);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [jiu], as: '桃', targets: [] }).ok).toBe(false);
  });
});

/* ================================================================== */
/* b16 程俊铭【狭目】【叶障】                                          */
/* ================================================================== */

describe('b16 程俊铭【狭目】', () => {
  it('正常生效：计算与其他角色的距离 +1', () => {
    const base = build({ seed: 'sk-xiamu-1', self: CHAR.chenyuelai, hands: { 0: [] } });
    const st = build({ seed: 'sk-xiamu-1', self: CHAR.chengjunming, hands: { 0: [] } });
    toPlay(base);
    toPlay(st);
    expect(distance(st, 0, 2)).toBe(distance(base, 0, 2) + 1);
  });

  it('边界：距离修正只作用于自己算出去的方向，不改变攻击范围', () => {
    const base = build({ seed: 'sk-xiamu-2', self: CHAR.chenyuelai, hands: { 0: [] } });
    const st = build({ seed: 'sk-xiamu-2', self: CHAR.chengjunming, hands: { 0: [] } });
    toPlay(base);
    toPlay(st);
    expect(attackRange(st, 0)).toBe(1);
    expect(distance(st, 2, 0), '其他角色算我的距离不变').toBe(distance(base, 2, 0));
  });

  it('禁止主动发动：锁定技', () => {
    const st = build({ seed: 'sk-xiamu-3', self: CHAR.chengjunming, hands: { 0: [] } });
    toPlay(st);
    expect(skillNote(st, 0, 'b16.xiamu')).toContain('锁定技');
  });
});

describe('b16 程俊铭【叶障】', () => {
  it('正常发动：结束阶段本回合未造成伤害可摸两张牌', () => {
    const st = build({ seed: 'sk-yezhang-1', self: CHAR.chengjunming, hands: { 0: [] } });
    const g = toPlay(st);
    const before = player(st, 0).hand.length;
    expect(sendAs(st, 0, { type: 'END_PLAY_PHASE' }).ok).toBe(true);
    expect(st.pending?.title).toContain('叶障');
    expect(answerCurrent(st, { cardIds: [], targets: [], pass: false }).ok).toBe(true);
    expect(player(st, 0).hand.length).toBe(before + 2);
    expect(checkInvariants(st).length).toBe(0);
  });

  it('边界：可以不发动', () => {
    const st = build({ seed: 'sk-yezhang-2', self: CHAR.chengjunming, hands: { 0: [] } });
    toPlay(st);
    const before = player(st, 0).hand.length;
    expect(sendAs(st, 0, { type: 'END_PLAY_PHASE' }).ok).toBe(true);
    expect(st.pending?.title).toContain('叶障');
    expect(answerPass(st).ok).toBe(true);
    expect(player(st, 0).hand.length).toBe(before);
  });

  it('禁止发动：本回合造成过伤害', () => {
    const st = build({ seed: 'sk-yezhang-3', self: CHAR.chengjunming, hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    // 狭目使自己与相邻座位的距离变为 2，需先装备武器才能出【杀】
    forceEquip(st, 0, '长刀');
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    expect(player(st, 0).turnFlags.damageDealt).toBe(1);
    expect(sendAs(st, 0, { type: 'END_PLAY_PHASE' }).ok).toBe(true);
    expect(promptDetail(st) ?? '', '不再给出【叶障】选项').not.toContain('叶障');
    expect(st.log.some((l) => l.text.includes('叶障'))).toBe(false);
  });

  it('禁止主动发动：只在结束阶段自动检查', () => {
    const st = build({ seed: 'sk-yezhang-4', self: CHAR.chengjunming, hands: { 0: [] } });
    toPlay(st);
    expect(skillNote(st, 0, 'b16.yezhang')).toContain('结束阶段');
  });
});

/* ================================================================== */
/* b17 唐嘉均【内卷】【憎恨】                                          */
/* ================================================================== */

describe('b17 唐嘉均【内卷】', () => {
  it('正常发动：【无中生有】摸两张后再额外摸一张', () => {
    const st = build({ seed: 'sk-neijuan-1', self: CHAR.tangjiajun, hands: { 0: [] } });
    const g = toPlay(st);
    const [wzsy] = giveFromDeck(st, 0, ['无中生有']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [wzsy], as: '无中生有', targets: [] }).ok).toBe(true);
    expect(player(st, 0).hand.length, '2 张 + 内卷 1 张').toBe(3);
    expect(st.log.some((l) => l.text.includes('内卷'))).toBe(true);
    expect(checkInvariants(st).length).toBe(0);
  });

  it('边界：因【内卷】自身获得的牌不再递归触发', () => {
    const st = build({ seed: 'sk-neijuan-2', self: CHAR.tangjiajun, hands: { 0: [] } });
    toPlay(st);
    const got = findCards(st, () => true, 1);
    setHand(st, 0, []);
    afterGain(st, 0, got, '内卷');
    expect(player(st, 0).hand.length, 'reason 为“内卷”时不再摸牌').toBe(0);
  });

  it('禁止发动：不在自己的回合内不触发', () => {
    const st = build({ seed: 'sk-neijuan-3', self: CHAR.tangjiajun, hands: { 0: [] } });
    toPlay(st);
    setHand(st, 0, []);
    const got = findCards(st, () => true, 1);
    // 借用别人的回合
    st.turn.currentSeat = 1;
    afterGain(st, 0, got, '摸牌阶段');
    expect(player(st, 0).hand.length).toBe(0);
  });

  it('禁止主动发动：触发技', () => {
    const st = build({ seed: 'sk-neijuan-4', self: CHAR.tangjiajun, hands: { 0: [] } });
    toPlay(st);
    expect(skillNote(st, 0, 'b17.neijuan')).toContain('锁定技');
  });
});

describe('b17 唐嘉均【憎恨】', () => {
  it('正常发动：目标手牌多于你时须连续使用两张【闪】', () => {
    const st = build({ seed: 'sk-zenghen-1', self: CHAR.tangjiajun, hands: { 0: [], 1: [] } });
    toPlay(st);
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    setHand(st, 0, [sha]);
    setHand(st, 1, findCards(st, (c) => c.name === '闪', 2));
    const hp1 = player(st, 1).hp;
    expect(sendAs(st, 0, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    expect(st.pending?.actorSeat).toBe(1);
    expect(promptDetail(st)).toContain('2 张【闪】');
    // 第一张闪不足以抵消
    const f1 = player(st, 1).hand[0];
    expect(answerCurrent(st, { cardIds: [f1], targets: [], pass: false }).ok).toBe(true);
    expect(promptDetail(st), '仍需第二张闪').toContain('1 张【闪】');
    const f2 = player(st, 1).hand[0];
    expect(answerCurrent(st, { cardIds: [f2], targets: [], pass: false }).ok).toBe(true);
    expect(player(st, 1).hp, '连续两张闪抵消').toBe(hp1);
    expect(checkInvariants(st).length).toBe(0);
  });

  it('关键边界：只有一张【闪】时仍受到伤害', () => {
    const st = build({ seed: 'sk-zenghen-2', self: CHAR.tangjiajun, hands: { 0: [], 1: [] } });
    toPlay(st);
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    setHand(st, 0, [sha]);
    const [flash] = findCards(st, (c) => c.name === '闪', 1);
    const [filler] = findCards(st, (c) => c.name === '桃', 1);
    setHand(st, 1, [flash, filler]);
    const hp1 = player(st, 1).hp;
    expect(sendAs(st, 0, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    expect(promptDetail(st)).toContain('2 张【闪】');
    expect(answerCurrent(st, { cardIds: [flash], targets: [], pass: false }).ok).toBe(true);
    expect(answerPass(st).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1 - 1);
  });

  it('边界：目标手牌数不大于你时只需一张【闪】', () => {
    const st = build({ seed: 'sk-zenghen-3', self: CHAR.tangjiajun, hands: { 0: [], 1: [] } });
    toPlay(st);
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    const filler = findCards(st, (c) => c.name !== '普通杀' && c.name !== '闪' && c.name !== '桃', 2);
    setHand(st, 0, [sha, ...filler]);
    setHand(st, 1, findCards(st, (c) => c.name === '闪', 1));
    const hp1 = player(st, 1).hp;
    expect(sendAs(st, 0, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    expect(promptDetail(st)).not.toContain('2 张【闪】');
    const f = player(st, 1).hand[0];
    expect(answerCurrent(st, { cardIds: [f], targets: [], pass: false }).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1);
  });

  it('禁止主动发动：触发技', () => {
    const st = build({ seed: 'sk-zenghen-4', self: CHAR.tangjiajun, hands: { 0: [] } });
    toPlay(st);
    expect(skillNote(st, 0, 'b17.zenghen')).toContain('锁定技');
  });
});

/* ================================================================== */
/* 技能与牌的守恒                                                      */
/* ================================================================== */

describe('技能结算后的引擎不变量', () => {
  it('【λ法】全流程结束后牌张守恒且无悬空状态', () => {
    const { st, flags, slots } = (() => {
      const st = build({ seed: 'sk-inv-1', self: CHAR.wulifan, hands: { 0: [], 1: [], 2: [], 3: [], 4: [] } });
      toPlay(st);
      setHand(st, 0, findCards(st, () => true, 3));
      expect(sendAs(st, 0, { type: 'ACTIVATE_SKILL', skillId: 'b01.lambda' }).ok).toBe(true);
      const flags = st.players[0].skillFlags.lambdaCards as string[];
      const nonLambda = st.players[0].hand.filter((id) => !flags.includes(id)).slice(0, 2);
      expect(answerCurrent(st, { cardIds: nonLambda, targets: [], pass: false }).ok).toBe(true);
      expect(answerCurrent(st, { cardIds: [], targets: [1], pass: false }).ok).toBe(true);
      const frame = st.stack[st.stack.length - 1];
      const slots = frame.data.slots as { cardId: string; slot: string }[];
      return { st, flags, slots };
    })();
    expect(flags.length).toBe(1);
    expect(slots.length).toBe(3);
    expect(answerCurrent(st, { cardIds: [slots[0].slot], targets: [], pass: false }).ok).toBe(true);
    expect(checkInvariants(st).length).toBe(0);
    expect(player(st, 0).hand.length).toBe(4);
  });
});
