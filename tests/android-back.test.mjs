import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { requestAppBack } from '../modules/input/appBack.ts';

const java = readFileSync(
  new URL(
    '../mobile/android/src/com/guanyun/weather/MainActivity.java',
    import.meta.url,
  ),
  'utf8',
);
const sourceMatch = java.match(/evaluateJavascript\(("(?:\\.|[^"\\])*"), result/);
assert.ok(sourceMatch, 'MainActivity must evaluate a JavaScript back bridge');
const source = JSON.parse(sourceMatch[1]);

function pressBack(markup, installHandlers = () => {}) {
  const { document, window } = parseHTML(`<html><body>${markup}</body></html>`);
  const protocolEvents = [];
  installHandlers(document);
  window.addEventListener('shantu-app-back', (event) => {
    protocolEvents.push({
      type: event.type,
      cancelable: event.cancelable,
      isRealmEvent: event instanceof window.Event,
    });
  });
  // Match app/page.tsx: only an Escape consumer may cancel the native request.
  window.addEventListener('shantu-app-back', (event) => {
    if (requestAppBack(document)) event.preventDefault();
  });
  const handled = runInNewContext(source, { Event: window.Event, window });
  return { handled, protocolEvents };
}

test('native bridge dispatches the named cancelable event in the WebView realm', () => {
  const result = pressBack('<main class="observatory"></main>');
  assert.equal(result.handled, false);
  assert.deepEqual(result.protocolEvents, [{
    type: 'shantu-app-back',
    cancelable: true,
    isRealmEvent: true,
  }]);
});

test('back closes a marked popup before falling through to an active editor', () => {
  let popupClosed = 0;
  let editorBacks = 0;
  const result = pressBack(`
    <main class="observatory">
      <section data-app-back="30" id="popup"></section>
      <section data-app-back="10" id="route-edit"></section>
    </main>`, (document) => {
      document.querySelector('#popup').addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          popupClosed += 1;
          event.preventDefault();
          event.stopPropagation();
        }
      });
      document.querySelector('#route-edit').addEventListener('keydown', () => editorBacks++);
    });
  assert.equal(result.handled, true);
  assert.equal(popupClosed, 1);
  assert.equal(editorBacks, 0);
});

test('an active map operation can consume Escape through the app-root fallback', () => {
  let operationBacks = 0;
  const result = pressBack('<main class="observatory"></main>', (document) => {
    document.querySelector('.observatory').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        operationBacks += 1;
        event.preventDefault();
      }
    });
  });
  assert.equal(result.handled, true);
  assert.equal(operationBacks, 1);
});

test('the idle home page leaves Android back unconsumed', () => {
  const result = pressBack('<main class="observatory"></main>');
  assert.equal(result.handled, false);
});

test('the highest-priority marker wins, with the last peer selected', () => {
  let escaped = '';
  const result = pressBack(`
    <main class="observatory">
      <section data-app-back="30" id="panel"></section>
      <section data-app-back="50" id="search-first"></section>
      <section data-app-back="50" id="search-last"></section>
      <section data-app-back="99" hidden id="hidden"></section>
    </main>`, (document) => {
      for (const surface of document.querySelectorAll('[data-app-back]')) {
        surface.addEventListener('keydown', (event) => {
          escaped = event.currentTarget.id;
          event.preventDefault();
        });
      }
    });
  assert.equal(result.handled, true);
  assert.equal(escaped, 'search-last');
});

test('a focused field inside the selected menu receives Escape first', () => {
  let target = '';
  const result = pressBack(`
    <main class="observatory">
      <section data-app-back="50" id="place-search"><input id="query"></section>
    </main>`, (document) => {
      Object.defineProperty(document, 'activeElement', {
        configurable: true,
        value: document.querySelector('#query'),
      });
      document.querySelector('#query').addEventListener('keydown', (event) => {
        target = event.target.id;
        event.preventDefault();
      });
    });
  assert.equal(result.handled, true);
  assert.equal(target, 'query');
});

test('an open modal dialog has priority over lower-level map menus', () => {
  let escaped = '';
  const result = pressBack(`
    <main class="observatory">
      <section data-app-back="30" id="section-list"></section>
      <section role="dialog" aria-modal="true" id="route-dialog"></section>
    </main>`, (document) => {
      for (const surface of document.querySelectorAll('[data-app-back], [role="dialog"]')) {
        surface.addEventListener('keydown', (event) => {
          escaped = event.currentTarget.id;
          event.preventDefault();
        });
      }
    });
  assert.equal(result.handled, true);
  assert.equal(escaped, 'route-dialog');
});
