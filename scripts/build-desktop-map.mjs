import { build as bundle } from 'esbuild';
import { build as viteBuild, loadEnv } from 'vite';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const logDir = resolve(root, '.openai');
await mkdir(logDir, { recursive: true });
const startedAt = new Date().toISOString().replaceAll(':', '-');
const logPath = resolve(logDir, `desktop-map-build-${startedAt}.log`);
const logLines = [];

function log(value) {
  logLines.push(value);
}

function parseArgs(args) {
  let outDir;
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '--out-dir') throw new Error(`Unknown argument: ${args[index]}`);
    if (outDir !== undefined) throw new Error('Duplicate --out-dir');
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error('--out-dir requires a path');
    outDir = value;
  }
  return resolve(root, outDir ?? 'EXE/山兔桌面/resources/map-runtime');
}

function assertBoundedOutput(path) {
  const relativePath = relative(root, path);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
    throw new Error('--out-dir must be a child of the project root');
  if (relativePath.split(sep).some((part) => part === '..'))
    throw new Error('--out-dir contains an unsafe parent segment');
}

async function walkFiles(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path, base));
    else if (entry.isFile()) files.push({ path, relative: relative(base, path).replaceAll('\\', '/') });
  }
  return files;
}

async function main() {
  const outputRoot = parseArgs(process.argv.slice(2));
  assertBoundedOutput(outputRoot);
  const webRoot = resolve(outputRoot, 'web');
  const nodePath = resolve(outputRoot, 'node.exe');
  const serverPath = resolve(outputRoot, 'server.mjs');
  const privateConfigPath = resolve(outputRoot, 'config.private.json');
  const seedSource = resolve(root, '.openai/default-map-sources-private.json');
  const seedTarget = resolve(webRoot, 'native/default-map-sources.json');
  const viteConfig = resolve(root, 'mobile/vite.config.ts');
  const versionSource = await readFile(resolve(root, 'config/product.ts'), 'utf8');
  const version = versionSource.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];
  if (!version) throw new Error('APP_VERSION could not be read from config/product.ts');

  const seedBytes = await readFile(seedSource);
  const seedManifest = JSON.parse(seedBytes.toString('utf8'));
  if (seedManifest.version !== 1 || !Array.isArray(seedManifest.maps) || seedManifest.maps.length < 1 || seedManifest.maps.length > 100)
    throw new Error('The local private map seed must be version 1 and contain 1 to 100 maps');
  const env = loadEnv('apk-preview', root, '');
  const tiandituKey = env.NEXT_PUBLIC_TIANDITU_KEY?.trim() ?? '';
  if (!tiandituKey) throw new Error('The local Tianditu key is unavailable for the private desktop build');

  const geology = {};
  for (const name of ['GEOCLOUD_TOKEN', 'GEOCLOUD_SERVICE', 'GEOCLOUD_LAYER']) {
    const value = env[name]?.trim();
    if (value) geology[name] = value;
  }
  const privateConfig = { version: 1, geology };

  await mkdir(webRoot, { recursive: true });
  await viteBuild({
    configFile: viteConfig,
    mode: 'apk-preview',
    logLevel: 'silent',
    build: { outDir: webRoot, emptyOutDir: true, sourcemap: false },
  });
  await mkdir(dirname(seedTarget), { recursive: true });
  await writeFile(seedTarget, seedBytes);
  await bundle({
    entryPoints: [resolve(root, 'desktop-app/map_runtime.ts')],
    outfile: serverPath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    alias: { '@': root },
    define: { 'process.env.SHANTU_SERVER_LIBRARY': '"1"' },
    logLevel: 'silent',
  });
  const shellTheme = resolve(root, 'desktop-app/shell/theme.ts');
  const shellThemeOutput = resolve(webRoot, 'desktop-theme.js');
  try {
    await readFile(shellTheme);
  } catch (error) {
    if ((error).code !== 'ENOENT') throw error;
  }
  await bundle({
    entryPoints: [shellTheme],
    outfile: shellThemeOutput,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    alias: { '@': root },
    logLevel: 'silent',
  });
  await writeFile(privateConfigPath, `${JSON.stringify(privateConfig)}\n`, { encoding: 'utf8', mode: 0o600 });
  await copyFile(process.execPath, nodePath);

  const webSeed = JSON.parse(await readFile(seedTarget, 'utf8'));
  const webFiles = await walkFiles(webRoot);
  const javascript = await Promise.all(webFiles.filter((item) => /\.m?js$/i.test(item.relative))
    .map((item) => readFile(item.path, 'utf8')));
  const keyEmbedded = javascript.some((content) => content.includes(tiandituKey));
  if (!keyEmbedded) throw new Error('The local Tianditu key was not found in the generated web assets');
  const privateWritten = JSON.parse(await readFile(privateConfigPath, 'utf8'));
  const nodeInfo = await readFile(nodePath);
  const geologyConfigMatches = ['GEOCLOUD_TOKEN', 'GEOCLOUD_SERVICE', 'GEOCLOUD_LAYER']
    .every((name) => (env[name]?.trim() ?? '') === (privateWritten.geology?.[name] ?? ''));
  const sourceSeedSha256 = createHash('sha256').update(seedBytes).digest('hex');
  const outputSeedSha256 = createHash('sha256').update(await readFile(seedTarget)).digest('hex');
  const result = {
    app: 'shantu-desktop-map-build', version,
    outputRoot,
    webFiles: webFiles.length,
    nodeBytes: nodeInfo.byteLength,
    seedCount: webSeed.maps.length,
    seedCountMatches: seedManifest.maps.length === webSeed.maps.length,
    seedBytesMatch: sourceSeedSha256 === outputSeedSha256,
    tiandituKeyPresent: Boolean(tiandituKey),
    tiandituKeyEmbedded: keyEmbedded,
    geocloudTokenPresent: Boolean(privateWritten.geology?.GEOCLOUD_TOKEN),
    geocloudServicePresent: Boolean(privateWritten.geology?.GEOCLOUD_SERVICE),
    geocloudLayerPresent: Boolean(privateWritten.geology?.GEOCLOUD_LAYER),
    geologyConfigMatches,
  };
  if (!result.seedCountMatches || !result.seedBytesMatch || !result.tiandituKeyEmbedded || !result.geologyConfigMatches || !nodeInfo.byteLength)
    throw new Error('Desktop map artifact consistency check failed');
  log(JSON.stringify(result, null, 2));
  return result;
}

try {
  const result = await main();
  await writeFile(logPath, `${logLines.join('\n')}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...result, buildLog: logPath }, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown desktop map build failure';
  log(`FAILED: ${message}`);
  await writeFile(logPath, `${logLines.join('\n')}\n`, 'utf8');
  process.stderr.write(`Desktop map build failed; details saved under .openai. ${message}\n`);
  process.exitCode = 1;
}
