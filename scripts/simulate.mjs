#!/usr/bin/env node
/**
 * 命令行验收跑批。
 *
 * 与 tests/simulation.test.ts 跑的是同一套逻辑，但结论直接打印成报告，
 * 便于在没有测试框架的环境里复核「固定种子自对局 + 复现重放」这两条验收。
 *
 * 用法：
 *   node scripts/simulate.mjs                 # 默认 200 局
 *   node scripts/simulate.mjs 500            # 指定局数
 *   node scripts/simulate.mjs 200 --replay   # 顺带对前 10 局做复现重放校验
 */
import { register } from 'node:module';

// 直接以 TS 源码运行：借助 Node 自带的类型剥离 + 路径别名映射
// 第二个参数是父模块 URL，必须以本文件为基准，否则相对路径会解析到上一级目录。
register('./ts-alias-loader.mjs', import.meta.url);

const { completeDraft, createGame, initDraft } = await import('@engine/setup');
const { checkInvariants, exportReplay, hashState, replayFromFile } = await import('@engine/engine');
const { runBotGame } = await import('../src/runner/localGame.ts');

const args = process.argv.slice(2);
const games = Number(args.find((a) => /^\d+$/.test(a)) ?? 200);
const withReplay = args.includes('--replay');
const MAX_TURNS = 120;

let finished = 0;
let capped = 0;
const problems = [];

for (let i = 0; i < games; i++) {
  const seed = `soak-${i}`;
  const n = 4 + (i % 5);
  const draft = initDraft(seed, n, 0);
  const chars = completeDraft(draft, draft.offer.options[0]);
  const { state } = createGame({ seed, playerCount: n, selfSeat: 0, characters: chars });
  runBotGame(state, MAX_TURNS);

  if (state.status === 'techPause') problems.push(`${seed}(${n}人) 技术暂停：${state.techPause?.detail ?? ''}`);
  else if (state.status === 'finished') finished += 1;
  else capped += 1;
  if (state.status === 'running' && !state.pending) problems.push(`${seed}(${n}人) 运行中却没有待处理提示`);
  const errs = checkInvariants(state).filter((e) => !e.includes('存活但体力'));
  if (errs.length > 0) problems.push(`${seed}(${n}人) 不变量：${errs[0]}`);
}

console.log(`自对局：共 ${games} 局`);
console.log(`  正常结束      ${finished}`);
console.log(`  达到操作上限  ${capped}（上限 ${MAX_TURNS} 回合）`);
console.log(`  技术暂停 / 不变量 / 悬空状态  ${problems.length}`);
for (const p of problems.slice(0, 10)) console.log(`    - ${p}`);

if (withReplay) {
  console.log('\n复现重放校验（前 10 局）：');
  let ok = 0;
  for (let i = 0; i < Math.min(10, games); i++) {
    const seed = `soak-${i}`;
    const n = 4 + (i % 5);
    const draft = initDraft(seed, n, 0);
    const chars = completeDraft(draft, draft.offer.options[0]);
    const { state } = createGame({ seed, playerCount: n, selfSeat: 0, characters: chars });
    runBotGame(state, MAX_TURNS);
    const before = hashState(state);
    const file = exportReplay(state);
    const r = replayFromFile(file);
    const pass = r.match && r.finalHash === before && r.error === null;
    if (pass) ok += 1;
    else console.log(`    - ${seed} 失败：error=${r.error} divergeAt=${r.divergeAt} hash=${r.finalHash} != ${before}`);
  }
  console.log(`  哈希一致的局数  ${ok} / ${Math.min(10, games)}`);
}

process.exit(problems.length === 0 ? 0 : 1);
