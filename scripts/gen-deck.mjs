// 从既有 104 张配牌表生成结构化实体牌目录。
// 输入：../八男杀-104张基础配牌表.csv
// 输出：src/content/deckData.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = resolve(here, '../../八男杀-104张基础配牌表.csv');
const outPath = resolve(here, '../src/content/deckData.ts');

const raw = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
const header = lines[0].split(',');
if (header.join(',') !== '牌副,编号,花色,点数,牌名,类型') {
  throw new Error('配牌表表头与预期不一致：' + header.join(','));
}

const RANK_MAP = { A: 1, J: 11, Q: 12, K: 13 };
const toRank = (s) => {
  if (RANK_MAP[s] !== undefined) return RANK_MAP[s];
  const n = Number(s);
  if (!Number.isInteger(n) || n < 2 || n > 10) throw new Error('非法点数：' + s);
  return n;
};

const rows = [];
for (let i = 1; i < lines.length; i++) {
  const cells = lines[i].split(',');
  if (cells.length !== 6) throw new Error('第 ' + (i + 1) + ' 行列数异常');
  const [deckNo, code, suit, rankText, name, typeText] = cells;
  rows.push({
    id: code,
    deck: Number(deckNo),
    suit,
    rank: toRank(rankText),
    rankLabel: rankText,
    name,
    type: typeText,
  });
}

if (rows.length !== 104) throw new Error('配牌表数量不是 104，实际 ' + rows.length);

const ids = new Set();
for (const r of rows) {
  if (ids.has(r.id)) throw new Error('编号重复：' + r.id);
  ids.add(r.id);
}

const byName = {};
for (const r of rows) byName[r.name] = (byName[r.name] ?? 0) + 1;

const banner = `// 本文件由 scripts/gen-deck.mjs 从「八男杀-104张基础配牌表.csv」生成，请勿手改。
// 每张实体牌保留唯一 cardId（编号），花色与点数成为结构化字段。
`;

const body = `${banner}
import type { CardInstance } from '@engine/types';

export const DECK_SIZE = ${rows.length};

export const BASE_DECK: CardInstance[] = [
${rows
  .map(
    (r) =>
      `  { id: ${JSON.stringify(r.id)}, deck: ${r.deck}, suit: ${JSON.stringify(r.suit)}, rank: ${
        r.rank
      }, name: ${JSON.stringify(r.name)}, type: ${JSON.stringify(r.type)} },`,
  )
  .join('\n')}
];

/** 牌名 -> 张数，用于守恒校验。 */
export const BASE_DECK_COUNTS: Record<string, number> = ${JSON.stringify(byName, null, 2)};
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, body, 'utf8');
console.log(`已生成 ${outPath}，共 ${rows.length} 张实体牌。`);
console.log(Object.entries(byName).map(([k, v]) => `${k}×${v}`).join('  '));
