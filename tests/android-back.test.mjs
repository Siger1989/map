import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {dispatchBack,registerBackHandler} from '../modules/controls/backNavigation.ts';
const java=readFileSync(new URL('../mobile/android/src/com/guanyun/weather/MainActivity.java',import.meta.url),'utf8');
const source=JSON.parse(java.match(/evaluateJavascript\(("(?:\\.|[^"\\])*"), result/)[1]);
class Key {constructor(type,data){this.type=type;Object.assign(this,data);this.defaultPrevented=false;}preventDefault(){this.defaultPrevented=true;}}
function fixture(){
 const calls=[],all=[],clean=[];
 globalThis.Node={DOCUMENT_POSITION_FOLLOWING:4};globalThis.KeyboardEvent=Key;
 globalThis.getComputedStyle=n=>({visibility:n.hidden?'hidden':'visible',zIndex:String(n.z)});
 globalThis.document={querySelectorAll:()=>all.filter(n=>n.legacy),querySelector:()=>all.find(n=>n.root)??null};
 function node(name,z=0,parentElement=null,options={}){const n={name,z,parentElement,...options,isConnected:true,getClientRects(){return this.hidden?[]:[{}]},contains(b){for(let p=b;p;p=p.parentElement)if(p===this)return true;return false;},closest(){return this.modal?this:null},compareDocumentPosition(b){return all.indexOf(this)<all.indexOf(b)?4:2;},dispatchEvent(e){calls.push(name);if(this.consume)e.preventDefault();}};all.push(n);return n;}
 return {calls,node,register(n){clean.push(registerBackHandler(()=>n,()=>calls.push(n.name)))},close(){clean.forEach(f=>f());delete globalThis.document;delete globalThis.getComputedStyle;delete globalThis.Node;delete globalThis.KeyboardEvent;}};
}
test('native delegates one return to the app; absent/unhandled dispatcher returns control to Android',()=>{
 let count=0;assert.equal(runInNewContext(source,{window:{shantuBack(){count++;return true;}}}),true);assert.equal(count,1);
 assert.equal(runInNewContext(source,{window:{}}),false);assert.equal(runInNewContext(source,{window:{shantuBack:()=>false}}),false);
});
test('top painted window wins regardless of registration order',()=>{const f=fixture();try{const a=f.node('drawing',5),b=f.node('photo',90);f.register(b);f.register(a);assert.ok(dispatchBack());assert.deepEqual(f.calls,['photo']);}finally{f.close()}});
test('nested settings close before their recording window',()=>{const f=fixture();try{const a=f.node('record',20),b=f.node('settings',0,a);f.register(b);f.register(a);dispatchBack();assert.deepEqual(f.calls,['settings']);}finally{f.close()}});
test('hidden or disconnected windows never consume back',()=>{const f=fixture();try{f.register(f.node('hidden',999,null,{hidden:true}));const gone=f.node('removed',900);gone.isConnected=false;f.register(gone);assert.equal(dispatchBack(),false);}finally{f.close()}});
test('stacking context ancestor beats high z-index inside lower context',()=>{const f=fixture();try{const base=f.node('base',5),top=f.node('modal',30);f.register(f.node('child',999,base));f.register(top);dispatchBack();assert.deepEqual(f.calls,['modal']);}finally{f.close()}});
test('legacy dialog consumes one Escape above registered controls',()=>{const f=fixture();try{f.register(f.node('drawing',20));f.node('legacy',0,null,{legacy:true,modal:true});dispatchBack();assert.deepEqual(f.calls,['legacy']);}finally{f.close()}});
test('map selection receives cancellable Escape while idle map returns false',()=>{const f=fixture();try{const root=f.node('map',0,null,{root:true,consume:true});assert.equal(dispatchBack(),true);root.consume=false;assert.equal(dispatchBack(),false);}finally{f.close()}});
