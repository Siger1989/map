import type { Contour, ProfilePoint } from './contours';
import type { SectionSettings } from './types';
export const PROFILE_NOTES_KEY = 'shantu.section-points.v1';
export const PROFILE_NOTES_CHANGED = 'shantu:section-points-changed';
export const NOTE_COLORS = [
  '#f4a261',
  '#60caff',
  '#e18cfa',
  '#ffe073',
  '#74e5a0',
  '#ff8295',
  '#a5adff',
  '#6ce0d5',
  '#ffa6e4',
  '#bddb67',
  '#e9bc83',
  '#8dd8fa',
];
export const noteColor = (note: ProfileNote, index = 0) =>
  note.color ?? NOTE_COLORS[index % NOTE_COLORS.length];
export function nextNoteColor(notes: ProfileNote[]) {
  return (
    NOTE_COLORS.find(
      (color) => !notes.some((note, i) => noteColor(note, i) === color),
    ) ??
    `#${(0x777777 + ((notes.length * 76543) % 0x888888)).toString(16).padStart(6, '0')}`
  );
}
export function previewProfileNotes(
  settings: SectionSettings,
  notes: ProfileNote[],
) {
  window.dispatchEvent(
    new CustomEvent(PROFILE_NOTES_CHANGED, {
      detail: { key: sectionKey(settings), notes },
    }),
  );
}
export type ProfileNote = {
  color?: string;
  fraction?: number;
  id: string;
  name: string;
  note: string;
  fields: { name: string; value: string; unit: string }[];
  point: ProfilePoint & { distance: number };
  curveName: string;
  source: Contour['source'];
  sampledAt: number;
};
export type SavedSection = {
  settings: SectionSettings;
  notes: ProfileNote[];
  savedAt: number;
};
/** Geometry only: colour, visibility and object identity do not detach saved measurements. */
export function sectionKey(s: SectionSettings) {
  const p = s.plane;
  return JSON.stringify(
    p
      ? [
          p.center,
          s.altitude,
          p.width,
          p.height,
          p.heading,
          p.tilt,
          p.roll ?? 0,
          ...(s.objectId ? [s.objectId] : []),
        ]
      : null,
  );
}
export function validSection(s: SectionSettings) {
  const p = s?.plane;
  return (
    !!p &&
    (s.objectId === undefined ||
      (typeof s.objectId === 'string' &&
        /^[a-zA-Z0-9-]{1,80}$/.test(s.objectId))) &&
    Array.isArray(p.center) &&
    p.center.length === 2 &&
    p.center.every(Number.isFinite) &&
    Math.abs(p.center[0]) <= 180 &&
    Math.abs(p.center[1]) <= 85 &&
    [s.altitude, p.width, p.height, p.heading, p.tilt, p.roll ?? 0].every(
      Number.isFinite,
    ) &&
    s.altitude >= -12000 &&
    s.altitude <= 30000 &&
    p.width >= 0.1 &&
    p.width <= 200000 &&
    p.height >= 0.1 &&
    p.height <= 200000 &&
    (!s.scale ||
      (['m', 'km'].includes(s.scale.unit) &&
        (s.scale.interval === 'auto' ||
          (Number.isFinite(s.scale.interval) &&
            s.scale.interval >= 0.0001 &&
            s.scale.interval <= 200000)))) &&
    typeof s.color === 'string' &&
    /^#[\da-f]{6}$/i.test(s.color)
  );
}
export function validProfileNote(n: ProfileNote) {
  const p = n?.point;
  return (
    !!p &&
    typeof n.id === 'string' &&
    typeof n.name === 'string' &&
    n.name.length <= 80 &&
    typeof n.note === 'string' &&
    (n.color === undefined || /^#[\da-f]{6}$/i.test(n.color)) &&
    (n.fraction === undefined ||
      (Number.isFinite(n.fraction) && n.fraction >= 0 && n.fraction <= 1)) &&
    n.note.length <= 1000 &&
    typeof n.curveName === 'string' &&
    ['terrain', 'model'].includes(n.source) &&
    Number.isFinite(n.sampledAt) &&
    [p.u, p.v, p.altitude, p.distance].every(Number.isFinite) &&
    p.distance >= 0 &&
    Array.isArray(p.coordinates) &&
    p.coordinates.length === 2 &&
    p.coordinates.every(Number.isFinite) &&
    Math.abs(p.coordinates[0]) <= 180 &&
    Math.abs(p.coordinates[1]) <= 90 &&
    Array.isArray(p.local) &&
    p.local.length === 3 &&
    p.local.every(Number.isFinite) &&
    Array.isArray(n.fields) &&
    n.fields.every(
      (f) =>
        f &&
        typeof f.name === 'string' &&
        f.name.length <= 80 &&
        typeof f.value === 'string' &&
        f.value.length <= 500 &&
        typeof f.unit === 'string' &&
        f.unit.length <= 40,
    )
  );
}
export function readSavedSections(raw: string | null): SavedSection[] {
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (
    !Array.isArray(data) ||
    !data.every(
      (s: SavedSection) =>
        s &&
        validSection(s.settings) &&
        Number.isFinite(s.savedAt) &&
        Array.isArray(s.notes) &&
        s.notes.every(validProfileNote),
    )
  )
    throw new Error('本机剖面测点数据无法读取，原数据已保留。');
  return data;
}
export function updateSavedSection(
  records: SavedSection[],
  settings: SectionSettings,
  notes: ProfileNote[],
) {
  if (!validSection(settings) || !notes.every(validProfileNote))
    throw new Error('测点数据无效，尚未保存。');
  const rest = records.filter(
    (s) => sectionKey(s.settings) !== sectionKey(settings),
  );
  return notes.length
    ? [{ settings, notes, savedAt: Date.now() }, ...rest]
    : rest;
}
export function noteDetails(notes: ProfileNote[]): [string, string][] {
  return notes.flatMap(
    (n, i) =>
      [
        [
          `测点 ${i + 1} · ${n.name}`,
          `${n.point.coordinates[0].toFixed(7)}°，${n.point.coordinates[1].toFixed(7)}°（WGS84）；海拔 ${n.point.altitude.toFixed(2)} m；沿线 ${n.point.distance.toFixed(2)} m`,
        ],
        [
          '测点来源',
          `${n.curveName} · ${n.source === 'terrain' ? '地形采样' : '模型网格'} · ${new Date(n.sampledAt).toLocaleString('zh-CN', { hour12: false })}`,
        ],
        ...(n.note ? [['备注', n.note]] : []),
        ...n.fields.map((f) => [
          f.name || '数据项',
          `${f.value}${f.unit ? ` ${f.unit}` : ''}`,
        ]),
      ] as [string, string][],
  );
}
