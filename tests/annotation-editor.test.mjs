import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { newAnnotation } from '../modules/annotations/data.ts';
import { annotationEditItems, editorPose, patchAnnotation, commitAnnotationEdit, positionOffsets, withPositionOffset } from '../modules/annotations/editorSession.ts';
import { rotationDegrees, withRotationAxis } from '../modules/objectTransform/math.ts';

const model = () => newAnnotation('box', [104.06, 30.67], 502, 'model');
const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
test('annotation draft commit preserves unrelated edits and does not mutate the original', () => {
  const base = model(), other = {...model(), id:'other', name:'changed elsewhere'};
  const draft = patchAnnotation(base, {name:'new name', attributes:[{name:'编号', value:'00123'}]});
  const result = commitAnnotationEdit([base, other], {base, draft});
  assert.equal(result[0].name, 'new name');
  assert.equal(base.name, '长方体');
  assert.equal(result[1], other);
});
test('annotation draft rejects changed or deleted source and preserves the draft', () => {
  const base = model(), draft = patchAnnotation(base, {name:'draft'});
  assert.throws(() => commitAnnotationEdit([{...base, name:'other tab'}], {base, draft}), /其他操作/);
  assert.throws(() => commitAnnotationEdit([], {base, draft}), /其他操作/);
  assert.equal(draft.name, 'draft');
});
test('pin editor persists a blank custom row and removes it from both draft and saved marker', async (t) => {
  const {window}= (await import('linkedom')).parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
  globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);globalThis.cancelAnimationFrame=clearTimeout;
  const disk=new Map();
  globalThis.localStorage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v)};
  await build({entryPoints:['modules/annotations/PinEditor.tsx','modules/annotations/useAnnotations.ts'],outdir:'.openai/annotation-editor-ui',bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic',plugins:[{name:'terrain-stub',setup(b){b.onResolve({filter:/terrain\/elevation$/},()=>({path:'terrain',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const readElevation=async()=>null;'}));}}]});
  const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
  const {PinEditor}=await import('../.openai/annotation-editor-ui/PinEditor.js');
  const {useAnnotations}=await import('../.openai/annotation-editor-ui/useAnnotations.js');
  let state;
  function Probe(){state=useAnnotations();const item=state.items.find(a=>a.id==='pin');return item?React.createElement(PinEditor,{state,item,photos:[],onClose(){},onShare(){},onAdjust(){},onCapture(){},onImport(){},onPhoto(){}}):null;}
  const root=createRoot(document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());});
  disk.set('guanyun.annotations.v1',JSON.stringify([newAnnotation('pin',[104,30],100,'pin')]));
  await act(async()=>root.render(React.createElement(Probe)));
  await act(async()=>new Promise(resolve=>setTimeout(resolve,0)));
  await act(async()=>document.querySelector('.pin-attribute-head button').click());
  assert.equal(document.querySelectorAll('.pin-attribute').length,1);
  assert.deepEqual(JSON.parse(disk.get('guanyun.annotations.v1'))[0].attributes,[{name:'',value:''}]);
  await act(async()=>document.querySelector('[aria-label="删除条目 1"]').click());
  assert.equal(document.querySelectorAll('.pin-attribute').length,0);
  assert.deepEqual(JSON.parse(disk.get('guanyun.annotations.v1'))[0].attributes,[]);
  await act(async()=>document.querySelector('button.pin-danger').click());
  await act(async()=>document.querySelector('[aria-label="确认删除标记"] .pin-danger').click());
  assert.deepEqual(JSON.parse(disk.get('guanyun.annotations.v1')),[]);
  assert.equal(document.querySelector('.pin-editor'),null);
});
test('a remotely deleted source leaves the open draft visible until it is discarded', () => {
  const base=model(), draft=patchAnnotation(base,{name:'still editing'}), other={...model(),id:'other'};
  assert.deepEqual(annotationEditItems([other],{base,draft}),[other,draft]);
  assert.deepEqual(annotationEditItems([other],null),[other]);
  assert.throws(()=>commitAnnotationEdit([other],{base,draft}),/其他操作/);
});
test('placement changes return to terrain-relative mode while explicit altitude remains supported', () => {
  const base = {...model(), centerAltitude:700};
  assert.equal(patchAnnotation(base, {offset:15}).centerAltitude, undefined);
  assert.equal(patchAnnotation(base, {placement:'underground', centerAltitude:450}).centerAltitude, 450);
  assert.throws(() => patchAnnotation(base, {width:-1}), /参数无效/);
});
test('each position reset preserves the other two local axes on a rotated model', () => {
  const base = editorPose(model());
  let pose = withRotationAxis(base, 2, 35);
  pose = withRotationAxis(pose, 0, 20);
  for (const [axis, value] of [[0,10],[1,20],[2,30]]) pose = withPositionOffset(base, pose, axis, value);
  positionOffsets(base, pose).forEach((value, i) => close(value, [10,20,30][i]));
  for (const axis of [0,1,2]) {
    const reset = withPositionOffset(base, pose, axis, 0);
    positionOffsets(base, reset).forEach((value, i) => close(value, i === axis ? 0 : [10,20,30][i]));
  }
});
test('rotation reset preserves coordinates, altitude and other angles', () => {
  let pose = editorPose(model());
  for (const [axis, value] of [[0,10],[1,20],[2,30]]) pose = withRotationAxis(pose, axis, value);
  const reset = withRotationAxis(pose, 1, 0);
  rotationDegrees(reset).forEach((value, i) => close(value, [10,0,30][i]));
  assert.deepEqual(reset.coordinates, pose.coordinates);
  assert.equal(reset.altitude, pose.altitude);
});
test('position adjustments wrap across the antimeridian without jumping around the globe', () => {
  const base = editorPose({...model(), coordinates:[179.9999,0]});
  const moved = withPositionOffset(base, base, 0, 100);
  assert.ok(moved.coordinates[0] < -179.99);
  close(positionOffsets(base, moved)[0],100);
});
test('pins can move without known elevation and their editor axes remain on the map plane', () => {
  const pose = editorPose({...newAnnotation('pin',[104,30],null,'pin'),pitch:40});
  assert.deepEqual(pose.rotation,[0,0,0,1]);
  const next = withPositionOffset(pose,pose,0,50);
  close(positionOffsets(pose,next)[0],50);
  assert.equal(next.altitude,pose.altitude);
});
test('out-of-range elevation and displacement cannot enter the draft', () => {
  const base = editorPose(model());
  assert.throws(() => withPositionOffset(base,base,2,100000), /超出/);
  assert.throws(() => withPositionOffset(base,base,0,NaN), /位移/);
});
