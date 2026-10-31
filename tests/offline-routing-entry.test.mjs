import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import 'fake-indexeddb/auto';
import { compileOsmGraph } from '../modules/offlineRouting/osmGraph.ts';
import { saveGraph, deleteGraph } from '../modules/offlineRouting/storage.ts';
import { planRoute } from '../modules/navigation/provider.ts';
import { externalLegs } from '../modules/routeShare/data.ts';

test('the planning entry uses exact local vehicle packages without an online request or relabelling', async () => {
  const descriptors = new Map(['window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const originalFetch = globalThis.fetch;
  const settings = new Map([['shantu.routing-mode.v1', 'offline']]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => settings.get(key) ?? null,
    setItem: (key, value) => settings.set(key, String(value)),
  } });
  let fetches = 0;
  globalThis.fetch = () => { fetches++; throw new TypeError('network unavailable'); };
  const raw = JSON.parse(await readFile(new URL('./fixtures/offline-routing/berlin-small-osm.json', import.meta.url), 'utf8'));
  const graphs = ['motorcar', 'motorcycle'].map(profile => compileOsmGraph(raw, 'public test '+profile,
    [13.404,52.519,13.406,52.521], 'entry-test-'+profile, 1, profile));
  const start = { name: 'start', coordinates: [13.4048063,52.5201631] };
  const end = { name: 'end', coordinates: [13.4042511,52.5205732] };
  try {
    for (const graph of graphs) await saveGraph(graph);
    for (const mode of ['auto', 'motorcycle']) {
      const result = await planRoute(start, end, mode, new AbortController().signal);
      assert.equal(result.mode, mode);
      assert.equal(result.routingSource.kind, 'offline');
      assert.equal(result.routingSource.name, 'public test '+(mode === 'auto' ? 'motorcar' : 'motorcycle'));
      assert.ok(result.distance > 50 && result.distance < 70);
    }
    await deleteGraph(graphs[0].id);
    await assert.rejects(planRoute(start, end, 'auto', new AbortController().signal), /汽车离线路网/);
    settings.set('shantu.routing-mode.v1', 'online');
    await assert.rejects(planRoute(start, end, 'motorcycle', new AbortController().signal), /摩托车.*离线/);
    assert.equal(fetches, 0);
    assert.deepEqual(externalLegs({ stops: [start, end], mode: 'motorcycle' }), []);
  } finally {
    for (const graph of graphs) await deleteGraph(graph.id);
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
