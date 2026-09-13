import type { Frame, GameState, OptionDescriptor, Pending, StepOutcome } from './types';

/* ------------------------------------------------------------------ */
/* 驱动注册表                                                          */
/* ------------------------------------------------------------------ */

export interface DriverCtx {
  state: GameState;
  frame: Frame;
}

export type Driver = (ctx: DriverCtx) => StepOutcome;

/** 各类结算帧的驱动函数。由 drivers/index.ts 在模块加载时注册。 */
export const DRIVERS: Record<string, Driver> = {};

/* ------------------------------------------------------------------ */
/* 帧构造                                                              */
/* ------------------------------------------------------------------ */

export function makeFrame(kind: string, step: string, data: Record<string, any> = {}, opts: { returnKey?: string; note?: string } = {}): Frame {
  return {
    id: 'f?',
    kind,
    step,
    data,
    returnKey: opts.returnKey,
    note: opts.note,
  };
}

/** 入栈前分配稳定 id。 */
export function assignFrameId(state: GameState, frame: Frame): Frame {
  if (frame.id === 'f?') frame.id = `f${++state.frameSeq}`;
  return frame;
}

let promptCounter = 0;

export function makePending(
  state: GameState,
  frame: Frame,
  partial: Omit<Pending, 'promptId' | 'revision' | 'frameId'>,
): Pending {
  // 每次产生提示都让 revision 前进，保证“迟到回答”被判为过期。
  const prev = state.pending;
  const revision = prev && prev.frameId === frame.id ? prev.revision + 1 : 1;
  const promptId = `p${++state.promptSeq}`;
  promptCounter++;
  return { ...partial, promptId, revision, frameId: frame.id };
}

export function emptyOptions(over: Partial<OptionDescriptor> = {}): OptionDescriptor {
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

/* ------------------------------------------------------------------ */
/* 推进循环                                                            */
/* ------------------------------------------------------------------ */

export class TechPauseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TechPauseError';
  }
}

export const MAX_STEPS = 4000;

/**
 * 自动推进，直到产生待选项、结算栈为空或对局结束。
 * 超过步骤预算进入“技术暂停”，不悄悄跳过技能或判某阵营胜利。
 * 同时监测重复状态：连续出现相同状态说明存在无进展循环。
 */
export function pump(state: GameState): void {
  let steps = 0;
  while (state.pending === null && state.stack.length > 0 && state.status !== 'finished') {
    if (++steps > MAX_STEPS) {
      const top = state.stack[state.stack.length - 1];
      state.status = 'techPause';
      state.techPause = {
        frameKind: top.kind,
        frameStep: top.step,
        steps,
        detail: `自动推进超过 ${MAX_STEPS} 步仍未到达稳定等待点。`,
      };
      state.stack = [];
      return;
    }
    const frame = state.stack[state.stack.length - 1];
    const driver = DRIVERS[frame.kind];
    if (!driver) {
      state.status = 'techPause';
      state.techPause = { frameKind: frame.kind, frameStep: frame.step, steps, detail: '缺少结算帧驱动：' + frame.kind };
      state.stack = [];
      return;
    }
    let outcome: StepOutcome;
    try {
      outcome = driver({ state, frame });
    } catch (err) {
      state.status = 'techPause';
      state.techPause = {
        frameKind: frame.kind,
        frameStep: frame.step,
        steps,
        detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      };
      state.stack = [];
      return;
    }
    switch (outcome.t) {
      case 'next':
        break;
      case 'push':
        state.stack.push(assignFrameId(state, outcome.frame));
        break;
      case 'replace':
        assignFrameId(state, outcome.frame);
        state.stack[state.stack.length - 1] = outcome.frame;
        break;
      case 'done': {
        const child = state.stack.pop()!;
        const parent = state.stack[state.stack.length - 1];
        if (parent) {
          const key = child.returnKey ?? '_child';
          parent.data[key] = outcome.result === undefined ? true : outcome.result;
        }
        break;
      }
      case 'wait':
        state.pending = outcome.pending;
        break;
      default:
        break;
    }
  }
}

/** 便捷：以子帧形式 push，并让父帧在子帧结束后收到结果。 */
export function child(kind: string, step: string, data: Record<string, any>, returnKey: string, note?: string): StepOutcome {
  return { t: 'push', frame: makeFrame(kind, step, data, { returnKey, note }) };
}
