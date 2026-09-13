import type { OptionDescriptor } from '@engine/types';

/**
 * 待处理提示的「提交入口」判定。
 *
 * 这段逻辑原本内联在弹层组件里，直接导致过两次同类缺陷：
 *   1. 只按 selectableCards 判断，导致「需要打出【闪】/【杀】」「无懈可击窗口」这类
 *      allowPass=true 且 minCards=0 的提示选完牌没有提交按钮；
 *   2. 完全没看 targetSeats，导致「【λ法】选择翻开者」「【火把】选择两名角色」
 *      这类纯选目标的提示根本无法提交，玩家只能干等倒计时。
 *
 * 因此把它抽成纯函数：判定只依赖提示描述与已选数量，便于逐条锁死。
 */
export interface PromptSubmitState {
  /** 是否必须渲染「确认」按钮。 */
  needConfirm: boolean;
  /** 「确认」是否可点。 */
  canConfirm: boolean;
  /** 确认时至少需要选中的牌数。 */
  minNeeded: number;
  /** 底部提示文案。 */
  hint: string;
}

export function promptSubmitState(opts: OptionDescriptor, selCount: number, targetCount: number): PromptSubmitState {
  const hasCards = opts.selectableCards.length > 0;
  const hasTargets = Boolean(opts.targetSeats && opts.targetSeats.length > 0);
  // 只要存在任意一类可选输入，就必须给出提交入口。
  const needConfirm = hasCards || hasTargets || opts.minCards > 0 || opts.minTargets > 0;
  // allowPass=true 时「放弃」已经承担了「一张都不选」的语义，
  // 因此「确认」至少要求选中一张，避免两个含义相同的空提交并存。
  const minNeeded = hasCards && opts.allowPass ? Math.max(1, opts.minCards) : opts.minCards;
  const targetOk = targetCount >= opts.minTargets && targetCount <= opts.maxTargets;
  const canConfirm = selCount >= minNeeded && selCount <= opts.maxCards && targetOk;
  const hint = hasCards
    ? `需要选择 ${minNeeded}—${opts.maxCards} 项${opts.allowPass ? '，或放弃' : ''}`
    : hasTargets
      ? `需要选择 ${opts.minTargets}—${opts.maxTargets} 名角色`
      : '';
  return { needConfirm, canConfirm, minNeeded, hint };
}

/**
 * 目标座位的点选结果。
 * 单选提示（例如【λ法】的翻开者）下直接换选到新目标，省掉「先取消再选」的一步，
 * 与卡牌的点选行为保持一致。
 */
export function toggleTarget(prev: number[], seat: number, maxTargets: number): number[] {
  if (prev.includes(seat)) return prev.filter((x) => x !== seat);
  if (prev.length >= maxTargets) return maxTargets === 1 ? [seat] : prev;
  return [...prev, seat];
}
