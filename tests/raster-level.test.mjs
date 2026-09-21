import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { RasterLevelLock } from '../modules/cartography/RasterLevelLock.ts';
import { syncCartography } from '../modules/cartography/cartography.ts';

const source = (id, maxzoom = 18) => ({ id, type: 'raster', minzoom: 0, maxzoom, tileSize: 256, loaded: () => true });
function fixture() {
  const sources = new Map([['detail', source('detail')], ['custom', source('custom', 14)]]), refresh = [];
  let floor = 0;
  const map = { getSource: id => sources.get(id), getMinZoom: () => floor, setMinZoom: value => { floor = value; }, refreshTiles: id => refresh.push(id) };
  return { sources, refresh, map, lock: new RasterLevelLock(map) };
}
test('locking, lowering the lock, source changes and auto restore source and camera limits', () => {
  const { sources, refresh, map, lock } = fixture();
  const original = () => 7;
  sources.get('detail').calculateTileZoom = original;
  lock.sync(['detail'], 13);
  assert.equal(map.getMinZoom(), 12);
  assert.equal(sources.get('detail').maxzoom, 13);
  assert.equal(sources.get('detail').calculateTileZoom(20, 100, 100, 100, 1), 13);
  const requests = refresh.length;
  lock.sync(['detail'], 13);
  assert.equal(refresh.length, requests);
  lock.sync(['detail'], 11);
  assert.equal(map.getMinZoom(), 10);
  lock.sync(['custom'], 12);
  assert.equal(sources.get('detail').maxzoom, 18);
  assert.equal(sources.get('detail').calculateTileZoom, original);
  assert.equal(map.getMinZoom(), 11);
  lock.sync(['custom'], null);
  assert.equal(map.getMinZoom(), 0);
  assert.equal(sources.get('custom').maxzoom, 14);
  assert.equal(sources.get('custom').calculateTileZoom, undefined);
});
test('replacement sources keep their own limits and invalid levels unlock safely', () => {
  const { sources, map, lock } = fixture();
  lock.sync(['custom'], 12);
  sources.set('custom', source('custom', 9));
  lock.sync(['custom'], 12);
  assert.equal(sources.get('custom').maxzoom, 9);
  assert.equal(map.getMinZoom(), 8);
  lock.sync(['custom'], NaN);
  assert.equal(map.getMinZoom(), 0);
  assert.equal(sources.get('custom').maxzoom, 9);
});
test('road opacity remains relative to original styles and never compounds or changes routes', () => {
  const paint = new Map();
  const map = { getLayer: () => true, setPaintProperty: (id, property, value) => paint.set(`${id}/${property}`, value), setLayoutProperty: () => {} };
  syncCartography(map, { roads: true, labels: true, roadsOpacity: 0.5 });
  syncCartography(map, { roads: true, labels: true, roadsOpacity: 0.5 });
  assert.equal(paint.get('main-roads/line-opacity'), 0.425);
  assert.equal(paint.get('road-names/text-opacity'), 0.5);
  syncCartography(map, { roads: true, labels: true, roadsOpacity: 0 });
  assert.ok([...paint.values()].every(v => v === 0));
  syncCartography(map, { roads: true, labels: true });
  assert.equal(paint.get('main-roads/line-opacity'), 0.85);
  assert.ok([...paint.keys()].every(key => !key.includes('route')));
});
test('installed MapLibre selects only the locked level across zoom, pitch and bearing', async () => {
  const compiled = await build({ stdin: { resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts', contents: `
    import {MercatorTransform} from './node_modules/maplibre-gl/src/geo/projection/mercator_transform.ts';
    import {LngLat} from './node_modules/maplibre-gl/src/geo/lng_lat.ts';
    import {coveringTiles} from './node_modules/maplibre-gl/src/geo/projection/covering_tiles.ts';
    export function samples() {
      const t=new MercatorTransform();t.resize(390,844);t.setCenter(new LngLat(103.52,30.8));
      const result=[];
      for(const zoom of [12,13,15]) for(const pitch of [0,62,80]) for(const bearing of [0,90,180]) {
        t.setZoom(zoom);t.setPitch(pitch);t.setBearing(bearing);
        result.push(coveringTiles(t,{tileSize:256,minzoom:0,maxzoom:13,roundZoom:true,calculateTileZoom:()=>13}).map(tile=>tile.canonical.z));
      }
      return result;
    }` }, bundle: true, platform: 'node', format: 'esm', write: false });
  const engine = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
  const samples = engine.samples();
  assert.equal(samples.length, 27);
  for (const levels of samples) { assert.ok(levels.length > 0); assert.deepEqual([...new Set(levels)], [13]); }
});
