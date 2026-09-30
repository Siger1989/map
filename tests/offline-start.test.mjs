import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

test('retired native download bridge refuses without touching Android or stored data', () => {
  const source=readFileSync('mobile/android/src/com/guanyun/weather/NativeBridge.java','utf8');
  const method=source.slice(source.indexOf('    @JavascriptInterface public String offlineStart'),source.indexOf('    @JavascriptInterface public String offlineState')).replace('@JavascriptInterface ','');
  const dir=path.resolve('.openai/offline-start-java');mkdirSync(dir,{recursive:true});
  // No Android or storage fakes: touching either would fail to compile this boundary.
  writeFileSync(path.join(dir,'StartCheck.java'),`public class StartCheck {
    ${method}
    public static void main(String[] args) {
      for (String input : new String[] {null, "", "old-download-task"})
        if (!"地图缓存功能已移除".equals(new StartCheck().offlineStart(input))) throw new AssertionError();
      System.out.println("disabled without side effects");
    }
  }`);
  const jdk=process.env.JAVA_HOME || 'D:/GodotAndroid/jdk-17';
  const bin=name=>path.join(jdk,'bin',name+(process.platform==='win32'?'.exe':''));
  execFileSync(bin('javac'),['-encoding','UTF-8','-d',dir,path.join(dir,'StartCheck.java')],{timeout:30000});
  assert.match(execFileSync(bin('java'),['-cp',dir,'StartCheck'],{encoding:'utf8',timeout:10000}),/disabled without side effects/);
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
