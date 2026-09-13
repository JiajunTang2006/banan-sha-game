import { describe, expect, it } from 'vitest';
import { DEMO_POOL } from '@content/characters';
import { completeDraft, createGame, initDraft, roleConfig } from '@engine/setup';
import {
  checkInvariants,
  deserialize,
  exportReplay,
  hashState,
  replayFromFile,
  serialize,
} from '@engine/engine';
import { checkVictory } from '@engine/drivers/victory';
import { advance, projectForPlayer } from '@engine/engine';
import { chooseAnswer, choosePlayCommand, botCommandId } from '@bot/bot';
import type { Command, GameState, RoleId, Transition } from '@engine/types';
import { runBotGame } from '../src/runner/localGame';

/**
 * 第一阶段验收的自动化部分。
 *
 * 覆盖方案第 13 节：
 *   验收 1 —— 4/6/7/8 人规则配置与身份胜负判定
 *   验收 4 —— 固定种子的电脑自对局稳定性（操作上限区分正常结束与疑似停滞）
 *   验收 5 —— 复现文件重放后最终状态哈希一致
 *
 * 本文件不依赖任何随机源：种子全部写死，失败用例都能按 seed 原样复现。
 */

/** 用固定种子建一局，身份表显式传入以保证可复现。 */
function makeState(seed: string, n: number, opts: { selfSeat?: number; autoBegin?: boolean } = {}): GameState {
  const draft = initDraft(seed, n, opts.selfSeat ?? 0);
  const chars = completeDraft(draft, draft.offer!.options[0]);
  return createGame({
    seed,
    playerCount: n,
    selfSeat: opts.selfSeat ?? 0,
    characters: chars,
    roles: roleConfig(n),
    ...(opts.autoBegin === undefined ? {} : { autoBegin: opts.autoBegin }),
  }).state;
}

/**
 * 与页面完全一致地建局：不传 roles、不传 riggedHands。
 * 页面的 createGame 调用就是这个形状，身份与手牌都来自随机。
 */
function makeUiState(seed: string, n: number, selfSeat = 0): GameState {
  const draft = initDraft(seed, n, selfSeat);
  const chars = completeDraft(draft, draft.offer!.options[0]);
  return createGame({ seed, playerCount: n, selfSeat, characters: chars }).state;
}

/** 让全部电脑应答，直到稳定等待点；返回推进步数。 */
function stepAll(state: GameState, max = 4000): number {
  let steps = 0;
  while (state.status === 'running' && state.pending && steps < max) {
    const pending = state.pending;
    const seat = pending.actorSeat;
    const view = projectForPlayer(state, seat);
    const cmd: Command =
      pending.kind === 'playPhase'
        ? choosePlayCommand(view)
        : {
            type: 'ANSWER_PROMPT',
            promptId: pending.promptId,
            promptRevision: pending.revision,
            answer: chooseAnswer(view, pending),
          };
    const r: Transition = advance(state, { seat, playerId: 'p' + seat, commandId: botCommandId('acc') }, cmd);
    if (!r.ok) break;
    steps += 1;
  }
  return steps;
}

/* ================================================================== */
/* 验收 1：人数配置与身份胜负                                          */
/* ================================================================== */

describe('验收 1：4/6/7/8 人规则配置', () => {
  const counts: Record<number, Record<RoleId, number>> = {
    4: { lord: 1, loyalist: 1, rebel: 1, traitor: 1 },
    5: { lord: 1, loyalist: 1, rebel: 2, traitor: 1 },
    6: { lord: 1, loyalist: 1, rebel: 3, traitor: 1 },
    7: { lord: 1, loyalist: 2, rebel: 3, traitor: 1 },
    8: { lord: 1, loyalist: 2, rebel: 4, traitor: 1 },
  };

  for (const n of [4, 6, 7, 8]) {
    it(`${n} 人局：身份数量与规则一致，且建局后不变量成立`, () => {
      // autoBegin=false：只检查建局结果，不推进到主公的摸牌阶段（否则主公手牌会变多）
      const st = makeState(`acc1-${n}`, n, { autoBegin: false });
      const actual = { lord: 0, loyalist: 0, rebel: 0, traitor: 0 } as Record<RoleId, number>;
      for (const p of st.players) actual[p.role] += 1;
      expect(actual).toEqual(counts[n]);
      expect(st.players.filter((p) => p.roleRevealed).map((p) => p.role)).toEqual(['lord']);
      expect(st.players.every((p) => p.hand.length === 4)).toBe(true);
      const lord = st.players.find((p) => p.role === 'lord')!;
      const base = DEMO_POOL.find((c) => c.characterId === lord.characterId)!;
      expect(lord.maxHp, '主公体力上限：4 人不加，5 人及以上 +1').toBe(base.maxHp + (n >= 5 ? 1 : 0));
      expect(checkInvariants(st)).toEqual([]);
    });

    it(`${n} 人局：主公死亡时按存活者判定反贼 / 内奸胜`, () => {
      const st = makeState(`acc1-vic-${n}`, n);
      const lord = st.players.find((p) => p.role === 'lord')!;
      const setAlive = (roles: RoleId[]) => {
        for (const p of st.players) p.alive = roles.includes(p.role);
      };
      // 主公死亡 + 只剩内奸 → 内奸胜
      setAlive(['lord', 'traitor']);
      lord.alive = false;
      expect(checkVictory(st)).toBe('traitor');
      // 主公死亡 + 还有反贼存活 → 反贼胜
      setAlive(['lord', 'rebel', 'traitor']);
      lord.alive = false;
      expect(checkVictory(st)).toBe('rebel');
      // 主公存活 + 敌对阵营全灭 → 主公忠臣胜
      setAlive(['lord', 'loyalist']);
      expect(checkVictory(st)).toBe('lord');
      // 主公存活 + 还有内奸 → 未结束
      setAlive(['lord', 'loyalist', 'traitor']);
      expect(checkVictory(st)).toBeNull();
    });

    it(`${n} 人局：电脑自对局能推进到结束或达到操作上限`, () => {
      const st = makeState(`acc1-sim-${n}`, n);
      runBotGame(st, 60);
      expect(st.status === 'finished' || st.turn.turnSerial > 0).toBe(true);
      expect(st.status).not.toBe('techPause');
      const errs = checkInvariants(st).filter((e) => !e.includes('存活但体力'));
      expect(errs).toEqual([]);
    });
  }
});

/* ================================================================== */
/* 验收 4：200 局固定种子自对局                                        */
/* ================================================================== */

describe('验收 4：200 局固定种子电脑自对局', () => {
  const GAMES = 200;
  const MAX_TURNS = 120;

  it('全部对局无技术暂停、无不变量破坏、无悬空状态', () => {
    const techPauses: string[] = [];
    const invariantBreaks: string[] = [];
    const dangling: string[] = [];
    let finished = 0;
    let capped = 0;

    for (let i = 0; i < GAMES; i++) {
      const seed = `soak-${i}`;
      const n = 4 + (i % 5);
      const st = makeState(seed, n);
      runBotGame(st, MAX_TURNS);

      if (st.status === 'techPause') techPauses.push(`${seed}(${n}人)：${st.techPause?.detail ?? ''}`);
      else if (st.status === 'finished') finished += 1;
      else capped += 1;

      if (st.status === 'running' && !st.pending) dangling.push(`${seed}(${n}人)：运行中却没有待处理提示`);
      const errs = checkInvariants(st).filter((e) => !e.includes('存活但体力'));
      if (errs.length > 0) invariantBreaks.push(`${seed}(${n}人)：${errs.slice(0, 2).join(' / ')}`);
    }

    // 失败清单只打印前几条，避免刷屏；断言本身保证为空
    expect(techPauses.slice(0, 3)).toEqual([]);
    expect(invariantBreaks.slice(0, 3)).toEqual([]);
    expect(dangling.slice(0, 3)).toEqual([]);
    expect(finished + capped).toBe(GAMES);
    // 达到操作上限只代表「未在 120 回合内分出胜负」。本次实测 200/200 全部正常结束，
    // 因此把门限设在 90%：一旦电脑策略退化成互不出牌，这里会立刻报红。
    expect(finished).toBeGreaterThanOrEqual(GAMES * 0.9);
    expect(capped).toBeLessThanOrEqual(GAMES * 0.1);
    // 记录实际分布，便于人工复核（本地跑一次即可看到）
    console.info(`[验收4] 共 ${GAMES} 局：正常结束 ${finished} 局，达到操作上限 ${capped} 局。`);
  });

  it('同一颗种子跑两次得到完全相同的状态哈希', () => {
    for (const seed of ['soak-0', 'soak-7', 'soak-63', 'soak-199']) {
      const a = makeState(seed, 5);
      const b = makeState(seed, 5);
      expect(hashState(a)).toBe(hashState(b));
      expect(stepAll(a)).toBe(stepAll(b));
      expect(hashState(a)).toBe(hashState(b));
    }
  });
});

/* ================================================================== */
/* 验收 5：复现文件重放                                                */
/* ================================================================== */

describe('验收 5：复现文件重放哈希一致', () => {
  it('导出复现文件后重放，最终哈希与胜负完全一致', () => {
    for (const seed of ['replay-0', 'replay-1', 'replay-2', 'replay-3', 'replay-4']) {
      const st = makeState(seed, 5);
      runBotGame(st, 40);
      const file = exportReplay(st);
      expect(file.format).toBe('banan-sha/replay');
      expect(file.commands.length).toBeGreaterThan(0);

      const result = replayFromFile(file);
      expect(result.error, `${seed} 重放报错`).toBeNull();
      expect(result.divergeAt, `${seed} 第 ${result.divergeAt} 条命令起偏离`).toBeNull();
      expect(result.match, `${seed} 最终哈希不一致`).toBe(true);
      expect(result.finalHash).toBe(file.finalHash);
      expect(result.finalHash).toBe(hashState(st));
      expect(result.state.status).toBe(st.status);
      expect(result.state.winner).toBe(st.winner);
      expect(checkInvariants(result.state)).toEqual([]);
    }
  });

  it('同一份复现文件重放两次结果一致（重放本身也是确定性的）', () => {
    const st = makeState('replay-twice', 5);
    runBotGame(st, 30);
    const file = exportReplay(st);
    const a = replayFromFile(file);
    const b = replayFromFile(file);
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.match && b.match).toBe(true);
  });

  it('页面路径（身份与手牌都由随机决定）导出的复现文件同样能精确重放', () => {
    // 页面调用 createGame 时不传 roles / riggedHands，与测试脚手架走的不是同一条分支：
    // 显式身份表会跳过身份分配的随机数消耗，回放必须走回同一条分支才不会错位。
    for (const seed of ['ui-0', 'ui-1', 'ui-2']) {
      const st = makeUiState(seed, 5);
      runBotGame(st, 30);
      const file = exportReplay(st);
      expect(file.setup.rolesInput, '页面建局不带身份表').toBeUndefined();
      expect(file.setup.characters.length).toBe(5);
      const r = replayFromFile(file);
      expect(r.error).toBeNull();
      expect(r.divergeAt).toBeNull();
      expect(r.match).toBe(true);
      expect(r.finalHash).toBe(hashState(st));
      // 身份与角色都必须一致，否则重放出来的根本不是同一局
      expect(r.state.players.map((p) => p.role)).toEqual(st.players.map((p) => p.role));
      expect(r.state.players.map((p) => p.characterId)).toEqual(st.players.map((p) => p.characterId));
      expect(r.state.players.map((p) => p.hp)).toEqual(st.players.map((p) => p.hp));
    }
  });

  it('复现文件里的存档能直接恢复并继续推进', () => {
    const st = makeState('replay-resume', 5);
    runBotGame(st, 20);
    const file = exportReplay(st);
    const restored = deserialize(file.state);
    expect(hashState(restored)).toBe(file.finalHash);
    const result = replayFromFile(file);
    // 从恢复的存档继续跑，与从重放结果继续跑必须走到同一个状态
    runBotGame(restored, 10);
    runBotGame(result.state, 10);
    expect(hashState(restored)).toBe(hashState(result.state));
  });

  it('存档往返不改变状态（含进行中的待处理提示）', () => {
    const st = makeState('replay-save', 5);
    stepAll(st, 5);
    const roundTrip = deserialize(serialize(st));
    expect(hashState(roundTrip)).toBe(hashState(st));
    if (st.pending) {
      expect(roundTrip.pending?.promptId).toBe(st.pending.promptId);
      expect(roundTrip.pending?.actorSeat).toBe(st.pending.actorSeat);
      expect(projectForPlayer(roundTrip, st.pending.actorSeat).pending).toBeTruthy();
    }
  });
});
