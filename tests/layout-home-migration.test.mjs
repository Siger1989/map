import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { homeSelector, migrateHomeLayout } from '../modules/uiLayout/homeSelectors.mjs';
import { emptyLayout, validateLayout, layoutCss } from '../modules/uiLayout/model.mjs';
import { defaults, selectorFor } from '../modules/uiLayout/selection.mjs';

test('old homepage layout selectors and anchor references resolve to new surfaces without mutating the draft', () => {
  const { document: doc, window } = parseHTML('<html><body><main class="observatory home-map"><nav class="home-position-dock"><button class="position-dock-button"></button></nav><header class="home-topbar"></header></main></body></html>');
  window.CSS = { escape: value => value };
  const draft = { ...emptyLayout(), entries: [{ ...defaults('.position-dock > .position-dock-button', '定位'), dx: 9, scale: .8, anchor: { reference: '.position-dock', x: 'right', y: 'bottom', gapX: 8, gapY: 12 } }, defaults('.topbar', '顶部')] };
  const before = JSON.stringify(draft);
  const migrated = validateLayout(migrateHomeLayout(draft, doc));
  assert.equal(JSON.stringify(draft), before);
  assert.equal(migrated.version, 1);
  assert.equal(migrated.entries[0].dx, 9);
  assert.equal(migrated.entries[0].scale, .8);
  assert.equal(migrated.entries[0].anchor.reference, '.home-position-dock');
  for (const e of migrated.entries) assert.ok(doc.querySelector(e.selector));
  assert.equal(selectorFor(doc.querySelector('header'), doc), '.home-topbar');
  assert.match(layoutCss(migrated), /home-position-dock > \.position-dock-button/);
});
test('migration respects class boundaries and quoted content and is idempotent', () => {
  assert.equal(homeSelector('.position-dock > .position-dock-button[title=".topbar"]'), '.home-position-dock > .position-dock-button[title=".topbar"]');
  const doc = { querySelector: () => ({}) };
  const draft = { ...emptyLayout(), entries: [{ ...defaults('.home-topbar', '新'), dx: 21 }, defaults('.topbar', '旧')] };
  const once = migrateHomeLayout(draft, doc);
  assert.equal(once.entries.length, 1);
  assert.equal(once.entries[0].dx, 21);
  assert.deepEqual(migrateHomeLayout(once, doc), once);
  assert.equal(migrateHomeLayout(draft, { querySelector: () => null }), draft);
});
