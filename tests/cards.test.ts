import { describe, expect, it } from 'vitest';
import {
  answerCurrent,
  answerPass,
  answerPick,
  build,
  forceEquip,
  fromDeck,
  giveFromDeck,
  handNames,
  inHand,
  optionCount,
  runBots,
  send,
  sendAs,
  setHand,
  setHp,
  stripFromOthers,
  toPlay,
  CHAR,
} from './harness';
import { checkInvariants } from '@engine/engine';
import { attackRange, distance } from '@engine/query';
import { player } from '@engine/util';

/**
 * 基础牌独立效果测试。
 *
 * 每张牌名至少覆盖：正常结算、以及关键边界（防守方有牌/无牌、满血/受伤、距离内外）。
 * 座位 0 是真人且为主公，因此建局后直接进入自己的出牌阶段。
 *
 * 约定：需要伤害落地的用例必须先把目标手牌清空，否则电脑会用手里的牌响应。
 */
describe('基本牌', () => {
  it('普通杀：目标不出闪则受到 1 点普通伤害', () => {
    const st = build({ seed: 'c-sha-1', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    const hp1 = player(st, 1).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1 - 1);
    expect(st.log.some((l) => l.text.includes('1 点伤害'))).toBe(true);
  });

  it('普通杀：目标打出闪则不掉血', () => {
    const st = build({ seed: 'c-sha-2', hands: { 0: [] } });
    const g = toPlay(st);
    setHand(st, 1, giveFromDeck(st, 1, ['闪']));
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    const hp1 = player(st, 1).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1);
    expect(handNames(st, 1)).not.toContain('闪');
    expect(st.log.some((l) => l.text.includes('打出') && l.text.includes('【闪】'))).toBe(true);
  });

  it('普通杀：出牌阶段限一次', () => {
    const st = build({ seed: 'c-sha-3', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    giveFromDeck(st, 0, ['普通杀', '普通杀']);
    const first = inHand(st, 0, '普通杀');
    expect(send(g, { type: 'PLAY_CARD', cardIds: [first], as: '普通杀', targets: [1] }).ok).toBe(true);
    const second = inHand(st, 0, '普通杀');
    expect(send(g, { type: 'PLAY_CARD', cardIds: [second], as: '普通杀', targets: [1] }).ok).toBe(false);
    expect(st.lastCommandError).toContain('普通杀');
  });

  it('火杀造成火焰伤害；藤甲使火焰伤害 +1', () => {
    const st = build({ seed: 'c-huo-1', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    const [sha] = giveFromDeck(st, 0, ['火杀']);
    const hp1 = player(st, 1).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '火杀', targets: [1] }).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1 - 1);
    expect(st.log.some((l) => l.text.includes('1 点火焰伤害'))).toBe(true);

    const st2 = build({ seed: 'c-huo-2', hands: { 0: [], 1: [] } });
    const g2 = toPlay(st2);
    forceEquip(st2, 1, '藤甲');
    const [sha2] = giveFromDeck(st2, 0, ['火杀']);
    const hp2 = player(st2, 1).hp;
    expect(send(g2, { type: 'PLAY_CARD', cardIds: [sha2], as: '火杀', targets: [1] }).ok).toBe(true);
    expect(player(st2, 1).hp).toBe(hp2 - 2);
    expect(st2.log.some((l) => l.text.includes('2 点火焰伤害'))).toBe(true);
  });

  it('雷杀造成雷电伤害', () => {
    const st = build({ seed: 'c-lei-1', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    const [sha] = giveFromDeck(st, 0, ['雷杀']);
    const hp1 = player(st, 1).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '雷杀', targets: [1] }).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1 - 1);
    expect(st.log.some((l) => l.text.includes('1 点雷电伤害'))).toBe(true);
  });

  it('闪不能主动使用', () => {
    const st = build({ seed: 'c-shan-1', hands: { 0: [] } });
    const g = toPlay(st);
    const [shan] = giveFromDeck(st, 0, ['闪']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [shan], as: '闪', targets: [] }).ok).toBe(false);
  });

  it('桃：受伤时回复 1 点体力', () => {
    const st = build({ seed: 'c-tao-1', hands: { 0: [] } });
    setHp(st, 0, 1);
    const g = toPlay(st);
    const [tao] = giveFromDeck(st, 0, ['桃']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [tao], as: '桃', targets: [] }).ok).toBe(true);
    expect(player(st, 0).hp).toBe(2);
  });

  it('桃：满血时不能使用，且不会超出体力上限', () => {
    const st = build({ seed: 'c-tao-2', hands: { 0: [] } });
    const g = toPlay(st);
    const maxHp = player(st, 0).maxHp;
    expect(player(st, 0).hp).toBe(maxHp);
    const [tao] = giveFromDeck(st, 0, ['桃']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [tao], as: '桃', targets: [] }).ok).toBe(false);
    expect(player(st, 0).hp).toBe(maxHp);
  });

  it('酒：本回合下一张杀的伤害 +1', () => {
    const st = build({ seed: 'c-jiu-1', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    const [jiu] = giveFromDeck(st, 0, ['酒']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [jiu], as: '酒', targets: [] }).ok).toBe(true);
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    const hp1 = player(st, 1).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1 - 2);
  });

  it('酒：一次使用只在战斗记录里留下一行「使用【酒】」', () => {
    const st = build({ seed: 'c-jiu-log', hands: { 0: [] } });
    const g = toPlay(st);
    const [jiu] = giveFromDeck(st, 0, ['酒']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [jiu], as: '酒', targets: [] }).ok).toBe(true);
    expect(st.log.filter((l) => l.text.includes('使用【酒】'))).toHaveLength(1);
    expect(st.log.some((l) => l.text.includes('下一张【杀】首个伤害 +1'))).toBe(true);
  });

  it('酒：出牌阶段限一次', () => {
    const st = build({ seed: 'c-jiu-2', hands: { 0: [] } });
    const g = toPlay(st);
    const [j1] = giveFromDeck(st, 0, ['酒']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [j1], as: '酒', targets: [] }).ok).toBe(true);
    const [j2] = giveFromDeck(st, 0, ['酒']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [j2], as: '酒', targets: [] }).ok).toBe(false);
  });
});

describe('单体锦囊', () => {
  it('无中生有：自己摸 2 张', () => {
    const st = build({ seed: 't-wz-1', hands: { 0: [] } });
    const g = toPlay(st);
    const [wzsy] = giveFromDeck(st, 0, ['无中生有']);
    const before = player(st, 0).hand.length;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [wzsy], as: '无中生有', targets: [] }).ok).toBe(true);
    expect(player(st, 0).hand.length).toBe(before - 1 + 2);
  });

  it('日志格式：无目标牌不写成「→ 自己」', () => {
    const st = build({ seed: 't-log-1', hands: { 0: [] } });
    const g = toPlay(st);
    const [wzsy] = giveFromDeck(st, 0, ['无中生有']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [wzsy], as: '无中生有', targets: [] }).ok).toBe(true);
    const line = st.log.find((l) => l.text.includes('无中生有'))!;
    expect(line.text).toContain('使用【无中生有】');
    expect(line.text).not.toContain('→');
    // 装备牌同理
    const [mount] = giveFromDeck(st, 0, ['防御坐骑']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [mount], as: '防御坐骑', targets: [] }).ok).toBe(true);
    const eq = st.log.find((l) => l.text.includes('装备【防御坐骑】'))!;
    expect(eq.text).not.toContain('→');
    // 一次装备只应留下一条日志（曾在结算栈里重复记一次，日志出现两行）
    expect(st.log.filter((l) => l.text.includes('装备【防御坐骑】'))).toHaveLength(1);
    // 有目标的牌照常显示目标
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    setHand(st, 1, []);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    expect(st.log.some((l) => l.text.includes('使用【普通杀】 → P1。'))).toBe(true);
  });

  it('过河拆桥：弃置目标区域内 1 张牌', () => {
    const st = build({ seed: 't-gh-1', hands: { 0: [] } });
    const g = toPlay(st);
    setHand(st, 1, giveFromDeck(st, 1, ['普通杀', '闪']));
    const [gh] = giveFromDeck(st, 0, ['过河拆桥']);
    const hand1 = player(st, 1).hand.length;
    const discardBefore = st.discard.length;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [gh], as: '过河拆桥', targets: [1] }).ok).toBe(true);
    // 由使用者选择目标区域内的牌，手牌显示为背面槽位
    expect(st.pending?.actorSeat).toBe(0);
    expect(optionCount(st)).toBe(hand1);
    expect(answerPick(st, 0).ok).toBe(true);
    expect(player(st, 1).hand.length).toBe(hand1 - 1);
    expect(st.discard.length).toBe(discardBefore + 2); // 过河拆桥自身 + 被弃的牌
  });

  it('过河拆桥：目标没有牌时不能指定', () => {
    const st = build({ seed: 't-gh-2', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    const [gh] = giveFromDeck(st, 0, ['过河拆桥']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [gh], as: '过河拆桥', targets: [1] }).ok).toBe(false);
  });

  it('决斗：目标不打杀则目标受伤', () => {
    const st = build({ seed: 't-duel-1', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    const [duel] = giveFromDeck(st, 0, ['决斗']);
    const hp0 = player(st, 0).hp;
    const hp1 = player(st, 1).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [duel], as: '决斗', targets: [1] }).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1 - 1);
    expect(player(st, 0).hp).toBe(hp0);
  });

  it('决斗：交替打杀，先打不出的一方受伤', () => {
    const st = build({ seed: 't-duel-2', hands: { 0: [] } });
    const g = toPlay(st);
    setHand(st, 1, giveFromDeck(st, 1, ['普通杀']));
    const [duel] = giveFromDeck(st, 0, ['决斗']);
    const hp0 = player(st, 0).hp;
    const hp1 = player(st, 1).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [duel], as: '决斗', targets: [1] }).ok).toBe(true);
    // 目标打出杀后轮到我：我选择不打出
    expect(st.pending?.actorSeat).toBe(0);
    expect(answerPass(st).ok).toBe(true);
    expect(player(st, 0).hp).toBe(hp0 - 1);
    expect(player(st, 1).hp).toBe(hp1);
  });

  it('决斗：我可以继续打杀把压力推回去', () => {
    const st = build({ seed: 't-duel-3', hands: { 0: [] } });
    const g = toPlay(st);
    setHand(st, 1, giveFromDeck(st, 1, ['普通杀']));
    const [duel] = giveFromDeck(st, 0, ['决斗']);
    const [mySha] = giveFromDeck(st, 0, ['普通杀']);
    const hp0 = player(st, 0).hp;
    const hp1 = player(st, 1).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [duel], as: '决斗', targets: [1] }).ok).toBe(true);
    expect(st.pending?.actorSeat).toBe(0);
    // 我打出杀 → 目标已无杀 → 目标受伤
    expect(answerCurrent(st, { cardIds: [mySha], targets: [], pass: false }).ok).toBe(true);
    runBots(st);
    expect(player(st, 1).hp).toBe(hp1 - 1);
    expect(player(st, 0).hp).toBe(hp0);
  });

  it('顺手牵羊：距离为 1 时获得目标 1 张牌', () => {
    const st = build({
      seed: 't-ss-1',
      n: 4,
      others: [CHAR.guyuanhao, CHAR.liuyutao, CHAR.wulifan],
      hands: { 0: [] },
    });
    const g = toPlay(st);
    setHand(st, 1, giveFromDeck(st, 1, ['普通杀', '闪']));
    const [ssqy] = giveFromDeck(st, 0, ['顺手牵羊']);
    const before = player(st, 0).hand.length;
    const hand1 = player(st, 1).hand.length;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [ssqy], as: '顺手牵羊', targets: [1] }).ok).toBe(true);
    expect(st.pending?.actorSeat).toBe(0);
    expect(answerPick(st, 0).ok).toBe(true);
    expect(player(st, 1).hand.length).toBe(hand1 - 1);
    expect(player(st, 0).hand.length).toBe(before - 1 + 1);
  });

  it('顺手牵羊：距离大于 1 时不能指定', () => {
    const st = build({ seed: 't-ss-2', hands: { 0: [] } });
    const g = toPlay(st);
    const [ssqy] = giveFromDeck(st, 0, ['顺手牵羊']);
    // 5 人局中座位 0 到座位 2 的基准距离为 2
    expect(distance(st, 0, 2)).toBe(2);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [ssqy], as: '顺手牵羊', targets: [2] }).ok).toBe(false);
  });
});

describe('群体锦囊', () => {
  it('南蛮入侵：打出杀者免伤，其余各受 1 点伤害', () => {
    const st = build({ seed: 't-nanman', hands: { 0: [] } });
    const g = toPlay(st);
    setHand(st, 1, giveFromDeck(st, 1, ['普通杀']));
    setHand(st, 2, []);
    setHand(st, 3, []);
    setHand(st, 4, []);
    const [nmrq] = giveFromDeck(st, 0, ['南蛮入侵']);
    const hps = st.players.map((p) => p.hp);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [nmrq], as: '南蛮入侵', targets: [1, 2, 3, 4] }).ok).toBe(true);
    expect(player(st, 1).hp, '有杀应免伤').toBe(hps[1]);
    for (const s of [2, 3, 4]) expect(player(st, s).hp, `seat ${s}`).toBe(hps[s] - 1);
    expect(st.log.some((l) => l.text.includes('打出') && l.text.includes('普通杀'))).toBe(true);
  });

  it('万箭齐发：打出闪者免伤，其余各受 1 点伤害', () => {
    const st = build({ seed: 't-wanjian', hands: { 0: [] } });
    const g = toPlay(st);
    setHand(st, 1, giveFromDeck(st, 1, ['闪']));
    setHand(st, 2, []);
    setHand(st, 3, []);
    setHand(st, 4, []);
    const [wjqf] = giveFromDeck(st, 0, ['万箭齐发']);
    const hps = st.players.map((p) => p.hp);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [wjqf], as: '万箭齐发', targets: [1, 2, 3, 4] }).ok).toBe(true);
    expect(player(st, 1).hp, '有闪应免伤').toBe(hps[1]);
    for (const s of [2, 3, 4]) expect(player(st, s).hp, `seat ${s}`).toBe(hps[s] - 1);
  });

  it('群体锦囊：不能只指定部分目标', () => {
    const st = build({ seed: 't-mass-1', hands: { 0: [] } });
    toPlay(st);
    const [nmrq] = giveFromDeck(st, 0, ['南蛮入侵']);
    expect(sendAs(st, 0, { type: 'PLAY_CARD', cardIds: [nmrq], as: '南蛮入侵', targets: [3] }).ok).toBe(false);
    expect(st.lastCommandError).toContain('目标');
  });
});

describe('无懈可击', () => {
  /** 把电脑手上的无懈可击全部收回牌堆，只保留指定座位，保证轮询顺序确定。 */
  const isolate = (st: ReturnType<typeof build>, keep: number[]) => stripFromOthers(st, '无懈可击', keep);

  it('抵消一张单体锦囊，目标区域不受影响', () => {
    const st = build({ seed: 't-wuxie', hands: { 0: [] } });
    setHand(st, 1, giveFromDeck(st, 1, ['普通杀', '闪']));
    const [gh] = giveFromDeck(st, 0, ['过河拆桥']);
    const [wx] = giveFromDeck(st, 1, ['无懈可击']);
    isolate(st, [1]);
    const hand1 = player(st, 1).hand.length;

    expect(sendAs(st, 0, { type: 'PLAY_CARD', cardIds: [gh], as: '过河拆桥', targets: [1] }).ok).toBe(true);
    expect(st.pending?.actorSeat).toBe(1);
    expect(st.pending?.title).toContain('无懈可击');

    expect(answerCurrent(st, { cardIds: [wx], targets: [], pass: false }).ok).toBe(true);
    // 只有座位 1 持有无懈，之后不会再有人反制，也不会进入选牌；
    // 结算栈回到我的出牌阶段。
    expect(st.pending?.kind).toBe('playPhase');
    expect(st.pending?.actorSeat).toBe(0);
    // 过河拆桥被抵消：目标只损失了用来抵消的那张无懈
    expect(player(st, 1).hand.length).toBe(hand1 - 1);
    expect(st.discard).toContain(wx);
  });

  it('可被另一张无懈可击反制，原锦囊恢复生效', () => {
    const st = build({ seed: 't-wuxie-2', hands: { 0: [] } });
    setHand(st, 1, giveFromDeck(st, 1, ['普通杀', '闪']));
    const [gh] = giveFromDeck(st, 0, ['过河拆桥']);
    const [wx1] = giveFromDeck(st, 1, ['无懈可击']);
    const [wx2] = giveFromDeck(st, 0, ['无懈可击']);
    isolate(st, [0, 1]);
    const hand1 = player(st, 1).hand.length;

    expect(sendAs(st, 0, { type: 'PLAY_CARD', cardIds: [gh], as: '过河拆桥', targets: [1] }).ok).toBe(true);

    // 两张无懈按轮询顺序打出，彼此抵消后原锦囊恢复生效；
    // 最后一次由我决定弃置目标的哪张牌。
    const pool = [wx2, wx1];
    let guard = 0;
    while (st.pending && guard++ < 12) {
      const p = st.pending;
      if (p.title.includes('无懈可击')) {
        const mine = p.options.selectableCards.find((c) => pool.includes(c.cardId));
        if (mine) {
          pool.splice(pool.indexOf(mine.cardId), 1);
          expect(answerCurrent(st, { cardIds: [mine.cardId], targets: [], pass: false }).ok).toBe(true);
        } else {
          expect(answerPass(st).ok).toBe(true);
        }
      } else if (p.kind === 'choice' && p.actorSeat === 0 && p.options.selectableCards.length > 0) {
        expect(answerPick(st, 0).ok).toBe(true);
      } else {
        break;
      }
    }
    // 目标损失：一张用来反制的无懈 + 一张被弃置的牌
    expect(st.discard).toContain(wx1);
    expect(st.discard).toContain(wx2);
    expect(player(st, 1).hand.length).toBe(hand1 - 2);
  });

  it('不能用来抵消基本牌', () => {
    const st = build({ seed: 't-wuxie-3', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    setHand(st, 1, giveFromDeck(st, 1, ['无懈可击']));
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    const hp1 = player(st, 1).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    // 杀不是锦囊：不会为它开启无懈窗口
    expect(st.pending?.title ?? '').not.toContain('无懈可击');
    expect(player(st, 1).hp).toBe(hp1 - 1);
  });
});

describe('延时锦囊', () => {
  it('乐不思蜀：置入目标判定区', () => {
    const st = build({ seed: 't-lebu', hands: { 0: [] } });
    const g = toPlay(st);
    const [lbs] = giveFromDeck(st, 0, ['乐不思蜀']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [lbs], as: '乐不思蜀', targets: [1] }).ok).toBe(true);
    expect(player(st, 1).judge).toContain(lbs);
    expect(st.log.some((l) => l.text.includes('判定区置入【乐不思蜀】'))).toBe(true);
  });

  it('乐不思蜀：同一个判定区不能叠加两张', () => {
    const st = build({ seed: 't-lebu-2', hands: { 0: [] } });
    const g = toPlay(st);
    // 先把两张都拿到手上，避免第二张又被从判定区取回来
    const [a, b] = giveFromDeck(st, 0, ['乐不思蜀', '乐不思蜀']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [a], as: '乐不思蜀', targets: [1] }).ok).toBe(true);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [b], as: '乐不思蜀', targets: [1] }).ok).toBe(false);
    expect(player(st, 1).judge).toEqual([a]);
  });
});

describe('铁索连环', () => {
  it('切换横置状态', () => {
    const st = build({ seed: 't-tiesuo', hands: { 0: [] } });
    const g = toPlay(st);
    const [ts] = giveFromDeck(st, 0, ['铁索连环']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [ts], as: '铁索连环', targets: [1] }).ok).toBe(true);
    expect(player(st, 1).chained).toBe(true);
  });

  it('可以重铸（弃置并摸一张）', () => {
    const st = build({ seed: 't-tiesuo-2', hands: { 0: [] } });
    const g = toPlay(st);
    const [ts] = giveFromDeck(st, 0, ['铁索连环']);
    const before = player(st, 0).hand.length;
    expect(send(g, { type: 'RECAST', cardIds: [ts] }).ok).toBe(true);
    expect(player(st, 0).hand.length).toBe(before);
    expect(st.discard).toContain(ts);
    expect(st.log.some((l) => l.text.includes('重铸'))).toBe(true);
  });

  it('不可重铸的牌不能重铸', () => {
    const st = build({ seed: 't-tiesuo-3', hands: { 0: [] } });
    toPlay(st);
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    expect(sendAs(st, 0, { type: 'RECAST', cardIds: [sha] }).ok).toBe(false);
  });
});

describe('装备牌', () => {
  it('诸葛连弩：出杀无次数限制', () => {
    const st = build({ seed: 'e-nu', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    forceEquip(st, 0, '诸葛连弩');
    giveFromDeck(st, 0, ['普通杀', '普通杀']);
    const a = inHand(st, 0, '普通杀');
    expect(send(g, { type: 'PLAY_CARD', cardIds: [a], as: '普通杀', targets: [1] }).ok).toBe(true);
    const b = inHand(st, 0, '普通杀');
    expect(send(g, { type: 'PLAY_CARD', cardIds: [b], as: '普通杀', targets: [1] }).ok).toBe(true);
  });

  it('长刀：范围 3', () => {
    const st = build({ seed: 'e-changdao', hands: { 0: [] } });
    toPlay(st);
    forceEquip(st, 0, '长刀');
    expect(attackRange(st, 0)).toBe(3);
  });

  it('寒冰剑：范围 2', () => {
    const st = build({ seed: 'e-hanbing-range', hands: { 0: [] } });
    toPlay(st);
    forceEquip(st, 0, '寒冰剑');
    expect(attackRange(st, 0)).toBe(2);
  });

  it('方天画戟：消耗全部手牌时最多指定 3 个目标', () => {
    const st = build({ seed: 'e-fangtian', hands: { 0: [], 1: [], 2: [], 3: [], 4: [] } });
    const g = toPlay(st);
    forceEquip(st, 0, '方天画戟');
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    // 手牌只剩这一张杀 → 可以额外指定至多两名攻击范围内的其他角色
    const hp = st.players.map((p) => p.hp);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1, 2] }).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp[1] - 1);
    expect(player(st, 2).hp).toBe(hp[2] - 1);
  });

  it('八卦阵：需要闪时进行判定，结果写入日志', () => {
    const st = build({ seed: 'e-bagua', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    forceEquip(st, 1, '八卦阵');
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    const hp1 = player(st, 1).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    expect(st.log.some((l) => l.text.includes('八卦阵'))).toBe(true);
    const now = player(st, 1).hp;
    expect([hp1, hp1 - 1]).toContain(now);
  });

  it('藤甲：普通杀无效', () => {
    const st = build({ seed: 'e-tengjia', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    forceEquip(st, 1, '藤甲');
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    const hp1 = player(st, 1).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1);
    expect(st.log.some((l) => l.text.includes('藤甲') && l.text.includes('无效'))).toBe(true);
  });

  it('藤甲：南蛮入侵与万箭齐发同样无效', () => {
    const st = build({ seed: 'e-tengjia-2', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    forceEquip(st, 1, '藤甲');
    const hp1 = player(st, 1).hp;
    const [nmrq] = giveFromDeck(st, 0, ['南蛮入侵']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [nmrq], as: '南蛮入侵', targets: [1, 2, 3, 4] }).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1);
  });

  it('寒冰剑：防止伤害并改为弃置目标至多两张牌', () => {
    const st = build({ seed: 'e-hanbing', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    forceEquip(st, 0, '寒冰剑');
    // 目标手里没有闪，伤害必然落地，从而触发寒冰剑的替代效果
    setHand(st, 1, giveFromDeck(st, 1, ['普通杀', '普通杀', '普通杀']));
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    const hp1 = player(st, 1).hp;
    const hand1 = player(st, 1).hand.length;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    // 寒冰剑是可选发动：先由使用者确认发动，再依次选择要弃置的牌
    expect(st.pending?.title).toContain('寒冰剑');
    expect(answerCurrent(st, { cardIds: [], targets: [], pass: false }).ok).toBe(true);
    let guard = 0;
    while (st.pending && st.pending.kind === 'choice' && st.pending.options.selectableCards.length > 0 && guard++ < 4) {
      expect(answerPick(st, 0).ok).toBe(true);
    }
    expect(player(st, 1).hp, '伤害被防止').toBe(hp1);
    expect(player(st, 1).hand.length).toBeLessThan(hand1);
    expect(st.log.some((l) => l.text.includes('寒冰剑'))).toBe(true);
  });

  it('进攻坐骑与防御坐骑改变距离', () => {
    const st = build({ seed: 'e-mount', hands: { 0: [] } });
    toPlay(st);
    const base = distance(st, 0, 2);
    forceEquip(st, 0, '进攻坐骑');
    expect(distance(st, 0, 2)).toBe(base - 1);

    forceEquip(st, 2, '防御坐骑');
    expect(distance(st, 0, 2)).toBe(base);
  });

  it('防具区被废除时不能装备防具', () => {
    const st = build({ seed: 'e-abolish', self: CHAR.qianyiwen, hands: { 0: [] } });
    toPlay(st);
    expect(player(st, 0).armorZoneAbolished).toBe(true);
    const [armor] = giveFromDeck(st, 0, ['藤甲']);
    expect(sendAs(st, 0, { type: 'PLAY_CARD', cardIds: [armor], as: '藤甲', targets: [] }).ok).toBe(false);
  });
});

describe('出牌合法性总则', () => {
  it('不能指定不存在的目标座位', () => {
    const st = build({ seed: 'l-target-1', hands: { 0: [], 1: [] } });
    toPlay(st);
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    expect(sendAs(st, 0, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [9] }).ok).toBe(false);
  });

  it('不能重复指定同一目标', () => {
    const st = build({ seed: 'l-target-2', hands: { 0: [], 1: [] } });
    toPlay(st);
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    expect(sendAs(st, 0, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1, 1] }).ok).toBe(false);
  });

  it('不能使用手上没有的牌', () => {
    const st = build({ seed: 'l-own-1', hands: { 0: [] } });
    toPlay(st);
    const [sha] = fromDeck(st, '普通杀');
    // 牌还在牌堆里，不在手上
    expect(sendAs(st, 0, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(false);
  });

  it('未识别的牌名不能使用', () => {
    const st = build({ seed: 'l-name-1', hands: { 0: [] } });
    toPlay(st);
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    expect(sendAs(st, 0, { type: 'PLAY_CARD', cardIds: [sha], as: '不存在牌', targets: [1] }).ok).toBe(false);
  });

  it('非法指令被拒后对局仍可继续', () => {
    const st = build({ seed: 'l-recover', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    const [sha] = giveFromDeck(st, 0, ['普通杀']);
    expect(sendAs(st, 0, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [9] }).ok).toBe(false);
    expect(st.status).toBe('running');
    expect(st.pending?.actorSeat).toBe(0);
    const hp1 = player(st, 1).hp;
    expect(send(g, { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] }).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1 - 1);
    expect(checkInvariants(st).filter((e) => !e.includes('存活但体力'))).toEqual([]);
  });
});

describe('牌守恒', () => {
  it('出牌与结算全过程保持牌数守恒', () => {
    const st = build({ seed: 'conservation', hands: { 0: [], 1: [] } });
    const g = toPlay(st);
    giveFromDeck(st, 0, ['酒', '无中生有', '铁索连环', '闪']);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [inHand(st, 0, '酒')], as: '酒', targets: [] }).ok).toBe(true);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [inHand(st, 0, '无中生有')], as: '无中生有', targets: [] }).ok).toBe(true);
    expect(send(g, { type: 'PLAY_CARD', cardIds: [inHand(st, 0, '铁索连环')], as: '铁索连环', targets: [1] }).ok).toBe(true);
    expect(checkInvariants(st).filter((e) => !e.includes('存活但体力'))).toEqual([]);
    const accounted = st.deck.length + st.discard.length + st.processing.length;
    expect(accounted).toBeGreaterThan(0);
  });
});
