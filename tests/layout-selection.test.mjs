import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import {
  pick,
  selectable,
  hierarchy,
  selectionRoots,
} from '../modules/uiLayout/selection.mjs';
import { createSession, STORAGE_KEY } from '../modules/uiLayout/session.mjs';
import { batchPatches, bounds } from '../modules/uiLayout/geometry.mjs';
import { mountEditor } from '../modules/uiLayout/mobileEditor.mjs';

function fixture() {
  const { document: doc, window } =
    parseHTML(`<html><head></head><body><main class="observatory">
    <nav class="position-dock"><button class="position-dock-button" aria-label="定位">定位</button>
      <div class="route-display-control"><button class="position-dock-button">海拔</button>
        <aside class="route-display-info"><section class="route-color-legend glass"><strong>路线海拔</strong><div class="route-color-ramp"></div></section>
        <section class="route-elevation-stats glass"><span>493–497m</span></section><section class="route-elevation-profile glass"><svg><path/></svg></section></aside>
      </div></nav>
    <div class="track-tools glass" aria-label="绘制工具"><div class="track-drawing-style"><input type="color"><select><option>1.5px</option></select></div><button>道路吸附</button><button>完成</button></div>
    <section class="unknown-future-panel" aria-label="新增功能"><button>保存</button></section>
    <div class="maplibregl-map"><div class="maplibregl-canvas-container"><canvas class="maplibregl-canvas"></canvas></div></div>
    </main><div data-layout-ignore><button>编辑器</button></div></body></html>`);
  window.CSS = { escape: (s) => s.replace(/[^a-z0-9_-]/gi, (c) => `\\${c}`) };
  window.getComputedStyle = (node) => ({
    visibility: node.hasAttribute('hidden') ? 'hidden' : 'visible',
    scale: 'none',
    transform: 'none',
    zoom: '1',
  });
  for (const node of doc.querySelectorAll('*'))
    node.getBoundingClientRect = () => ({
      left: 10,
      top: 20,
      width: 100,
      height: 40,
      right: 110,
      bottom: 60,
    });
  window.innerWidth = 390;
  window.innerHeight = 844;
  const selectValue = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    'value',
  );
  if (!selectValue.set)
    Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
      configurable: true,
      get: selectValue.get,
      set(value) {
        for (const option of this.querySelectorAll('option'))
          option.selected = option.value === value;
      },
    });
  return doc;
}

test('whole-component picking reaches the route information outer frame, while hierarchy exposes its contents', () => {
  const doc = fixture();
  doc.elementFromPoint = () => doc.querySelector('.route-color-legend strong');
  assert.equal(pick(doc, 0, 0, 'group').selector, '.route-display-info');
  const levels = hierarchy(doc.querySelector('.route-color-legend'));
  assert.ok(
    levels.some(
      (l) => l.selector === '.route-display-info' && l.relation === 'parent',
    ),
  );
  assert.ok(
    levels.some(
      (l) => l.selector === '.route-color-ramp' && l.relation === 'content',
    ),
  );
  assert.ok(!levels.some((l) => l.element.matches('body,main')));
});

test('drawing toolbar, unknown semantic panels and covered controls are discoverable without whitelist maintenance', () => {
  const doc = fixture();
  doc.elementFromPoint = () => doc.querySelector('.track-drawing-style input');
  assert.equal(pick(doc, 0, 0, 'group').selector, '.track-tools');
  assert.equal(pick(doc, 0, 0, 'control').element.localName, 'input');
  assert.ok(
    selectable(doc, 'group').some(
      (c) => c.selector === '.unknown-future-panel',
    ),
  );
  assert.ok(selectable(doc, 'control', '道路吸附').length === 1);
  assert.ok(
    selectable(doc, 'element').some((c) => c.selector === '.route-color-ramp'),
  );
  assert.ok(
    !selectable(doc, 'element').some((c) =>
      c.element.closest('[data-layout-ignore]'),
    ),
  );
  doc.elementFromPoint = () => doc.querySelector('canvas');
  assert.equal(pick(doc, 0, 0, 'group'), null);
  assert.equal(pick(doc, 0, 0, 'element'), null);
});

test('touch selection sees through its editing cover and stable controls retain selectors after state changes', () => {
  const doc = fixture(),
    target = doc.querySelector('.position-dock > button');
  doc.elementsFromPoint = () => [
    doc.querySelector('[data-layout-ignore] button'),
    target,
  ];
  assert.equal(
    pick(doc, 1, 1, 'control').selector,
    '.position-dock > .position-dock-button',
  );
  target.setAttribute('aria-label', '正在跟随');
  assert.equal(
    pick(doc, 1, 1, 'control').selector,
    '.position-dock > .position-dock-button',
  );
  const roots = selectionRoots([
    { element: target },
    { element: target.parentElement },
  ]);
  assert.deepEqual(
    roots.map((i) => i.element),
    [target.parentElement],
  );
});

test('multi-selection resizing respects spacing, scaled parents and one grouped frame', () => {
  const a = {
    entry: { dx: 0, dy: 0, scale: 1 },
    rect: { left: 20, top: 10, right: 120, bottom: 60 },
    box: { width: 200, height: 100 },
    parentScale: { x: 0.5, y: 0.5 },
  };
  const b = {
    entry: { dx: 5, dy: 6, scale: 1 },
    rect: { left: 150, top: 10, right: 200, bottom: 60 },
    box: { width: 50, height: 50 },
    parentScale: { x: 1, y: 1 },
  };
  const frame = bounds([a, b]);
  assert.equal(frame.width, 180);
  const result = batchPatches([a, b], frame, {
    width: 360,
    height: 100,
    dx: 10,
    dy: -5,
  });
  assert.equal(result[0].next.width, 400);
  assert.equal(result[0].next.dx, 20);
  assert.equal(result[1].next.dx, 145);
  assert.equal(result[1].target.left - result[0].target.left, 260);
});

test('on-device changes save, reopen, undo as one batch and cannot hide the recovery UI', () => {
  const doc = fixture(),
    values = new Map(),
    storage = {
      getItem: (k) => values.get(k),
      setItem: (k, v) => values.set(k, v),
    };
  const session = createSession(doc, storage);
  session.select('.track-tools', '绘制工具');
  session.select('.route-display-info', '路线信息', true);
  session.update({ dx: 15, dy: -5 });
  assert.equal(session.layout.entries.length, 2);
  assert.ok(session.layout.entries.every((e) => e.dx === 15 && e.dy === -5));
  session.history();
  assert.equal(session.layout.entries.length, 0);
  session.history(true);
  assert.equal(session.layout.entries.length, 2);
  assert.equal(session.save(), true);
  assert.ok(values.has(STORAGE_KEY));
  session.update({ dx: 30 });
  session.cancel();
  assert.equal(session.layout.entries[0].dx, 15);
  session.dispose();
  const reopened = createSession(doc, storage);
  assert.equal(reopened.layout.entries[1].dx, 15);
  assert.match(doc.head.textContent, /\.observatory :is\(\.track-tools\)/);
  assert.equal(reopened.dirty, false);
  reopened.dispose();
});

test('invalid imports and failed storage writes preserve the saved layout', () => {
  const doc = fixture();
  let raw = '{bad';
  const storage = {
    getItem: () => raw,
    setItem: () => {
      throw Error('quota');
    },
  };
  const s = createSession(doc, storage);
  assert.match(s.message, /无法读取/);
  assert.throws(() => s.import('{bad'));
  assert.equal(raw, '{bad');
  s.select('.track-tools', '绘制工具');
  s.update({ scale: 1.1 });
  assert.equal(s.save(), false);
  assert.equal(s.dirty, true);
  s.cancel();
  assert.equal(s.layout.entries.length, 0);
  s.dispose();
});

test('phone editor has no component list and closes through its compact controls', () => {
  const doc = fixture();
  const s = createSession(doc, { getItem: () => null, setItem: () => {} });
  let closed = false;
  const close = mountEditor(s, () => {
    closed = true;
  });
  try {
    assert.equal(
      doc.querySelectorAll('.layout-mobile [data-resize]').length,
      8,
    );
    assert.equal(doc.querySelector('.layout-mobile [multiple]'), null);
    doc.querySelector('[data-action="mode"]').onclick();
    assert.ok(
      doc.querySelector('.layout-mobile-cover').classList.contains('operating'),
    );
    doc.querySelector('[data-action="multi"]').onclick();
    assert.equal(
      doc.querySelector('[data-action="multi"]').getAttribute('aria-pressed'),
      'true',
    );
    doc.querySelector('[data-action="exit"]').onclick();
    assert.equal(closed, true);
    assert.equal(doc.querySelector('.layout-mobile'), null);
  } finally {
    close();
    s.dispose();
  }
});
