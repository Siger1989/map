import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { DEFAULT_LAYERS } from '../modules/map/types.ts';
import { newAnnotation } from '../modules/annotations/data.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach(value => this.classList.values.add(value)),
      toggle: (value, enabled) => enabled
        ? this.classList.values.add(value)
        : this.classList.values.delete(value),
      contains: value => this.classList.values.has(value),
    };
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, value),
      getPropertyValue: name => this.style.values.get(name) ?? '',
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelector() { return null; }
  addEventListener() {}
}

async function compileWithMapLibreStub(entryPoint) {
  const output = await build({
    entryPoints: [fileURLToPath(new URL(entryPoint, import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [{
      name: 'maplibre-marker-test-adapter',
      setup(builder) {
        builder.onResolve({ filter: /^three$/ }, () => ({
          path: import.meta.resolve('three'),
          external: true,
        }));
        builder.onResolve({ filter: /^maplibre-gl$/ }, () => ({
          path: 'maplibre-gl-test-stub',
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `
            export class Marker {
              constructor(options) {
                this.options = options;
                this.element = options.element;
                this.opacityCalls = [];
                globalThis.__markerTerrainHarness.markers.push(this);
              }
              getElement() { return this.element; }
              getLngLat() { return this.coordinates ? { lng: this.coordinates[0], lat: this.coordinates[1] } : null; }
              setLngLat(coordinates) { this.coordinates = coordinates; return this; }
              setOffset(offset) { this.offset = offset; return this; }
              setOpacity(opacity, opacityWhenCovered) {
                this.opacityCalls.push([opacity, opacityWhenCovered]);
                return this;
              }
              addTo(map) { this.map = map; return this; }
              remove() { this.removed = true; }
            }
            export class MercatorCoordinate {
              static fromLngLat(coordinates) {
                return {
                  x: coordinates[0] / 360,
                  y: -coordinates[1] / 180,
                  meterInMercatorCoordinateUnits: () => 1e-5,
                };
              }
            }
          `,
          loader: 'js',
        }));
      },
    }],
  });
  const source = output.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`);
}

async function withDocument(run) {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: () => new FakeElement(),
    createElementNS: () => new FakeElement(),
  };
  try { return await run(); }
  finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

test('AnnotationLayer uses public Marker opacity options and only preserves X-ray for underground model labels', async () => {
  const previousHarness = globalThis.__markerTerrainHarness;
  globalThis.__markerTerrainHarness = { markers: [] };
  try {
    await withDocument(async () => {
      const { AnnotationLayer } = await compileWithMapLibreStub('../modules/annotations/AnnotationLayer.ts');
      const layer = new AnnotationLayer(() => {});
      const mapListeners = new Map();
      layer.map = {
        getZoom: () => 16,
        getCenter: () => ({ lng: 104, lat: 30 }),
        getCanvas: () => ({ clientWidth: 400, clientHeight: 400 }),
        on: (name, callback) => mapListeners.set(name, callback),
        off: (name, callback) => {
          if (mapListeners.get(name) === callback) mapListeners.delete(name);
        },
        triggerRepaint() {},
      };
      const settings = { ...DEFAULT_LAYERS, terrain: true, exaggeration: 1 };
      const pin = newAnnotation('pin', [104, 30], 120, 'surface-pin');
      layer.update([pin], null, settings);

      const pinMarker = globalThis.__markerTerrainHarness.markers[0];
      assert.equal(pinMarker.options.opacity, 1);
      assert.equal(pinMarker.options.opacityWhenCovered, 0);
      assert.deepEqual(pinMarker.opacityCalls, [], 'new markers receive options before addTo, without a forced depth check');

      const undergroundPin = { ...pin, id: 'underground-pin', placement: 'underground' };
      const surfaceBox = newAnnotation('box', [104.001, 30], 120, 'surface-box');
      const undergroundBox = { ...surfaceBox, id: 'underground-box', placement: 'underground' };
      layer.update([pin, undergroundPin, surfaceBox, undergroundBox], null, settings);
      const [samePin, pinMarkerUnder, boxMarker, undergroundBoxMarker] = globalThis.__markerTerrainHarness.markers;

      assert.equal(pinMarkerUnder.options.opacityWhenCovered, 0, 'underground placement does not exempt pins');
      assert.equal(boxMarker.options.opacityWhenCovered, 0, 'surface model labels follow terrain occlusion');
      assert.equal(undergroundBoxMarker.options.opacityWhenCovered, 1, 'underground model labels retain X-ray visibility');
      assert.ok(undergroundBoxMarker.element.classList.contains('is-underground-model-label'));
      assert.ok(!pinMarkerUnder.element.classList.contains('is-underground-model-label'));

      layer.update([pin, undergroundPin, surfaceBox, undergroundBox], 'surface-pin', settings);
      assert.strictEqual(globalThis.__markerTerrainHarness.markers[0], samePin);
      assert.deepEqual(samePin.opacityCalls, [], 'a rebuild with unchanged occlusion semantics does not force another read');

      const switched = { ...surfaceBox, placement: 'underground' };
      layer.update([switched], null, settings);
      assert.deepEqual(boxMarker.opacityCalls, [[1, 1]], 'changing a reused model label to underground updates its covered opacity');

      const distantPin = newAnnotation('pin', [120, 30], 120, 'distant-pin');
      layer.update([pin, distantPin], null, settings);
      const distantMarker = globalThis.__markerTerrainHarness.markers.find(marker =>
        marker.options.element?.dataset?.annotationId === 'distant-pin');
      assert.ok(distantMarker, 'the marker object retains its original element for later reuse');
      assert.equal(distantMarker.map, undefined, 'a distant annotation never reaches native Marker.addTo');
      assert.strictEqual(samePin.map, layer.map, 'the nearby annotation stays attached');
      layer.onRemove();
    });
  } finally {
    if (previousHarness === undefined) delete globalThis.__markerTerrainHarness;
    else globalThis.__markerTerrainHarness = previousHarness;
  }
});

test('PhotoLayer uses covered opacity zero and releases marker and map listeners on dispose', async () => {
  const previousHarness = globalThis.__markerTerrainHarness;
  globalThis.__markerTerrainHarness = { markers: [] };
  try {
    await withDocument(async () => {
      const { PhotoLayer } = await compileWithMapLibreStub('../modules/photos/PhotoLayer.ts');
      const listeners = new Map();
      const map = {
        on: (name, callback) => listeners.set(name, callback),
        off: (name, callback) => {
          if (listeners.get(name) === callback) listeners.delete(name);
        },
        getContainer: () => ({ clientWidth: 300, clientHeight: 300 }),
        project: () => ({ x: 100, y: 100 }),
      };
      const layer = new PhotoLayer(map, () => {});
      layer.sync([{ id: 'photo-1', name: '照片', kind: 'track', coordinates: [104, 30], url: 'blob:photo' }]);

      const [marker] = globalThis.__markerTerrainHarness.markers;
      assert.equal(marker.options.opacity, 1);
      assert.equal(marker.options.opacityWhenCovered, 0);
      assert.deepEqual(marker.coordinates, [104, 30]);
      assert.ok(listeners.has('moveend'));

      layer.dispose();
      assert.equal(marker.removed, true);
      assert.equal(listeners.has('moveend'), false);
    });
  } finally {
    if (previousHarness === undefined) delete globalThis.__markerTerrainHarness;
    else globalThis.__markerTerrainHarness = previousHarness;
  }
});

test('PhotoLayer filters distant photos before map projection and marker creation', async () => {
  const previousHarness = globalThis.__markerTerrainHarness;
  globalThis.__markerTerrainHarness = { markers: [] };
  try {
    await withDocument(async () => {
      const { PhotoLayer } = await compileWithMapLibreStub('../modules/photos/PhotoLayer.ts');
      let projections = 0;
      const listeners = new Map();
      const map = {
        on: (name, callback) => listeners.set(name, callback),
        off: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
        getCenter: () => ({ lng: 104, lat: 30 }),
        getZoom: () => 12,
        getCanvas: () => ({ clientWidth: 390, clientHeight: 750 }),
        getContainer: () => ({ clientWidth: 390, clientHeight: 750 }),
        project: () => { projections++; return { x: 100, y: 100 }; },
      };
      const layer = new PhotoLayer(map, () => {});
      layer.sync([
        { id: 'near', name: '附近照片', kind: 'track', coordinates: [104.001, 30], url: 'blob:near' },
        { id: 'far', name: '远处照片', kind: 'track', coordinates: [120, 30], url: 'blob:far' },
      ]);
      assert.equal(projections, 1, 'only the nearby photo reaches map.project');
      assert.equal(globalThis.__markerTerrainHarness.markers.length, 1, 'distant photo gets no DOM marker');
      assert.deepEqual(globalThis.__markerTerrainHarness.markers[0].coordinates, [104.001, 30]);
      layer.dispose();
    });
  } finally {
    if (previousHarness === undefined) delete globalThis.__markerTerrainHarness;
    else globalThis.__markerTerrainHarness = previousHarness;
  }
});

test('covered annotation and photo roots have scoped hide and pointer-blocking CSS; underground model labels are excluded', async () => {
  const [annotationCss, photoCss] = await Promise.all([
    read('../modules/annotations/annotations.css'),
    read('../modules/photos/photos.css'),
  ]);
  assert.match(annotationCss, /\.maplibregl-marker-covered\.annotation-marker:not\(\.is-underground-model-label\)\s*\{[^}]*visibility:\s*hidden\s*!important;[^}]*pointer-events:\s*none\s*!important;/);
  assert.match(photoCss, /\.maplibregl-marker-covered\.trip-photo-marker\s*\{[^}]*visibility:\s*hidden\s*!important;[^}]*pointer-events:\s*none\s*!important;/);
});
