import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

const bundle = await build({ stdin: { contents: `
  export { TrackColorPicker } from './modules/tracks/TrackColorPicker';
  export { AppColorPicker } from './modules/appearance/AppColorPicker';
`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'node', format: 'esm',
  packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, write: false, logLevel: 'silent' });
await writeFile('.openai/track-color-picker-test-bundle.mjs', bundle.outputFiles[0].text);
const { TrackColorPicker, AppColorPicker } = await import('../.openai/track-color-picker-test-bundle.mjs');
const React = await import('react');
const { act } = React;

async function setup(t) {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  window.document.oninput = null;
  const saved = new Map();
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT']) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const colors = {};
  function Probe() {
    const [drawing, setDrawing] = React.useState('#123456');
    const [selection, setSelection] = React.useState('#abcdef');
    colors.drawing = drawing; colors.selection = selection;
    return React.createElement(React.Fragment, null,
      React.createElement(TrackColorPicker, { label: '画线颜色', value: drawing, onChange: setDrawing }),
      React.createElement(TrackColorPicker, { label: '相连4段颜色', value: selection, onChange: setSelection }),
      React.createElement(AppColorPicker));
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    try { await act(async () => root.unmount()); }
    finally { for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; }
  });
  return { window, root, colors, render: async () => act(async () => root.render(React.createElement(Probe))),
    input: label => document.querySelector(`input[aria-label="${label}"]`),
    click: async node => { assert.ok(node); const event = new window.Event('click', { bubbles: true, cancelable: true }); await act(async () => node.dispatchEvent(event)); return event; } };
}

test('drawing and selection triggers share the same app palette, suppress native color UI and apply HEX immediately', async t => {
  const f = await setup(t);
  await f.render();
  const drawing = f.input('画线颜色');
  const selection = f.input('相连4段颜色');
  assert.equal(drawing.value, '#123456');
  assert.equal(selection.value, '#abcdef');
  const open = await f.click(drawing);
  assert.equal(open.defaultPrevented, true, 'AppColorPicker prevents the browser color dialog');
  const palette = [...document.querySelectorAll('.app-color-grid [data-color]')].map(button => button.dataset.color);
  assert.equal(palette.length, 18);
  await f.click(document.querySelector('.app-color-custom'));
  const hex = document.querySelector('input[aria-label="自定义颜色值"]');
  const setter = Object.getOwnPropertyDescriptor(f.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(hex, '12ab'); hex.dispatchEvent(new f.window.Event('input', { bubbles: true })); });
  assert.ok(document.querySelector('[role="dialog"]'), 'partial HEX does not apply');
  await act(async () => { setter.call(hex, '12abef'); hex.dispatchEvent(new f.window.Event('input', { bubbles: true })); });
  assert.equal(!!document.querySelector('[role="dialog"]'), false, 'valid HEX applies and closes immediately');
  assert.equal(f.input('画线颜色').value, '#12abef');
  assert.equal(f.input('相连4段颜色').value, '#abcdef', 'drawing color does not alter selection color');

  await f.click(f.input('相连4段颜色'));
  assert.deepEqual([...document.querySelectorAll('.app-color-grid [data-color]')].map(button => button.dataset.color), palette);
  await f.click(document.querySelector('button[aria-label="蓝色"]'));
  assert.equal(!!document.querySelector('[role="dialog"]'), false);
  assert.equal(f.input('相连4段颜色').value, '#377eb8');
  assert.equal(f.input('画线颜色').value, '#12abef');
});
