import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createSession, STORAGE_KEY } from '../modules/uiLayout/session.mjs';
import { emptyLayout } from '../modules/uiLayout/model.mjs';
import { defaults } from '../modules/uiLayout/selection.mjs';
import {
  downloadLayout,
  bindLayoutActions,
  requestLayoutAction,
} from '../modules/uiLayout/transfer.mjs';
import { layerPatches, layerPositionCss } from '../modules/uiLayout/layers.mjs';
const fixture = () => {
  const { document: doc, window } = parseHTML(
    '<html><head></head><body><main class="observatory"><nav id="owner"><section id="child"></section></nav><section id="other"></section><div id="static"></div></main></body></html>',
  );
  window.CSS = { escape: (s) => s };
  window.innerWidth = 390;
  window.innerHeight = 844;
  window.getComputedStyle = (el) => ({
    position: el.id === 'owner' || el.id === 'other' ? 'absolute' : 'static',
    zIndex: el.id === 'owner' ? '12' : el.id === 'other' ? '40' : 'auto',
    display: 'block',
    opacity: '1',
    visibility: 'visible',
    scale: 'none',
    transform: 'none',
    zoom: '1',
  });
  for (const el of doc.querySelectorAll('*'))
    el.getBoundingClientRect = () => ({
      left: 20,
      top: 30,
      right: 120,
      bottom: 80,
      width: 100,
      height: 50,
    });
  return { doc, window };
};
test('loading an older saved layout performs no storage writes and native JSON export preserves its settings', () => {
  const { doc, window } = fixture(),
    layout = {
      ...emptyLayout(),
      entries: [
        {
          ...defaults('#child', '旧布局'),
          dx: 23,
          dy: -7,
          scale: 0.7,
          width: 144,
          fontSize: 12,
          zIndex: 6,
          anchor: {
            reference: '#owner',
            x: 'right',
            y: 'top',
            gapX: 8,
            gapY: 4,
          },
        },
      ],
    };
  const raw = JSON.stringify(layout);
  let writes = 0,
    exported;
  const session = createSession(doc, {
    getItem: (key) => {
      assert.equal(key, STORAGE_KEY);
      return raw;
    },
    setItem: () => writes++,
  });
  assert.equal(writes, 0);
  assert.deepEqual(session.layout, layout);
  window.GuanyunNative = {
    saveFile: (name, mime, text) => (exported = { name, mime, text }),
  };
  assert.match(downloadLayout(session.layout, window), /保存/);
  assert.equal(exported.name, 'shantu-layout-draft.json');
  assert.deepEqual(JSON.parse(exported.text), layout);
  assert.equal(writes, 0);
  assert.throws(() => session.import('{invalid'));
  assert.deepEqual(session.layout, layout);
  session.dispose();
});
test('avatar actions use the current manager and clean up listeners instead of adding another layout session', async () => {
  const { window } = fixture();
  let raw = '';
  const unbind = bindLayoutActions(window, {
    export: () => 'download requested',
    import: (text) => {
      raw = text;
      return 'imported';
    },
  });
  assert.equal(
    await requestLayoutAction('export', '', window),
    'download requested',
  );
  assert.equal(
    await requestLayoutAction('import', 'draft', window),
    'imported',
  );
  assert.equal(raw, 'draft');
  unbind();
  await assert.rejects(requestLayoutAction('export', '', window), /尚未就绪/);
});
test('page layers cross the owning parent while group layers remain local and preserve saved geometry', () => {
  const { doc } = fixture(),
    owner = { ...defaults('#owner', '父组'), dx: 23, scale: 0.8 },
    child = {
      element: doc.getElementById('child'),
      entry: defaults('#child', '子项'),
    };
  const own = layerPatches([child], 1, 'group', [owner]);
  assert.equal(own[0].selector, '#child');
  const page = layerPatches([child], 1, 'page', [owner]);
  assert.equal(page[0].selector, '#owner');
  assert.equal(page[0].zIndex, 41);
  assert.equal(page[0].dx, 23);
  assert.equal(page[0].scale, 0.8);
  assert.equal(owner.zIndex, undefined);
  const css = layerPositionCss(
    doc,
    [{ ...defaults('#static', '静态块'), zIndex: 5 }],
    '.observatory',
  );
  assert.match(css, /position:relative/);
});
