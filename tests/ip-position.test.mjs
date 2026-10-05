import test from 'node:test';
import assert from 'node:assert/strict';
import { readIpPosition, watchIpPosition } from '../modules/position/ipPosition.ts';
import { canFollow } from '../modules/position/follow.ts';

test('IP positions remain coarse network estimates and expire separately from GPS', () => {
  const now = Date.now();
  const raw = { coordinates: [104, 30], accuracy: 50000, timestamp: now, source: 'network', provider: 'ip', heading: 90 };
  const fix = readIpPosition(raw, now);
  assert.equal(fix.provider, 'ip');
  assert.equal('heading' in fix, false, 'IP data cannot provide a movement direction');
  assert.equal(canFollow(fix, now + 60000), true);
  assert.equal(canFollow(fix, now + 120001), false);
  for (const patch of [{ coordinates: [400, 30] }, { accuracy: 5 }, { source: 'gps' }, { timestamp: now - 10001 }, { timestamp: now + 5001 }])
    assert.equal(readIpPosition({ ...raw, ...patch }, now), null);
});

test('stopping an IP request aborts it and prevents its late result from replacing another provider', async (t) => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = { setTimeout, clearTimeout, setInterval };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  t.after(() => { globalThis.window = oldWindow; globalThis.document = oldDocument; });
  let finish, signal, accepted = 0, errors = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    return await new Promise(resolve => { finish = resolve; });
  });
  const stop = watchIpPosition(() => accepted++, () => errors++);
  stop();
  assert.equal(signal.aborted, true);
  finish(Response.json({ coordinates: [104, 30], accuracy: 50000, timestamp: Date.now(), source: 'network', provider: 'ip' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(accepted, 0);
  assert.equal(errors, 0);
});
