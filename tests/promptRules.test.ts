import { describe, expect, it } from 'vitest';
import { promptSubmitState, toggleTarget } from '../src/web/promptRules';
import type { OptionDescriptor } from '@engine/types';

/** 按需覆盖字段构造提示描述，未指定的部分取「无输入」默认值。 */
function opts(over: Partial<OptionDescriptor> = {}): OptionDescriptor {
  return {
    selectableCards: [],
    minCards: 0,
    maxCards: 0,
    targetSeats: null,
    minTargets: 0,
    maxTargets: 0,
    skills: [],
    enumOptions: [],
    asNames: [],
    allowPass: true,
    passLabel: '放弃',
    ...over,
  };
}

const cards = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ cardId: `c${i}`, name: '闪', suit: '♠' as const, rank: 1, from: 'hand' as const }));

/**
 * 弹层提交入口的回归测试。
 *
 * 这两类缺陷都真实发生过：
 *   - 只按 selectableCards 判断 → 「需要打出【闪】」选完牌没有确认按钮；
 *   - 完全没看 targetSeats → 「【λ法】选择翻开者」根本提交不了。
 */
describe('提示提交入口', () => {
  it('需要打出【闪】：有可选的牌就必须能提交', () => {
    const o = opts({ selectableCards: cards(2), minCards: 0, maxCards: 1, allowPass: true });
    const none = promptSubmitState(o, 0, 0);
    expect(none.needConfirm, '曾经这里没有确认按钮').toBe(true);
    expect(none.canConfirm, '一张都没选时不可提交').toBe(false);
    expect(promptSubmitState(o, 1, 0).canConfirm).toBe(true);
    expect(none.hint).toContain('或放弃');
  });

  it('无懈可击窗口：允许放弃，选中一张后可确认', () => {
    const o = opts({ selectableCards: cards(1), minCards: 0, maxCards: 1, allowPass: true, passLabel: '不使用' });
    expect(promptSubmitState(o, 0, 0).needConfirm).toBe(true);
    expect(promptSubmitState(o, 1, 0).canConfirm).toBe(true);
  });

  it('弃牌阶段：必须选满指定张数才能确认', () => {
    const o = opts({ selectableCards: cards(6), minCards: 4, maxCards: 4, allowPass: false, passLabel: '确认弃置' });
    const s = promptSubmitState(o, 3, 0);
    expect(s.needConfirm).toBe(true);
    expect(s.canConfirm).toBe(false);
    expect(s.minNeeded, '不允许放弃时按下限判定').toBe(4);
    expect(promptSubmitState(o, 4, 0).canConfirm).toBe(true);
    expect(promptSubmitState(o, 5, 0).canConfirm, '超过上限不可提交').toBe(false);
    expect(s.hint).not.toContain('或放弃');
  });

  it('【λ法】选择翻开者：纯选目标的提示必须有确认入口', () => {
    const o = opts({ targetSeats: [1, 2, 3, 4], minTargets: 1, maxTargets: 1, allowPass: false, passLabel: '确认' });
    const none = promptSubmitState(o, 0, 0);
    expect(none.needConfirm, '回归点：曾经这个提示连确认按钮都不渲染').toBe(true);
    expect(none.hint).toContain('1—1 名角色');
    expect(none.canConfirm).toBe(false);
    expect(promptSubmitState(o, 0, 1).canConfirm).toBe(true);
    expect(promptSubmitState(o, 0, 2).canConfirm, '单选提示不能提交两个目标').toBe(false);
  });

  it('【火把】选择两名角色：选够两个才能确认', () => {
    const o = opts({ targetSeats: [0, 1, 2, 3, 4], minTargets: 2, maxTargets: 2, allowPass: false });
    expect(promptSubmitState(o, 0, 1).canConfirm).toBe(false);
    expect(promptSubmitState(o, 0, 2).canConfirm).toBe(true);
  });

  it('同时需要选牌与选目标时，两类输入都要满足', () => {
    const o = opts({ selectableCards: cards(2), minCards: 1, maxCards: 1, targetSeats: [1, 2], minTargets: 1, maxTargets: 1, allowPass: false });
    expect(promptSubmitState(o, 1, 0).canConfirm).toBe(false);
    expect(promptSubmitState(o, 0, 1).canConfirm).toBe(false);
    expect(promptSubmitState(o, 1, 1).canConfirm).toBe(true);
    expect(promptSubmitState(o, 1, 1).hint, '有牌可选的提示以选牌为主').toContain('项');
  });

  it('空提示（无牌无目标且可以放弃）只保留放弃按钮', () => {
    const o = opts({ minCards: 0, allowPass: true });
    const s = promptSubmitState(o, 0, 0);
    expect(s.needConfirm).toBe(false);
    expect(s.hint).toBe('');
  });

  it('濒死无牌可救时依然只显示「不救」', () => {
    const o = opts({ minCards: 0, maxCards: 1, allowPass: true, passLabel: '不救' });
    expect(promptSubmitState(o, 0, 0).needConfirm).toBe(false);
  });
});

describe('目标座位点选', () => {
  it('单选提示下直接换选到新目标', () => {
    expect(toggleTarget([], 1, 1)).toEqual([1]);
    expect(toggleTarget([1], 2, 1), '不用先取消').toEqual([2]);
  });

  it('再次点击同一个目标等于取消', () => {
    expect(toggleTarget([2], 2, 1)).toEqual([]);
  });

  it('多选提示不能超过上限', () => {
    expect(toggleTarget([1, 2], 3, 2)).toEqual([1, 2]);
    expect(toggleTarget([1], 2, 2)).toEqual([1, 2]);
  });

  it('多选提示里取消其中一个不影响其他选择', () => {
    expect(toggleTarget([1, 2, 3], 2, 3)).toEqual([1, 3]);
  });
});
