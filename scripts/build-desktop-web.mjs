import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
const root = fileURLToPath(new URL('..', import.meta.url));
const version = (
  await readFile(resolve(root, 'config/product.ts'), 'utf8')
).match(/APP_VERSION = '([^']+)'/)[1];
const name = `Shantu-${version}-Windows-Mac-Web`;
const staging = resolve(root, '.openai', `web-${Date.now()}`, name);
await mkdir(staging, { recursive: true });
// The browser entry already handles absent Android capabilities and wide viewports.
await viteBuild({
  configFile: resolve(root, 'mobile/vite.config.ts'),
  build: { outDir: resolve(staging, 'web') },
});
await bundle({
  entryPoints: [resolve(root, 'desktop-web/server.ts')],
  outfile: resolve(staging, 'server.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  alias: { '@': root },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
const windows =
  '@echo off\r\ncd /d "%~dp0"\r\nwhere node >nul 2>nul\r\nif errorlevel 1 (\r\n echo Please install Node.js 22.13+ from https://nodejs.org/en/download\r\n pause\r\n exit /b 1\r\n)\r\nnode server.mjs\r\npause\r\n';
const mac =
  '#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nif ! command -v node >/dev/null 2>&1; then\n echo "Please install Node.js 22.13+ from https://nodejs.org/en/download"\n read -r answer\n exit 1\nfi\nnode server.mjs\n';
await writeFile(resolve(staging, 'Start-Windows.cmd'), windows);
await writeFile(resolve(staging, 'Start-Mac.command'), mac);
await writeFile(
  resolve(staging, 'README.md'),
  await readFile(resolve(root, 'desktop-web/README.md')),
);
const entries = {};
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const key = name + '/' + relative(staging, path).replaceAll('\\', '/');
      const bytes = new Uint8Array(await readFile(path));
      entries[key] =
        entry.name === 'Start-Mac.command'
          ? [bytes, { os: 3, attrs: 0o100755 << 16 }]
          : bytes;
    }
  }
}
await walk(staging);
const archive = zipSync(entries, { level: 6 });
const target = resolve(root, 'APK', name + '.zip');
await mkdir(resolve(root, 'APK'), { recursive: true });
await writeFile(target, archive);
const sha = createHash('sha256').update(archive).digest('hex');
await writeFile(target + '.sha256', `${sha}  ${name}.zip\n`);
console.log(
  JSON.stringify(
    {
      file: target,
      staging,
      bytes: archive.length,
      sha256: sha,
      files: Object.keys(entries).length,
    },
    null,
    2,
  ),
);
