import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { requestAppBack } from '../modules/input/appBack.ts';

function makeDocument(markup) {
  return parseHTML(`<html><body>${markup}</body></html>`).document;
}

test('back targets the highest-priority visible surface and lets its handler consume it', () => {
  const document = makeDocument(`
    <main class="observatory">
      <section data-app-back="30"></section>
      <section data-app-back="50" id="search"></section>
      <section data-app-back="50" id="direction"></section>
      <section data-app-back="90" hidden id="hidden"></section>
      <section role="dialog" aria-modal="true" id="dialog-first"></section>
      <section role="dialog" aria-modal="true" id="dialog-last"></section>
    </main>`);
  const seen = [];
  for (const element of document.querySelectorAll('[data-app-back], [role="dialog"]')) {
    element.addEventListener('keydown', event => {
      seen.push(event.currentTarget.id || element.getAttribute('data-app-back'));
      event.preventDefault();
    });
  }

  assert.equal(requestAppBack(document), true);
  assert.deepEqual(seen, ['dialog-last']);
});

test('back dispatches to the focused control inside the selected surface first', () => {
  const document = makeDocument(`
    <main class="observatory">
      <section data-app-back="50" id="search"><input id="query"></section>
    </main>`);
  const input = document.querySelector('#query');
  Object.defineProperty(document, 'activeElement', { configurable: true, value: input });
  const seen = [];
  input.addEventListener('keydown', event => {
    seen.push(event.target.id);
    event.preventDefault();
  });
  document.querySelector('#search').addEventListener('keydown', event => seen.push(`surface:${event.target.id}`));

  assert.equal(requestAppBack(document), true);
  assert.deepEqual(seen, ['query', 'surface:query']);
});

test('an unconsumed menu escape falls back to the app root, while an idle page remains unhandled', () => {
  const document = makeDocument(`
    <main class="observatory">
      <section data-app-back="40" id="menu"></section>
    </main>`);
  document.querySelector('#menu').addEventListener('keydown', event => event.stopPropagation());
  let rootCount = 0;
  document.querySelector('.observatory').addEventListener('keydown', event => {
    rootCount += 1;
    event.preventDefault();
  });
  assert.equal(requestAppBack(document), true);
  assert.equal(rootCount, 1);

  const idleDocument = makeDocument('<main class="observatory"></main>');
  assert.equal(requestAppBack(idleDocument), false);
});
