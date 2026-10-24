import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeRouteOffline, downloadNative } from '../modules/outdoor/nativeOffline.ts';

test('old APK compatibility stub is not treated as background support; large tasks use ordered chunks',async()=>{
  const old=globalThis.window;
  const calls=[];let state={};
  const bridge={offlineStart(){throw Error('must not send large single payload');},offlineState:()=>JSON.stringify(state),offlinePause(){},offlineHas:()=>false,offlineVerify:()=>'',offlineRemove:()=>true};
  globalThis.window={GuanyunNative:bridge};
  try {
    assert.equal(nativeRouteOffline(),null);
    Object.assign(bridge,{
      offlineCapabilities:()=>JSON.stringify({version:2,imported:true,chunked:true}),
      offlineBegin(id,name,total){calls.push(['begin',id,total]);return 'ok';},
      offlineAppend(id,offset,raw){calls.push(['append',offset,JSON.parse(raw).length]);return 'ok';},
      offlineCommit(id){calls.push(['commit']);state={id,state:'complete',done:2101,bytes:999};return 'ok';},
      offlineDiscard(){calls.push(['discard']);},
    });
    assert.equal(nativeRouteOffline(),bridge);
    const trip={id:'native19',name:'route',provider:'imported',urls:Array.from({length:2101},(_,i)=>`https://tiles.example.test/19/${i}/1.png`),done:0,bytes:0};
    const progress=[];
    await downloadNative(trip,new AbortController().signal,p=>progress.push(p));
    assert.deepEqual(calls,[['begin','native19',2101],['append',0,1000],['append',1000,1000],['append',2000,101],['commit']]);
    assert.equal(progress.at(-1).complete,true);assert.equal(progress.at(-1).done,2101);
    calls.length=0;
    const abort=new AbortController();
    bridge.offlineAppend=()=>{abort.abort();return 'ok';};
    await assert.rejects(downloadNative(trip,abort.signal,()=>{}),/暂停/);
    assert.deepEqual(calls,[['begin','native19',2101],['discard']]);
  }finally{globalThis.window=old;}
});
