import test from 'node:test';
import assert from 'node:assert/strict';
import {
  keyboardOcclusion, keyboardSurfaceAdjustment,
  snapshotKeyboardSurfaceStyles, restoreKeyboardSurfaceStyles,
} from '../mobile/keyboardFocus.ts';

test('keyboard occlusion distinguishes overlay and resized visual viewports', () => {
  assert.deepEqual(keyboardOcclusion({ layoutHeight: 800, visualHeight: 500, innerHeight: 800, viewportKeyboardOpen: true }), {
    top: 500, height: 300, mode: 'overlay',
  });
  assert.deepEqual(keyboardOcclusion({ layoutHeight: 800, visualHeight: 500, innerHeight: 500, viewportKeyboardOpen: true }), {
    top: 500, height: 300, mode: 'resized',
  });
  assert.equal(keyboardOcclusion({ layoutHeight: 800, visualHeight: 760, innerHeight: 800, viewportKeyboardOpen: true }), null,
    'small browser chrome or system-bar changes are not treated as a keyboard');
  assert.equal(keyboardOcclusion({ layoutHeight: 800, visualHeight: 500, innerHeight: 800 }), null,
    'a shrinking viewport alone is insufficient without the keyboard-open signal');
});

test('native virtual keyboard geometry takes the actual occlusion boundary', () => {
  assert.deepEqual(keyboardOcclusion({
    layoutHeight: 800, visualHeight: 800, innerHeight: 800,
    keyboardRect: { top: 540, height: 260 },
  }), { top: 540, height: 260, mode: 'native' });
});

test('surface adjustment lifts above keyboard but clamps to visible viewport top', () => {
  assert.deepEqual(keyboardSurfaceAdjustment({
    surfaceTop: 200, surfaceBottom: 740, viewportTop: 0, keyboardTop: 500,
  }), { top: 8, maxHeight: 484 });
  assert.deepEqual(keyboardSurfaceAdjustment({
    surfaceTop: 80, surfaceBottom: 740, viewportTop: 0, keyboardTop: 500,
  }), { top: 8, maxHeight: 484 });
  assert.deepEqual(keyboardSurfaceAdjustment({
    surfaceTop: 40, surfaceBottom: 740, viewportTop: 100, keyboardTop: 500,
  }), { top: 108, maxHeight: 384 });
});

test('temporary surface styles preserve and restore inline !important priorities', () => {
  const values = new Map([
    ['top', { value: '12px', priority: 'important' }],
    ['bottom', { value: '7px', priority: '' }],
    ['max-height', { value: 'none', priority: 'important' }],
  ]);
  const style = {
    getPropertyValue: (name) => values.get(name)?.value ?? '',
    getPropertyPriority: (name) => values.get(name)?.priority ?? '',
    setProperty: (name, value, priority = '') => values.set(name, { value, priority }),
    removeProperty: (name) => { values.delete(name); },
  };
  const before = snapshotKeyboardSurfaceStyles(style);
  style.setProperty('top', '88px', 'important');
  style.setProperty('bottom', 'auto', 'important');
  style.setProperty('overflow-y', 'auto', 'important');
  restoreKeyboardSurfaceStyles(style, before);
  assert.deepEqual(values.get('top'), { value: '12px', priority: 'important' });
  assert.deepEqual(values.get('bottom'), { value: '7px', priority: '' });
  assert.deepEqual(values.get('max-height'), { value: 'none', priority: 'important' });
  assert.equal(values.has('overflow-y'), false);
});
