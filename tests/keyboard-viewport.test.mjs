import test from 'node:test';
import assert from 'node:assert/strict';
import { installKeyboardViewportCompatibility } from '../mobile/keyboardViewport.ts';

class FakeEvents {
  listeners = new Map();
  addEventListener(type, listener) {
    const entries = this.listeners.get(type) ?? new Set();
    entries.add(listener);
    this.listeners.set(type, entries);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  fire(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type, ...event });
  }
}

function fakeEnvironment({ innerWidth = 390, innerHeight = 800, visualHeight = innerHeight,
  userAgent = 'Android', previewKeyboard = false } = {}) {
  const values = new Map([
    ['--shantu-vh', ''], ['--shantu-visual-height', ''], ['--shantu-layout-height', ''],
  ]);
  const priorities = new Map();
  const root = { dataset: {}, style: {
    getPropertyValue: (name) => values.get(name) ?? '',
    getPropertyPriority: (name) => priorities.get(name) ?? '',
    setProperty: (name, value, priority = '') => { values.set(name, value); priorities.set(name, priority); },
    removeProperty: (name) => { values.delete(name); priorities.delete(name); },
  } };
  const documentRef = new FakeEvents();
  documentRef.documentElement = root;
  const visualViewport = Object.assign(new FakeEvents(), { height: visualHeight, width: innerWidth });
  const frameAttributes = new Map(previewKeyboard ? [['data-shantu-preview-keyboard', 'open']] : []);
  const windowRef = Object.assign(new FakeEvents(), { innerWidth, innerHeight, visualViewport,
    navigator: { userAgent }, frameElement: {
      getAttribute: (name) => frameAttributes.get(name) ?? null,
    } });
  return {
    documentRef, windowRef, visualViewport, root,
    value: (name) => values.get(name) ?? '',
  };
}

function editableInput(type = 'text') {
  return { type, isContentEditable: false,
    matches(selector) {
      if (selector.startsWith('input')) return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
      return false;
    } };
}

function focus(env, type = 'text') { env.documentRef.fire('focusin', { target: editableInput(type) }); }
function blur(env, type = 'text') { env.documentRef.fire('focusout', { target: editableInput(type) }); }
function resizeWindow(env, width, height) {
  env.windowRef.innerWidth = width;
  env.windowRef.innerHeight = height;
  env.windowRef.fire('resize');
}
function resizeVisual(env, width, height) {
  env.visualViewport.width = width;
  env.visualViewport.height = height;
  env.visualViewport.fire('resize');
}

test('editable focus freezes layout through blur until adjustResize restores the viewport', () => {
  const env = fakeEnvironment();
  const cleanup = installKeyboardViewportCompatibility(env.documentRef, env.windowRef, true);
  focus(env);
  resizeWindow(env, 390, 500);
  assert.equal(env.root.dataset.shantuKeyboard, 'open');
  assert.equal(env.value('--shantu-vh'), '8px');
  assert.equal(env.value('--shantu-layout-height'), '800px');
  assert.equal(env.value('--shantu-visual-height'), '500px');
  assert.equal(env.root.dataset.shantuLayoutBand, 'tall');

  blur(env);
  assert.equal(env.root.dataset.shantuKeyboard, 'open', 'focusout does not collapse the frozen layout');
  assert.equal(env.value('--shantu-vh'), '8px');
  resizeWindow(env, 390, 800);
  resizeVisual(env, 390, 800);
  assert.equal(env.root.dataset.shantuKeyboard, undefined);
  assert.equal(env.value('--shantu-vh'), '1dvh');
  assert.equal(env.value('--shantu-layout-height'), '800px');
  cleanup();
});

test('viewport-only IME changes are detected while ordinary unfocused resizing stays live', () => {
  const env = fakeEnvironment({ innerHeight: 800, visualHeight: 800 });
  const cleanup = installKeyboardViewportCompatibility(env.documentRef, env.windowRef, false);
  focus(env);
  resizeVisual(env, 390, 520);
  assert.equal(env.root.dataset.shantuKeyboard, 'open');
  assert.equal(env.value('--shantu-visual-height'), '520px');
  resizeVisual(env, 390, 800);
  assert.equal(env.root.dataset.shantuKeyboard, undefined);
  blur(env);
  resizeWindow(env, 390, 700);
  assert.equal(env.root.dataset.shantuKeyboard, undefined, 'an unfocused resize is not classified as an IME');
  assert.equal(env.value('--shantu-vh'), '7px');
  assert.equal(env.value('--shantu-layout-height'), '700px');
  assert.equal(env.root.dataset.shantuLayoutBand, 'medium');
  cleanup();
});

test('desktop vertical resize while an editable field is focused stays a live viewport resize', () => {
  const env = fakeEnvironment({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0' });
  const cleanup = installKeyboardViewportCompatibility(env.documentRef, env.windowRef, true);
  focus(env);
  resizeWindow(env, 390, 560);
  assert.equal(env.root.dataset.shantuKeyboard, undefined, 'desktop window resizing is not treated as an on-screen keyboard');
  assert.equal(env.value('--shantu-vh'), '1dvh', 'desktop keeps the live viewport unit');
  assert.equal(env.value('--shantu-layout-height'), '560px');
  assert.equal(env.root.dataset.shantuLayoutBand, 'compact');
  cleanup();
});

test('desktop-hosted phone preview keeps adjustResize freeze while its simulated keyboard is open', () => {
  const env = fakeEnvironment({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0', previewKeyboard: true });
  const cleanup = installKeyboardViewportCompatibility(env.documentRef, env.windowRef, true);
  focus(env);
  resizeWindow(env, 390, 500);
  assert.equal(env.root.dataset.shantuKeyboard, 'open');
  assert.equal(env.value('--shantu-layout-height'), '800px');
  cleanup();
});

test('switching editable fields preserves keyboard mode and orientation width changes refresh its baseline', () => {
  const env = fakeEnvironment();
  const cleanup = installKeyboardViewportCompatibility(env.documentRef, env.windowRef, true);
  focus(env);
  resizeWindow(env, 390, 500);
  blur(env);
  focus(env, 'search');
  assert.equal(env.root.dataset.shantuKeyboard, 'open', 'input switching keeps the existing freeze');

  resizeWindow(env, 800, 600);
  assert.equal(env.root.dataset.shantuKeyboard, undefined, 'a significant width change clears the old orientation freeze');
  assert.equal(env.value('--shantu-layout-height'), '600px');
  assert.equal(env.root.dataset.shantuLayoutBand, 'compact');
  assert.equal(env.value('--shantu-vh'), '1dvh', 'the live dvh unit is restored for the new orientation');
  resizeWindow(env, 800, 430);
  assert.equal(env.root.dataset.shantuKeyboard, 'open', 'subsequent keyboard resize uses the new baseline');
  assert.equal(env.value('--shantu-layout-height'), '600px');
  cleanup();
});

test('installation is shared and cleanup removes listeners and restores previous root state', () => {
  const env = fakeEnvironment();
  env.root.style.setProperty('--shantu-vh', '7.75px', 'important');
  env.root.dataset.shantuKeyboard = 'preexisting';
  env.root.dataset.shantuLayoutBand = 'preexisting-band';
  const cleanup = installKeyboardViewportCompatibility(env.documentRef, env.windowRef, true);
  assert.equal(installKeyboardViewportCompatibility(env.documentRef, env.windowRef, true), cleanup);
  const focusListeners = env.documentRef.listeners.get('focusin').size;
  assert.equal(focusListeners, 1);
  cleanup();
  assert.equal(env.documentRef.listeners.get('focusin').size, 0);
  assert.equal(env.windowRef.listeners.get('resize').size, 0);
  assert.equal(env.visualViewport.listeners.get('resize').size, 0);
  assert.equal(env.value('--shantu-vh'), '7.75px');
  assert.equal(env.root.style.getPropertyPriority('--shantu-vh'), 'important');
  assert.equal(env.root.dataset.shantuKeyboard, 'preexisting');
  assert.equal(env.root.dataset.shantuLayoutBand, 'preexisting-band');
});

test('keyboard close animation retains the original layout band until near-full height recovery', () => {
  const env = fakeEnvironment();
  const cleanup = installKeyboardViewportCompatibility(env.documentRef, env.windowRef, true);
  focus(env);
  resizeVisual(env, 390, 500);
  assert.equal(env.root.dataset.shantuKeyboard, 'open');
  resizeVisual(env, 390, 720);
  assert.equal(env.root.dataset.shantuKeyboard, 'open', 'an intermediate animation frame cannot release the freeze');
  assert.equal(env.root.dataset.shantuLayoutBand, 'tall');
  assert.equal(env.value('--shantu-layout-height'), '800px');
  resizeVisual(env, 390, 796);
  assert.equal(env.root.dataset.shantuKeyboard, undefined);
  assert.equal(env.root.dataset.shantuLayoutBand, 'tall');
  cleanup();
});
