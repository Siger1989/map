import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('native tiles finish at Content-Length without waiting for EOF', (t) => {
  const binary = (name) => process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
  try { execFileSync(binary('javac'), ['-version'], { windowsHide: true, stdio: 'pipe', timeout: 10000 }); }
  catch (error) { if (error.code === 'ENOENT') return t.skip('JDK required; set JAVA_HOME'); throw error; }
  const folder = mkdtempSync(join(tmpdir(), 'shantu-tile-framing-'));
  try {
    execFileSync(binary('javac'), ['--release', '8', '-d', folder,
      fileURLToPath(new URL('../mobile/android/src/com/guanyun/weather/MapTileProxy.java', import.meta.url)),
      fileURLToPath(new URL('./android/MapTileResponseCheck.java', import.meta.url)),
    ], { windowsHide: true, stdio: 'pipe', timeout: 20000 });
    const result = execFileSync(binary('java'), ['-cp', folder, 'com.guanyun.weather.MapTileResponseCheck'],
      { windowsHide: true, encoding: 'utf8', timeout: 10000 });
    assert.match(result, /PASS native tile framing/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
