import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { satelliteUnderlaySource, showSatelliteUnderlay } from '../modules/cartography/satelliteUnderlay.ts';

test('bundled overview covers every global XYZ tile up to its declared maximum with original bytes', async () => {
  const root = new URL('../public/basemaps/satellite-overview-v1/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('SOURCE.json', root)));
  assert.equal(manifest.maxzoom, satelliteUnderlaySource('http://localhost').maxzoom);
  let count = 0, total = 0;
  for (let z=0; z<=manifest.maxzoom; z++) for(let x=0;x<2**z;x++) for(let y=0;y<2**z;y++) {
    const key=`${z}/${x}/${y}.jpg`, data=await readFile(new URL(key,root));
    assert.equal(createHash('sha256').update(data).digest('hex'),manifest.outputs_sha256[key],key);
    assert.ok(data.subarray(0,3).equals(Buffer.from([255,216,255])) || data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),key);
    total+=data.length;count++;
  }
  assert.equal(count,Object.keys(manifest.outputs_sha256).length);
  assert.equal(total,manifest.bytes);
});

test('overview uses local assets on both browser and Android and preserves geographic XYZ identity',()=>{
  for(const origin of ['http://127.0.0.1:9174','https://appassets.androidplatform.net']){
    const source=satelliteUnderlaySource(origin);
    assert.deepEqual(source.tiles,[origin+'/basemaps/satellite-overview-v1/{z}/{x}/{y}.jpg']);
    assert.equal(source.tileSize,256);assert.equal(source.minzoom,0);
    assert.ok(source.attribution.includes('EOX'));
  }
});

test('satellite and custom maps receive underlay while ordinary map-only mode stays reversible',()=>{
  assert.equal(showSatelliteUnderlay({satellite:true,offlineBasemap:false},false),true);
  assert.equal(showSatelliteUnderlay({satellite:false,offlineBasemap:false},true),true);
  assert.equal(showSatelliteUnderlay({satellite:false,offlineBasemap:false},false),false);
  assert.equal(showSatelliteUnderlay({satellite:true,offlineBasemap:true},false),false);
});
