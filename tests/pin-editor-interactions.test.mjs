import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { newAnnotation } from '../modules/annotations/data.ts';

test('pin name is selected once and the model menu adds a prism at the pin coordinates', async (t) => {
  const { window } = (await import('linkedom')).parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  const disk = new Map();
  globalThis.localStorage = { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value) };
  let focusCount = 0, selectCount = 0;
  window.HTMLElement.prototype.focus = function () { focusCount++; document.activeElement = this; };
  window.HTMLInputElement.prototype.select = function () {
    selectCount++;
    this.selectionStart = 0;
    this.selectionEnd = this.value.length;
  };
  await build({
    entryPoints: ['modules/annotations/PinEditor.tsx', 'modules/annotations/useAnnotations.ts'],
    outdir: '.openai/pin-editor-interactions', bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic',
    plugins: [{ name: 'terrain-stub', setup(builder) {
      builder.onResolve({ filter: /terrain\/elevation$/ }, () => ({ path: 'terrain', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const readElevation=async()=>null;' }));
    } }],
  });
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const { PinEditor } = await import('../.openai/pin-editor-interactions/PinEditor.js');
  const { useAnnotations } = await import('../.openai/pin-editor-interactions/useAnnotations.js');
  let annotationState;
  function Probe({ pane }) {
    annotationState = useAnnotations();
    const item = annotationState.items.find(value => value.id === 'pin');
    return React.createElement('div', { 'data-pane': pane }, item && React.createElement(PinEditor, {
      state: annotationState, item, photos: [{ id: 'photo-1', name: 'photo.jpg', title: '照片', url: 'data:image/png;base64,' }], onClose() {}, onShare() {}, onAdjust() {}, onCapture() {}, onImport() {}, onPhoto() {},
      onAddModel: (kind, coordinates) => annotationState.addAndEdit(kind, coordinates),
    }));
  }
  disk.set('guanyun.annotations.v1', JSON.stringify([newAnnotation('pin', [104, 30], 100, 'pin')]));
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); });
  await act(async () => root.render(React.createElement(Probe, { pane: 'main' })));
  assert.equal(document.querySelector('.pin-editor-header strong'), null, 'the redundant editor title does not compete with actions');
  const name = document.querySelector('[aria-label="标记名称"]');
  assert.equal(document.activeElement, name);
  assert.equal(name.selectionStart, 0);
  assert.equal(name.selectionEnd, name.value.length);
  assert.equal(focusCount, 1);
  assert.equal(selectCount, 1);
  assert.equal(document.querySelector('[aria-label="复制信息"]'), null, 'the detail header no longer duplicates the parent copy action');
  assert.equal(document.querySelector('[aria-label="分享完整标记信息"]'), null, 'the coordinate row no longer duplicates the header share action');
  const editCoordinates = document.querySelector('[aria-label="编辑标记坐标"]');
  assert.match(editCoordinates.textContent, /编辑坐标/);
  assert.match(editCoordinates.textContent, /104\.000000, 30\.000000/);
  await act(async () => editCoordinates.click());
  const longitude = document.querySelector('[aria-label="经度"]');
  assert.ok(longitude, 'the edit coordinate entry opens the real coordinate editor');
  assert.ok(document.querySelector('[aria-label="纬度"]'));
  await act(async () => document.querySelector('.pin-picker-back').click());
  assert.ok(document.querySelector('[aria-label="编辑标记坐标"]'), 'back returns to the pin details');
  await act(async () => document.querySelector('.pin-danger').click());
  assert.ok(document.querySelector('[role="alertdialog"]'));
  assert.ok(document.querySelector('[role="alertdialog"] .pin-danger'));
  await act(async () => [...document.querySelectorAll('[role="alertdialog"] button')].find(button => button.textContent === '取消').click());
  assert.ok(document.querySelector('[aria-label="编辑标记坐标"]'), 'cancel keeps the original marker');
  assert.ok(document.querySelector('[aria-label="查看照片 photo.jpg"]'), 'cancel keeps its associated photo visible');
  await act(async () => root.render(React.createElement(Probe, { pane: 'moved' })));
  assert.equal(focusCount, 1, 'same marker rerender/pane move does not steal focus');
  assert.equal(selectCount, 1, 'same marker rerender does not select again');
  await act(async () => document.querySelector('.pin-add-model-trigger').click());
  const prismButton = [...document.querySelectorAll('.pin-model-options button')].find(button => button.textContent.includes('轮廓模型'));
  assert.ok(prismButton);
  await act(async () => prismButton.click());
  const saved = JSON.parse(disk.get('guanyun.annotations.v1'));
  const prism = saved.find(value => value.kind === 'prism');
  assert.ok(prism);
  assert.deepEqual(prism.coordinates, [104, 30]);
  assert.equal(saved.find(value => value.id === 'pin').kind, 'pin');
  assert.equal(annotationState.edit.draft.id, prism.id);
  assert.equal(annotationState.edit.draft.kind, 'prism');
  assert.equal(selectCount, 1, 'adding a model does not refocus the prior pin name');
});
