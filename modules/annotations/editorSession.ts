import { Quaternion, Vector3 } from 'three';
import { coordinate, mercator } from '../section/planeMath.ts';
import { annotationPose, type Pose } from '../objectTransform/math.ts';
import { validAnnotation, type Annotation } from './data.ts';

export type AnnotationEdit = { base: Annotation; draft: Annotation; origin?: Pose | null };
export const sameAnnotation = (a: Annotation, b: Annotation) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Keep the open draft reachable even when another tab deletes its saved source. */
export function annotationEditItems(items: Annotation[], edit: AnnotationEdit | null) {
  if (!edit) return items;
  const found = items.some((item) => item.id === edit.draft.id);
  return found ? items.map((item) => item.id === edit.draft.id ? edit.draft : item)
    : [...items, edit.draft];
}

export function patchAnnotation(item: Annotation, patch: Partial<Annotation>) {
  const next = { ...item, ...patch, id: item.id, kind: item.kind };
  if ((patch.placement !== undefined || patch.offset !== undefined) &&
      !Object.hasOwn(patch, 'centerAltitude')) delete next.centerAltitude;
  if (!validAnnotation(next)) throw new Error('参数无效，请检查数值范围。');
  return next;
}

/** Commit only against the version opened for editing; unrelated objects survive. */
export function commitAnnotationEdit(items: Annotation[], edit: AnnotationEdit) {
  const current = items.find((a) => a.id === edit.base.id);
  if (!current || !sameAnnotation(current, edit.base))
    throw new Error('这个标记已在其他操作中改变，草稿已保留。请放弃后重新打开。');
  if (!validAnnotation(edit.draft)) throw new Error('标记参数无效，尚未保存。');
  return items.map((a) => a.id === current.id ? edit.draft : a);
}

/** Metres in the same local axes as the existing gizmo, relative to edit start. */
export function positionOffsets(base: Pose, pose: Pose): [number, number, number] {
  const origin = mercator(base.coordinates), now = mercator(pose.coordinates);
  let dx = now.x - origin.x;
  dx -= Math.round(dx); // shortest crossing of the antimeridian
  return new Vector3(dx / origin.unit, (origin.y - now.y) / origin.unit,
    pose.altitude - base.altitude)
    .applyQuaternion(new Quaternion().fromArray(pose.rotation).invert()).toArray();
}

export function withPositionOffset(base: Pose, pose: Pose, axis: 0 | 1 | 2, value: number): Pose {
  if (!Number.isFinite(value) || Math.abs(value) > 100000) throw new Error('位移需在 ±100000 米以内');
  const values = positionOffsets(base, pose);
  values[axis] = value;
  const delta = new Vector3(...values).applyQuaternion(new Quaternion().fromArray(pose.rotation));
  const origin = mercator(base.coordinates);
  const ll = coordinate(origin.x + delta.x * origin.unit, origin.y - delta.y * origin.unit);
  const altitude = base.altitude + delta.z;
  if (Math.abs(ll[1]) > 85 || altitude < -12000 || altitude > 30000)
    throw new Error('调整后的位置超出支持范围');
  return { ...pose, coordinates: [((ll[0] + 180) % 360 + 360) % 360 - 180, ll[1]], altitude };
}

export function editorPose(item: Annotation) {
  const pose = annotationPose(item);
  return pose && item.kind === 'pin' ? { ...pose, rotation: [0, 0, 0, 1] as Pose['rotation'] } : pose;
}
