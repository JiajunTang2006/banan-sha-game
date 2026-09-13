import { describe, expect, it } from 'vitest';
import { CHAR, answerPass, build, giveFromDeck, setHand, setHp, stackDeck, toPlay } from './harness';
import { advance, checkInvariants, deserialize, hashState, serialize } from '@engine/engine';
import { getActions } from '@engine/play';
import { card, player } from '@engine/util';
import type { Command, GameState } from '@engine/types';

/**
 * 验收 6 的引擎侧：界面上的「过期按钮」「连点」「快速取消」「倒计时超时」，
 * 在引擎里都表现为一条迟到或重复的命令。这些命令必须被拒绝，
 * 且拒绝之后对局状态完全不变——UI 的健壮性最终靠这一层兜底。
 *
 * 刷新恢复（序列化往返）在文件末尾覆盖。
 */

/** 模拟前端倒计时到点后的自动提交。 */
function timeout(state: GameState): { ok: boolean; error?: string } {
  const p = state.pending;
  if (!p) throw new Error('当前没有待处理的提示');
  const cmd: Command = { type: 'SYSTEM_TIMEOUT', promptId: p.promptId, promptRevision: p.revision };
  return advance(state, { seat: p.actorSeat, playerId: 'p' + p.actorSeat, commandId: 'timeout' }, cmd);
}

/** 从牌堆取一张【杀】塞进座位 0 手里，并把座位 1 的手牌清空（保证伤害必然落地）。 */
function armSha(state: GameState): string {
  const [sha] = giveFromDeck(state, 0, ['普通杀']);
  setHand(state, 0, [sha]);
  setHand(state, 1, []);
  return sha;
}

describe('过期按钮', () => {
  it('已经回答过的提示再次提交会被判为过期，且不重复结算', () => {
    const st = build({ seed: 'rob-stale-1', hands: { 0: [], 1: [] } });
    toPlay(st);
    const sha = armSha(st);
    const hp1 = player(st, 1).hp;
    expect(
      advance(st, { seat: 0, playerId: 'p0', commandId: 'x' }, {
        type: 'PLAY_CARD',
        cardIds: [sha],
        as: '普通杀',
        targets: [1],
      }).ok,
    ).toBe(true);
    const stale = { promptId: st.pending!.promptId, promptRevision: st.pending!.revision };
    expect(st.pending!.actorSeat, '先由目标决定是否出【闪】').toBe(1);
    expect(answerPass(st).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1 - 1);
    // 用已经消费掉的提示再回答一次
    const again = advance(
      st,
      { seat: 1, playerId: 'p1', commandId: 'stale' },
      {
        type: 'ANSWER_PROMPT',
        promptId: stale.promptId,
        promptRevision: stale.promptRevision,
        answer: { cardIds: [], targets: [], pass: true },
      },
    );
    expect(again.ok).toBe(false);
    expect(again.error).toContain('过期');
    expect(player(st, 1).hp, '过期指令不产生额外伤害').toBe(hp1 - 1);
  });

  it('伪造的提示编号不会推进任何流程', () => {
    const st = build({ seed: 'rob-stale-2', hands: { 0: [], 1: [] } });
    toPlay(st);
    const before = hashState(st);
    const r = advance(
      st,
      { seat: 0, playerId: 'p0', commandId: 'fake' },
      {
        type: 'ANSWER_PROMPT',
        promptId: 'p99999',
        promptRevision: 7,
        answer: { cardIds: [], targets: [], pass: true },
      },
    );
    expect(r.ok).toBe(false);
    expect(hashState(st)).toBe(before);
  });
});

describe('连点', () => {
  it('同一条出牌指令连点两次，第二次被拒且只结算一次', () => {
    const st = build({ seed: 'rob-double-1', hands: { 0: [], 1: [] } });
    toPlay(st);
    const sha = armSha(st);
    const hp1 = player(st, 1).hp;
    const cmd: Command = { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] };
    expect(advance(st, { seat: 0, playerId: 'p0', commandId: 'c1' }, cmd).ok).toBe(true);
    const dup = advance(st, { seat: 0, playerId: 'p0', commandId: 'c2' }, cmd);
    expect(dup.ok, '结算中不接受新的出牌指令').toBe(false);
    expect(answerPass(st).ok).toBe(true);
    expect(player(st, 1).hp, '只掉 1 点').toBe(hp1 - 1);
    expect(checkInvariants(st).filter((e) => !e.includes('存活但体力'))).toEqual([]);
  });

  it('连续两次结束出牌阶段，第二次被拒', () => {
    const st = build({ seed: 'rob-double-2', hands: { 0: [], 1: [] } });
    toPlay(st);
    expect(advance(st, { seat: 0, playerId: 'p0', commandId: 'e1' }, { type: 'END_PLAY_PHASE' }).ok).toBe(true);
    const second = advance(st, { seat: 0, playerId: 'p0', commandId: 'e2' }, { type: 'END_PLAY_PHASE' });
    expect(second.ok).toBe(false);
  });

  it('连点技能发动：第二次不再生效', () => {
    const st = build({ seed: 'rob-double-3', self: CHAR.chenyuelai, hands: { 0: [] } });
    toPlay(st);
    // 把牌堆顶换成小点数，保证【抽卡】必然成功，手牌张数可预期
    stackDeck(st, findLow(st, 3));
    const first = advance(
      st,
      { seat: 0, playerId: 'p0', commandId: 's1' },
      { type: 'ACTIVATE_SKILL', skillId: 'b13.chouka' },
    );
    expect(first.ok).toBe(true);
    const second = advance(
      st,
      { seat: 0, playerId: 'p0', commandId: 's2' },
      { type: 'ACTIVATE_SKILL', skillId: 'b13.chouka' },
    );
    expect(second.ok).toBe(false);
    expect(st.players[0].turnFlags.choukaUsed, '限一次标记只被消耗一次').toBe(1);
    expect(st.players[0].hand.length, '只摸了一次（3 张）').toBe(3);
  });
});

/** 从牌堆里挑 n 张点数最小的牌，用于让【抽卡】稳定成功。 */
function findLow(state: GameState, n: number): string[] {
  return state.deck
    .slice()
    .sort((a, b) => card(state, a).rank - card(state, b).rank)
    .slice(0, n);
}

describe('快速取消', () => {
  it('结束出牌阶段后手上的牌不会再被结算', () => {
    const st = build({ seed: 'rob-cancel-1', hands: { 0: [], 1: [] } });
    toPlay(st);
    const sha = armSha(st);
    const hp1 = player(st, 1).hp;
    expect(advance(st, { seat: 0, playerId: 'p0', commandId: 'e1' }, { type: 'END_PLAY_PHASE' }).ok).toBe(true);
    expect(st.pending?.actorSeat).not.toBe(0);
    const late = advance(
      st,
      { seat: 0, playerId: 'p0', commandId: 'late' },
      { type: 'PLAY_CARD', cardIds: [sha], as: '普通杀', targets: [1] },
    );
    expect(late.ok, '阶段已结束，迟到的出牌必须被拒').toBe(false);
    expect(player(st, 0).hand).toContain(sha);
    expect(player(st, 1).hp).toBe(hp1);
  });

  it('不是自己的回合时不能提交任何命令', () => {
    const st = build({ seed: 'rob-cancel-2', hands: { 0: [], 1: [] } });
    toPlay(st);
    expect(advance(st, { seat: 0, playerId: 'p0', commandId: 'e1' }, { type: 'END_PLAY_PHASE' }).ok).toBe(true);
    expect(st.pending?.actorSeat, '轮到下家').toBe(1);
    const r = advance(st, { seat: 0, playerId: 'p0', commandId: 'notmy' }, { type: 'END_PLAY_PHASE' });
    expect(r.ok).toBe(false);
    expect(r.error ?? '').toContain('不是');
  });
});

describe('倒计时超时', () => {
  it('出牌阶段超时 = 结束出牌阶段，不会卡在同一个提示', () => {
    const st = build({ seed: 'rob-timeout-1', self: CHAR.chenyuelai, hands: { 0: [] } });
    toPlay(st);
    const old = st.pending!.promptId;
    const r = timeout(st);
    expect(r.ok).toBe(true);
    expect(st.status).not.toBe('techPause');
    expect(st.pending?.promptId).not.toBe(old);
    expect(st.turn.currentSeat, '回合确实交给了下家').toBe(1);
    expect(checkInvariants(st).length).toBe(0);
  });

  it('选择提示超时采用默认答案（【叶障】默认发动）', () => {
    const st = build({ seed: 'rob-timeout-2', self: CHAR.chengjunming, hands: { 0: [] } });
    toPlay(st);
    expect(advance(st, { seat: 0, playerId: 'p0', commandId: 'e1' }, { type: 'END_PLAY_PHASE' }).ok).toBe(true);
    expect(st.pending?.title ?? '').toContain('叶障');
    const r = timeout(st);
    expect(r.ok).toBe(true);
    expect(player(st, 0).hand.length, '默认发动，摸两张').toBe(2);
    expect(checkInvariants(st).length).toBe(0);
  });

  it('超时（需要打出【闪】）按放弃处理，伤害照常落地', () => {
    const st = build({ seed: 'rob-timeout-3', hands: { 0: [], 1: [] } });
    toPlay(st);
    const sha = armSha(st);
    const hp1 = player(st, 1).hp;
    expect(
      advance(st, { seat: 0, playerId: 'p0', commandId: 'x' }, {
        type: 'PLAY_CARD',
        cardIds: [sha],
        as: '普通杀',
        targets: [1],
      }).ok,
    ).toBe(true);
    const stale = { promptId: st.pending!.promptId, promptRevision: st.pending!.revision };
    expect(timeout(st).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1 - 1);
    const again = advance(
      st,
      { seat: 1, playerId: 'p1', commandId: 'stale' },
      {
        type: 'ANSWER_PROMPT',
        promptId: stale.promptId,
        promptRevision: stale.promptRevision,
        answer: { cardIds: [], targets: [], pass: true },
      },
    );
    expect(again.ok).toBe(false);
    expect(player(st, 1).hp, '超时后旧提示不会再造成伤害').toBe(hp1 - 1);
  });

  it('对局结束时提交超时不会破坏状态', () => {
    const st = build({ seed: 'rob-timeout-4', hands: { 0: [], 1: [] } });
    toPlay(st);
    st.status = 'finished';
    const r = timeout(st);
    expect(r.ok).toBe(false);
    expect(r.error ?? '').toContain('结束');
    expect(checkInvariants(st).length).toBe(0);
  });
});

describe('无牌与无目标', () => {
  it('手牌为空时没有任何可用的出牌动作', () => {
    const st = build({ seed: 'rob-empty-1', hands: { 0: [] } });
    toPlay(st);
    expect(getActions(st, 0).filter((a) => a.kind === 'useCard')).toEqual([]);
  });

  it('【过河拆桥】在没有合法目标时不可使用', () => {
    const st = build({ seed: 'rob-empty-2', hands: { 0: [], 1: [], 2: [], 3: [], 4: [] } });
    toPlay(st);
    const [qiao] = giveFromDeck(st, 0, ['过河拆桥']);
    expect(getActions(st, 0).filter((a) => a.asName === '过河拆桥' && a.cardIds.includes(qiao)).length).toBe(0);
  });

  it('【桃】在满血时不可使用，受伤后立即可用', () => {
    const st = build({ seed: 'rob-empty-3', hands: { 0: [] } });
    toPlay(st);
    const [tao] = giveFromDeck(st, 0, ['桃']);
    expect(getActions(st, 0).some((a) => a.asName === '桃' && a.cardIds.includes(tao))).toBe(false);
    setHp(st, 0, 1);
    expect(getActions(st, 0).some((a) => a.asName === '桃' && a.cardIds.includes(tao))).toBe(true);
  });

  it('【闪】不能在自己的出牌阶段主动使用', () => {
    const st = build({ seed: 'rob-empty-4', hands: { 0: [] } });
    toPlay(st);
    const [shan] = giveFromDeck(st, 0, ['闪']);
    expect(getActions(st, 0).some((a) => a.cardIds.includes(shan))).toBe(false);
  });

  it('目标手牌全空时【杀】仍然可用，只是对方无从响应', () => {
    const st = build({ seed: 'rob-empty-5', hands: { 0: [], 1: [] } });
    toPlay(st);
    const sha = armSha(st);
    const hp1 = player(st, 1).hp;
    expect(
      advance(st, { seat: 0, playerId: 'p0', commandId: 'x' }, {
        type: 'PLAY_CARD',
        cardIds: [sha],
        as: '普通杀',
        targets: [1],
      }).ok,
    ).toBe(true);
    expect(answerPass(st).ok).toBe(true);
    expect(player(st, 1).hp).toBe(hp1 - 1);
  });
});

describe('存档往返（刷新恢复）', () => {
  it('进行中的对局序列化再反序列化后哈希一致，且能继续推进到相同结果', () => {
    const st = build({ seed: 'rob-save-1', hands: { 0: [], 1: [] } });
    toPlay(st);
    const sha = armSha(st);
    expect(
      advance(st, { seat: 0, playerId: 'p0', commandId: 'x' }, {
        type: 'PLAY_CARD',
        cardIds: [sha],
        as: '普通杀',
        targets: [1],
      }).ok,
    ).toBe(true);
    expect(st.pending?.actorSeat, '停在别人的响应提示上').toBe(1);
    const restored = deserialize(serialize(st));
    expect(hashState(restored)).toBe(hashState(st));
    expect(restored.pending?.promptId).toBe(st.pending?.promptId);
    expect(restored.pending?.actorSeat).toBe(st.pending?.actorSeat);
    // 两边各自推进同一条命令，结果必须完全一致
    expect(answerPass(restored).ok).toBe(true);
    expect(answerPass(st).ok).toBe(true);
    expect(hashState(restored)).toBe(hashState(st));
    expect(player(restored, 1).hp).toBe(player(st, 1).hp);
  });

  it('旧版本存档缺少 replay / setup 字段时也能恢复', () => {
    const st = build({ seed: 'rob-save-2', hands: { 0: [] } });
    toPlay(st);
    const raw = JSON.parse(serialize(st)) as Record<string, unknown>;
    delete raw.replay;
    delete raw.setup;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.replay).toEqual([]);
    expect(restored.setup.seed).toBe(st.seed);
    expect(restored.setup.characters.length).toBe(st.players.length);
    expect(restored.status).toBe('running');
    // 恢复后仍可继续推进
    expect(advance(restored, { seat: 0, playerId: 'p0', commandId: 'e' }, { type: 'END_PLAY_PHASE' }).ok).toBe(true);
  });

  it('连续两次序列化得到完全相同的文本', () => {
    const st = build({ seed: 'rob-save-3', hands: { 0: [], 1: [] } });
    toPlay(st);
    giveFromDeck(st, 0, ['桃', '闪']);
    expect(serialize(deserialize(serialize(st)))).toBe(serialize(st));
  });
});
