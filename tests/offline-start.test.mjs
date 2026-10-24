import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

test('native bridge exposes the v2 imported-route chunk protocol', () => {
  const source=readFileSync('mobile/android/src/com/guanyun/weather/NativeBridge.java','utf8');
  assert.match(source,/offlineCapabilities\(\)\s*\{\s*return "\{\\"version\\":2,\\"imported\\":true,\\"chunked\\":true\}";/);
  assert.match(source,/offlineBegin\(String id,String name,int total\).*OfflineStore\.begin\(activity,id,name,total\)/);
  assert.match(source,/offlineAppend\(String id,int offset,String rawUrls\).*OfflineStore\.append\(activity,id,offset,rawUrls\)/);
  assert.match(source,/offlineDiscard\(String id\).*OfflineStore\.discard\(activity,id\)/);
  assert.match(source,/offlineCommit\(String id\).*OfflineStore\.commit\(activity,id\)/s);
  assert.match(source,/offlineStart\(String raw\).*OfflineStore\.prepare\(activity,raw\)/s);
  assert.doesNotMatch(source,/地图缓存功能已移除/);
  const service=readFileSync('mobile/android/src/com/guanyun/weather/OfflineDownloadService.java','utf8');
  const proxy=readFileSync('mobile/android/src/com/guanyun/weather/MapTileProxy.java','utf8');
  assert.match(service,/newFixedThreadPool\(16\);for\(int w=0;w<16;w\+\+\)/);
  assert.match(proxy,/MAX_ACTIVE_REQUESTS\s*=\s*32/);
  assert.match(proxy,/MAX_ACTIVE_PER_HOST\s*=\s*32/);
});

test('imported route estimate is passive and starts only after the explicit user click', async (t) => {
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
  let network=0,starts=0,calls=[];
  globalThis.fetch=async()=>{network++;throw Error('The estimate must not fetch');};
  window.GuanyunNative={offlineStart(){starts++;return 'ok';},offlineState:()=>JSON.stringify({}),offlinePause(){}};
  await build({entryPoints:['modules/outdoor/OfflineDownload.tsx'],outdir:'.openai/offline-start-ui',bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic'});
  const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
  const {OfflineDownload}=await import('../.openai/offline-start-ui/OfflineDownload.js');
  const target={name:'测试路线',area:{kind:'route',segments:[[[103,30],[103.001,30.001]]],bufferKm:1},source:{id:'imported-test',name:'导入影像',kind:'online',format:'XYZ',attribution:'',minzoom:12,maxzoom:19,tileSize:256,tiles:['https://tiles.example.test/{z}/{x}/{y}.png'],scheme:'xyz',bytes:0}};
  const offline={current:null,busy:false,background:true,message:'',pause(){},resume(){},createImportedRoute(...args){calls.push(args);return Promise.resolve();}};
  function Probe(){return React.createElement(OfflineDownload,{offline,target,onClose(){},onManage(){}});}
  const root=createRoot(document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());});await act(async()=>root.render(React.createElement(Probe)));
  const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);
  assert.equal(network,0);assert.equal(calls.length,0);assert.equal(starts,0);
  assert.ok(button('开始下载'));assert.equal(button('开始下载').disabled,false);
  await act(async()=>button('开始下载').click());
  assert.equal(calls.length,1);assert.equal(calls[0][0],target.name);assert.equal(calls[0][2].id,target.source.id);assert.equal(calls[0][3],14);
  assert.equal(network,0);assert.equal(starts,0);
});
