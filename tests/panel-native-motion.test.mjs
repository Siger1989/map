import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { PANEL_MOTION_EVENT, trackPanelMotion } from '../modules/ui/panelMotionEvents.ts';
import { configureNativeUIRegionTransport } from '../mobile/native-ui-regions.ts';
import { collectNativeGlassRegions } from '../mobile/native-glass-regions.ts';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(classes = 'control-popover') {
  const { window, document } = parseHTML(`<!doctype html><html><head></head><body><section id="panel" class="${classes}"></section></body></html>`);
  const panel = document.getElementById('panel');
  let opacity = 0;
  const saved = new Map();
  const replace = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  for (const element of document.querySelectorAll('*')) {
    const rect = element === panel ? { left:16, top:450, right:300, bottom:740, width:284, height:290 } : { left:0, top:0, right:390, bottom:857, width:390, height:857 };
    element.getBoundingClientRect = () => rect;
    for (const [key, value] of Object.entries({ offsetWidth:rect.width, offsetHeight:rect.height, clientWidth:rect.width, clientHeight:rect.height })) Object.defineProperty(element,key,{ value, configurable:true });
  }
  for (const [name, value] of Object.entries({ window, document, HTMLElement:window.HTMLElement, HTMLInputElement:window.HTMLInputElement,
    SVGElement:window.SVGElement, MutationObserver:window.MutationObserver, ResizeObserver:undefined,
    requestAnimationFrame:cb=>setTimeout(cb,0), cancelAnimationFrame:clearTimeout,
    getComputedStyle:element=>({
      display:'block', visibility:'visible', opacity:element===panel ? String(opacity) : '1',
      position:'relative', content:'none', transform:'none', pointerEvents:'auto',
      overflowX:'visible', overflowY:'visible', backdropFilter:element===panel ? 'blur(10px) saturate(125%)' : 'none',
      borderTopLeftRadius:'23px', borderTopRightRadius:'23px', borderBottomLeftRadius:'23px', borderBottomRightRadius:'23px',
      getPropertyValue:()=>'',
    }),
  })) replace(name,value);
  return { window, document, panel, setOpacity:value=>{opacity=value;}, restore:()=>{
    for(const [name, value]of saved) if(value) Object.defineProperty(globalThis,name,value); else delete globalThis[name];
  }};
}

test('WAAPI lifecycle notifies once, including cleanup and stale completion after rapid reentry',()=>{
  const f=fixture();
  try {
    const events=[];
    f.document.addEventListener(PANEL_MOTION_EVENT,event=>events.push(event.detail));
    const first=new EventTarget();
    const stopFirst=trackPanelMotion(f.panel,first);
    stopFirst(); // Effect cleanup / reduced motion switch, before animation.cancel().
    const second=new EventTarget();
    const stopSecond=trackPanelMotion(f.panel,second);
    first.dispatchEvent(new Event('finish'));
    first.dispatchEvent(new Event('cancel'));
    assert.deepEqual(events.map(x=>x.phase),['start','settled','start']);
    f.panel.remove();
    second.dispatchEvent(new Event('cancel'));
    stopSecond();
    assert.deepEqual(events.map(x=>x.phase),['start','settled','start','settled']);
    assert.ok(events.every(x=>x.element===f.panel),'removed panel still identifies the stale native backing');
  } finally { f.restore(); }
});

for (const surface of ['control-popover', 'raster-level-panel']) test(`native publisher follows ${surface} WAAPI-only opacity and sends final visible glass without a DOM mutation`,async()=>{
  const f=fixture(surface);
  const sent=[];
  let stop=()=>{};
  try {
    stop=configureNativeUIRegionTransport({getSessionId:()=> 'motion-test',send:packet=>sent.push(packet)});
    await delay(20);
    const last=()=>sent.filter(p=>p.command==='uiRegions').at(-1).payload;
    assert.deepEqual(last().glassRegions,[]);
    const animation=new EventTarget();
    const stopMotion=trackPanelMotion(f.panel,animation);
    await delay(20);
    f.setOpacity(.4); // WAAPI changes computed style, not style/class attributes.
    await delay(90);
    assert.equal(last().glassRegions.length,1);
    assert.equal(last().glassRegions[0].opacity,.4);
    f.setOpacity(1);
    animation.dispatchEvent(new Event('finish'));
    await delay(20);
    assert.equal(last().glassRegions[0].opacity,1);
    assert.deepEqual(last().glassRegions[0].radii,[23,23,23,23]);
    stopMotion();
    // Exit / unmount must clear the original region and never revive it later.
    const exit=new EventTarget();
    trackPanelMotion(f.panel,exit);
    f.panel.remove();
    exit.dispatchEvent(new Event('cancel'));
    await delay(20);
    assert.deepEqual(last().glassRegions,[]);
    stop(); stop=()=>{};
    const count=sent.length;
    animation.dispatchEvent(new Event('finish'));
    await delay(80);
    assert.equal(sent.length,count,'no timer or stale completion publishes after publisher cleanup');
  } finally { stop(); f.restore(); }
});

test('independent confirmation/share windows collect the same native glass as named main panels',()=>{
  for(const name of ['favorite-source-popup','measurement-share','marker-confirm']) {
    const f=fixture(name);
    try {
      f.setOpacity(1);
      const glass=collectNativeGlassRegions(f.document).regions;
      assert.equal(glass.length,1,name);
      assert.deepEqual([glass[0].blur,glass[0].saturation,glass[0].opacity],[10,1.25,1]);
    } finally { f.restore(); }
  }
});
