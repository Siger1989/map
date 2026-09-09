import test from 'node:test';
import assert from 'node:assert/strict';
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
