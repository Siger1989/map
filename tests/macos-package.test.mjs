import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { APP_VERSION } from '../config/product.ts';

test('Mac ZIP preserves safe paths, executable modes, both architectures and exact file hashes', async (t) => {
  const base = await mkdtemp(resolve(tmpdir(), 'shantu mac package '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const web = resolve(base, 'web');
  const runtime = resolve(base, 'runtime');
  const output = resolve(base, 'output');
  await mkdir(resolve(web, 'assets'), { recursive: true });
  await writeFile(resolve(web, 'index.html'), '<title>package fixture</title>');
  await writeFile(resolve(web, 'assets', 'app.js'), `console.log('${APP_VERSION}')`);
  for (const [arch, cpu] of [['arm64', 0x100000c], ['x64', 0x1000007]]) {
    await mkdir(resolve(runtime, `darwin-${arch}`, 'bin'), { recursive: true });
    // Header-only packaging fixtures are never executed as runtimes.
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(cpu, 4);
    await writeFile(resolve(runtime, `darwin-${arch}`, 'bin', 'node'), header);
    await writeFile(resolve(runtime, `darwin-${arch}`, 'LICENSE'), 'fixture license');
  }
  const args = ['scripts/build-macos.mjs', '--public', '--web-dir', web, '--runtime-dir', runtime, '--out-dir', output, '--node-version', '22.23.4'];
  const run = () => spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60000 });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  const zip = await readFile(resolve(output, `Shantu-${APP_VERSION}-macOS-public.zip`));
  const entries = unzipSync(zip);
  const prefix = `Shantu-${APP_VERSION}-macOS-public/`;
  assert.ok(Object.keys(entries).every((name) => name.startsWith(prefix) && !name.split('/').includes('..') && !name.includes('\\')));
  const manifest = JSON.parse(Buffer.from(entries[prefix + 'manifest.json']));
  assert.equal(manifest.appVersion, APP_VERSION);
  assert.equal(manifest.nodeVersion, '22.23.4');
  assert.deepEqual(manifest.architectures, ['arm64', 'x64']);
  for (const [name, hash] of Object.entries(manifest.files))
    assert.equal(createHash('sha256').update(entries[prefix + name]).digest('hex'), hash, name);
  assert.ok(entries[prefix + 'web/assets/app.js']);
  assert.ok(!Buffer.from(entries[prefix + 'Start-Mac.command']).includes(13), 'shell launcher must use LF');
  const modes = new Map();
  for (let offset = 0; offset < zip.length - 46; offset++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString();
    modes.set(name, { os: zip[offset + 5], mode: zip.readUInt32LE(offset + 38) >>> 16 });
    offset += 45 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
  }
  for (const name of ['Start-Mac.command', 'runtime/node-arm64', 'runtime/node-x64'])
    assert.deepEqual(modes.get(prefix + name), { os: 3, mode: 0o100755 });
  const secretFixture = 'private-credential-test-DO-NOT-SHIP';
  await writeFile(resolve(web, 'assets', 'app.js'), `console.log('${secretFixture}')`);
  result = spawnSync(process.execPath, args, {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, NEXT_PUBLIC_TIANDITU_KEY: secretFixture },
  });
  assert.notEqual(result.status, 0, 'public mode must reject a key even without a seed asset');
  assert.ok(!result.stderr.includes(secretFixture), 'credential errors must not print the key');
  await writeFile(resolve(web, 'assets', 'app.js'), `console.log('${APP_VERSION}')`);
  await mkdir(resolve(web, 'native'));
  await writeFile(resolve(web, 'native', 'default-map-sources.json'), JSON.stringify({ version: 1, maps: [{}] }));
  result = run();
  assert.notEqual(result.status, 0, 'public mode must reject private seeds');
  await rm(resolve(web, 'native', 'default-map-sources.json'));
  await writeFile(resolve(runtime, 'darwin-arm64', 'bin', 'node'), 'MZ invalid Windows executable');
  result = run();
  assert.notEqual(result.status, 0, 'Mac runtime must reject Windows binaries');
});
