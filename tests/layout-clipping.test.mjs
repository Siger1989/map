import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { defaults } from '../modules/uiLayout/selection.mjs';
import { emptyLayout } from '../modules/uiLayout/model.mjs';
import { renderAnchoredLayout } from '../modules/uiLayout/anchorRenderer.mjs';

test('independent card placement releases HUD clipping and reset restores native container styles', () => {
  const { document: doc, window } = parseHTML(`<html><head></head><body>
    <main class="observatory"><aside class="route-display-info"><section id="profile"></section></aside>
    <div id="shell"><button id="tool">工具</button></div>
    <div id="list"><div id="rows"><button id="row">路线项</button></div></div></main>
    <div id="outside"><button id="external">其他界面</button></div></body></html>`);
  window.CSS = { escape: (s) => s };
  window.getComputedStyle = (el) => ({
    overflowX: el.id === 'list' ? 'auto' : 'hidden',
    overflowY: 'hidden',
  });
  const style = doc.createElement('style');
  doc.head.append(style);
  const update = (entries) =>
    renderAnchoredLayout(
      doc,
      style,
      { ...emptyLayout(), entries },
      '.observatory',
    );
  const entry = (selector, patch) => ({
    ...defaults(selector, selector),
    ...patch,
  });
  update([entry('#profile', { dx: -120 }), entry('#tool', { dy: 80 })]);
  assert.match(style.textContent, /route-display-info\).*overflow:visible/);
  assert.match(style.textContent, /#shell\).*overflow:visible/);
  assert.doesNotMatch(
    style.textContent,
    /:is\(\.observatory\).*overflow:visible/,
  );
  assert.equal(
    doc.querySelector('#profile').parentElement.className,
    'route-display-info',
  );
  update([entry('#profile', { fontSize: 14 }), entry('#tool', { zIndex: 15 })]);
  assert.doesNotMatch(style.textContent, /overflow:visible/);
  update([entry('#row', { dx: 45 }), entry('#external', { dy: 90 })]);
  assert.match(style.textContent, /#rows\).*overflow:visible/);
  assert.doesNotMatch(style.textContent, /#list\).*overflow:visible/);
  assert.doesNotMatch(style.textContent, /#outside/);
  update([]);
  assert.equal(style.textContent, '');
  assert.equal(doc.querySelector('#shell').getAttribute('style'), null);
});
