import { spawn } from 'node:child_process';
import {
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { build } from 'esbuild';
import { loadEnv } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const logs = resolve(root, '.openai');
mkdirSync(logs, { recursive: true });
const listening = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1200);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
const digest = (data) => createHash('sha256').update(data).digest('hex');
const logo = digest(
  readFileSync(resolve(root, 'public/brand/shantu-logo.png')),
);
const apiBundle = resolve(logs, 'web-layout-api/server.mjs');
mkdirSync(resolve(logs, 'web-layout-api'), { recursive: true });
await build({
  entryPoints: [resolve(root, 'tools/layout-editor/api.ts')],
  outfile: apiBundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias: { '@': root },
  define: {
    'process.env.SHANTU_SERVER_LIBRARY': '"1"',
    'process.env.SHANTU_NO_OPEN': '"1"',
  },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
const childEnv = {
  ...process.env,
  ...loadEnv('development', root, ''),
  SHANTU_LAYOUT_ROOT: root,
  SHANTU_SERVER_LIBRARY: '1',
  SHANTU_NO_OPEN: '1',
};
async function ours(service) {
  try {
    const response = await fetch(
      `http://127.0.0.1:${service.port}${service.check}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) return false;
    return service.name === 'layout'
      ? (await response.text()).includes('山兔 · 布局调节窗口')
      : digest(Buffer.from(await response.arrayBuffer())) === logo;
  } catch {
    return false;
  }
}
const services = [
  {
    name: 'api',
    port: 3108,
    check: '/brand/shantu-logo.png',
    args: [apiBundle],
  },
  {
    name: 'layout',
    port: 9241,
    check: '/__layout',
    args: [
      'node_modules/vite/bin/vite.js',
      '--config',
      'mobile/vite.config.ts',
      '--host',
      '127.0.0.1',
      '--port',
      '9241',
      '--strictPort',
    ],
  },
];
const state = [];
for (const service of services) {
  if (await listening(service.port)) {
    if (!(await ours(service)))
      throw Error(`端口${service.port}由其他服务占用；未终止服务或切换端口。`);
    state.push({ name: service.name, port: service.port, reused: true });
    continue;
  }
  const stamp = Date.now();
  const output = openSync(
    resolve(logs, `layout-${service.name}-${stamp}-out.log`),
    'a',
  );
  const error = openSync(
    resolve(logs, `layout-${service.name}-${stamp}-error.log`),
    'a',
  );
  const child = spawn(process.execPath, service.args, {
    cwd: root,
    env: childEnv,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', output, error],
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  closeSync(output);
  closeSync(error);
  state.push({
    name: service.name,
    port: service.port,
    pid: child.pid,
    startedAt: new Date().toISOString(),
  });
}
writeFileSync(
  resolve(logs, 'layout-server-state.log'),
  JSON.stringify(state, null, 2),
);
for (const service of services) {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await listening(service.port)) && (await ours(service))) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready)
    throw Error(
      `${service.name}启动未确认，请检查.openai/layout-${service.name}-*-error.log。`,
    );
}
console.log('布局控制器已就绪：http://127.0.0.1:9241/__layout');
console.log(JSON.stringify(state));
