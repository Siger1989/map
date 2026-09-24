import test from 'node:test';
import assert from 'node:assert/strict';
import { LAST_VIEW_KEY, parseLastView, readLastView, saveLastView, shouldFocusStartupPosition } from '../modules/map/lastView.ts';
test('last camera preserves full position/zoom and rejects invalid storage', () => {
 const valid={center:[38.0073,10.0433],zoom:8.94,pitch:46,bearing:18.4};
 assert.deepEqual(parseLastView(JSON.stringify(valid)),valid);
 const selectedMode={...valid,terrain:false};
 assert.deepEqual(parseLastView(JSON.stringify(selectedMode)),selectedMode, 'the selected 2D/3D mode survives with camera data');
 assert.deepEqual(parseLastView(JSON.stringify(valid)),valid, 'older saved cameras without a mode remain compatible');
 assert.deepEqual(parseLastView(JSON.stringify({...valid,terrain:'false'})),valid, 'a malformed optional mode is ignored and uses the app default');
 for(const bad of [null,'{',JSON.stringify({...valid,zoom:21}),JSON.stringify({...valid,center:[200,10]}),JSON.stringify({...valid,pitch:-1}),JSON.stringify({...valid,zoom:'8.9'})]) assert.equal(parseLastView(bad),null);
});

test('last camera round-trips through its existing storage key and suppresses startup location focus', () => {
 const values = new Map();
 const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
 Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
   getItem: key => values.get(key) ?? null,
   setItem: (key, value) => values.set(key, value),
  },
 });
 try {
  const view={center:[104.0712,30.6634],zoom:11.6,pitch:0,bearing:-28,terrain:false};
  assert.equal(readLastView(), null);
  assert.equal(shouldFocusStartupPosition(readLastView()), true, 'first launch keeps the existing startup behavior');
  saveLastView(view);
  assert.deepEqual(readLastView(), view);
  assert.equal(shouldFocusStartupPosition(readLastView()), false, 'a saved camera wins over startup location focus');
  values.set(LAST_VIEW_KEY, '{damaged');
  assert.equal(readLastView(), null, 'damaged persisted data falls back to the default startup path');
  assert.equal(shouldFocusStartupPosition(readLastView()), true);
 } finally {
  if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
  else delete globalThis.localStorage;
 }
});

test('the last selected 2D or 3D mode reloads from the same saved camera snapshot', () => {
 const values = new Map();
 const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
 Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
   getItem: key => values.get(key) ?? null,
   setItem: (key, value) => values.set(key, value),
  },
 });
 try {
  const camera={center:[104.07,30.66],zoom:10,pitch:0,bearing:12};
  for (const terrain of [false, true]) {
   saveLastView({...camera,pitch:terrain ? 62 : 0,terrain});
   const afterReload=readLastView();
   assert.equal(afterReload?.terrain,terrain, `${terrain ? '3D' : '2D'} selection persists`);
   assert.equal(afterReload?.pitch,terrain ? 62 : 0, 'camera and mode are read from one snapshot');
  }
 } finally {
  if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
  else delete globalThis.localStorage;
 }
});
