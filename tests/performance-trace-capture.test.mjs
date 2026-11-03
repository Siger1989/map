import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'android', 'capture-performance-trace.py');
const python = process.env.PYTHON || 'python';

function run(args) {
  return spawnSync(python, [script, ...args], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
}

test('default invocation only prints a dry-run plan and never calls adb', () => {
  const result = run(['--adb', 'missing-adb-executable']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, 'DRY_RUN');
  assert.equal(plan.traceSeconds, 16);
  assert.equal(plan.bufferKiB, 32768);
  assert.equal(plan.swipeDurationMs, 350);
  assert.equal(plan.estimatedHostInputWindowSeconds, 2.2);
  assert.equal(plan.output, null);
  assert.equal(plan.windowFitsTrace, true);
  assert.equal(plan.video, false);
  assert.equal(plan.explicitCameraPresetOrLayerChanges, false);
  assert.equal(plan.cameraMovedByGesture, true);
  assert.equal('cameraOrLayerChanges' in plan, false);
});

test('capture refuses an existing output directory before any adb call or overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-capture-test-'));
  try {
    const output = path.join(temp, 'existing');
    fs.mkdirSync(output);
    const marker = path.join(output, 'keep.txt');
    fs.writeFileSync(marker, 'preserve');
    const result = run([
      '--capture', '--serial', 'device-under-test', '--output', output,
      '--expected-version-name', '0.2.test', '--expected-version-code', '1', '--expected-map-count', '1',
      '--x', '10', '--y', '20', '--x2', '30', '--y2', '20', '--adb', 'missing-adb-executable',
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already exists/);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve');
    assert.deepEqual(fs.readdirSync(output), ['keep.txt']);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('capture requires explicit serial, output, package expectations and gesture coordinates', () => {
  const result = run(['--capture']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--serial/);
  assert.match(result.stderr, /--output/);
  assert.match(result.stderr, /--expected-map-count/);
});

test('QA swipe request alternates direction and sends the accepted duration field only', () => {
  const code = [
    'import importlib.util,json',
    `s=importlib.util.spec_from_file_location('capture',${JSON.stringify(script)})`,
    'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
    "c={'x':10,'y':20,'x2':30,'y2':40}",
    'print(json.dumps([m.build_swipe_request(c,375,0),m.build_swipe_request(c,375,1)]))',
  ].join(';');
  const result = spawnSync(python, ['-c', code], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  const [forward, reverse] = JSON.parse(result.stdout);
  assert.deepEqual(forward, { action: 'swipe', x: 10, y: 20, x2: 30, y2: 40, duration: 375 });
  assert.deepEqual(reverse, { action: 'swipe', x: 30, y: 40, x2: 10, y2: 20, duration: 375 });
  assert.equal('durationMs' in forward, false);
  assert.equal('steps' in forward, false);
});

test('Perfetto uses the approved reference sources with a bounded run duration and unique session', () => {
  const code = [
    'import importlib.util,json',
    `s=importlib.util.spec_from_file_location('capture',${JSON.stringify(script)})`,
    'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
    "print(m.prepare_config(m.REFERENCE_CONFIG,m.DEFAULT_PACKAGE,20,'codex-test-session'))",
  ].join(';');
  const result = spawnSync(python, ['-c', code], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /duration_ms: 20000/);
  assert.match(result.stdout, /size_kb: 32768/);
  assert.match(result.stdout, /unique_session_name: "codex-test-session"/);
  assert.match(result.stdout, /android\.surfaceflinger\.frametimeline/);
  assert.equal(result.stdout.includes('heapprofd'), false);
  assert.equal(result.stdout.includes('stack_sampling'), false);
});

test('long traces receive a 128MiB ring buffer while short traces keep 32MiB', () => {
  const code = [
    'import importlib.util,json,re',
    `s=importlib.util.spec_from_file_location('capture',${JSON.stringify(script)})`,
    'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
    "short=m.prepare_config(m.REFERENCE_CONFIG,m.DEFAULT_PACKAGE,30,'short-session')",
    "long=m.prepare_config(m.REFERENCE_CONFIG,m.DEFAULT_PACKAGE,75,'long-session')",
    "print(json.dumps({'shortKiB':m.buffer_kib_for_trace(30),'longKiB':m.buffer_kib_for_trace(75),'shortConfig':re.search(r'size_kb: (\\d+)',short).group(1),'longConfig':re.search(r'size_kb: (\\d+)',long).group(1)}))",
  ].join(';');
  const result = spawnSync(python, ['-c', code], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    shortKiB: 32768, longKiB: 131072, shortConfig: '32768', longConfig: '131072',
  });
});

test('long-run plan derives minimum trace duration from repeat count and quiet buffers', () => {
  const runPlan = (repeats, traceSeconds = 16, duration = null) => {
    const args = ['--repeats', String(repeats), '--trace-seconds', String(traceSeconds)];
    if (duration !== null) args.push('--duration-ms', String(duration));
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const thirtyTwo = runPlan(32);
  assert.equal(thirtyTwo.swipeDurationMs, 350, 'the default swipe duration stays the same for every repeat count');
  assert.equal(thirtyTwo.estimatedHostInputWindowSeconds, 17.6);
  assert.equal(thirtyTwo.requiredTraceSeconds, 20);
  assert.equal(thirtyTwo.windowFitsTrace, false, '16 seconds cannot contain the gesture plus quiet buffers');
  const thirtyTwoLong = runPlan(32, 33, 750);
  assert.equal(thirtyTwoLong.estimatedHostInputWindowSeconds, 30.4);
  assert.equal(thirtyTwoLong.requiredTraceSeconds, 33);
  assert.equal(thirtyTwoLong.windowFitsTrace, true);
  const sixtyFour = runPlan(64);
  assert.equal(sixtyFour.estimatedHostInputWindowSeconds, 35.2);
  assert.equal(sixtyFour.requiredTraceSeconds, 38);
  assert.equal(sixtyFour.windowFitsTrace, false);
  assert.equal(runPlan(64, 38, 350).windowFitsTrace, true);
});

test('swipe duration rejects values outside the QA bridge 50..2000ms range', () => {
  assert.equal(run(['--duration-ms', '49']).status, 2);
  assert.equal(run(['--duration-ms', '2001']).status, 2);
});

test('device swipe spans require the QA fields, exact accepted duration, and increasing device timestamps', () => {
  const code = [
    'import importlib.util,json',
    `s=importlib.util.spec_from_file_location('capture',${JSON.stringify(script)})`,
    'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
    "valid={'acceptedSwipeDurationMs':750,'commandStartedElapsedRealtimeNanos':1000000000,'commandEndedElapsedRealtimeNanos':1800000000}",
    'one=m.validate_swipe_reply(valid,750)',
    "quantized=m.validate_swipe_reply({'acceptedSwipeDurationMs':750,'commandStartedElapsedRealtimeNanos':3000000000,'commandEndedElapsedRealtimeNanos':3736000000},750)",
    "two=m.validate_swipe_reply({'acceptedSwipeDurationMs':750,'commandStartedElapsedRealtimeNanos':1900000000,'commandEndedElapsedRealtimeNanos':2700000000},750,one['commandEndedElapsedRealtimeNanos'])",
    'errors=[]',
    "for reply,duration,previous in [({'duration':750},750,None),(dict(valid,acceptedSwipeDurationMs=700),750,None),(dict(valid,commandEndedElapsedRealtimeNanos=900000000),750,None),(dict(valid,commandStartedElapsedRealtimeNanos=1700000000),750,one['commandEndedElapsedRealtimeNanos'])]:",
    '    try:',
    '        m.validate_swipe_reply(reply,duration,previous);errors.append(False)',
    '    except m.CaptureError:',
    '        errors.append(True)',
    "print(json.dumps({'first':one,'second':two,'quantized':quantized,'errors':errors,'spanName':m.TRACE_SWIPE_SPAN_NAME}))",
  ].join('\n');
  const result = spawnSync(python, ['-c', code], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.first.acceptedSwipeDurationMs, 750);
  assert.equal(output.second.commandStartedElapsedRealtimeNanos, 1900000000);
  assert.equal(output.quantized.commandEndedElapsedRealtimeNanos - output.quantized.commandStartedElapsedRealtimeNanos, 736000000);
  assert.deepEqual(output.errors, [true, true, true, true]);
  assert.equal(output.spanName, 'ShantuQa/swipe');
});

test('trace window uses invocation start so a delayed background-wait ack cannot mask an overrun', () => {
  const code = [
    'import importlib.util,json',
    `s=importlib.util.spec_from_file_location('capture',${JSON.stringify(script)})`,
    'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
    // Invocation at 10s, ack 1.5s later. Old ack-based math gives 14.7s <= 16s;
    // the conservative call-begin deadline is 26s and input+quiet ends at 26.2s.
    "print(json.dumps({'conservative':m.input_fits_trace(10.0,11.5,25.2,1.0,16),'ackBased':25.2-11.5+1.0<=16}))",
  ].join(';');
  const result = spawnSync(python, ['-c', code], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { conservative: false, ackBased: true });
});

test('trace-end wait performs no perfetto query until the configured invocation deadline', () => {
  const code = [
    'import importlib.util,json,types',
    `s=importlib.util.spec_from_file_location('capture',${JSON.stringify(script)})`,
    'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
    'clock=[0.0]; queries=[]',
    'm.time.monotonic=lambda:clock[0]',
    'm.time.sleep=lambda duration:clock.__setitem__(0,clock[0]+duration)',
    "m.adb_command=lambda args,*cmd:queries.append(clock[0]) or ''",
    "m.wait_for_trace_end(types.SimpleNamespace(serial='test'),'own-session',2.0,16)",
    'print(json.dumps(queries))',
  ].join(';');
  const result = spawnSync(python, ['-c', code], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [18]);
});

test('raw before/after inspect is retained privately with report-safe path and digest', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-inspect-test-'));
  try {
    const code = [
      'import importlib.util,json,pathlib,sys',
      `s=importlib.util.spec_from_file_location('capture',${JSON.stringify(script)})`,
      'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
      "result=m.save_inspect(pathlib.Path(sys.argv[1]),'before',{'camera':{'center':{'lat':1.25,'lon':2.5}},'privateFixture':'local-only'})",
      'print(json.dumps(result))',
    ].join(';');
    const result = spawnSync(python, ['-c', code, temp], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    const reference = JSON.parse(result.stdout);
    assert.equal(reference.file, 'before-inspect.json');
    assert.match(reference.sha256, /^[a-f0-9]{64}$/);
    const saved = fs.readFileSync(path.join(temp, reference.file));
    assert.match(saved.toString(), /"privateFixture": "local-only"/);
    assert.equal(reference.sha256, crypto.createHash('sha256').update(saved).digest('hex'));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('process evidence captures target package service bindings by path without inferring ownership', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-process-test-'));
  try {
    const code = [
      'import importlib.util,json,pathlib,sys,types',
      `s=importlib.util.spec_from_file_location('capture',${JSON.stringify(script)})`,
      'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
      'calls=[]',
      'def fake_adb(args,*command):',
      ' calls.append(list(command))',
      " if 'pidof' in command: return '5317'",
      " return {'pidof':'5317','ps':'ps evidence','com.android.webview':'webview-only services','com.guanyun.weather.shantu.preview':'target SandboxService and ClientAppBindRecord'}.get(command[-1],'')",
      'm.adb_command=fake_adb',
      "result=m.capture_process_evidence(types.SimpleNamespace(serial='test',package='com.guanyun.weather.shantu.preview'),pathlib.Path(sys.argv[1]),'before')",
      'print(json.dumps({"result":result,"calls":calls}))',
    ].join('\n');
    const result = spawnSync(python, ['-c', code, temp], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.result.targetPackageServiceEvidenceFile, 'target-services-before.txt');
    assert.ok(output.calls.some(call => call.at(-1) === 'com.guanyun.weather.shantu.preview'));
    assert.match(fs.readFileSync(path.join(temp, output.result.targetPackageServiceEvidenceFile), 'utf8'), /ClientAppBindRecord/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
