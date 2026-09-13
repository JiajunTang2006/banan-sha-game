/**
 * 极简 ESM loader：让 scripts/*.mjs 能直接 import 引擎的 TS 源码。
 *
 * 需要处理两件事：
 *   1. tsconfig 里的路径别名（@engine / @content / @protocol / @bot）；
 *   2. 省略扩展名的相对导入（源码里写的是 `from './rng'`，Node ESM 要求显式扩展名）。
 * 类型剥离本身由 Node 22 的 --experimental-strip-types 负责。
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

const ROOT = resolvePath(fileURLToPath(new URL('..', import.meta.url)));

const ALIASES = {
  '@engine': 'src/engine',
  '@content': 'src/content',
  '@protocol': 'src/protocol',
  '@bot': 'src/bot',
};

/** 依次尝试 原样 / +.ts / 目录下的 index.ts。 */
function tryResolve(base) {
  const candidates = [base, base + '.ts', resolvePath(base, 'index.ts')];
  for (const c of candidates) {
    if (c.endsWith('.ts') && existsSync(c)) return pathToFileURL(c).href;
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  for (const [prefix, dir] of Object.entries(ALIASES)) {
    if (specifier === prefix || specifier.startsWith(prefix + '/')) {
      const url = tryResolve(resolvePath(ROOT, dir + specifier.slice(prefix.length)));
      if (url) return { url, shortCircuit: true };
    }
  }
  if ((specifier.startsWith('.') || specifier.startsWith('/')) && !/\.[cm]?[jt]s$/.test(specifier)) {
    const parent = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : ROOT;
    const url = tryResolve(resolvePath(parent, specifier));
    if (url) return { url, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
