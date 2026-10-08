import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhotonSearchURL, sortPlacesByDistance } from '../modules/navigation/provider.ts';

test('place lookup uses its actual origin and returns nearby matches first without mutating results', () => {
  const origin=[104,30];
  const url=new URL(buildPhotonSearchURL(' 公园 ', origin));
  assert.equal(url.searchParams.get('q'),'公园');
  assert.equal(url.searchParams.get('lat'),'30');
  assert.equal(url.searchParams.get('lon'),'104');
  assert.equal(url.searchParams.get('location_bias_scale'),'0.1');
  assert.equal(url.searchParams.get('limit'),'20');
  const places=[{name:'远处',coordinates:[110,35]},{name:'近处',coordinates:[104.001,30]},{name:'同距离',coordinates:[104.001,30]}];
  assert.deepEqual(sortPlacesByDistance(places,origin).map(p=>p.name),['近处','同距离','远处']);
  assert.equal(places[0].name,'远处');
  assert.deepEqual(sortPlacesByDistance(places,[110,35]).map(p=>p.name),['远处','近处','同距离']);
});

test('no available origin keeps upstream ranking and does not invent search coordinates', () => {
  const url=new URL(buildPhotonSearchURL('公园',null));
  assert.equal(url.searchParams.has('lat'),false);
  assert.equal(url.searchParams.has('lon'),false);
  const places=[{name:'第一',coordinates:[104,30]},{name:'第二',coordinates:[105,31]}];
  assert.deepEqual(sortPlacesByDistance(places,null),places);
});
