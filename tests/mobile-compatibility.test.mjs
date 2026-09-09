import test from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { installAbortCompatibility } from '../modules/compatibility/abort.ts';
import { probeRuntime } from '../modules/compatibility/capabilities.ts';
import mobileViewportCompatibility from '../scripts/mobile-css-compat.mjs';
import mobileHasCompatibility from '../scripts/mobile-has-compat.mjs';

function oldAbortAPIs(t) {
  for (const [owner, key] of [
    [AbortSignal, 'any'],
    [AbortSignal, 'timeout'],
    [AbortSignal.prototype, 'throwIfAborted'],
  ]) {
    const original = Object.getOwnPropertyDescriptor(owner, key);
    Object.defineProperty(owner, key, {
      configurable: true,
      writable: true,
      value: undefined,
    });
    t.after(() =>
      original
        ? Object.defineProperty(owner, key, original)
        : delete owner[key],
    );
  }
  installAbortCompatibility();
}

test('current browser cancellation methods are preserved', () => {
  const any = AbortSignal.any,
    timeout = AbortSignal.timeout;
  installAbortCompatibility();
  assert.equal(AbortSignal.any, any);
  assert.equal(AbortSignal.timeout, timeout);
});

test('legacy cancellation forwards the first reason and removes all source listeners', (t) => {
  oldAbortAPIs(t);
  const a = new AbortController(),
    b = new AbortController();
  const counts = [];
  for (const source of [a.signal, b.signal]) {
    const listeners = new Set();
    const add = source.addEventListener.bind(source),
      remove = source.removeEventListener.bind(source);
    source.addEventListener = (type, callback, options) => {
      listeners.add(callback);
      add(type, callback, options);
    };
    source.removeEventListener = (type, callback) => {
      listeners.delete(callback);
      remove(type, callback);
    };
    counts.push(listeners);
  }
  const signal = AbortSignal.any([a.signal, b.signal, a.signal]);
  assert.deepEqual(
    counts.map((v) => v.size),
    [1, 1],
  );
  const reason = new Error('user cancelled');
  b.abort(reason);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason, reason);
  assert.throws(
    () => signal.throwIfAborted(),
    (error) => error === reason,
  );
  assert.deepEqual(
    counts.map((v) => v.size),
    [0, 0],
  );
  a.abort('later');
  assert.equal(signal.reason, reason);
});

test('legacy timeout aborts at the requested time and supports pre-aborted inputs', (t) => {
  oldAbortAPIs(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timeout = AbortSignal.timeout(20000);
  const combined = AbortSignal.any([new AbortController().signal, timeout]);
  t.mock.timers.tick(19999);
  assert.equal(combined.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(combined.reason.name, 'TimeoutError');
  assert.equal(AbortSignal.any([timeout]).reason, timeout.reason);
  assert.equal(AbortSignal.any([]).aborted, false);
  assert.throws(() => AbortSignal.timeout(-1), RangeError);
  assert.throws(() => AbortSignal.any([timeout, {}]), TypeError);
});

test('actual graphics support allows OEM and old Chrome user agents and releases the probe context', () => {
  for (const userAgent of [
    'HuaweiWebView/12.1.2 Chrome/99.0',
    'Chrome/119.0',
    'Chrome/140.0',
  ]) {
    let released = 0;
    const document = {
      createElement: () => ({
        getContext: () => ({
          isContextLost: () => false,
          getExtension: () => ({ loseContext: () => released++ }),
        }),
      }),
    };
    const result = probeRuntime(document, {
      Worker() {},
      WebAssembly: {},
      navigator: { userAgent },
    });
    assert.equal(result.webgl2, true);
    assert.equal(result.worker, true);
    assert.equal(released, 1);
  }
});

test('a real driver failure is reported independently from the browser version', () => {
  const result = probeRuntime(
    {
      createElement() {
        throw new Error('driver');
      },
    },
    { Worker() {}, WebAssembly: {}, navigator: { userAgent: 'Chrome/200.0' } },
  );
  assert.equal(result.webgl2, false);
});

test('viewport lowering also handles custom-property values without losing other units', async () => {
  const result = await postcss([mobileViewportCompatibility()]).process(
    '.panel{--h:min(38dvh,320px);height:calc(100dvh - 44px);width:100vw}',
    { from: undefined },
  );
  assert.match(
    result.css,
    /--h:min\(calc\(var\(--shantu-vh, 1vh\) \* 38\),320px\)/,
  );
  assert.match(result.css, /width:100vw/);
  assert.doesNotMatch(result.css, /\d+dvh/);
});

test('legacy layout retains native rules, nested specificity, media scope and encoded matching recipes', async () => {
  const result = await postcss([mobileHasCompatibility()]).process(
    '@media(max-width:500px){.dock:has(.panel[data-typing="true"]) .content{height:100px}.box:has(:is(.item,#chosen)){color:red}}',
    { from: undefined },
  );
  assert.match(result.css, /@supports not selector\(:has\(\*\)\)/);
  assert.match(result.css, /\.dock:has/);
  const root = postcss.parse(result.css);
  const recipes = [];
  root.walkDecls((decl) => {
    if (decl.prop.startsWith('--shantu-has-'))
      recipes.push(JSON.parse(Buffer.from(decl.value, 'hex').toString()));
  });
  assert.deepEqual(recipes, [
    { candidate: '.dock', inner: '.panel[data-typing="true"]' },
    { candidate: '.box', inner: ':is(.item,#chosen)' },
  ]);
  assert.match(result.css, /\.shantu-has-[a-f0-9]+\.shantu-has-/);
  assert.match(result.css, /:not\(#shantu-compat-never\)/);
  assert.equal(root.first.name, 'media');
});
