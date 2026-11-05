import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { applyInputColor, hexToHsv, hsvToHex, normalizeHexColor } from '../modules/appearance/colorSelection.ts';

const require = createRequire(import.meta.url);
let pickerModule;

async function loadPicker() {
  if (!pickerModule) pickerModule = (async () => {
    const result = await build({
      entryPoints: ['modules/appearance/AppColorPicker.tsx'],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      packages: 'external',
      jsx: 'automatic',
      loader: { '.css': 'empty' },
      logLevel: 'silent',
    });
    const module = { exports: {} };
    // Keep the compiled fixture in memory; external React resolves to the same test instance.
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
    return module.exports;
  })();
  return pickerModule;
}

function setupDom() {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  // linkedom dispatches input events but does not expose this browser feature-detection property.
  // Advertise that support before importing react-dom; do not replace React's change handlers.
  window.document.oninput = null;
  const globals = {
    window, document: window.document, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const descriptors = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return {
    window,
    restore() {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

async function mount(t) {
  const dom = setupDom();
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { AppColorPicker } = await loadPicker();
  const changes = [];
  let current;
  function ControlledInputs() {
    const [colors, setColors] = React.useState({ navigation: '#123456', drawing: '#abcdef' });
    current = colors;
    return React.createElement(React.Fragment, null,
      ...Object.entries(colors).map(([name, value]) => React.createElement('input', {
        key: name, type: 'color', 'aria-label': `${name} color`, value,
        onChange(event) {
          const next = event.currentTarget.value;
          changes.push({ name, value: next });
          setColors(old => ({ ...old, [name]: next }));
        },
      })),
      React.createElement('output', { 'data-testid': 'controlled-values' }, JSON.stringify(colors)),
      React.createElement(AppColorPicker),
    );
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    try { await React.act(async () => root.unmount()); }
    finally { dom.restore(); }
  });
  await React.act(async () => root.render(React.createElement(ControlledInputs)));
  const input = name => document.querySelector(`input[aria-label="${name} color"]`);
  const dialog = () => document.querySelector('[role="dialog"][aria-label="选择颜色"]');
  const click = async node => {
    assert.ok(node, 'click target exists');
    const event = new dom.window.Event('click', { bubbles: true, cancelable: true });
    await React.act(async () => node.dispatchEvent(event));
    return event;
  };
  const type = async (node, value) => {
    assert.ok(node, 'input target exists');
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    await React.act(async () => {
      setter.call(node, value);
      node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  return {
    ...dom, act: React.act, changes, input, dialog, click, type,
    get values() { return current; },
    renderedValues: () => JSON.parse(document.querySelector('[data-testid="controlled-values"]').textContent),
  };
}

test('HEX accepts exactly six digits and normalizes case without accepting partial or alpha colors', () => {
  for (const [value, expected] of [
    ['#000000', '#000000'], ['ffffff', '#ffffff'], ['  #Ab09F1  ', '#ab09f1'],
  ]) assert.equal(normalizeHexColor(value), expected);
  for (const value of ['', '#', '#abc', '#12345', '#1234567', '#12345678', '#gg0000', '##abcdef', 'red']) {
    assert.equal(normalizeHexColor(value), null, value);
  }
});

test('HSV preserves RGB boundary colors and handles hue wrapping, grayscale and channel clamps', () => {
  for (const [hue, expected] of [
    [0, '#ff0000'], [60, '#ffff00'], [120, '#00ff00'], [180, '#00ffff'],
    [240, '#0000ff'], [300, '#ff00ff'], [360, '#ff0000'], [720, '#ff0000'], [-60, '#ff00ff'],
  ]) assert.equal(hsvToHex(hue, 1, 1), expected);
  assert.equal(hsvToHex(180, 0, 0.5), '#808080');
  assert.equal(hsvToHex(90, 1, 0), '#000000');
  assert.equal(hsvToHex(0, 2, 2), '#ff0000');
  assert.equal(hsvToHex(90, -1, 1), '#ffffff');
  assert.equal(hsvToHex(90, 1, -1), '#000000');
  assert.deepEqual(hexToHsv('#000000'), { h: 0, s: 0, v: 0 });
  assert.deepEqual(hexToHsv('#ffffff'), { h: 0, s: 0, v: 1 });
  for (const r of [0, 1, 127, 128, 254, 255]) for (const g of [0, 1, 127, 128, 254, 255]) for (const b of [0, 1, 127, 128, 254, 255]) {
    const hex = '#' + [r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('');
    const { h, s, v } = hexToHsv(hex);
    assert.equal(hsvToHex(h, s, v), hex, `RGB/HSV round trip ${hex}`);
  }
});

test('applyInputColor reaches the real React onChange and persists the controlled value exactly once', async t => {
  const f = await mount(t);
  let applied;
  await f.act(async () => { applied = applyInputColor(f.input('navigation'), 'Aa09F1'); });
  assert.equal(applied, true);
  assert.deepEqual(f.changes, [{ name: 'navigation', value: '#aa09f1' }]);
  assert.deepEqual(f.values, { navigation: '#aa09f1', drawing: '#abcdef' });
  assert.deepEqual(f.renderedValues(), f.values);
  assert.equal(f.input('navigation').value, '#aa09f1');
  assert.equal(f.input('drawing').value, '#abcdef');
});

test('invalid, disabled, read-only, detached and non-color inputs are unchanged without change events', async t => {
  const f = await mount(t);
  const input = f.input('navigation');
  const events = [];
  for (const type of ['input', 'change']) input.addEventListener(type, () => events.push(type));
  for (const value of ['#abc', '#1234567', 'not-a-color']) assert.equal(applyInputColor(input, value), false);
  input.disabled = true;
  assert.equal(applyInputColor(input, '#ff0000'), false);
  await f.click(input);
  assert.equal(f.dialog(), null, 'disabled color input does not open a chooser');
  input.disabled = false;
  input.readOnly = true;
  assert.equal(applyInputColor(input, '#ff0000'), false);
  await f.click(input);
  assert.equal(f.dialog(), null, 'read-only color input does not open a chooser');
  input.readOnly = false;
  input.type = 'text';
  assert.equal(applyInputColor(input, '#ff0000'), false);
  input.type = 'color';
  const detached = document.createElement('input');
  detached.type = 'color'; detached.value = '#123456';
  assert.equal(applyInputColor(detached, '#ff0000'), false);
  assert.equal(detached.value, '#123456');
  assert.deepEqual(events, []);
  assert.deepEqual(f.changes, []);
  assert.deepEqual(f.values, { navigation: '#123456', drawing: '#abcdef' });
  assert.equal(input.value, '#123456');
});

test('choosing red applies immediately to the controlled input and closes without confirmation', async t => {
  const f = await mount(t);
  const event = await f.click(f.input('navigation'));
  assert.equal(event.defaultPrevented, true, 'the shared picker suppresses the system color chooser');
  assert.ok(f.dialog());
  assert.equal(f.dialog().querySelectorAll('[data-color]').length, 18);
  assert.equal([...f.dialog().querySelectorAll('button')].some(button => /确认|确定|应用/.test(button.textContent)), false);
  await f.click(f.dialog().querySelector('button[aria-label="红色"]'));
  assert.equal(f.dialog(), null);
  assert.deepEqual(f.changes, [{ name: 'navigation', value: '#e41a1c' }]);
  assert.deepEqual(f.renderedValues(), { navigation: '#e41a1c', drawing: '#abcdef' });
});

test('close, backdrop cancellation and Escape leave both controlled values unchanged', async t => {
  const f = await mount(t);
  await f.click(f.input('navigation'));
  await f.click(f.dialog().querySelector('[aria-label="关闭颜色选择"]'));
  assert.equal(f.dialog(), null);
  await f.click(f.input('navigation'));
  await f.act(async () => document.querySelector('.app-color-picker-backdrop')
    .dispatchEvent(new f.window.Event('pointerdown', { bubbles: true })));
  assert.equal(f.dialog(), null);
  await f.click(f.input('drawing'));
  const escape = new f.window.Event('keydown', { bubbles: true, cancelable: true });
  escape.key = 'Escape';
  await f.act(async () => f.dialog().dispatchEvent(escape));
  assert.equal(escape.defaultPrevented, true);
  assert.equal(f.dialog(), null);
  assert.deepEqual(f.changes, []);
  assert.deepEqual(f.renderedValues(), { navigation: '#123456', drawing: '#abcdef' });
});

test('a second color entry uses the same palette and updates only its own controlled value', async t => {
  const f = await mount(t);
  await f.click(f.input('navigation'));
  const palette = [...f.dialog().querySelectorAll('[data-color]')].map(button => button.dataset.color);
  await f.click(f.dialog().querySelector('[aria-label="关闭颜色选择"]'));
  await f.click(f.input('drawing'));
  assert.deepEqual([...f.dialog().querySelectorAll('[data-color]')].map(button => button.dataset.color), palette);
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
  await f.click(f.dialog().querySelector('[aria-label="蓝色"]'));
  assert.equal(f.dialog(), null);
  assert.deepEqual(f.changes, [{ name: 'drawing', value: '#377eb8' }]);
  assert.deepEqual(f.renderedValues(), { navigation: '#123456', drawing: '#377eb8' });
});

test('custom HEX stays open for partial text and commits six valid digits immediately', async t => {
  const f = await mount(t);
  await f.click(f.input('navigation'));
  await f.click(f.dialog().querySelector('.app-color-custom'));
  const input = f.dialog().querySelector('input[aria-label="自定义颜色值"]');
  await f.type(input, 'aB3');
  assert.ok(f.dialog(), 'partial HEX is not a selection');
  assert.deepEqual(f.changes, []);
  await f.type(input, 'aB34E9');
  assert.equal(f.dialog(), null, 'six digits commit without blur, Enter or another confirmation');
  assert.deepEqual(f.changes, [{ name: 'navigation', value: '#ab34e9' }]);
  assert.deepEqual(f.renderedValues(), { navigation: '#ab34e9', drawing: '#abcdef' });
});
