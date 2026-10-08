import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesktopServer } from '../desktop-web/server.ts';
import { APP_VERSION } from '../config/product.ts';

const entryDir = dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'shantu-desktop-map';
const CONFIG_NAME = 'config.private.json';
const ALLOWED_GEOLOGY_KEYS = ['GEOCLOUD_TOKEN', 'GEOCLOUD_SERVICE', 'GEOCLOUD_LAYER'] as const;

type RuntimeConfig = { version: 1; geology?: Partial<Record<(typeof ALLOWED_GEOLOGY_KEYS)[number], string>> };

function parseArguments(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (!['--port', '--ready-file', '--web-root'].includes(name))
      throw new Error(`Unknown argument: ${name}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
    if (values.has(name)) throw new Error(`Duplicate argument: ${name}`);
    values.set(name, value);
  }
  const portText = values.get('--port') ?? '0';
  if (!/^\d+$/.test(portText)) throw new Error('--port must be an integer from 0 to 65535');
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('--port must be an integer from 0 to 65535');
  const readyFileArg = values.get('--ready-file');
  const webRootArg = values.get('--web-root');
  return {
    port,
    readyFile: readyFileArg ? resolve(readyFileArg) : undefined,
    webRoot: resolve(webRootArg ?? resolve(entryDir, 'web')),
  };
}

async function loadPrivateConfig() {
  const path = resolve(entryDir, CONFIG_NAME);
  for (const key of ALLOWED_GEOLOGY_KEYS) delete process.env[key];
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as RuntimeConfig;
    if (parsed.version !== 1 || !parsed.geology || typeof parsed.geology !== 'object' || Array.isArray(parsed.geology))
      throw new Error('Private runtime configuration has an unsupported format');
    for (const key of ALLOWED_GEOLOGY_KEYS) {
      const value = parsed.geology[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length > 4096 || /[\u0000\r\n]/.test(value))
        throw new Error('Private runtime configuration has an invalid value');
      process.env[key] = value;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

async function writeReadyFile(path: string, port: number) {
  const ready = {
    app: APP_NAME,
    version: APP_VERSION,
    port,
    url: `http://127.0.0.1:${port}/`,
    pid: process.pid,
  };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ready)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, path);
  return ready;
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const webStat = await stat(options.webRoot);
  if (!webStat.isDirectory()) throw new Error('--web-root must point to a directory');
  await access(options.webRoot);
  await loadPrivateConfig();

  const server = createDesktopServer(options.webRoot);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port, '127.0.0.1', () => {
      server.removeListener('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to resolve the local service port');
  const ready = options.readyFile ? await writeReadyFile(options.readyFile, address.port) : undefined;
  if (ready) process.stdout.write(`${JSON.stringify(ready)}\n`);

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      if (options.readyFile) void removeOwnedReadyFile(options.readyFile!);
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

async function removeOwnedReadyFile(path: string) {
  try {
    const ready = JSON.parse(await readFile(path, 'utf8')) as { pid?: number; app?: string };
    if (ready.pid === process.pid && ready.app === APP_NAME) await rm(path, { force: true });
  } catch {}
}

function writeStartupError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  process.stderr.write(`山兔桌面地图服务启动失败：${message}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void run().catch(writeStartupError);
