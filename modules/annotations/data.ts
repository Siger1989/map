import { coordinate, type Coordinate } from '../navigation/types.ts';

export const ANNOTATION_STORAGE = 'guanyun.annotations.v1';
export const MAX_ANNOTATIONS = 80;
export const KINDS = {
  pin: '地点标记',
  box: '长方体',
  cylinder: '圆柱',
  sphere: '球体',
} as const;
export type AnnotationKind = keyof typeof KINDS;
export type Annotation = {
  id: string;
  kind: AnnotationKind;
  name: string;
  note: string;
  color: string;
  coordinates: Coordinate;
  groundElevation: number | null;
  placement: 'surface' | 'underground';
  offset: number;
  width: number;
  length: number;
  height: number;
  heading: number;
  pitch: number;
  roll: number;
  opacity: number;
  visible: boolean;
};
const bounded = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function validAnnotation(value: unknown): value is Annotation {
  if (!value || typeof value !== 'object') return false;
  const a = value as Annotation;
  return (
    typeof a.id === 'string' &&
    a.id.length > 0 &&
    a.id.length <= 100 &&
    Object.hasOwn(KINDS, a.kind) &&
    typeof a.name === 'string' &&
    a.name.length <= 60 &&
    typeof a.note === 'string' &&
    a.note.length <= 500 &&
    typeof a.color === 'string' &&
    /^#[0-9a-f]{6}$/i.test(a.color) &&
    coordinate(a.coordinates) &&
    Math.abs(a.coordinates[1]) <= 85 &&
    (a.groundElevation === null || bounded(a.groundElevation, -12000, 10000)) &&
    ['surface', 'underground'].includes(a.placement) &&
    bounded(a.offset, 0, 10000) &&
    [a.width, a.length, a.height].every((v) => bounded(v, 0.1, 10000)) &&
    [a.heading, a.pitch, a.roll].every((v) => bounded(v, -360, 360)) &&
    bounded(a.opacity, 0.1, 0.85) &&
    typeof a.visible === 'boolean'
  );
}
export function parseAnnotations(raw: string | null): Annotation[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (
    !Array.isArray(value) ||
    value.length > MAX_ANNOTATIONS ||
    !value.every(validAnnotation)
  )
    throw new Error('标记存档格式无效，原存档未覆盖。');
  if (new Set(value.map((v) => v.id)).size !== value.length)
    throw new Error('标记存档包含重复编号。');
  return value;
}
export function newAnnotation(
  kind: AnnotationKind,
  coordinates: Coordinate,
  groundElevation: number | null,
  id: string,
): Annotation {
  return {
    id,
    kind,
    coordinates,
    groundElevation,
    name: KINDS[kind],
    note: '',
    color: '#f2b45f',
    placement: 'surface',
    offset: 0,
    width: 10,
    length: 20,
    height: 10,
    heading: 0,
    pitch: 0,
    roll: 0,
    opacity: 0.55,
    visible: true,
  };
}
export function dimensions(a: Annotation): [number, number, number] {
  if (a.kind === 'sphere') return [a.width, a.width, a.width];
  if (a.kind === 'cylinder') return [a.width, a.width, a.height];
  return [a.width, a.length, a.height];
}
export function volume(a: Annotation) {
  if (a.kind === 'pin') return null;
  if (a.kind === 'sphere') return (Math.PI * a.width ** 3) / 6;
  if (a.kind === 'cylinder') return Math.PI * (a.width / 2) ** 2 * a.height;
  return a.width * a.length * a.height;
}
/** Exact vertical extent of a rotated solid; compass heading does not change height. */
export function verticalHalfExtent(a: Annotation) {
  const pitch = (a.pitch * Math.PI) / 180,
    roll = (a.roll * Math.PI) / 180;
  const x = -Math.sin(roll),
    y = Math.cos(roll) * Math.sin(pitch),
    z = Math.cos(roll) * Math.cos(pitch);
  if (a.kind === 'pin') return 0;
  if (a.kind === 'sphere') return a.width / 2;
  if (a.kind === 'cylinder')
    return (a.width / 2) * Math.hypot(x, y) + (a.height / 2) * Math.abs(z);
  return (
    (Math.abs(x) * a.width + Math.abs(y) * a.length + Math.abs(z) * a.height) /
    2
  );
}
export function altitudeRange(a: Annotation, ground = a.groundElevation) {
  if (ground === null || !Number.isFinite(ground)) return null;
  const half = verticalHalfExtent(a);
  const center =
    a.placement === 'underground'
      ? ground - a.offset - half
      : ground + a.offset + half;
  return { bottom: center - half, center, top: center + half };
}
export function dimensionLabel(a: Annotation) {
  if (a.kind === 'pin') return '地点';
  if (a.kind === 'sphere') return `直径 ${a.width} m`;
  if (a.kind === 'cylinder') return `直径 ${a.width} × 高 ${a.height} m`;
  return `宽 ${a.width} × 长 ${a.length} × 高 ${a.height} m`;
}
