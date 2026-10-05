import test from 'node:test';
import assert from 'node:assert/strict';
import { createComparisonExitGate } from '../modules/mapComparison/comparisonExitGate.ts';

test('comparison browsing closes in one action when route editor is absent or clean', () => {
  for (const editingRoute of [false, true]) {
    const gate = createComparisonExitGate();
    const calls = [];
    gate.request({
      editingRoute,
      dirtyRoute: false,
      closeRouteEditor: () => calls.push('route-close'),
      confirmRouteExit: () => calls.push('confirm'),
      exitComparison: () => calls.push('comparison-close'),
    });
    assert.deepEqual(calls, editingRoute
      ? ['route-close', 'comparison-close']
      : ['comparison-close']);
  }
});

test('dirty route edit keeps comparison open until save or discard, while continue cancels pending close', () => {
  for (const resolution of ['save', 'discard', 'continue']) {
    const gate = createComparisonExitGate();
    const calls = [];
    gate.request({
      editingRoute: true,
      dirtyRoute: true,
      closeRouteEditor: () => calls.push('route-close'),
      confirmRouteExit: () => calls.push('confirm'),
      exitComparison: () => calls.push('comparison-close'),
    });
    assert.deepEqual(calls, ['confirm'], 'request must not discard or close a dirty route editor');
    gate.resolve(resolution !== 'continue');
    if (resolution === 'continue') {
      assert.deepEqual(calls, ['confirm']);
      gate.resolve(true);
      assert.deepEqual(calls, ['confirm'], 'cancelled intent cannot fire later');
    } else {
      assert.deepEqual(calls, ['confirm', 'comparison-close']);
    }
  }
});
