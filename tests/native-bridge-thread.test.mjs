import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve('.');
const localJavaHome = 'D:/GodotAndroid/jdk-17-portable/jdk-17.0.19+10';
const javaHome = process.env.JAVA_HOME || (existsSync(join(localJavaHome, 'bin', 'javac.exe')) ? localJavaHome : '');
const javaBin = javaHome ? join(javaHome, 'bin') : '';
const javac = javaBin ? join(javaBin, process.platform === 'win32' ? 'javac.exe' : 'javac') : 'javac';
const java = javaBin ? join(javaBin, process.platform === 'win32' ? 'java.exe' : 'java') : 'java';

test('BridgePageState is safe to read from JavaBridge thread using the production class', () => {
  const output = mkdtempSync(join(tmpdir(), 'shantu-bridge-page-state-'));
  try {
    const compile = spawnSync(javac, [
      '-encoding', 'UTF-8', '-d', output,
      'mobile/android/src/com/guanyun/weather/BridgePageState.java',
      'mobile/tests/BridgePageStateCheck.java',
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(compile.status, 0, `javac failed:\n${compile.stdout}\n${compile.stderr}`);

    const run = spawnSync(java, ['-cp', output, 'com.guanyun.weather.BridgePageStateCheck'], {
      cwd: root, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(run.status, 0, `BridgePageStateCheck failed:\n${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /BridgePageState JavaBridge-thread checks passed/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test('MainActivity records page and lifecycle state while bridge remains a state-only delegate', () => {
  const activity = readFileSync('mobile/android/src/com/guanyun/weather/MainActivity.java', 'utf8');
  const bridge = readFileSync('mobile/android/src/com/guanyun/weather/NativeBridge.java', 'utf8');

  assert.match(activity, /new\s+BridgePageState\s*\(/);
  assert.match(activity, /onPageStarted\s*\([\s\S]*?\.page\s*\(\s*url\s*\)/);
  assert.match(activity, /(?:do|did)UpdateVisitedHistory\s*\([\s\S]*?\.page\s*\(\s*(?:url|view\.getUrl\s*\(\s*\))\s*\)/);
  assert.match(activity, /onResume\s*\([\s\S]*?\.foreground\s*\(\s*true\s*\)/);
  assert.match(activity, /onPause\s*\([\s\S]*?\.foreground\s*\(\s*false\s*\)/);
  assert.match(activity, /onDestroy\s*\([\s\S]*?\.foreground\s*\(\s*false\s*\)[\s\S]*?\.page\s*\(\s*null\s*\)/);
  assert.match(activity, /boolean\s+trustedForeground\s*\(\s*\)\s*\{\s*return\s+\w+\.trustedForeground\s*\(\s*\)\s*;\s*\}/);
  assert.match(bridge, /activity\.trustedForeground\s*\(\s*\)/);
  assert.doesNotMatch(activity, /trustedForeground\s*\(\s*\)\s*\{[^}]*webView\.getUrl/s);
});
