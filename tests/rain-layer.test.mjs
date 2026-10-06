import test from 'node:test';
import assert from 'node:assert/strict';
import { gridPoints } from '../modules/weather/data.ts';
import { buildRainRaster } from '../modules/weather/rain.ts';
import { WeatherLayer } from '../modules/weather/WeatherLayer.ts';

function weather(anchor, valuesByHour) {
  const points = gridPoints(...anchor);
  return {
    anchor,
    fetchedAt: 1,
    times: valuesByHour.map((_, i) => i),
    cells: points.map((point) => ({
      ...point,
      elevation: null,
      hours: valuesByHour.map((value) => ({ rain: value })),
    })),
  };
}

class MapMock {
  sources = new Map();
  layers = new Map();
  style = { layers: [{ id: 'rivers', type: 'line' }, { id: 'place-labels', type: 'symbol' }] };
  beforeIds = [];
  addSource(id, definition) {
    this.sources.set(id, {
      definition,
      updates: [],
      attempts: 0,
      throwNextUpdate: false,
      updateImage(image) {
        this.attempts++;
        if (this.throwNextUpdate) {
          this.throwNextUpdate = false;
          throw new Error('mock image update failure');
        }
        this.updates.push(image);
      },
    });
  }
  addLayer(layer, before) {
    this.layers.set(layer.id, layer);
    this.beforeIds.push(before);
    const index = before ? this.style.layers.findIndex((item) => item.id === before) : -1;
    this.style.layers.splice(index < 0 ? this.style.layers.length : index, 0, { id: layer.id, type: layer.type, layout: layer.layout });
  }
  getStyle() { return this.style; }
  getSource(id) { return this.sources.get(id); }
  getLayer(id) { return this.layers.get(id); }
  setLayoutProperty(id, name, value) { this.layers.get(id).layout[name] = value; }
  setPaintProperty(id, name, value) { this.layers.get(id).paint[name] = value; }
}

function installCanvas(t) {
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const priorError = console.error;
  const frames = [], errors = [];
  const control = { contextAvailable: true, failEncoding: false, created: 0 };
  globalThis.document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      control.created++;
      const canvas = {
        width: 0,
        height: 0,
        getContext(kind) {
          assert.equal(kind, '2d');
          if (!control.contextAvailable) return null;
          return {
            createImageData(width, height) {
              return { width, height, data: new Uint8ClampedArray(width * height * 4) };
            },
            putImageData(image) { frames.push(new Uint8ClampedArray(image.data)); },
          };
        },
        toDataURL(type) {
          assert.equal(type, 'image/png');
          if (control.failEncoding) throw new Error('mock encode failure');
          return `data:image/png;base64,mock-${frames.length}`;
        },
      };
      return canvas;
    },
  };
  console.error = (...args) => errors.push(args);
  t.after(() => {
    console.error = priorError;
    if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument);
    else delete globalThis.document;
  });
  return { control, frames, errors };
}

test('rain image source maps smooth pixels to forecast bounds and reuses opacity/visibility updates', (t) => {
  const canvas = installCanvas(t);
  const map = new MapMock();
  const layer = new WeatherLayer(map);
  const data = weather([103.28, 31.08], [2, 5]);
  const source = map.getSource('rain-grid');
  assert.equal(source.definition.type, 'image');
  assert.deepEqual(source.definition.coordinates, [[0, 1], [1, 1], [1, 0], [0, 0]]);
  assert.equal(map.getLayer('rain-grid').type, 'raster');
  assert.equal(map.getLayer('rain-grid').paint['raster-fade-duration'], 0);
  assert.equal(map.getLayer('rain-grid').paint['raster-resampling'], 'linear');
  assert.deepEqual(map.style.layers.map((item) => item.id), ['rain-grid', 'rivers', 'place-labels']);

  layer.update(data, 0, { rain: true, opacity: 0.37 });
  const firstRaster = buildRainRaster(data, 0);
  assert.equal(canvas.frames.length, 1);
  assert.deepEqual(canvas.frames[0], firstRaster.pixels, 'the actual raster pixels are written into ImageData');
  assert.deepEqual(source.updates[0].coordinates, [
    [firstRaster.bounds[0], firstRaster.bounds[3]],
    [firstRaster.bounds[2], firstRaster.bounds[3]],
    [firstRaster.bounds[2], firstRaster.bounds[1]],
    [firstRaster.bounds[0], firstRaster.bounds[1]],
  ]);
  assert.equal(map.getLayer('rain-grid').layout.visibility, 'visible');
  assert.equal(map.getLayer('rain-grid').paint['raster-opacity'], 0.37);

  layer.update(data, 0, { rain: true, opacity: 0.8 });
  assert.equal(canvas.control.created, 1, 'opacity-only changes do not redraw the canvas');
  assert.equal(source.updates.length, 1);
  assert.equal(map.getLayer('rain-grid').paint['raster-opacity'], 0.8);
  layer.update(data, 0, { rain: false, opacity: 0.8 });
  assert.equal(map.getLayer('rain-grid').layout.visibility, 'none');
  assert.equal(source.updates.length, 1, 'closing the layer does not leave the previous raster visible or rebuild it');
  layer.update(data, 0, { rain: true, opacity: 0.8 });
  assert.equal(map.getLayer('rain-grid').layout.visibility, 'visible');
  assert.equal(canvas.control.created, 1, 'reopening the latest data and hour reuses its cached image');

  layer.update(data, 1, { rain: true, opacity: 0.8 });
  assert.equal(source.updates.length, 2, 'changing the selected hour updates the image source');
  assert.notDeepEqual(canvas.frames[1], canvas.frames[0], 'a changed hour changes the actual raster pixels');
  const regional = weather([112, 30], [2, 5]);
  layer.update(regional, 1, { rain: true, opacity: 0.8 });
  assert.notDeepEqual(source.updates[2].coordinates, source.updates[1].coordinates, 'new forecast center repositions the image');

  layer.update(null, 0, { rain: true, opacity: 0.8 });
  assert.equal(map.getLayer('rain-grid').layout.visibility, 'none');
  assert.equal(source.updates.length, 3, 'missing data hides the previous texture');
});

test('canvas context and encoding failures stay hidden and retry the same data/hour', (t) => {
  const canvas = installCanvas(t);
  const map = new MapMock();
  const layer = new WeatherLayer(map);
  const data = weather([103.28, 31.08], [2]);
  const source = map.getSource('rain-grid');
  canvas.control.contextAvailable = false;
  layer.update(data, 0, { rain: true, opacity: 0.6 });
  assert.equal(map.getLayer('rain-grid').layout.visibility, 'none');
  assert.equal(source.updates.length, 0);
  canvas.control.contextAvailable = true;
  canvas.control.failEncoding = true;
  layer.update(data, 0, { rain: true, opacity: 0.6 });
  assert.equal(map.getLayer('rain-grid').layout.visibility, 'none');
  assert.equal(source.updates.length, 0);
  canvas.control.failEncoding = false;
  layer.update(data, 0, { rain: true, opacity: 0.6 });
  assert.equal(source.updates.length, 1, 'failed canvas attempts did not poison the data/hour cache');
  assert.equal(map.getLayer('rain-grid').layout.visibility, 'visible');
  assert.equal(canvas.errors.length, 2);
});

test('image source update failures stay hidden and re-encode the same data/hour on retry', (t) => {
  const canvas = installCanvas(t);
  const map = new MapMock();
  const layer = new WeatherLayer(map);
  const data = weather([103.28, 31.08], [2]);
  const source = map.getSource('rain-grid');
  source.throwNextUpdate = true;
  layer.update(data, 0, { rain: true, opacity: 0.6 });
  assert.equal(map.getLayer('rain-grid').layout.visibility, 'none');
  assert.equal(source.updates.length, 0);
  assert.equal(canvas.control.created, 1);

  layer.update(data, 0, { rain: true, opacity: 0.6 });
  assert.equal(map.getLayer('rain-grid').layout.visibility, 'visible');
  assert.equal(source.attempts, 2);
  assert.equal(source.updates.length, 1);
  assert.equal(canvas.control.created, 2, 'the failed update did not cache a successful image');
  assert.equal(canvas.frames.length, 2);
  assert.equal(canvas.errors.length, 1);
});

test('rain image is inserted below custom vector symbols when no road layer exists', () => {
  const map = new MapMock();
  map.style.layers = [{ id: 'custom-place-symbols', type: 'symbol' }];
  new WeatherLayer(map);
  assert.equal(map.beforeIds[0], 'custom-place-symbols');
  assert.deepEqual(map.style.layers.map((item) => item.id), ['rain-grid', 'custom-place-symbols']);
});
