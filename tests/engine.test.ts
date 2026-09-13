import { describe, expect, it } from 'vitest';
import { BASE_DECK, BASE_DECK_COUNTS } from '@content/deckData';
import { DEMO_POOL } from '@content/characters';
import { CARD_DEF_BY_NAME } from '@content/cards';
import { initDraft, completeDraft, createGame, roleConfig } from '@engine/setup';
import { advance, checkInvariants, hashState, projectForPlayer, serialize, deserialize } from '@engine/engine';
import { runBotGame } from '../src/runner/localGame';

describe('内容登记', () => {
  it('104 张基础牌数量与配牌表一致', () => {
    expect(BASE_DECK.length).toBe(104);
    expect(BASE_DECK_COUNTS['普通杀']).toBe(24);
    expect(BASE_DECK_COUNTS['闪']).toBe(16);
    expect(BASE_DECK_COUNTS['桃']).toBe(8);
    expect(BASE_DECK_COUNTS['酒']).toBe(4);
    expect(BASE_DECK_COUNTS['无懈可击']).toBe(5);
    expect(BASE_DECK_COUNTS['铁索连环']).toBe(3);
    expect(BASE_DECK_COUNTS['乐不思蜀']).toBe(2);
  });

  it('每个牌名都有定义，装备牌都有范围或栏位', () => {
    for (const c of BASE_DECK) {
      const def = CARD_DEF_BY_NAME[c.name];
      expect(def, c.name).toBeTruthy();
      if (def.category === 'equip') expect(def.slot, c.name).toBeTruthy();
      if (def.slot === 'weapon') expect(def.range, c.name).toBeGreaterThan(0);
    }
  });

  it('cardId 全局唯一', () => {
    const ids = new Set(BASE_DECK.map((c) => c.id));
    expect(ids.size).toBe(104);
  });

  it('首发角色池为 8 名且技能全部实现', () => {
    expect(DEMO_POOL.length).toBe(8);
    for (const c of DEMO_POOL) expect(c.skills.length).toBeGreaterThan(0);
  });
});

describe('身份配置', () => {
  it('4—8 人身份数量正确', () => {
    expect(roleConfig(4).filter((r) => r === 'lord').length).toBe(1);
    expect(roleConfig(5)).toEqual(['lord', 'loyalist', 'rebel', 'rebel', 'traitor']);
    expect(roleConfig(8).filter((r) => r === 'rebel').length).toBe(4);
    for (const n of [4, 5, 6, 7, 8]) {
      const roles = roleConfig(n);
      expect(roles.length).toBe(n);
      expect(roles.filter((r) => r === 'lord').length).toBe(1);
      expect(roles.filter((r) => r === 'traitor').length).toBe(1);
      expect(roles.filter((r) => r === 'loyalist').length).toBe(n >= 7 ? 2 : 1);
    }
  });
});

describe('选将（D01）', () => {
  it('候选不重复、不抽空角色池', () => {
    const draft = initDraft('draft-seed-1', 5, 0);
    const options = draft.offer!.options;
    expect(options.length).toBeGreaterThan(0);
    expect(new Set(options).size).toBe(options.length);
    const chars = completeDraft(draft, options[0]);
    expect(chars.length).toBe(5);
    // familyId 全局唯一
    const fams = chars.map((c) => DEMO_POOL.find((d) => d.characterId === c)!.familyId);
    expect(new Set(fams).size).toBe(5);
  });
});

describe('建局', () => {
  it('5 人局主公有体力加成、初始手牌 4 张、牌堆守恒', () => {
    const draft = initDraft('g1', 5, 0);
    const chars = completeDraft(draft, draft.offer!.options[0]);
    const { state, lordSeat } = createGame({ seed: 'g1', playerCount: 5, selfSeat: 0, characters: chars, autoBegin: false });
    expect(state.players[lordSeat].role).toBe('lord');
    expect(state.players[lordSeat].roleRevealed).toBe(true);
    for (const p of state.players) expect(p.hand.length).toBe(4);
    expect(state.players[lordSeat].maxHp).toBe(DEMO_POOL.find((c) => c.characterId === chars[lordSeat])!.maxHp + 1);
    expect(checkInvariants(state)).toEqual([]);
    const owner = state.players.length;
    expect(owner).toBe(5);
    expect(state.deck.length + state.discard.length + 5 * 4).toBe(104);
  });

  it('4 人局主公不加体力', () => {
    const draft = initDraft('g4', 4, 0);
    const chars = completeDraft(draft, draft.offer!.options[0]);
    const { state, lordSeat } = createGame({ seed: 'g4', playerCount: 4, selfSeat: 0, characters: chars, autoBegin: false });
    const base = DEMO_POOL.find((c) => c.characterId === chars[lordSeat])!;
    expect(state.players[lordSeat].maxHp).toBe(base.maxHp);
  });
});

describe('确定性', () => {
  it('相同种子与命令序列得到相同状态哈希', () => {
    const build = () => {
      const draft = initDraft('det', 5, 0);
      const chars = completeDraft(draft, draft.offer!.options[0]);
      return createGame({ seed: 'det', playerCount: 5, selfSeat: 0, characters: chars }).state;
    };
    const a = build();
    const b = build();
    expect(hashState(a)).toBe(hashState(b));
    const ra = runBotGame(a, 40);
    const rb = runBotGame(b, 40);
    expect(ra.steps).toBe(rb.steps);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('序列化后可继续推进', () => {
    const draft = initDraft('save', 5, 0);
    const chars = completeDraft(draft, draft.offer!.options[0]);
    const { state } = createGame({ seed: 'save', playerCount: 5, selfSeat: 0, characters: chars });
    runBotGame(state, 3);
    const text = serialize(state);
    const restored = deserialize(text);
    expect(hashState(restored)).toBe(hashState(state));
    const pending = restored.pending!;
    expect(pending).toBeTruthy();
    const view = projectForPlayer(restored, pending.actorSeat);
    expect(view.selfSeat).toBe(pending.actorSeat);
  });
});

describe('电脑自对局稳定性', () => {
  for (const n of [4, 5, 6, 7, 8]) {
    it(`${n} 人局：跑满若干回合不崩溃、牌守恒`, () => {
      const draft = initDraft(`sim-${n}`, n, 0);
      const chars = completeDraft(draft, draft.offer!.options[0]);
      const { state } = createGame({ seed: `sim-${n}`, playerCount: n, selfSeat: 0, characters: chars });
      runBotGame(state, 25);
      expect(state.status === 'finished' || state.turn.turnSerial > 0).toBe(true);
      const errs = checkInvariants(state).filter((e) => !e.includes('存活但体力'));
      expect(errs).toEqual([]);
      expect(state.deck.length + state.discard.length + state.processing.length).toBeGreaterThan(0);
    });
  }
});
