import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNavigationCamera } from '../modules/guidance/navigationCamera.ts';

test('close navigation seeds real terrain height and completes the elevation lifecycle', () => {
  const calls = [], center = [104, 30], event = {positionFollow: true};
  const map = { getTerrain: () => ({source: 'elevation'}),
    isSourceLoaded: () => true,
    queryTerrainElevation(point) { assert.equal(point, center); return 493; },
    setCenterElevation(value, metadata) {calls.push(['height', value, metadata]);},
    easeTo(options, metadata) {calls.push(['camera', options, metadata]);} };
  applyNavigationCamera(map, {center, zoom: 18.2, pitch: 60, duration: 650}, event);
  assert.equal(calls[0][1], 493);
  assert.equal(calls[1][1].freezeElevation, true);
  assert.equal(calls[1][1].pitch, 60);
  assert.equal(calls[1][2], event);
  assert.equal(calls[1][1].duration, 650);
  map.queryTerrainElevation = () => null;
  map.isSourceLoaded = () => false;
  calls.length = 0;
  applyNavigationCamera(map, {center, duration: 0}, event);
  assert.equal(calls.length, 1, 'missing DEM never invents a height');
  assert.equal(calls[0][1].freezeElevation, true, 'subsequently loaded DEM can update after the move');
  assert.equal(calls[0][1].duration, 0, 'a late DEM must not move a zoomed camera underground mid-animation');
});

test('level maps keep normal camera semantics and tagged preview movement', () => {
  const event = {routePreview: true}, options = {center: [0, 0], pitch: 0};
  applyNavigationCamera({getTerrain:()=>null, easeTo(value, tag) {
    assert.deepEqual(value, options); assert.equal(tag,event);
  }}, options, event);
});
