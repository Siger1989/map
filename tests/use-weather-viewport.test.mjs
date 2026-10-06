import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';

const output = '.openai/use-weather-viewport-hook.mjs';
await build({ entryPoints: ['modules/weather/useWeather.ts'], bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: output });
const { useWeather } = await import(`${pathToFileURL(process.cwd() + '/' + output).href}?test=${Date.now()}`);
const React = await import('react');
const { createRoot } = await import('react-dom/client');

async function mount(t, initial) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
  const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const timers = new Map();
  const intervals = [];
  const requests = [];
  let timerId = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, writable: true, value: true });
  Object.defineProperty(globalThis, 'setTimeout', { configurable: true, value: (callback, delay, ...args) => {
    const id = ++timerId;
    timers.set(id, { callback: () => callback(...args), delay });
    return id;
  } });
  Object.defineProperty(globalThis, 'clearTimeout', { configurable: true, value: id => timers.delete(id) });
  Object.defineProperty(globalThis, 'setInterval', { configurable: true, value: (callback, delay) => {
    const id = intervals.length + 1; intervals.push({ id, callback, delay }); return id;
  } });
  Object.defineProperty(globalThis, 'clearInterval', { configurable: true, value: id => { const entry = intervals.find(item => item.id === id); if (entry) entry.cleared = true; } });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: (url, options) => new Promise(resolve => requests.push({ url: String(url), signal: options.signal, resolve })) });

  let result;
  function Probe({ anchor, options }) { result = useWeather(anchor, options); return React.createElement('div'); }
  const root = createRoot(document.getElementById('root'));
  async function render(value) { await React.act(async () => root.render(React.createElement(Probe, value))); }
  await render(initial);
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    React, render, state: () => result, timers, intervals, requests,
    async fireDebounce() {
      const queued = [...timers.entries()].filter(([, timer]) => timer.delay === 450);
      for (const [id, timer] of queued) { timers.delete(id); await React.act(async () => { timer.callback(); await Promise.resolve(); }); }
    },
  };
}

function bounds(west, south, east, north) { return [west, south, east, north]; }
function payload(pointCount) {
  const start = Math.floor(Date.now() / 1000);
  return Array.from({ length: pointCount }, (_, i) => ({
    hourly: {
      time: Array.from({ length: 25 }, (_, hour) => start + hour * 3600),
      rain: Array(25).fill(i / 10), showers: Array(25).fill(0),
    },
  }));
}
async function resolveRequest(f, request) {
  const pointCount = new URL(request.url).searchParams.get('latitude').split(',').length;
  await f.React.act(async () => {
    request.resolve(new Response(JSON.stringify(payload(pointCount)), { status: 200 }));
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

test('rain waits for map bounds, then requests only rain variables for the viewport grid', async t => {
  const f = await mount(t, { anchor: [104, 30], options: { enabled: true, viewport: null, variables: 'rain,showers' } });
  assert.equal(f.intervals.length, 0, 'waiting for bounds does not start a periodic request');
  await f.fireDebounce();
  assert.equal(f.requests.length, 0, 'rain mode never falls back to the anchor square');

  await f.render({ anchor: [104, 30], options: { enabled: true, viewport: bounds(103.2, 29.7, 104.8, 30.5), variables: 'rain,showers' } });
  await f.fireDebounce();
  assert.equal(f.requests.length, 1);
  const query = new URL(f.requests[0].url).searchParams;
  const pointCount = query.get('latitude').split(',').length;
  assert.ok(pointCount <= 81);
  assert.equal(query.get('hourly'), 'rain,showers');
  assert.equal(query.get('forecast_hours'), '25');
  assert.equal(f.intervals.at(-1).delay, 30 * 60 * 1000);
  await resolveRequest(f, f.requests[0]);
  assert.equal(f.state().data.cells.length, pointCount);
  assert.equal(f.state().data.times.length, 25);
});

test('zoom with a fixed center cancels the prior request and reloads a finer viewport mesh', async t => {
  const f = await mount(t, { anchor: [104, 30], options: { enabled: true, viewport: bounds(98, 26, 110, 34), variables: 'rain,showers' } });
  await f.fireDebounce();
  assert.equal(f.requests.length, 1);
  const coarseCount = new URL(f.requests[0].url).searchParams.get('latitude').split(',').length;

  await f.render({ anchor: [104, 30], options: { enabled: true, viewport: bounds(103.2, 29.7, 104.8, 30.3), variables: 'rain,showers' } });
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.state().data, null, 'old coarse viewport data is hidden while a new grid loads');
  await f.fireDebounce();
  assert.equal(f.requests.length, 2);
  const fineCount = new URL(f.requests[1].url).searchParams.get('latitude').split(',').length;
  assert.ok(fineCount <= 81);
  assert.ok(fineCount < coarseCount, 'zoom-in uses a finer local grid');
  await resolveRequest(f, f.requests[1]);
  assert.equal(f.state().data.cells.length, fineCount);
});

test('an expanded viewport immediately hides data whose sampled nodes do not cover it', async t => {
  const f = await mount(t, { anchor: [104, 30], options: { enabled: true, viewport: bounds(103.2, 29.7, 104.8, 30.5), variables: 'rain,showers' } });
  await f.fireDebounce();
  await resolveRequest(f, f.requests[0]);
  assert.ok(f.state().data);

  await f.render({ anchor: [104, 30], options: { enabled: true, viewport: bounds(98, 26, 110, 34), variables: 'rain,showers' } });
  assert.equal(f.state().data, null, 'an old narrow raster is hidden while the broader request waits');
  await f.fireDebounce();
  assert.equal(f.requests.length, 2);
});

test('nearby pan within the sampled node domain reuses the current viewport grid', async t => {
  const first = bounds(103.2, 29.7, 104.8, 30.5);
  const f = await mount(t, { anchor: [104, 30], options: { enabled: true, viewport: first, variables: 'rain,showers' } });
  await f.fireDebounce();
  await resolveRequest(f, f.requests[0]);
  const existing = f.state().data;
  await f.render({ anchor: [104, 30], options: { enabled: true, viewport: bounds(103.4, 29.7, 105, 30.5), variables: 'rain,showers' } });
  await f.fireDebounce();
  assert.equal(f.requests.length, 1, 'a small pan within sampled nodes does not refetch');
  assert.equal(f.state().data, existing);
});

test('viewport cache expires after thirty minutes and re-fetches when rain is re-enabled', async t => {
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  t.after(() => { Date.now = realNow; });
  const opts = { enabled: true, viewport: bounds(103.2, 29.7, 104.8, 30.5), variables: 'rain,showers' };
  const f = await mount(t, { anchor: [104, 30], options: opts });
  await f.fireDebounce();
  await resolveRequest(f, f.requests[0]);
  const cached = f.state().data;
  assert.ok(cached);

  await f.render({ anchor: [104, 30], options: { ...opts, enabled: false } });
  offset = 31 * 60 * 1000;
  await f.render({ anchor: [104, 30], options: opts });
  assert.equal(f.state().data, null, 'expired viewport data is hidden before the refresh');
  await f.fireDebounce();
  assert.equal(f.requests.length, 2);
});

test('date-line viewport sends wrapped API longitudes but preserves continuous local coordinates', async t => {
  const f = await mount(t, { anchor: [180, 0], options: { enabled: true, viewport: bounds(179.4, -0.6, 181, 0.6), variables: 'rain,showers' } });
  await f.fireDebounce();
  assert.equal(f.requests.length, 1);
  const queryLongitudes = new URL(f.requests[0].url).searchParams.get('longitude').split(',').map(Number);
  assert.ok(queryLongitudes.every(value => value >= -180 && value <= 180));
  await resolveRequest(f, f.requests[0]);
  assert.ok(f.state().data.cells.some(cell => cell.lng > 180), 'grid order remains continuous across the date line');
});

test('disabled viewport request stays idle and legacy anchor weather still uses 25 full-variable points', async t => {
  const disabled = await mount(t, { anchor: [104, 30], options: { enabled: false, viewport: bounds(103, 29, 105, 31), variables: 'rain,showers' } });
  await disabled.fireDebounce();
  assert.equal(disabled.requests.length, 0);
  assert.equal(disabled.intervals.length, 0);
  await disabled.render({ anchor: [104, 30] });
  await disabled.fireDebounce();
  assert.equal(disabled.requests.length, 1);
  const query = new URL(disabled.requests[0].url).searchParams;
  assert.equal(query.get('latitude').split(',').length, 25);
  assert.match(query.get('hourly'), /temperature_2m/);
  assert.match(query.get('hourly'), /rain,showers/);
  await resolveRequest(disabled, disabled.requests[0]);
  assert.equal(disabled.state().data.cells.length, 25);
});
