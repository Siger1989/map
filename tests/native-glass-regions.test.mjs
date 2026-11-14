import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { absolutePseudoRect, collectNativeGlassRegions, intersectGlassRect, parseNativeGlassFilter } from '../mobile/native-glass-regions.ts';
import { buildNativeUIRegionSnapshot, configureNativeUIRegionTransport, nativeUIRegionPackets } from '../mobile/native-ui-regions.ts';

const box = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top });
const baseStyle = {
  display: 'block', visibility: 'visible', opacity: '1', position: 'relative', content: 'none', transform: 'none',
  backdropFilter: 'none', overflowX: 'visible', overflowY: 'visible', pointerEvents: 'auto',
  left: 'auto', right: 'auto', top: 'auto', bottom: 'auto', width: 'auto', height: 'auto', boxSizing: 'border-box',
  borderLeftWidth: '0px', borderRightWidth: '0px', borderTopWidth: '0px', borderBottomWidth: '0px',
  borderTopLeftRadius: '23px', borderTopRightRadius: '23px', borderBottomRightRadius: '23px', borderBottomLeftRadius: '23px',
  marginLeft: '0px', marginRight: '0px', marginTop: '0px', marginBottom: '0px',
  paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px',
};

function fixture(markup, rules = {}, bounds = {}) {
  const { window, document } = parseHTML(`<!doctype html><html><head></head><body>${markup}</body></html>`);
  const saved = new Map();
  const replace = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const element of document.querySelectorAll('*')) {
    const rect = bounds[element.id] ?? box(0, 0, 390, 857);
    element.getBoundingClientRect = () => rect;
    for (const [key, value] of Object.entries({ offsetWidth: rect.width, offsetHeight: rect.height,
      clientWidth: rect.width, clientHeight: rect.height })) Object.defineProperty(element, key, { configurable: true, value });
  }
  for (const [name, value] of Object.entries({ window, document, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, SVGElement: window.SVGElement, MutationObserver: window.MutationObserver,
    ResizeObserver: undefined, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
    getComputedStyle: (element, pseudo) => {
      const style = { ...baseStyle, ...rules[element.id + (pseudo ?? '')] };
      style.getPropertyValue = name => name === '-webkit-backdrop-filter' ? style.webkitBackdropFilter ?? '' : '';
      return style;
    },
  })) replace(name, value);
  return { window, document, restore: () => {
    for (const [name, value] of saved) if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name];
  } };
}

test('computed glass filter parses percentage and unitless saturation without inventing blur', () => {
  assert.deepEqual(parseNativeGlassFilter('blur(10px) saturate(125%)'), { blur: 10, saturation: 1.25 });
  assert.deepEqual(parseNativeGlassFilter('saturate(.8) blur(3px) blur(4px)'), { blur: 5, saturation: .8 });
  assert.equal(parseNativeGlassFilter('none'), null);
  assert.equal(parseNativeGlassFilter('blur(0px) saturate(125%)'), null);
  assert.equal(parseNativeGlassFilter('blur(2em)'), null);
  assert.deepEqual(parseNativeGlassFilter('blur(500px) saturate(900%)'), { blur: 64, saturation: 3 });
});

test('only explicit comparison chrome extends named map edges; popup glass still uses normal intersection', () => {
  const f = fixture(`<main class="observatory home-map" data-comparing="true">
    <div id="a" class="map-canvas map-comparison-primary" data-native-map-id="main"></div>
    <div id="b" class="map-canvas map-comparison-secondary" data-native-map-id="aux-1"></div>
    <div class="map-comparison-ui"><header id="heading" class="map-comparison-heading"></header>
      <section class="map-comparison-pane"><div id="bar0" class="map-comparison-toolbar"></div></section>
      <section class="map-comparison-pane"><div id="bar1" class="map-comparison-toolbar"></div></section>
      <footer id="bottom" class="map-comparison-actions"></footer>
      <div id="popup" class="comparison-source-popup"></div>
    </div></main>`, Object.fromEntries(['heading','bar0','bar1','bottom','popup'].map(id => [id,{backdropFilter:'blur(10px) saturate(1.25)'}])), {
    a:box(0,68,390,424), b:box(0,456,390,813), heading:box(0,0,390,36),
    bar0:box(0,36,390,68),bar1:box(0,424,390,456),bottom:box(0,813,390,857),popup:box(10,70,260,200),
  });
  try {
    const {regions} = collectNativeGlassRegions(f.document);
    const chrome = regions.filter(region=>region.edgeExtend);
    assert.equal(chrome.length,4);
    assert.deepEqual(chrome.map(region=>region.sourceMapId),['main','main','aux-1','aux-1']);
    assert.equal(regions.find(region=>region.left===10).sourceMapId,undefined);
    assert.equal(regions.find(region=>region.left===10).edgeExtend,undefined);
  } finally { f.restore(); }
});

test('pseudo geometry uses resolved width and insets including scaling, border box and margins', () => {
  const style = { ...baseStyle, position: 'absolute', content: '""', left: '0px', right: '0px', top: '0px', height: '52px' };
  assert.deepEqual(absolutePseudoRect(box(10, 20, 790, 1734), 390, 857, style), boxRect(10, 20, 790, 124));
  const rail = { ...style, width: 'auto', height: 'auto', bottom: '0px' };
  assert.deepEqual(absolutePseudoRect(box(320, 340, 370, 666), 50, 326, rail), boxRect(320, 340, 370, 666));
  const rightAligned = { ...style, left: 'auto', right: '8px', width: '40px', marginRight: '2px' };
  assert.deepEqual(absolutePseudoRect(box(10, 20, 110, 220), 100, 200, rightAligned), boxRect(60, 20, 100, 72));
  assert.equal(absolutePseudoRect(box(0, 0, 100, 100), 100, 100, baseStyle), null, 'no guessed static position');
  assert.equal(intersectGlassRect(boxRect(0, 0, 20, 20), boxRect(25, 25, 30, 30)), null);
});
function boxRect(left, top, right, bottom) { return { left, top, right, bottom }; }

test('DOM collector covers header and rail pseudo surfaces, dual menus and portals, but not hidden or inert hosts', () => {
  const filter = { backdropFilter: 'blur(10px) saturate(125%)' };
  const rules = {
    'home::before': { ...filter, position: 'absolute', content: '""', left: '0px', right: '0px', top: '0px', height: '52px', borderTopLeftRadius: '0px', borderTopRightRadius: '0px', borderBottomRightRadius: '0px', borderBottomLeftRadius: '0px' },
    'rail::before': { ...filter, position: 'absolute', content: '""', left: '0px', right: '0px', top: '0px', bottom: '0px' },
    fade: { opacity: '.5' }, panel: filter, dual: filter,
    portal: { backdropFilter: 'none', webkitBackdropFilter: 'blur(10px) saturate(125%)' },
    clip: { overflowX: 'hidden', overflowY: 'auto' }, cropped: filter,
    hidden: { display: 'none' }, hiddenPanel: filter, inertPanel: filter,
    noBlur: { backdropFilter: 'none' }, transparent: { ...filter, opacity: '0' },
  };
  const env = fixture(`<main id="home" class="observatory home-map">
    <div id="fade"><section id="panel" class="home-recording-panel glass"></section></div>
    <aside id="rail" class="home-position-dock"></aside>
    <section id="dual" class="comparison-layer-window"></section>
    <div id="clip"><section id="cropped" class="route-dialog"></section></div>
    <div id="hidden"><section id="hiddenPanel" class="glass"></section></div>
    <section id="inertPanel" class="glass" inert></section><section id="noBlur" class="glass"></section>
    <section id="transparent" class="glass"></section></main><section id="portal" class="collection-action-dialog"></section>`, rules,
  { panel: box(16, 100, 286, 300), rail: box(320, 340, 370, 666), dual: box(200, 70, 360, 160),
    portal: box(30, 30, 260, 180), clip: box(10, 400, 200, 450), cropped: box(0, 390, 210, 460) });
  try {
    const { regions, elements } = collectNativeGlassRegions(env.document);
    assert.equal(regions.length, 6);
    assert.deepEqual(regions[0], { ...boxRect(0, 0, 390, 52), radii: [0, 0, 0, 0], blur: 10, saturation: 1.25, opacity: 1 });
    const byId = id => regions[elements.findIndex(e => e.id === id)];
    assert.equal(byId('panel').opacity, .5);
    assert.deepEqual(byId('rail'), { ...boxRect(320, 340, 370, 666), radii: [23, 23, 23, 23], blur: 10, saturation: 1.25, opacity: 1 });
    assert.ok(byId('dual')); assert.ok(byId('portal'));
    assert.deepEqual(byId('cropped'), { ...boxRect(10, 400, 200, 450), radii: [0, 0, 0, 0], blur: 10, saturation: 1.25, opacity: 1 });
    assert.equal(elements.filter(e => e.id === 'panel').length, 1, 'multiple matching selectors do not duplicate a surface');
  } finally { env.restore(); }
});

test('native snapshot routes glass only to uiRegions and retains independent main/dual map viewports', () => {
  const glass = [{ ...boxRect(1, 2, 10, 20), radii: [2, 2, 2, 2], blur: 10, saturation: 1.25, opacity: 1 }];
  const views = [{ mapId: 'primary', ...boxRect(0, 0, 190, 800) }, { mapId: 'secondary', ...boxRect(195, 0, 390, 800) }];
  const [ui, viewport] = nativeUIRegionPackets(buildNativeUIRegionSnapshot([], views, 390, 800, 3, false, glass));
  assert.deepEqual(ui.payload.glassRegions, glass);
  assert.equal('glassRegions' in viewport.payload, false);
  assert.deepEqual(viewport.payload.viewports, views);
});

test('box selection action card is a native glass host without claiming its full-screen gesture surface', () => {
  const env = fixture(`<div class="map-box-selection"><div id="surface" class="map-box-surface"></div>
    <div id="tools" class="map-box-tools"><strong>框选 · 已选 0 项</strong><button>退出</button></div></div>`, {
    tools: { backdropFilter: 'blur(10px) saturate(125%)' },
  }, { tools: box(8, 650, 308, 760) });
  try {
    const { regions, elements } = collectNativeGlassRegions(env.document);
    assert.equal(regions.length, 1);
    assert.equal(elements[0].id, 'tools');
    assert.deepEqual(regions[0], { ...boxRect(8, 650, 308, 760), radii: [23, 23, 23, 23], blur: 10, saturation: 1.25, opacity: 1 });
  } finally { env.restore(); }
});

test('dual source popup samples its full rectangle beyond its unfiltered toolbar and pane', () => {
  const env = fixture(`<main id="home" class="observatory home-map"><section id="dualUi" class="map-comparison-ui">
    <div id="panes" class="map-comparison-panes"><div id="pane" class="map-comparison-pane">
      <div id="toolbar" class="map-comparison-toolbar"><div id="picker" class="comparison-source-picker">
        <button class="comparison-source-trigger">上方图源</button>
        <div id="popup" class="comparison-source-popup" role="dialog"><section class="comparison-source-group">
          <div class="comparison-source-row"><button role="option">天地图影像</button></div>
        </section></div>
      </div></div></div></div></section></main>`, {
    home: { overflowX: 'clip', overflowY: 'clip' },
    toolbar: { backdropFilter: 'none' },
    popup: { backdropFilter: 'blur(10px) saturate(125%)', overflowY: 'auto', overflowX: 'auto' },
  }, {
    home: box(0, 0, 390, 857), dualUi: box(0, 0, 390, 857), panes: box(0, 36, 390, 813),
    pane: box(0, 36, 390, 424), toolbar: box(0, 36, 390, 68), picker: box(32, 38, 284, 66),
    popup: box(32, 68, 282, 468),
  });
  try {
    const { regions, elements } = collectNativeGlassRegions(env.document);
    assert.equal(regions.length, 1);
    assert.equal(elements[0].id, 'popup');
    assert.deepEqual(regions[0], { ...boxRect(32, 68, 282, 468), radii: [23, 23, 23, 23], blur: 10, saturation: 1.25, opacity: 1 },
      'a visible-overflow toolbar/pane does not clip its absolutely positioned source menu');
  } finally { env.restore(); }
});

test('live session republishes material changes and removal, then clears native glass on cleanup', async () => {
  const rules = { panel: { backdropFilter: 'blur(10px) saturate(125%)' } };
  const env = fixture('<section id="panel" class="home-recording-panel"></section>', rules, { panel: box(16, 100, 286, 300) });
  const packets = []; let stop = () => {};
  try {
    stop = configureNativeUIRegionTransport({ getSessionId: () => 'glass-session', send: packet => packets.push(packet) });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(packets.find(p => p.command === 'uiRegions').payload.glassRegions[0].blur, 10);
    rules.panel.backdropFilter = 'blur(14px) saturate(120%)';
    env.window.dispatchEvent(new env.window.Event('shantu-material-change'));
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(packets.filter(p => p.command === 'uiRegions').at(-1).payload.glassRegions[0].blur, 14);
    const panel = env.document.getElementById('panel');
    panel.getBoundingClientRect = () => box(36, 100, 306, 300);
    panel.dispatchEvent(new env.window.Event('transitionrun', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 85));
    assert.equal(packets.filter(p => p.command === 'uiRegions').at(-1).payload.glassRegions[0].left, 36,
      'CSS transition movement republishes glass without a DOM mutation or resize');
    env.document.getElementById('panel').setAttribute('inert', '');
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(packets.filter(p => p.command === 'uiRegions').at(-1).payload.glassRegions, []);
    stop(); stop = () => {};
    assert.deepEqual(packets.at(-1).payload.glassRegions, []);
  } finally { stop(); env.restore(); }
});

test('collector bounds native work to 32 surfaces', () => {
  const rules = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, { backdropFilter: 'blur(10px)' }]));
  const bounds = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, box(i, i, i + 50, i + 50)]));
  const env = fixture(Array.from({ length: 40 }, (_, i) => `<section id="p${i}" class="glass"></section>`).join(''), rules, bounds);
  try { assert.equal(collectNativeGlassRegions(env.document).regions.length, 32); } finally { env.restore(); }
});

test('fractional viewport rounding preserves card corners while real clipping still removes them', () => {
  const env = fixture('<footer id="footer" class="map-toolbar"></footer>', {
    footer: { backdropFilter: 'blur(10px)', borderBottomRightRadius: '0px', borderBottomLeftRadius: '0px' },
  }, { footer: box(0, 778.175, 391.146, 834) });
  Object.defineProperty(env.document.documentElement, 'clientWidth', { configurable: true, value: 391 });
  Object.defineProperty(env.document.documentElement, 'clientHeight', { configurable: true, value: 834 });
  const footer = env.document.getElementById('footer');
  try {
    let region = collectNativeGlassRegions(env.document).regions[0];
    assert.equal(region.right, 391, 'paint bounds remain clipped to the viewport');
    assert.deepEqual(region.radii, [23, 23, 0, 0]);
    footer.getBoundingClientRect = () => box(0, 778.175, 392, 834);
    region = collectNativeGlassRegions(env.document).regions[0];
    assert.ok(region.radii[1] > 0, 'one CSS pixel is included in the rounding tolerance');
    footer.getBoundingClientRect = () => box(0, 778.175, 397, 834);
    region = collectNativeGlassRegions(env.document).regions[0];
    assert.equal(region.radii[1], 0, 'six CSS pixels is real clipping, not rounding');
  } finally { env.restore(); }
});
