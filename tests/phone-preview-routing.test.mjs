import test from 'node:test';
import assert from 'node:assert/strict';
import { phonePreviewRoute } from '../mobile/phone-preview-routing.js';

const route = query => phonePreviewRoute(new URLSearchParams(query));

test('retired weather preview URLs cannot open a weather feature or forward its parameters', () => {
  for (const scene of ['weather', 'live-weather']) {
    assert.deepEqual(route(`scene=${scene}&weather-demo=snow&rain=1`), { scenePreview: false, title: null, page: '/' });
  }
  assert.equal(route('scene=journey&route=winding&weather=1&weather-demo=cloud&rain=1').page,
    '/journey-preview.html?route=winding');
});

test('journey routes, solar night view, markers and floating navigation remain reachable', () => {
  assert.equal(route('scene=journey&route=road').page, '/journey-preview.html?route=road');
  assert.equal(route('scene=journey').page, '/journey-preview.html');
  assert.equal(route('scene=sky&night=1').page, '/sky-preview.html?night=1');
  assert.equal(route('scene=marker').page, '/sky-preview.html?marker=1');
  assert.equal(route('scene=floating-nav').page, '/floating-navigation-preview.html');
  for (const scene of ['journey', 'sky', 'marker', 'floating-nav']) assert.equal(route('scene=' + scene).scenePreview, true);
});
