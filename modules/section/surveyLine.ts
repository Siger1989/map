import {
  coordinate as validCoordinate,
  type Coordinate,
} from '../navigation/types.ts';
import { coordinate, mercator } from './planeMath.ts';
import type { SectionSettings } from './types.ts';

export type SurveyStation = { id: string; label: string; distance: number };
export type SurveySheetInfo = {
  project: string;
  title: string;
  number: string;
  author: string;
  reviewer: string;
  date: string;
  source: string;
  note: string;
};
export type SurveyPointData = { name: string; note: string };
export type SurveyLine = {
  version: 1;
  a: Coordinate;
  b: Coordinate;
  stations: SurveyStation[];
  interval: number;
  halfWidth: number;
  info?: SurveySheetInfo;
  pointData?: Record<string, SurveyPointData>;
};
export function validSurveyPointData(v: unknown): v is SurveyPointData {
  const p = v as SurveyPointData;
  return (
    !!p &&
    typeof p.name === 'string' &&
    p.name.length <= 60 &&
    typeof p.note === 'string' &&
    p.note.length <= 500
  );
}
export const emptySurveyInfo = (): SurveySheetInfo => ({
  project: '',
  title: '',
  number: '',
  author: '',
  reviewer: '',
  date: new Date().toISOString().slice(0, 10),
  source: '',
  note: '',
});
export function validSurveyInfo(v: unknown): v is SurveySheetInfo {
  const info = v as SurveySheetInfo;
  return (
    !!info &&
    [
      'project',
      'title',
      'number',
      'author',
      'reviewer',
      'date',
      'source',
      'note',
    ].every(
      (k) =>
        typeof info[k as keyof SurveySheetInfo] === 'string' &&
        info[k as keyof SurveySheetInfo].length <= (k === 'note' ? 500 : 100),
    ) &&
    (info.date === '' || /^\d{4}-\d{2}-\d{2}$/.test(info.date))
  );
}
export type SectionAnchor = { sectionId: string; distance: number };
export type SurveyTerrain = {
  key: string;
  columns: number;
  rows: number;
  start: number;
  end: number;
  halfWidth: number;
  heights: (number | null)[];
  sampledAt: number;
  zoom: number;
  source: string;
};
export const MAX_SURVEY_SPAN = 50000;
const wrap = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;
/** Local metric plane uses the same Mercator basis as the existing 3D section. */
export function surveyBasis(line: Pick<SurveyLine, 'a' | 'b'>) {
  const a = mercator(line.a),
    b = mercator(line.b);
  const dx = (b.x - a.x - Math.round(b.x - a.x)) / a.unit,
    dy = (b.y - a.y) / a.unit;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1 || length > MAX_SURVEY_SPAN)
    throw new Error('A、B 间距须为 1 米至 50 公里');
  return {
    ...a,
    ux: dx / length,
    uy: dy / length,
    length,
    heading: (Math.atan2(dy, dx) * 180) / Math.PI,
    bearing: ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360,
  };
}
export function surveyCoordinate(
  line: SurveyLine,
  distance: number,
  offset = 0,
): Coordinate {
  const m = surveyBasis(line);
  const p = coordinate(
    m.x + (m.ux * distance - m.uy * offset) * m.unit,
    m.y + (m.uy * distance + m.ux * offset) * m.unit,
  );
  return [wrap(p[0]), p[1]];
}
export function projectSurveyPoint(line: SurveyLine, point: Coordinate) {
  const a = surveyBasis(line),
    p = mercator(point);
  const dx = (p.x - a.x - Math.round(p.x - a.x)) / a.unit,
    dy = (p.y - a.y) / a.unit;
  const distance = dx * a.ux + dy * a.uy;
  if (!Number.isFinite(distance) || Math.abs(distance) > MAX_SURVEY_SPAN)
    throw new Error('选点距 A 超过 50 公里，请选择更近的位置');
  return {
    distance,
    coordinate: surveyCoordinate(line, distance),
    offset: -dx * a.uy + dy * a.ux,
  };
}
export function surveyRange(line: SurveyLine) {
  const distances = [
    0,
    surveyBasis(line).length,
    ...line.stations.map((s) => s.distance),
  ];
  return { start: Math.min(...distances), end: Math.max(...distances) };
}
function fitSurveyCorridor(line: SurveyLine): SurveyLine {
  const range = surveyRange(line);
  return {
    ...line,
    halfWidth: Math.min(5000, Math.max(0.1, (range.end - range.start) * 0.15)),
  };
}
export function validSectionAnchor(value: unknown): value is SectionAnchor {
  const v = value as SectionAnchor;
  return (
    !!v &&
    typeof v.sectionId === 'string' &&
    /^[a-zA-Z0-9-]{1,80}$/.test(v.sectionId) &&
    Number.isFinite(v.distance) &&
    Math.abs(v.distance) <= MAX_SURVEY_SPAN
  );
}
export function validSurveyLine(value: unknown): value is SurveyLine {
  const v = value as SurveyLine;
  if (
    !v ||
    v.version !== 1 ||
    (v.info !== undefined && !validSurveyInfo(v.info)) ||
    !validCoordinate(v.a) ||
    !validCoordinate(v.b) ||
    Math.abs(v.a[1]) > 85 ||
    Math.abs(v.b[1]) > 85 ||
    !Array.isArray(v.stations) ||
    v.stations.length > 200 ||
    !v.stations.every(
      (s) =>
        s &&
        typeof s.id === 'string' &&
        /^[a-zA-Z0-9-]{1,100}$/.test(s.id) &&
        typeof s.label === 'string' &&
        s.label.length > 0 &&
        s.label.length <= 60 &&
        Number.isFinite(s.distance) &&
        Math.abs(s.distance) <= MAX_SURVEY_SPAN,
    ) ||
    new Set(v.stations.map((s) => s.id)).size !== v.stations.length ||
    ![1, 2, 5, 10, 20, 25, 50, 100, 200, 500].includes(v.interval) ||
    !Number.isFinite(v.halfWidth) ||
    v.halfWidth < 0.1 ||
    v.halfWidth > 10000
  )
    return false;
  if (v.stations.some((s) => s.id === 'A' || s.id === 'B')) return false;
  if (
    v.pointData !== undefined &&
    (!v.pointData ||
      typeof v.pointData !== 'object' ||
      Array.isArray(v.pointData) ||
      !Object.entries(v.pointData).every(
        ([id, p]) =>
          (id === 'A' || id === 'B' || v.stations.some((s) => s.id === id)) &&
          validSurveyPointData(p),
      ))
  )
    return false;
  try {
    const r = surveyRange(v);
    return r.end - r.start <= MAX_SURVEY_SPAN;
  } catch {
    return false;
  }
}
export function newSurveyLine(a: Coordinate, b: Coordinate): SurveyLine {
  const length = surveyBasis({ a, b }).length;
  return {
    version: 1,
    a: [...a],
    b: [...b],
    stations: [],
    interval: 50,
    halfWidth: Math.min(5000, length * 0.15),
  };
}
export function addSurveyStation(
  line: SurveyLine,
  point: Coordinate,
  id: string,
): SurveyLine {
  const { distance } = projectSurveyPoint(line, point);
  let n = 2,
    label = 'C';
  while (line.stations.some((s) => s.label === label)) {
    n++;
    label = n < 26 ? String.fromCharCode(65 + n) : `P${n + 1}`;
  }
  const next = {
    ...line,
    stations: [...line.stations, { id, label, distance }],
  };
  if (!validSurveyLine(next))
    throw new Error('勘探线最多 200 个附加点，总长不超过 50 公里');
  return fitSurveyCorridor(next);
}
export function removeSurveyStation(line: SurveyLine, id: string): SurveyLine {
  if (id === 'A' || id === 'B') throw new Error('A/B 是基准点，不能删除');
  const pointData = { ...line.pointData };
  delete pointData[id];
  return fitSurveyCorridor({
    ...line,
    stations: line.stations.filter((s) => s.id !== id),
    pointData,
  });
}
export function surveyKey(line: SurveyLine) {
  const r = surveyRange(line);
  return JSON.stringify([line.a, line.b, r.start, r.end, line.halfWidth]);
}
export function validSurveyTerrain(
  value: unknown,
  line: SurveyLine,
): value is SurveyTerrain {
  const v = value as SurveyTerrain;
  const r = surveyRange(line);
  return (
    !!v &&
    v.key === surveyKey(line) &&
    v.start === r.start &&
    v.end === r.end &&
    v.halfWidth === line.halfWidth &&
    Number.isInteger(v.columns) &&
    v.columns >= 2 &&
    v.columns <= 257 &&
    Number.isInteger(v.rows) &&
    v.rows >= 3 &&
    v.rows <= 65 &&
    v.rows % 2 === 1 &&
    Array.isArray(v.heights) &&
    v.heights.length === v.columns * v.rows &&
    v.heights.every(
      (h) => h === null || (Number.isFinite(h) && h >= -12000 && h <= 10000),
    ) &&
    Number.isFinite(v.sampledAt) &&
    Number.isInteger(v.zoom) &&
    v.zoom >= 0 &&
    v.zoom <= 12 &&
    typeof v.source === 'string' &&
    v.source.length <= 200
  );
}
export function surveySettings(
  line: SurveyLine,
  before?: SectionSettings,
): SectionSettings {
  if (!validSurveyLine(line)) throw new Error('勘探线参数无效');
  const r = surveyRange(line),
    m = surveyBasis(line),
    center = surveyCoordinate(line, (r.start + r.end) / 2);
  const centerScale = m.unit / mercator(center).unit;
  const { surveyTerrain: oldTerrain, ...rest } = before ?? {
    enabled: true,
    altitude: 0,
    color: '#bc5430',
  };
  return {
    ...rest,
    survey: line,
    altitude: 0,
    plane: {
      center,
      width: (r.end - r.start) * centerScale,
      height: 24000,
      heading: m.heading,
      tilt: 0,
      roll: 0,
    },
    ...(oldTerrain && validSurveyTerrain(oldTerrain, line)
      ? { surveyTerrain: oldTerrain }
      : {}),
  };
}
export function surveyStations(line: SurveyLine) {
  return [
    { id: 'A', label: 'A', distance: 0 },
    { id: 'B', label: 'B', distance: surveyBasis(line).length },
    ...line.stations,
  ].sort((a, b) => a.distance - b.distance);
}
export type SurveyFollow = 'chainage' | 'project';
export function moveSurveyStation(
  line: SurveyLine,
  id: string,
  point: Coordinate,
  mode: 'direction' | 'slide',
  follow: SurveyFollow = 'chainage',
): SurveyLine {
  if (id !== 'A' && id !== 'B') {
    const distance = projectSurveyPoint(line, point).distance;
    const next = {
      ...line,
      stations: line.stations.map((s) =>
        s.id === id ? { ...s, distance } : s,
      ),
    };
    if (!validSurveyLine(next)) throw new Error('移动后的勘探线超过范围限制');
    return fitSurveyCorridor(next);
  }
  const target =
    mode === 'slide' ? projectSurveyPoint(line, point).coordinate : point;
  let next = { ...line, [id === 'A' ? 'a' : 'b']: target };
  const m = surveyBasis(next);
  if (mode === 'slide') {
    const old = surveyBasis(line);
    if (m.ux * old.ux + m.uy * old.uy < 0)
      throw new Error('沿线移动不能跨过另一基准点；需要转向时请选择调整方向');
  }
  if (mode === 'slide' || follow === 'project')
    next = {
      ...next,
      stations: line.stations.map((s) => ({
        ...s,
        distance: projectSurveyPoint(next, surveyCoordinate(line, s.distance))
          .distance,
      })),
    };
  if (!validSurveyLine(next)) throw new Error('移动后的勘探线超过范围限制');
  return fitSurveyCorridor(next);
}
export function surveyHeight(
  data: SurveyTerrain,
  distance: number,
): number | null {
  if (distance < data.start - 0.001 || distance > data.end + 0.001) return null;
  const t = Math.max(
      0,
      Math.min(
        data.columns - 1,
        ((distance - data.start) / (data.end - data.start)) *
          (data.columns - 1),
      ),
    ),
    x = Math.floor(t);
  const row = Math.floor(data.rows / 2) * data.columns,
    a = data.heights[row + x],
    b = data.heights[row + Math.min(x + 1, data.columns - 1)];
  return a === null || b === null ? null : a + (b - a) * (t - x);
}
