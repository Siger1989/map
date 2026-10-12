import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('the shared search hook applies source, city, near and paging consistently to multiple consumers', async (t) => {
  const { window } = (await import('linkedom')).parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  Object.assign(globalThis, {
    window,
    document: window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  globalThis.__placeSearchCalls = [];
  globalThis.__slowSearchResolvers = [];
  globalThis.__pageResolvers = [];
  await build({
    entryPoints: ['modules/navigation/usePlaceSearch.ts'],
    outdir: '.openai/place-search-hook-test',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    plugins: [{
      name: 'search-provider-spy',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^\.\/provider$/ }, (args) =>
          args.importer.endsWith('usePlaceSearch.ts')
            ? { path: 'provider', namespace: 'test-provider' }
            : undefined,
        );
        buildApi.onLoad({ filter: /.*/, namespace: 'test-provider' }, () => ({
          contents: `
            export const defaultPlaceSearchSource = () => 'auto';
            export async function searchPlacesDetailed(query, near, signal, source, options) {
              globalThis.__placeSearchCalls.push({ query, near, source, options });
              if (signal.aborted) throw signal.reason;
              const page = options.page;
              if (!page && query === 'Slow Place')
                return new Promise((resolve) => globalThis.__slowSearchResolvers.push(resolve));
              if (page) return new Promise((resolve) => globalThis.__pageResolvers.push({ query, resolve }));
              const name = query === 'Fast Place' ? 'Fast Result'
                : query === 'Slow Page Request' ? 'Slow First Page'
                  : query === 'Replacement Query' ? 'Replacement First Page'
                    : 'Page One';
              return {
                places: [{ name, coordinates: [104.1,30.1] }],
                suggestions: query === 'Public Park'
                  ? [{ label: 'Try Southport', query: 'Public Park', city: 'Southport' }]
                  : [],
                warnings: query === 'Public Park' ? ['Primary source was empty'] : [],
                next: { provider: 'tianditu', query, start: 20 },
              };
            }
          `,
          loader: 'ts',
        }));
      },
    }],
  });

  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { usePlaceSearch } = await import('../.openai/place-search-hook-test/usePlaceSearch.js');
  const snapshots = {};
  function Consumer({ id, query, near }) {
    snapshots[id] = usePlaceSearch({ query, enabled: true, near });
    return React.createElement('button', {
      id,
      onClick: () => snapshots[id].loadMore(),
    }, [
      snapshots[id].places.map((place) => place.name).join(','),
      snapshots[id].suggestions.map((item) => item.label).join(','),
      snapshots[id].warnings.join(','),
    ].join('|'));
  }
  function App({ query = 'Public Park', near = [104, 30] }) {
    return React.createElement(React.Fragment, null,
      React.createElement(Consumer, { id: 'map-search', query, near }),
      React.createElement(Consumer, { id: 'route-search', query, near }),
    );
  }

  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    const { act } = React;
    await act(async () => root.unmount());
    delete globalThis.__placeSearchCalls;
    delete globalThis.__slowSearchResolvers;
    delete globalThis.__pageResolvers;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    delete globalThis.window;
    delete globalThis.document;
  });
  await React.act(async () => root.render(React.createElement(App)));
  await React.act(async () => new Promise((resolve) => setTimeout(resolve, 520)));
  assert.equal(globalThis.__placeSearchCalls.length, 2);
  for (const call of globalThis.__placeSearchCalls) {
    assert.equal(call.query, 'Public Park');
    assert.deepEqual(call.near, [104, 30]);
    assert.equal(call.source, 'auto');
    assert.deepEqual(call.options, { city: undefined, nationwide: false });
  }
  assert.match(document.querySelector('#map-search').textContent, /Page One/);
  assert.match(document.querySelector('#route-search').textContent, /Page One/);

  await React.act(async () => {
    const mapSearch = document.querySelector('#map-search');
    mapSearch.click();
    mapSearch.click();
  });
  assert.equal(globalThis.__placeSearchCalls.length, 3);
  assert.equal(globalThis.__pageResolvers.length, 1, 'rapid repeat clicks should issue only one page request');
  assert.deepEqual(globalThis.__placeSearchCalls.at(-1).options.page, {
    provider: 'tianditu', query: 'Public Park', start: 20,
  });
  await React.act(async () => globalThis.__pageResolvers[0].resolve({
    places: [
      { name: 'Page One', coordinates: [104.1,30.1] },
      { name: 'Page Two', coordinates: [104.2,30.2] },
      { name: 'Page Two', coordinates: [104.2,30.2] },
    ],
    suggestions: [
      { label: 'Try Southport', query: 'Public Park', city: 'Southport' },
      { label: 'Try Southport', query: 'Public Park', city: 'Southport' },
      { label: 'Try County', query: 'Public Park', city: 'County' },
    ],
    warnings: ['Primary source was empty', 'Primary source was empty', 'Photon fallback used'],
    next: undefined,
  }));
  assert.equal(document.querySelector('#map-search').textContent, 'Page One,Page Two|Try Southport,Try County|Primary source was empty,Photon fallback used');
  assert.equal(document.querySelector('#route-search').textContent, 'Page One|Try Southport|Primary source was empty');

  await React.act(async () => root.render(React.createElement(App, { query: 'Slow Place' })));
  await React.act(async () => new Promise((resolve) => setTimeout(resolve, 520)));
  assert.equal(globalThis.__slowSearchResolvers.length, 2);
  await React.act(async () => root.render(React.createElement(App, { query: 'Fast Place' })));
  await React.act(async () => new Promise((resolve) => setTimeout(resolve, 520)));
  await React.act(async () => {
    for (const resolve of globalThis.__slowSearchResolvers)
      resolve({ places: [{ name: 'Stale Slow Result', coordinates: [104,30] }], suggestions: [], warnings: [] });
  });
  assert.match(document.querySelector('#map-search').textContent, /Fast Result/);
  assert.match(document.querySelector('#route-search').textContent, /Fast Result/);
  assert.doesNotMatch(document.querySelector('#map-search').textContent, /Stale Slow Result/);
  assert.doesNotMatch(document.querySelector('#route-search').textContent, /Stale Slow Result/);

  await React.act(async () => root.render(React.createElement(App, { query: 'Slow Page Request' })));
  await React.act(async () => new Promise((resolve) => setTimeout(resolve, 520)));
  await React.act(async () => document.querySelector('#route-search').click());
  assert.equal(globalThis.__pageResolvers.length, 2);
  await React.act(async () => root.render(React.createElement(App, { query: 'Replacement Query' })));
  await React.act(async () => new Promise((resolve) => setTimeout(resolve, 520)));
  await React.act(async () => globalThis.__pageResolvers[1].resolve({
    places: [{ name: 'Stale Page Result', coordinates: [104.2,30.2] }],
    suggestions: [{ label: 'Stale Suggestion', query: 'Slow Page Request' }],
    warnings: ['Stale page warning'],
    next: undefined,
  }));
  assert.match(document.querySelector('#route-search').textContent, /Replacement First Page/);
  assert.doesNotMatch(document.querySelector('#route-search').textContent, /Stale Page Result|Stale Suggestion|Stale page warning/);
});
