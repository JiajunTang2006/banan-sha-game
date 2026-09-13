import type { RngState } from './types';

/**
 * 确定性随机源：xoshiro128**。
 * 状态完全序列化在 GameState 中，因此“同一初始状态 + 同一命令序列”必然得到同一结果。
 * 引擎不调用 Math.random()。
 */

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function cloneRng(r: RngState): RngState {
  return { s: [r.s[0], r.s[1], r.s[2], r.s[3]] };
}

/** 从字符串生成初始随机状态（SplitMix32）。 */
export function rngFromSeed(seed: string): RngState {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
  const s: [number, number, number, number] = [next(), next(), next(), next()];
  if (s.every((v) => v === 0)) s[0] = 0x9e3779b9;
  return { s };
}

export function rngNext(r: RngState): number {
  const s = r.s;
  const result = (Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] ^= s[0];
  s[3] ^= s[1];
  s[1] ^= s[2];
  s[0] ^= s[3];
  s[2] ^= t;
  s[3] = rotl(s[3], 11);
  return result >>> 0;
}

/** 返回 [0, 1) 的浮点数。 */
export function rngFloat(r: RngState): number {
  return rngNext(r) / 4294967296;
}

/** 返回 [0, n) 的整数。 */
export function rngInt(r: RngState, n: number): number {
  if (n <= 0) throw new Error('rngInt 的 n 必须为正数');
  return Math.floor(rngFloat(r) * n) % n;
}

/** 原地 Fisher-Yates 洗牌。 */
export function rngShuffle<T>(r: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(r, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** 不放回抽取 count 个元素（返回新数组，原数组不变）。 */
export function rngSample<T>(r: RngState, arr: readonly T[], count: number): T[] {
  const pool = arr.slice();
  const out: T[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = rngInt(r, pool.length);
    out.push(pool[j]);
    pool.splice(j, 1);
  }
  return out;
}

/**
 * 电脑策略专用随机源：与牌堆随机分开，避免调整电脑策略的随机次数
 * 改变后续发牌顺序。
 */
export function botRng(r: RngState): RngState {
  return rngFromSeed('bot::' + r.s.join('-'));
}
