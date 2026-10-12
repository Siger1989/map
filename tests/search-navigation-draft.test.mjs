import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchNavigationDraft } from '../modules/navigation/searchNavigationDraft.ts';

test('an active navigation keeps a newly searched destination as a draft', () => {
  const draft = createSearchNavigationDraft();
  const applied = [];
  const route = { id: 'new-destination-route' };
  const replaceActiveRoute = (value) => applied.push(value);

  draft.begin(true);
  const onRouteApplied = draft.onRouteApplied(true, replaceActiveRoute);

  assert.equal(onRouteApplied, undefined);
  assert.deepEqual(applied, []);
});

test('ordinary route changes during navigation still replace the active route', () => {
  const draft = createSearchNavigationDraft();
  const applied = [];
  const route = { id: 'same-guidance-route' };
  const replaceActiveRoute = (value) => applied.push(value);

  const onRouteApplied = draft.onRouteApplied(true, replaceActiveRoute);

  assert.equal(onRouteApplied, replaceActiveRoute);
  onRouteApplied(route);
  assert.deepEqual(applied, [route]);
});

test('explicitly starting navigation clears the search draft gate', () => {
  const draft = createSearchNavigationDraft();
  const applied = [];
  const route = { id: 'explicitly-started-route' };
  let starts = 0;
  const replaceActiveRoute = (value) => applied.push(value);

  draft.begin(true);
  const startNavigation = () => {
    draft.clear();
    starts += 1;
  };
  startNavigation();

  const onRouteApplied = draft.onRouteApplied(true, replaceActiveRoute);
  assert.equal(starts, 1);
  assert.equal(onRouteApplied, replaceActiveRoute);
  onRouteApplied(route);
  assert.deepEqual(applied, [route]);
});
