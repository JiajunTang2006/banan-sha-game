#!/usr/bin/env node
/**
 * 单机 Demo 的本地启动入口。
 *
 * 以 HTTP 方式提供 dist/ 静态产物；模块、Worker 与 IndexedDB 都需要 HTTP/HTTPS 环境，
 * 因此不承诺双击 HTML 文件即可运行全部功能。
 *
 * 用法：
 *   node scripts/serve.mjs            # 只监听本机回环地址
 *   node scripts/serve.mjs --lan      # 监听 0.0.0.0，局域网内其他设备可访问
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');

const args = process.argv.slice(2);
const lan = args.includes('--lan');
const port = Number(process.env.PORT ?? args.find((a) => /^\d+$/.test(a)) ?? 3000);
const host = lan ? '0.0.0.0' : (process.env.HOST ?? '127.0.0.1');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'banan-sha-demo', version: '0.1.0' }));
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = join(dist, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(dist) || !(await exists(file))) {
      // 单页应用回退
      const fallback = join(dist, 'index.html');
      if (await exists(fallback)) {
        res.writeHead(200, { 'content-type': MIME['.html'] });
        res.end(await readFile(fallback));
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('500 ' + (err instanceof Error ? err.message : String(err)));
  }
});

function localAddresses() {
  const out = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address);
    }
  }
  return out;
}

if (!(await exists(join(dist, 'index.html')))) {
  console.error('未找到 dist/index.html，请先运行：npm run build');
  process.exit(1);
}

server.listen(port, host, () => {
  console.log('');
  console.log('  八男杀 Demo 已启动');
  console.log('  ─────────────────────────────');
  console.log(`  本机：      http://127.0.0.1:${port}`);
  if (lan) {
    for (const a of localAddresses()) console.log(`  局域网：    http://${a}:${port}`);
    console.log('  提示：其他设备请使用局域网地址，不能使用 localhost。');
  }
  console.log('  健康检查：  /healthz');
  console.log('  按 Ctrl+C 停止服务。');
  console.log('');
});
