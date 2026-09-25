import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { RasterLevelLock } from '../modules/cartography/RasterLevelLock.ts';
import {
  cartographySettingsForDisplay,
  syncCartography,
} from '../modules/cartography/cartography.ts';

const source = (id, maxzoom = 18) => ({ id, type: 'raster', minzoom: 0, maxzoom, tileSize: 256, loaded: () => true });
function fixture() {
  const sources = new Map([['detail', source('detail')], ['custom', source('custom', 14)]]), refresh = [];
  let floor = 0;
  const map = { getSource: id => sources.get(id), getMinZoom: () => floor, setMinZoom: value => { floor = value; }, refreshTiles: id => refresh.push(id) };
  return { sources, refresh, map, lock: new RasterLevelLock(map) };
}
test('detail cap changes and source restoration never constrain camera zoom', () => {
  const { sources, refresh, map, lock } = fixture();
  const original = () => 7;
  sources.get('detail').calculateTileZoom = original;
  lock.sync(['detail'], 13);
  assert.equal(map.getMinZoom(), 0);
  assert.equal(sources.get('detail').maxzoom, 13);
  assert.equal(sources.get('detail').calculateTileZoom(20, 100, 100, 100, 1), 7);
  const requests = refresh.length;
  lock.sync(['detail'], 13);
  assert.equal(refresh.length, requests);
  lock.sync(['detail'], 11);
  assert.equal(map.getMinZoom(), 0);
  lock.sync(['custom'], 12);
  assert.equal(sources.get('detail').maxzoom, 18);
  assert.equal(sources.get('detail').calculateTileZoom, original);
  assert.equal(map.getMinZoom(), 0);
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
  assert.equal(map.getMinZoom(), 0);
  lock.sync(['custom'], NaN);
  assert.equal(map.getMinZoom(), 0);
  assert.equal(sources.get('custom').maxzoom, 9);
});
test('metadata reload does not release a selected raster cap or cause refresh oscillation', () => {
  const { sources, refresh, lock } = fixture();
  const raster = sources.get('detail');
  let ready = false; raster.loaded = () => ready;
  lock.sync(['detail'], 12);
  assert.equal(refresh.length, 0);
  ready = true; lock.sync(['detail'], 12);
  assert.equal(raster.maxzoom, 12);
  ready = false;
  for (let i=0;i<20;i++) lock.sync(['detail'], 12);
  ready = true; lock.sync(['detail'], 12);
  assert.equal(raster.maxzoom, 12);
  assert.equal(refresh.length, 1);
  lock.sync([], null);
  assert.equal(raster.maxzoom, 18);
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
test('map road and river visibility follows the layer setting, not snap mode', () => {
  for (const roads of [true, false]) {
    const visibility = new Map();
    const map = {
      getLayer: () => true,
      setPaintProperty: () => {},
      setLayoutProperty: (id, _property, value) => visibility.set(id, value),
    };
    const settings = { roads, labels: true };
    const displaySettings = cartographySettingsForDisplay(settings, true);
    assert.deepEqual(displaySettings, { roads, labels: false });
    assert.notEqual(displaySettings, settings);
    assert.deepEqual(settings, { roads, labels: true });
    syncCartography(map, displaySettings);
    for (const id of ['rivers', 'road-outline', 'main-roads', 'local-roads'])
      assert.equal(visibility.get(id), roads ? 'visible' : 'none', id);
    assert.equal(visibility.get('road-names'), roads ? 'visible' : 'none');
    assert.equal(visibility.get('city-names'), 'none');

    const internationalSettings = { roads, labels: true };
    assert.equal(
      cartographySettingsForDisplay(internationalSettings, false),
      internationalSettings,
    );
    assert.deepEqual(internationalSettings, { roads, labels: true });
  }
});
test('installed MapLibre keeps free zoom with bounded requests and a fixed maximum detail level', async () => {
  const compiled = await build({ stdin: { resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts', contents: `
    import {MercatorTransform} from './node_modules/maplibre-gl/src/geo/projection/mercator_transform.ts';
    import {LngLat} from './node_modules/maplibre-gl/src/geo/lng_lat.ts';
    import {coveringTiles} from './node_modules/maplibre-gl/src/geo/projection/covering_tiles.ts';
    export function samples() {
      const t=new MercatorTransform();t.resize(390,844);t.setCenter(new LngLat(103.52,30.8));
      const result=[];
      for(const zoom of [0,4,12,15,22]) for(const pitch of [0,62,80]) for(const bearing of [0,90,180]) {
        t.setZoom(zoom);t.setPitch(pitch);t.setBearing(bearing);
        result.push(coveringTiles(t,{tileSize:256,minzoom:0,maxzoom:13,roundZoom:true}).map(tile=>tile.canonical.z));
      }
      return result;
    }` }, bundle: true, platform: 'node', format: 'esm', write: false });
  const engine = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
  const samples = engine.samples();
  assert.equal(samples.length, 45);
  for (const levels of samples) { assert.ok(levels.length > 0); assert.ok(levels.every(z=>z<=13)); assert.ok(levels.length < 400); }
});

test("camera limits are untouched, including a caller-defined floor",()=>{const f=fixture();f.map.setMinZoom(3);f.map.setMinZoom=()=>{throw Error("camera changed");};f.lock.sync(["detail"],18);f.lock.sync(["detail"],2);f.lock.sync([],null);assert.equal(f.map.getMinZoom(),3);});
