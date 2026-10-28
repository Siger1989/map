import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { configureNativeUIRegionTransport } from '../mobile/native-ui-regions.ts';

test('live publisher covers horizontal and vertical survey strokes without blocking empty corners or clipped map', async () => {
  const { window, document } = parseHTML(`<!doctype html><html><head></head><body>
    <svg><path id="horizontal" class="survey-hit-line" role="button"/><path id="vertical" class="survey-hit-line" role="button"/>
      <path id="diagonal" class="survey-hit-line" role="button"/></svg>
    <div id="clip"><svg><path id="clipped" class="survey-hit-line" role="button"/>
      <path id="outside" class="survey-hit-line" role="button"/></svg></div>
  </body></html>`);
  const saved = new Map();
  const setGlobal = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  class GeometryFixture {
    static [Symbol.hasInstance](element) { return typeof element?.getTotalLength === 'function'; }
  }
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom, x: left, y: top,
    width: right - left, height: bottom - top, toJSON() {} });
  for (const element of document.querySelectorAll('*')) element.getBoundingClientRect = () => rect(0, 0, 390, 800);
  document.getElementById('clip').getBoundingClientRect = () => rect(40, 220, 120, 300);
  const path = (id, ax, ay, bx, by) => {
    const element = document.getElementById(id), length = Math.hypot(bx - ax, by - ay);
    element.getBoundingClientRect = () => rect(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
    element.getTotalLength = () => length;
    element.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    element.getPointAtLength = (distance) => ({ x: ax + (bx - ax) * distance / length,
      y: ay + (by - ay) * distance / length,
      matrixTransform(matrix) { return { x: this.x * matrix.a + this.y * matrix.c + matrix.e,
        y: this.x * matrix.b + this.y * matrix.d + matrix.f }; } });
  };
  path('horizontal', 20, 50, 180, 50);
  path('vertical', 230, 20, 230, 180);
  path('diagonal', 20, 100, 180, 200);
  path('clipped', -50, 260, 200, 260);
  path('outside', -50, 350, 200, 350);
  for (const [name, value] of Object.entries({
    window, document, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement,
    SVGElement: window.SVGElement, SVGGeometryElement: GeometryFixture,
    MutationObserver: window.MutationObserver,
    getComputedStyle: element => ({ display: 'block', visibility: 'visible', opacity: '1',
      pointerEvents: element.localName === 'path' ? 'stroke' : 'auto', strokeWidth: '16',
      overflowX: element.id === 'clip' ? 'hidden' : 'visible', overflowY: element.id === 'clip' ? 'hidden' : 'visible' }),
    requestAnimationFrame: callback => setTimeout(() => callback(Date.now()), 0), cancelAnimationFrame: clearTimeout,
    ResizeObserver: undefined,
  })) setGlobal(name, value);
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 390 });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 });
  window.devicePixelRatio = 2;
  const packets = [];
  let stop = () => {};
  try {
    stop = configureNativeUIRegionTransport({ getSessionId: () => 'stroke-fixture-session', send: packet => packets.push(packet) });
    await new Promise(resolve => setTimeout(resolve, 25));
  } finally {
    stop();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
  const packet = packets.find(p => p.command === 'uiRegions');
  assert.ok(packet, 'run the actual DOM collector and transport, rather than constructing a synthetic packet');
  const regions = id => packet.payload.regions.filter(r => r.id.startsWith(`${id}:`));
  const hit = (id, x, y) => regions(id).some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  assert.ok(hit('horizontal', 100, 50), 'zero-height horizontal geometry must retain its stroke hit band');
  assert.ok(hit('horizontal', 100, 57));
  assert.ok(hit('vertical', 230, 100), 'zero-width vertical geometry must retain its stroke hit band');
  assert.ok(hit('vertical', 237, 100));
  assert.equal(hit('horizontal', 100, 65), false);
  assert.ok(hit('diagonal', 100, 150));
  assert.equal(hit('diagonal', 25, 195), false, 'an empty corner of the path bounds must remain a native map hit');
  assert.ok(regions('diagonal').length > 2, 'publish sampled stroke segments, not one whole path rectangle');
  assert.ok(hit('clipped', 80, 260));
  assert.equal(hit('clipped', 20, 260), false);
  assert.ok(regions('clipped').every(r => r.left >= 40 && r.right <= 120 && r.top >= 220 && r.bottom <= 300));
  assert.equal(regions('outside').length, 0, 'entirely clipped strokes cannot steal map input');
  assert.ok(regions('horizontal').every(r => r.kind === 'overlay'));
});
