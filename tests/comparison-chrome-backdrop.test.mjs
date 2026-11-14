import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { comparisonChromeSlices, installComparisonChromeBackdrop } from '../modules/mapComparison/comparisonChromeBackdrop.ts';

const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
test('portrait chrome uses upper map for heading and lower map for footer without expanding projection', () => {
  const maps = [rect(0,68,390,424), rect(0,456,390,813)];
  const before = structuredClone(maps);
  assert.deepEqual(comparisonChromeSlices(rect(0,0,390,36), maps, 'heading'), [{index:0,rect:rect(0,0,390,36)}]);
  assert.deepEqual(comparisonChromeSlices(rect(0,813,390,857), maps, 'actions'), [{index:1,rect:rect(0,813,390,857)}]);
  assert.deepEqual(comparisonChromeSlices(rect(0,424,390,456), maps, 'toolbar', 1), [{index:1,rect:rect(0,424,390,456)}]);
  assert.deepEqual(maps,before);
});
test('landscape full-width chrome is partitioned between the real map viewports', () => {
  const maps = [rect(0,68,428.5,346), rect(428.5,68,857,346)];
  assert.deepEqual(comparisonChromeSlices(rect(0,346,857,390),maps,'actions'), [
    {index:0,rect:rect(0,346,428.5,390)}, {index:1,rect:rect(428.5,346,857,390)},
  ]);
  assert.deepEqual(comparisonChromeSlices(rect(428.5,36,857,68),maps,'toolbar',1),[{index:1,rect:rect(428.5,36,857,68)}]);
});
test('no artificial pixels are assigned to invalid or missing maps', () => {
  assert.deepEqual(comparisonChromeSlices(rect(0,0,390,36),[],'heading'),[]);
  assert.deepEqual(comparisonChromeSlices(rect(0,0,390,36),[rect(0,0,0,0)],'heading'),[]);
});
test('browser DOMRect prototype accessors retain vertical edges', () => {
  const bar = Object.create(Object.defineProperties({}, {
    left:{get:()=>0}, top:{get:()=>0}, right:{get:()=>390}, bottom:{get:()=>36},
  }));
  assert.deepEqual(Object.keys(bar),[]);
  assert.deepEqual(comparisonChromeSlices(bar,[rect(0,68,390,424),rect(0,456,390,813)],'heading'),
    [{index:0,rect:rect(0,0,390,36)}]);
});

test('web underlay copies only owned bands and removes listener/canvas without altering map geometry', () => {
  const {document} = parseHTML(`<main class="observatory home-map" data-comparing="true">
    <div id="a" class="map-canvas map-comparison-primary"></div><div id="b" class="map-canvas map-comparison-secondary"></div>
    <section class="map-comparison-ui"><header class="map-comparison-heading" id="h"></header>
    <section class="map-comparison-pane"><div id="t0" class="map-comparison-toolbar"></div></section>
    <section class="map-comparison-pane"><div id="t1" class="map-comparison-toolbar"></div></section>
    <footer id="f" class="map-comparison-actions"></footer></section></main>`);
  const boxes={a:rect(0,68,390,424),b:rect(0,456,390,813),h:rect(0,0,390,36),t0:rect(0,36,390,68),t1:rect(0,424,390,456),f:rect(0,813,390,857)};
  for(const element of document.querySelectorAll('*')) {
    const box=boxes[element.id] ?? rect(0,0,390,857);
    element.getBoundingClientRect=()=>({...box,width:box.right-box.left,height:box.bottom-box.top});
  }
  const originalCreate=document.createElement.bind(document), calls=[];
  document.createElement=(tag)=>{
    const element=originalCreate(tag);
    if(tag==='canvas')element.getContext=()=>({clearRect(){},drawImage(...args){calls.push(args);}});
    return element;
  };
  const saved=new Map();
  for(const [name,value] of Object.entries({document,MutationObserver:class{observe(){}disconnect(){}},ResizeObserver:undefined})){
    saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
    Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  }
  let listener, removed=false;
  const source={width:780,height:712,getBoundingClientRect:document.querySelector('#a').getBoundingClientRect};
  const map={getCanvas:()=>source,on(type,callback){listener=callback;},off(type,callback){removed=listener===callback;},triggerRepaint(){}};
  try{
    const cleanup=installComparisonChromeBackdrop(map,document.querySelector('#a'));
    listener();
    assert.equal(calls.length,2);
    assert.ok(calls.every(args=>args[4]===1),'copies one actual edge row');
    assert.equal(document.querySelectorAll('.map-comparison-chrome-backdrop').length,1);
    cleanup();
    assert.equal(removed,true);
    assert.equal(document.querySelectorAll('.map-comparison-chrome-backdrop').length,0);
    assert.equal(source.width,780);assert.equal(source.height,712);
  }finally{
    for(const [name,value] of saved)if(value)Object.defineProperty(globalThis,name,value);else delete globalThis[name];
  }
});
