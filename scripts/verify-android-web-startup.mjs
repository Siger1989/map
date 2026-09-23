/** Smoke-test the exact packaged web directory, not the development server. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { browserRuntime } from './browser-runtime.mjs';

const root = resolve(process.argv[2] ?? 'mobile/dist');
const screenshot = process.argv[3];
const mime = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
  '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.pbf': 'application/x-protobuf',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const inside = relative(root, file);
    if (inside.startsWith('..' + sep) || inside === '..') {
      response.writeHead(403).end();
      return;
    }
    const content = await readFile(file);
    response.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream');
    response.writeHead(200).end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser;
try {
  const chromium = browserRuntime().chromium;
  for (const options of [
    { headless: true },
    { headless: true, channel: 'chrome' },
    { headless: true, channel: 'msedge' },
  ]) {
    try { browser = await chromium.launch(options); break; } catch { /* try installed browser */ }
  }
  if (!browser) throw new Error('未找到可用的 Chromium、Chrome 或 Edge');
  const page = await browser.newPage({ viewport: { width: 390, height: 857 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? String(error)));
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const text = document.querySelector('#root')?.textContent ?? '';
    return text.includes('地图暂未启动') ||
      (text.includes('山兔') && text.includes('路线') && text.includes('收藏'));
  }, undefined, { timeout: 25000 });
  await page.waitForTimeout(1000);
  const state = await page.evaluate(() => ({
    text: document.querySelector('#root')?.textContent?.slice(0, 500) ?? '',
    diagnostic: document.querySelector('#root pre')?.textContent ?? '',
  }));
  if (state.text.includes('地图暂未启动') || errors.length)
    throw new Error([state.diagnostic || state.text, ...errors].filter(Boolean).join('\n'));
  if (!(state.text.includes('山兔') && state.text.includes('路线') && state.text.includes('收藏')))
    throw new Error(`主页未完成启动：${state.text}`);
  if (screenshot) await page.screenshot({ path: screenshot });
  console.log(`Android web startup OK: ${root}`);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
