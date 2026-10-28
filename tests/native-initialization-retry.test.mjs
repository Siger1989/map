import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ entryPoints: ['modules/map/native/initializationRetry.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { NativeInitializationRetry } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

function clock() {
  let now = 0, id = 0; const jobs = new Map();
  return {
    timers: { set(callback, delay) { jobs.set(++id, { at: now + delay, callback }); return id; }, clear(key) { jobs.delete(key); } },
    advance(to) {
      while (true) {
        const next = [...jobs.entries()].filter(([, job]) => job.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; jobs.delete(next[0]); next[1].callback();
      }
      now = to;
    },
    get now() { return now; }, get pending() { return jobs.size; },
  };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('a missing first render ACK automatically retries the same owner and becomes ready once after the real second ACK', async () => {
  const time = clock(), owners = new Set(), createCalls = [], requests = [];
  let created = false, realFrame = true, notified = 0, flight = null;
  const owner = { token: 'same-react-owner', generation: 1 };
  const retry = new NativeInitializationRetry(() => !created, undefined, time.timers);
  const ensure = () => {
    if (created) return Promise.resolve();
    if (flight) return flight;
    let failed = false;
    flight = (async () => {
      createCalls.push(owner); owners.add(owner.token); // Fake host idempotently reuses the existing native surface.
      const revision = requests.length + 1; requests.push({ revision, owner });
      try {
        const ack = await (revision === 1 ? Promise.reject(new Error('first render ACK timed out')) : Promise.resolve({ applied: true }));
        if (!ack.applied) throw new Error('not applied');
        created = true; retry.reset();
        if (realFrame && notified === 0) notified++;
      } catch { failed = true; }
    })().finally(() => { flight = null; if (failed) retry.schedule(() => { void ensure(); }); });
    return flight;
  };
  const first = ensure(); assert.equal(ensure(), first, 'initialization stays single-flight');
  await first;
  assert.equal(created, false); assert.equal(notified, 0, 'real frames alone cannot make the initial state ready');
  time.advance(499); await flush(); assert.equal(requests.length, 1);
  time.advance(500); await flush();
  assert.equal(created, true); assert.equal(notified, 1);
  assert.deepEqual(requests.map(r => r.revision), [1, 2]);
  assert.equal(owners.size, 1); assert.ok(createCalls.every(value => value === owner));
  time.advance(10000); await ensure(); assert.equal(notified, 1); assert.equal(requests.length, 2);
});

test('automatic retries have a fixed finite budget and repeated scheduling cannot postpone or multiply one timer', () => {
  const time = clock(), at = [];
  const retry = new NativeInitializationRetry(() => true, undefined, time.timers);
  const attempt = () => { at.push(time.now); retry.schedule(attempt); };
  assert.equal(retry.schedule(attempt), true);
  assert.equal(retry.schedule(attempt), false);
  time.advance(20000);
  assert.deepEqual(at, [500, 2000, 5000]);
  assert.equal(time.pending, 0); assert.equal(retry.schedule(attempt), false);
});

test('hiding cancels timers and an explicit foreground recovery renews the bounded budget', () => {
  const time = clock(); let visible = true, calls = 0;
  const retry = new NativeInitializationRetry(() => visible, undefined, time.timers);
  retry.schedule(() => calls++); visible = false; retry.cancel();
  time.advance(10000); assert.equal(calls, 0); assert.equal(time.pending, 0);
  assert.equal(retry.schedule(() => calls++), false);
  visible = true; retry.reset(); retry.schedule(() => calls++);
  time.advance(10499); assert.equal(calls, 0);
  time.advance(10500); assert.equal(calls, 1);
});

test('aborted or superseded owners cannot execute a scheduled retry and disposal removes pending work', () => {
  const time = clock(); let currentOwner = true, calls = 0;
  const retry = new NativeInitializationRetry(() => currentOwner, undefined, time.timers);
  retry.schedule(() => calls++); currentOwner = false;
  time.advance(500); assert.equal(calls, 0);
  currentOwner = true; retry.reset(); retry.schedule(() => calls++);
  retry.cancel(); currentOwner = false;
  time.advance(10000); assert.equal(calls, 0); assert.equal(time.pending, 0);
});

test('default startup retry timers use the Window receiver rather than the scheduler object', () => {
  const time = clock(), oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout;
  let attempts = 0;
  globalThis.setTimeout = function(callback, delay) {
    assert.equal(this, globalThis); return time.timers.set(callback, delay);
  };
  globalThis.clearTimeout = function(timer) {
    assert.equal(this, globalThis); return time.timers.clear(timer);
  };
  try {
    const retry = new NativeInitializationRetry(() => true);
    assert.equal(retry.schedule(() => attempts++), true);
    time.advance(500); assert.equal(attempts, 1);
    retry.schedule(() => attempts++); retry.cancel();
    time.advance(10000); assert.equal(attempts, 1); assert.equal(time.pending, 0);
  } finally { globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear; }
});
