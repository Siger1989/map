import { build as bundle } from 'esbuild';
import { zipSync } from 'fflate';
import { loadEnv } from 'vite';
import {
  copyFile,
  open,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SEED = 'native/default-map-sources.json';
const PRIVATE_SEED_PATH = resolve(root, '.openai', 'default-map-sources-private.json');
const TEXT_ASSET = /\.(?:json|m?js|html|css)$/i;

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--public') {
      if (values.has('public')) throw new Error('--public may only be specified once');
      values.set('public', true);
      continue;
    }
    if (!['--web-dir', '--runtime-dir', '--out-dir', '--node-version'].includes(arg))
      throw new Error(`Unknown argument: ${arg}`);
    if (values.has(arg)) throw new Error(`${arg} may only be specified once`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values.set(arg, value);
    index += 1;
  }
  for (const required of ['--web-dir', '--runtime-dir'])
    if (!values.has(required)) throw new Error(`Required argument: ${required}`);
  const nodeVersion = values.get('--node-version');
  if (!nodeVersion) throw new Error('Required argument: --node-version');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(nodeVersion))
    throw new Error('--node-version must be a version such as 22.13.0');
  return {
    webDir: resolve(values.get('--web-dir')),
    runtimeDir: resolve(values.get('--runtime-dir')),
    outDir: resolve(values.get('--out-dir') ?? resolve(root, 'EXE')),
    nodeVersion,
    visibility: values.has('public') ? 'public' : 'private',
  };
}

async function requireRegularFile(path, label) {
  const info = await lstat(path).catch(() => null);
  if (!info || info.isSymbolicLink() || !info.isFile())
    throw new Error(`${label} must be an existing regular file (symlinks are refused): ${path}`);
}

async function requireDirectory(path, label) {
  const info = await lstat(path).catch(() => null);
  if (!info || info.isSymbolicLink() || !info.isDirectory())
    throw new Error(`${label} must be an existing directory (symlinks are refused): ${path}`);
}

async function rejectSymlinkParents(rootDir, path) {
  const parts = relative(rootDir, path).split(sep).filter(Boolean);
  let current = rootDir;
  for (const part of parts) {
    current = resolve(current, part);
    const info = await lstat(current).catch(() => null);
    if (info?.isSymbolicLink()) throw new Error(`Symlinks are refused: ${current}`);
  }
}

async function readMachOHeader(path) {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(8);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function walkRegularFiles(dir, relativeTo = dir) {
  await requireDirectory(dir, 'Input directory');
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Symlinks are refused: ${path}`);
    if (info.isDirectory()) files.push(...(await walkRegularFiles(path, relativeTo)));
    else if (info.isFile()) files.push({ path, name: relative(relativeTo, path).split(sep).join('/') });
    else throw new Error(`Unsupported filesystem entry: ${path}`);
  }
  return files;
}

function isValidPrivateSeed(bytes) {
  try {
    const seed = JSON.parse(bytes.toString('utf8'));
    return bytes.byteLength <= 1024 * 1024 && seed && seed.version === 1 &&
      Array.isArray(seed.maps) && seed.maps.length >= 1 && seed.maps.length <= 100 &&
      seed.maps.every((item) => item && typeof item === 'object' && !Array.isArray(item)) &&
      (seed.legacyMapCount === undefined ||
        (Number.isInteger(seed.legacyMapCount) && seed.legacyMapCount >= 0 && seed.legacyMapCount <= seed.maps.length));
  } catch {
    return false;
  }
}

function collectStrings(value, strings = []) {
  if (typeof value === 'string') strings.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, strings);
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) collectStrings(item, strings);
  return strings;
}

function collectSeedQuerySecrets(seedBytes) {
  const seed = JSON.parse(seedBytes.toString('utf8'));
  const secrets = new Set();
  for (const value of collectStrings(seed)) {
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      let url;
      try { url = new URL(match[0]); } catch { continue; }
      for (const pair of url.search.slice(1).split('&')) {
        if (!pair) continue;
        const separator = pair.indexOf('=');
        const rawName = separator < 0 ? pair : pair.slice(0, separator);
        const rawValue = separator < 0 ? '' : pair.slice(separator + 1);
        let name, decoded;
        try {
          name = decodeURIComponent(rawName.replaceAll('+', ' '));
          decoded = decodeURIComponent(rawValue.replaceAll('+', ' '));
        } catch { continue; }
        if (!/^(?:tk|key|token|apikey|access_token)$/i.test(name) || !decoded) continue;
        secrets.add(rawValue);
        secrets.add(decoded);
        secrets.add(encodeURIComponent(decoded));
        secrets.add(encodeURIComponent(decoded).toLowerCase());
      }
    }
  }
  return [...secrets].filter(Boolean);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const options = parseArgs(process.argv.slice(2));
const productSource = await readFile(resolve(root, 'config/product.ts'), 'utf8');
const version = productSource.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];
if (!version) throw new Error('APP_VERSION could not be read from config/product.ts');

await requireDirectory(options.webDir, '--web-dir');
await requireDirectory(options.runtimeDir, '--runtime-dir');
const webFiles = await walkRegularFiles(options.webDir);
if (!webFiles.some(({ name }) => name === 'index.html'))
  throw new Error('--web-dir must contain the built index.html');
const seedFile = webFiles.find(({ name }) => name === SEED);
if (options.visibility === 'private') {
  if (!seedFile || !isValidPrivateSeed(await readFile(seedFile.path)))
    throw new Error(`Private builds require a valid ${SEED} in --web-dir`);
} else if (seedFile) {
  throw new Error(`Public builds refuse the private ${SEED} asset`);
}

const previewEnv = loadEnv('apk-preview', root, '');
const tiandituKey = String(previewEnv.NEXT_PUBLIC_TIANDITU_KEY ?? '').trim();
const geocloudToken = String(previewEnv.GEOCLOUD_TOKEN ?? '').trim();
let localPrivateSeed;
try {
  const info = await lstat(PRIVATE_SEED_PATH);
  if (info.isSymbolicLink() || !info.isFile())
    throw new Error('Local private map-source seed is not a regular file.');
  localPrivateSeed = await readFile(PRIVATE_SEED_PATH);
} catch (error) {
  if (error?.code !== 'ENOENT' || options.visibility === 'private')
    throw new Error('Local private map-source seed is unavailable; credential checks cannot run.');
}
let seedQuerySecrets;
if (localPrivateSeed) {
  if (!isValidPrivateSeed(localPrivateSeed))
    throw new Error('Local private map-source seed is invalid; credential checks cannot run.');
  try {
    seedQuerySecrets = collectSeedQuerySecrets(localPrivateSeed);
  } catch {
    throw new Error('Local private map-source seed is invalid; credential checks cannot run.');
  }
} else {
  seedQuerySecrets = [];
}
if (options.visibility === 'private') {
  if (!tiandituKey) throw new Error('Private builds require the configured Tianditu key.');
  if (geocloudToken)
    throw new Error('Mac packaging does not support the configured Geocloud token; refusing to omit it.');
  if (!localPrivateSeed || !seedFile || !Buffer.from(await readFile(seedFile.path)).equals(localPrivateSeed))
    throw new Error('Private web seed does not exactly match the local private seed.');
  const javascriptFiles = webFiles.filter(({ name }) => /\.m?js$/i.test(name));
  let keyFound = false;
  for (const file of javascriptFiles) {
    if ((await readFile(file.path, 'utf8')).includes(tiandituKey)) {
      keyFound = true;
      break;
    }
  }
  if (!keyFound) throw new Error('Private web JavaScript does not contain the configured Tianditu key.');
} else {
  const knownSecrets = [tiandituKey, geocloudToken, ...seedQuerySecrets].filter(Boolean);
  for (const file of webFiles.filter(({ name }) => TEXT_ASSET.test(name))) {
    const contents = await readFile(file.path, 'utf8');
    if (knownSecrets.some((secret) => contents.includes(secret)))
      throw new Error('Public web assets contain locally configured credential material.');
  }
}

const runtimes = [
  { arch: 'arm64', source: resolve(options.runtimeDir, 'darwin-arm64', 'bin', 'node'), license: resolve(options.runtimeDir, 'darwin-arm64', 'LICENSE') },
  { arch: 'x64', source: resolve(options.runtimeDir, 'darwin-x64', 'bin', 'node'), license: resolve(options.runtimeDir, 'darwin-x64', 'LICENSE') },
];
for (const runtime of runtimes) {
  await rejectSymlinkParents(options.runtimeDir, runtime.source);
  await rejectSymlinkParents(options.runtimeDir, runtime.license);
  await requireRegularFile(runtime.source, `darwin-${runtime.arch} Node runtime`);
  await requireRegularFile(runtime.license, `darwin-${runtime.arch} Node LICENSE`);
  const header = await readMachOHeader(runtime.source);
  const expectedCpu = runtime.arch === 'arm64' ? 0x0100000c : 0x01000007;
  if (header.length < 8 || header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== expectedCpu)
    throw new Error(`darwin-${runtime.arch} Node runtime must be a 64-bit little-endian Mach-O binary for its named architecture`);
}

const targetName = `Shantu-${version}-macOS-${options.visibility}`;
const stagingParent = resolve(root, '.openai', `macos-${Date.now()}-${process.pid}`);
const staging = resolve(stagingParent, targetName);
const outputZip = resolve(options.outDir, `${targetName}.zip`);
const temporaryRoot = resolve(root, '.openai');
let stagingCreated = false;
function verifyStagingParent() {
  const parent = resolve(stagingParent);
  if (dirname(parent) !== temporaryRoot || !parent.split(sep).at(-1).startsWith('macos-'))
    throw new Error(`Refusing to remove staging outside ${temporaryRoot}: ${parent}`);
  return parent;
}
try {
  await mkdir(stagingParent);
  stagingCreated = true;
  await mkdir(resolve(staging, 'web'), { recursive: true });
  await mkdir(resolve(staging, 'runtime'), { recursive: true });
  for (const file of webFiles) {
    const destination = resolve(staging, 'web', ...file.name.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(file.path, destination);
  }
  for (const runtime of runtimes) {
    const name = `node-${runtime.arch}`;
    await copyFile(runtime.source, resolve(staging, 'runtime', name));
    await copyFile(runtime.license, resolve(staging, 'runtime', `LICENSE-${name}.txt`));
  }
  await bundle({
    entryPoints: [resolve(root, 'desktop-web/server.ts')],
    outfile: resolve(staging, 'server.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: `node${options.nodeVersion.split('.')[0]}`,
    alias: { '@': root },
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const launcher = resolve(root, 'desktop-web/Start-Mac.command');
  await requireRegularFile(launcher, 'Mac launcher source');
  const launcherText = (await readFile(launcher, 'utf8')).replace(/\r\n?/g, '\n');
  await writeFile(resolve(staging, 'Start-Mac.command'), launcherText, 'utf8');
  await writeFile(resolve(staging, 'README-Mac.md'), await readFile(resolve(root, 'desktop-web/README-Mac.md')));

  const stagedFiles = await walkRegularFiles(staging);
  const manifest = {
    format: 'shantu-macos-portable',
    formatVersion: 1,
    appVersion: version,
    visibility: options.visibility,
    platform: 'macOS',
    architectures: ['arm64', 'x64'],
    nodeVersion: options.nodeVersion,
    files: Object.fromEntries(await Promise.all(stagedFiles.map(async ({ path, name }) => [name, sha256(await readFile(path))]))),
  };
  await writeFile(resolve(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const entries = {};
  for (const { path, name } of [...stagedFiles, { path: resolve(staging, 'manifest.json'), name: 'manifest.json' }]) {
    const bytes = new Uint8Array(await readFile(path));
    const executable = name === 'Start-Mac.command' || name === 'runtime/node-arm64' || name === 'runtime/node-x64';
    entries[`${targetName}/${name}`] = executable ? [bytes, { os: 3, attrs: 0o100755 << 16 }] : bytes;
  }
  const archive = zipSync(entries, { level: 6 });
  await mkdir(options.outDir, { recursive: true });
  await writeFile(outputZip, archive);
  const archiveHash = sha256(archive);
  await writeFile(`${outputZip}.sha256`, `${archiveHash}  ${targetName}.zip\n`);
  console.log(JSON.stringify({ file: outputZip, bytes: archive.length, sha256: archiveHash, files: Object.keys(entries).length, visibility: options.visibility }, null, 2));
} finally {
  if (stagingCreated) await rm(verifyStagingParent(), { recursive: true, force: true });
}
