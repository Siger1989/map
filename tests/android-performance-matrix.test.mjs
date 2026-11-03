import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = path.join(root, 'scripts', 'android', 'performance-matrix.ps1');

function runPlan(args, cwd) {
  return execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runner,
    ...args,
  ], { cwd, stdio: 'pipe', encoding: 'utf8' });
}

test('dry-run report covers actual and missing task branches without claiming a pass', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'shantu-perf-matrix-'));
  try {
    const output = path.join(temp, 'run');
    runPlan([
      '-Adb', path.join(temp, 'must-not-run.exe'), '-Scenario', 'all',
      '-Serial', 'dry-run-only', '-OutputDirectory', output, '-WindowSeconds', '8',
    ], root);
    const raw = await readFile(path.join(output, 'matrix-report.json'), 'utf8');
    const report = JSON.parse(raw.replace(/^\uFEFF/, ''));
    assert.equal(report.mode, 'DRY_RUN');
    assert.equal(report.scenarios.length, 17);
    assert.deepEqual(report.scenarios.map(row => row.result), Array(17).fill('NOT_RUN'));
    assert.ok(report.fixtures.every(row => row.readiness === 'NOT_VERIFIED'));
    assert.deepEqual(report.commands, []);
    assert.equal(report.targetProcAccess.status, 'NOT_TESTED');
    assert.equal(report.scenarios.find(row => row.id === 'navigation-display').taskBranch, 'routeOverlay.route with navigationProgress absent');
    assert.equal(report.scenarios.find(row => row.id === 'navigation-active').taskBranch, 'routeOverlay.route + finite navigationProgress; guiding UI branch');
    assert.equal(report.scenarios.find(row => row.id === 'navigation-active').gpsBehavior, 'NONE');
    assert.match(report.scenarios.find(row => row.id === 'recording-active').fixtureGap, /无QA recording fixture/);
    assert.match(report.scenarios.find(row => row.id === 'recording-paused').taskBranch, /phase=paused/);
    assert.match(report.scenarios.find(row => row.id === 'measurement-active').taskBranch, /measurementPicking/);
    assert.match(report.scenarios.find(row => row.id === 'section-profile-active').taskBranch, /section.enabled/);
    assert.ok(report.scenarios.every(row => row.windowPolicy === 'FIXED_SECONDS:8'));
    assert.ok(report.scenarios.every(row => row.targetProcessBefore === null && row.targetProcessAfter === null));
    assert.ok(report.scenarios.every(row => row.readiness === 'NOT_RUN'));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('invalid scenario is rejected before creating an output directory', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'shantu-perf-matrix-invalid-'));
  try {
    const output = path.join(temp, 'must-not-exist');
    assert.throws(() => runPlan(['-Scenario', 'not-a-mode', '-OutputDirectory', output], root), /Unknown scenario id/);
    await assert.rejects(readFile(path.join(output, 'matrix-report.json')));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('existing report is rejected without modifying prior A/B evidence', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'shantu-perf-matrix-existing-'));
  try {
    const output = path.join(temp, 'occupied');
    await mkdir(output);
    const previous = path.join(output, 'matrix-report.json');
    await writeFile(previous, 'previous-evidence', 'utf8');
    assert.throws(() => runPlan(['-Scenario', 'single-2d', '-OutputDirectory', output], root), /Refusing to overwrite existing report/);
    assert.equal(await readFile(previous, 'utf8'), 'previous-evidence');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
