import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { buildNativeUIRegionSnapshot, configureNativeUIRegionTransport, nativeMapIdFor, nativeUIRegionPackets } from '../mobile/native-ui-regions.ts';

test('native map viewport ids honor explicit ids and the existing comparison pane classes', () => {
  const has = (name) => ({ contains: (value) => value === name });
  assert.equal(nativeMapIdFor({ dataset: { nativeMapId: 'terrain-left' }, classList: has('') }, 0), 'terrain-left');
  assert.equal(nativeMapIdFor({ dataset: {}, classList: has('map-comparison-primary') }, 0), 'primary');
  assert.equal(nativeMapIdFor({ dataset: {}, classList: has('map-comparison-secondary') }, 1), 'secondary');
  assert.equal(nativeMapIdFor({ dataset: {}, classList: has('') }, 0), 'primary');
  assert.equal(nativeMapIdFor({ dataset: {}, classList: has('') }, 1), 'map-2');
});

test('published hit regions and independent map viewports retain CSS-pixel geometry and DPR', () => {
  const snapshot = buildNativeUIRegionSnapshot(
    [{ id: 'edit-name', kind: 'control', left: 8, top: 32, right: 48, bottom: 60 }],
    [
      { mapId: 'primary', left: 0, top: 0, right: 190, bottom: 800 },
      { mapId: 'secondary', left: 196, top: 0, right: 390, bottom: 800 },
    ],
    390, 800, 2.75, false,
  );
  assert.deepEqual(snapshot, {
    clientViewportWidth: 390,
    clientViewportHeight: 800,
    devicePixelRatio: 2.75,
    modalActive: false,
    regions: [{ id: 'edit-name', kind: 'control', left: 8, top: 32, right: 48, bottom: 60 }],
    viewports: [
      { mapId: 'primary', left: 0, top: 0, right: 190, bottom: 800 },
      { mapId: 'secondary', left: 196, top: 0, right: 390, bottom: 800 },
    ],
  });
  const packets = nativeUIRegionPackets(snapshot);
  assert.deepEqual(packets.map(({ command }) => command), ['uiRegions', 'viewport']);
  assert.deepEqual(packets[0].payload.regions, snapshot.regions);
  assert.deepEqual(packets[1].payload.viewports, snapshot.viewports);
  assert.equal('viewports' in packets[0].payload, false);
  assert.equal('regions' in packets[1].payload, false);
});

test('mobile entry only installs the publisher; ordinary browser styling is gated on host-ready', async () => {
  const [main, publisher] = await Promise.all([
    readFile(new URL('../mobile/main.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../mobile/native-ui-regions.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(main, /installNativeUIRegions\(\)/);
  assert.match(publisher, /shantu:native-map-ready/);
  assert.match(publisher, /applyNativeMapHostStyle\(\)/);
  assert.match(publisher, /if \(running \|\| !transport \|\| !nativeSession/);
  assert.doesNotMatch(publisher, /window\.ShantuNativeMap\s*=/);
});

test('native resume and foreground restoration force current DOM hit regions and viewports to publish again', async () => {
  const publisher = await readFile(new URL('../mobile/native-ui-regions.ts', import.meta.url), 'utf8');
  assert.match(publisher, /window\.addEventListener\('shantu:native-map-resume', resume\)/);
  assert.match(publisher, /window\.addEventListener\('focus', resume\)/);
  assert.match(publisher, /document\.addEventListener\('visibilitychange', visibility\)/);
  assert.match(publisher, /mutation\.observe\(document\.body, \{ subtree: true, childList: true, characterData: true/);
  assert.match(publisher, /const forcePublish = \(\) => \{[\s\S]*?lastUiFingerprint = '';[\s\S]*?lastViewportFingerprint = '';[\s\S]*?schedule\(\);/);
  assert.match(publisher, /window\.removeEventListener\('shantu:native-map-resume', resume\)/);
  assert.match(publisher, /document\.removeEventListener\('visibilitychange', visibility\)/);
});

test('publisher sends visible import labels and transparent file inputs but excludes hidden picker DOM', async () => {
  const { window, document } = parseHTML(`<!doctype html><html><head></head><body>
    <label id="photo-import-label" class="import-file"><span>导入照片</span><input id="photo-import-input" type="file" style="position:absolute;opacity:0"></label>
    <input id="transparent-file-only" type="file" style="opacity:0">
    <label id="hidden-label" class="import-file" hidden><input id="hidden-file" type="file"></label>
    <div class="invisible-ancestor"><label id="invisible-label" class="import-file"><input id="invisible-file" type="file" style="opacity:0"></label></div>
    <div class="display-none-ancestor"><label id="display-none-label" class="import-file"><input id="display-none-file" type="file" style="opacity:0"></label></div>
    <label id="pointer-disabled-label" class="import-file" style="pointer-events:none"><input id="pointer-disabled-file" type="file" style="pointer-events:none;opacity:0"></label>
  </body></html>`);
  const saved = new Map();
  const setGlobal = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  for (const [name, value] of Object.entries({
    window, document,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    SVGElement: window.SVGElement,
    MutationObserver: window.MutationObserver,
    getComputedStyle: (element) => {
      const declarations = Object.fromEntries((element.getAttribute('style') ?? '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
        const index = part.indexOf(':');
        return [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()];
      }));
      const has = (name) => element.classList?.contains(name);
      return {
        display: element.hasAttribute('hidden') || has('display-none-ancestor') ? 'none' : declarations.display ?? 'block',
        visibility: has('visibility-hidden-ancestor') ? 'hidden' : declarations.visibility ?? 'visible',
        opacity: has('invisible-ancestor') ? '0' : declarations.opacity ?? '1',
        pointerEvents: declarations['pointer-events'] ?? 'auto',
        overflowX: declarations['overflow-x'] ?? 'visible',
        overflowY: declarations['overflow-y'] ?? 'visible',
        strokeWidth: declarations['stroke-width'] ?? '8',
      };
    },
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: clearTimeout,
    ResizeObserver: undefined,
  })) setGlobal(name, value);
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 390 });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 });
  window.devicePixelRatio = 2;
  const visible = { left: 20, top: 30, right: 120, bottom: 70, width: 100, height: 40 };
  for (const element of document.querySelectorAll('label,input')) element.getBoundingClientRect = () => ({ ...visible, x: visible.left, y: visible.top, toJSON() {} });

  const sent = [];
  let stop = () => {};
  try {
    stop = configureNativeUIRegionTransport({ getSessionId: () => 'test-session', send: (packet) => sent.push(packet) });
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    stop();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }

  const uiPacket = sent.find((packet) => packet.command === 'uiRegions');
  assert.ok(uiPacket, 'publisher must use the live DOM collection and send a uiRegions packet');
  const ids = uiPacket.payload.regions.map(({ id }) => id);
  assert.ok(ids.some((id) => id.startsWith('photo-import-label:')));
  assert.ok(ids.some((id) => id.startsWith('photo-import-input:')));
  assert.ok(ids.some((id) => id.startsWith('transparent-file-only:')));
  assert.equal(ids.some((id) => /hidden-label|hidden-file|invisible-label|invisible-file|display-none-label|display-none-file/.test(id)), false);
  assert.equal(ids.some((id) => /pointer-disabled-label|pointer-disabled-file/.test(id)), false);
});
