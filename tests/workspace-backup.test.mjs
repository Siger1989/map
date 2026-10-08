import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { mergeWorkspaceCore, validateWorkspace, WORKSPACE_FORMAT, WORKSPACE_VERSION } from '../modules/dataTransfer/workspaceBackup.ts';
import { importWorkspace } from '../modules/dataTransfer/workspaceBackup.ts';
import { syncPhotos, readPhotos, snapshotPhotos } from '../modules/photos/storage.ts';
import { syncMapSources, listMaps, readMap, snapshotMapSources } from '../modules/mapSources/storage.ts';
import { syncCadDocuments, readCadDocuments, validateCadDocuments, replaceCadDocuments } from '../modules/cad/storage.ts';
import { WGS84_CRS } from '../modules/coordinates/index.ts';
import { mergeData, collectData } from '../modules/dataTransfer/storage.ts';
import { ROUTING_MODE_KEY } from '../modules/offlineRouting/preferences.ts';
import { syncIndustryProjects, readIndustryProjects, validateIndustryProjects, replaceIndustryProjects } from '../modules/industry/projectStorage.ts';

const blank = () => ({ format: 'guanyun-backup', version: 1, tracks: [], annotations: [], favorites: [] });
const track = (id, name) => ({ id, name, createdAt: 1, source: 'manual', segments: [[[103,31],[103.1,31]]] });
const marker = (id, name) => ({ id, kind: 'pin', name, note: '', trackAnchor: { trackId: 'same', distance: 12 }, color: '#ffffff', coordinates: [103,31], groundElevation: null, placement: 'surface', offset: 0, width: 1, length: 1, height: 1, heading: 0, pitch: 0, roll: 0, opacity: 0.5, visible: true });

test('workspace sync overwrites matching IDs and retains receiver-only data and directory relationships', () => {
  const local = { ...blank(), tracks: [track('same','local'), track('local-only','keep')], annotations: [marker('pin','local pin')] };
  const incoming = { ...blank(), tracks: [track('same','sender'), track('sender-only','add')], annotations: [marker('pin','sender pin')] };
  const merged = mergeWorkspaceCore(local, incoming);
  assert.equal(merged.tracks.find((item) => item.id === 'same').name, 'sender');
  assert.ok(merged.tracks.some((item) => item.id === 'local-only'));
  assert.ok(merged.tracks.some((item) => item.id === 'sender-only'));
  assert.deepEqual(merged.favorites, []);
  assert.equal(merged.annotations[0].name, 'sender pin');
  assert.equal(merged.annotations[0].trackAnchor.trackId, 'same');
});

test('workspace validation applies the shared stored map validator', () => {
  const base = { format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, core: blank(), photos: [], settings: {}, mapSources: [], cadDocuments: [], limitations: [] };
  const valid = { id:'user-map', name:'My map', kind:'online', format:'png', attribution:'User source', minzoom:0, maxzoom:20, tileSize:256, tiles:['https://tiles.example/{z}/{x}/{y}.png'], bytes:10 };
  assert.equal(validateWorkspace({ ...base, mapSources:[valid] }).mapSources[0].id, 'user-map');
  assert.throws(() => validateWorkspace({ ...base, mapSources:[{ ...valid, tiles:[] }] }), /图源记录含无效配置|缺少瓦片地址/);
  assert.throws(() => validateWorkspace({ ...base, mapSources:[{ ...valid, kind:'unknown' }] }), /图源记录含无效配置/);
});

test('workspace parser rejects malformed photo base64, unapproved keys, and oversized workspaces', () => {
  const base = { format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, core: blank(), photos: [], settings: {}, mapSources: [], cadDocuments: [], limitations: [] };
  assert.deepEqual(validateWorkspace(base).photos, []);
  assert.throws(() => validateWorkspace({ ...base, photos: [{ id:'p', mime:'image/jpeg', previewBase64:'not base64', name:'p.jpg', trackId:'', trackName:'', time:1, coordinates:[103,31], kind:'point' }] }), /编码无效/);
  assert.throws(() => validateWorkspace({ ...base, settings: { 'shantu.secret-token':'abc' } }), /不允许/);
  assert.throws(() => validateWorkspace({ ...base, padding: 'x'.repeat(101 * 1024 * 1024) }), /100MB/);
});

test('workspace validates canonical Base64 linearly for 1 MiB and 20 MiB map files', () => {
  const base = { format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, core: blank(), photos: [], settings: {}, mapSources: [], cadDocuments: [], limitations: [] };
  const mapFor = (bytes, blobBase64) => ({ id:`map-${bytes}`, name:'Offline map', kind:'mbtiles', format:'mbtiles', attribution:'User supplied', minzoom:0, maxzoom:20, tileSize:256, bytes, blobMime:'application/x-sqlite3', blobBase64 });
  const canonicalZeros = (bytes) => {
    const padding = (3 - bytes % 3) % 3;
    return 'A'.repeat(Math.ceil(bytes / 3) * 4 - padding) + '='.repeat(padding);
  };
  for (const size of [1024 * 1024, 20 * 1024 * 1024]) {
    const map = mapFor(size, canonicalZeros(size));
    const result = validateWorkspace({ ...base, mapSources:[map] });
    assert.equal(result.mapSources[0].id, map.id);
  }
  for (const malformed of ['A===', 'AA=A', 'AB==', 'AAB=', 'AA==A']) {
    assert.throws(() => validateWorkspace({ ...base, mapSources:[mapFor(0, malformed)] }), /Base64|图源/);
  }
});

test('real IndexedDB import rollback restores added and overwritten photos, maps, core data, settings, CAD, and Excel projects', async () => {
  const local = new Map();
  globalThis.localStorage = { getItem:(k)=>local.get(k)??null, setItem:(k,v)=>local.set(k,String(v)), removeItem:(k)=>local.delete(k) };
  const blankPhoto = (id, title, body) => ({ id, name:`${id}.jpg`, trackId:'track', trackName:'Track', time:1, coordinates:[103,31], kind:'point', title, preview:new Blob([body],{type:'image/jpeg'}) });
  // Use direct known Base64 payloads for deterministic transfer bytes.
  const pOld = blankPhoto('same-photo','before','old'), pOnly = blankPhoto('local-photo','keep','local');
  await syncPhotos([pOld,pOnly]);
  const photoDb=await new Promise((resolve,reject)=>{const request=indexedDB.open('guanyun-trip-photos');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const corruptPhoto={id:'legacy-invalid-photo',name:'x'.repeat(300),trackId:'track',trackName:'Track',time:1,coordinates:[103,31],kind:'point',preview:new Blob(['legacy'],{type:'image/jpeg'})};
  await new Promise((resolve,reject)=>{const tx=photoDb.transaction('photos','readwrite');tx.objectStore('photos').put(corruptPhoto);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  const source = (id,name) => ({id,name,kind:'online',format:'png',attribution:'User supplied',minzoom:0,maxzoom:20,tileSize:256,tiles:[`https://tiles.example/${id}/{z}/{x}/{y}.png`],bytes:10});
  const mOld=source('same-map','before'),mOnly=source('local-map','keep');
  await syncMapSources([mOld,mOnly]);
  const mapDb=await new Promise((resolve,reject)=>{const request=indexedDB.open('shantu-map-sources');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const legacyMap={id:'legacy-invalid-map',name:'Legacy map',kind:'unknown',bytes:1};
  await new Promise((resolve,reject)=>{const tx=mapDb.transaction('maps','readwrite');tx.objectStore('maps').put(legacyMap);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  const doc = (id,name) => ({id,name,format:'dxf',features:[],layers:[],warnings:[],sourceBase64:'',sourceCrs:WGS84_CRS,mapFeatures:[],visible:true,createdAt:1,axisOrder:'xy',unitScale:1});
  const oldCad=doc('old-cad','old');
  await syncCadDocuments([oldCad]);
  const industry=(id,name,source='eA==')=>({id,name,kind:'section',sourceBase64:source,createdAt:1});
  const oldIndustry=industry('old-project','old project','b2xk');
  const localIndustry=industry('local-project','local project','bG9jYWw=');
  await syncIndustryProjects([oldIndustry,localIndustry]);
  const oldCore={...blank(),tracks:[track('same','before'),track('local-only','keep')]};
  mergeData(oldCore,localStorage);
  localStorage.setItem(ROUTING_MODE_KEY,'offline');
  const incomingPhoto=(id,title,base64)=>({id,name:`${id}.jpg`,trackId:'track',trackName:'Track',time:1,coordinates:[103,31],kind:'point',title,mime:'image/jpeg',previewBase64:base64});
  const backup={format:WORKSPACE_FORMAT,version:WORKSPACE_VERSION,core:{...blank(),tracks:[track('same','sender'),track('sender-only','new')]},photos:[incomingPhoto('same-photo','sender','bmV3'),incomingPhoto('new-photo','added','bmV3')],settings:{[ROUTING_MODE_KEY]:'online'},mapSources:[source('same-map','sender'),source('new-map','added')],cadDocuments:[doc('new-cad','new')],industryProjects:[industry('old-project','sender project','c2VuZGVy'),industry('new-project','new project','bmVldw==')],limitations:[]};
  const cadAdapter={readCadDocuments,validateCadDocuments,replaceCadDocuments,syncCadDocuments};
  const industryAdapter={readIndustryProjects,validateIndustryProjects,replaceIndustryProjects,syncIndustryProjects:async(projects)=>{await syncIndustryProjects(projects);throw new Error('injected failure after industry transaction commit');}};
  await assert.rejects(importWorkspace(backup,cadAdapter,industryAdapter),/工作区导入失败/);
  assert.deepEqual(collectData(localStorage).tracks.map((x)=>[x.id,x.name]),[['same','before'],['local-only','keep']]);
  assert.equal(localStorage.getItem(ROUTING_MODE_KEY),'offline');
  const photos=await readPhotos();
  assert.equal(photos.length,2); assert.equal(photos.find((x)=>x.id==='same-photo').title,'before'); assert.ok(photos.some((x)=>x.id==='local-photo')); assert.ok(!photos.some((x)=>x.id==='new-photo'));
  const maps=await listMaps(); assert.equal(maps.length,3); assert.equal((await readMap('same-map')).name,'before'); assert.ok(maps.some((x)=>x.id==='local-map')); assert.ok(!maps.some((x)=>x.id==='new-map'));
  assert.ok((await snapshotPhotos()).some((x)=>x.id==='legacy-invalid-photo'),'rollback preserves filtered legacy photo rows verbatim');
  assert.ok((await snapshotMapSources()).some((x)=>x.id==='legacy-invalid-map'),'rollback preserves legacy map rows verbatim');
  const cad=await readCadDocuments(); assert.deepEqual(cad.map((x)=>x.id),['old-cad']);
  const projects=await readIndustryProjects(); assert.deepEqual(projects.map((x)=>[x.id,x.name]).sort(),[['old-project','old project'],['local-project','local project']].sort());
});
