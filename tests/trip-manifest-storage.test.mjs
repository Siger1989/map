import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { persistTripManifest, tripPackages, putTrip, loadTripManifest, removeTripIndex, removeTripManifest, packageUrls } from '../modules/outdoor/tripStorage.ts';

test('large route manifests persist in IndexedDB while frequent progress keeps the legacy index small', async () => {
  const oldDB=globalThis.indexedDB, oldStorage=globalThis.localStorage;
  const values=new Map();
  globalThis.indexedDB=indexedDB;
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{
    assert.ok(value.length<4096,'large URL list must never enter localStorage');values.set(key,value);
  }};
  try {
    const urls=Array.from({length:21000},(_,i)=>`https://tiles.example.test/19/${i}/12.png`);
    const trip={id:'manifest-large',name:'large19',urls,done:0,bytes:0,complete:false,zoom:19};
    await persistTripManifest(trip);
    const stored=JSON.parse(values.get('guanyun.trips.v1'))[0];
    assert.equal(stored.manifest,true);assert.equal(stored.urlCount,21000);assert.deepEqual(stored.urls,[]);
    for(let i=1;i<=6;i++)putTrip({...trip,done:i,bytes:i*1024});
    assert.deepEqual((await loadTripManifest(stored)).urls,urls);
    assert.deepEqual(await packageUrls(trip.id),urls);
    assert.equal(tripPackages()[0].done,6);
    const other={...trip,id:'manifest-other',urls:urls.map(url=>url.replace('/19/','/18/'))};
    await persistTripManifest(other);
    removeTripIndex(trip.id);
    await removeTripManifest(trip.id);
    const compact=JSON.parse(values.get('guanyun.trips.v1'));
    assert.equal(compact.length,1);
    assert.equal(compact[0].id,other.id);
    assert.deepEqual(compact[0].urls,[],'deleting another manifest must not hydrate its large URLs into localStorage');
    assert.deepEqual((await loadTripManifest(compact[0])).urls,other.urls);
    await assert.rejects(loadTripManifest(stored),/缺失或损坏/);
    const small={...trip,id:'legacy-small',urls:['https://tiles.example.test/14/1/2.png'],manifest:undefined,urlCount:undefined};
    await persistTripManifest(small);
    assert.deepEqual(JSON.parse(values.get('guanyun.trips.v1'))[1].urls,small.urls);
    assert.deepEqual((await loadTripManifest(small)).urls,small.urls);
  } finally {globalThis.indexedDB=oldDB;globalThis.localStorage=oldStorage;}
});
