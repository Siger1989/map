import type { Coordinate } from '../navigation/types.ts';
import { trackEdgeKey } from './alternatives.ts';

export type PointDetail = { color?: string; note?: string };
export type GeometryDetails = {
  segments: Coordinate[][];
  pointDetails?: Record<string, PointDetail>;
  edgeNotes?: (string | null)[][];
};
const validColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
export function validPointDetails(value: unknown, lines: Coordinate[][]): value is Record<string, PointDetail> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = new Set(lines.flat().map(p => p.join(',')));
  return Object.entries(value).length <= 6000 && Object.entries(value).every(([key, v]) => keys.has(key) && v && typeof v === 'object' &&
    (v.color === undefined || validColor(v.color)) && (v.note === undefined || typeof v.note === 'string' && v.note.length <= 1600));
}
export function validEdgeNotes(value: unknown, lines: Coordinate[][]): value is (string | null)[][] {
  return Array.isArray(value) && value.length === lines.length && value.every((row, i) => Array.isArray(row) && row.length === Math.max(0, lines[i].length - 1) && row.every(note => note === null || typeof note === 'string' && note.length <= 1600));
}
export function selectedEdges(lines: Coordinate[][], points: Coordinate[]) {
  const keys = new Set(points.map(p => p.join(',')));
  return lines.flatMap((line, segment) => line.slice(1).flatMap((b, edge) => keys.has(line[edge].join(',')) && keys.has(b.join(',')) ? [{segment, edge, a: line[edge], b}] : []));
}
export function edgeNoteIndex(track: GeometryDetails) {
  const result = new Map<string, string>();
  track.segments.forEach((line, i) => line.slice(1).forEach((b, j) => {
    const note = track.edgeNotes?.[i]?.[j];
    if (note !== null && note !== undefined) result.set(trackEdgeKey(line[j], b), note);
  }));
  return result;
}
export function explicitNodeColors(track: GeometryDetails & { edgeColors?: (string | null)[][] }) {
  const colors = new Map<string, string>();
  track.segments.forEach((line, i) => line.slice(1).forEach((b, j) => {
    const color = track.edgeColors?.[i]?.[j];
    if (!color) return;
    colors.set(line[j].join(','), color);
    if (!colors.has(b.join(','))) colors.set(b.join(','), color);
  }));
  for (const [key, detail] of Object.entries(track.pointDetails ?? {})) if (detail.color) colors.set(key, detail.color);
  return colors;
}
/** Keep notes attached to physical points/edges when geometry is cut, joined or reversed. */
export function inheritTrackDetails(lines: Coordinate[][], sources: GeometryDetails[]) {
  const vertices = new Set(lines.flat().map(p => p.join(',')));
  const pointDetails: Record<string, PointDetail> = {}, notes = new Map<string, string>();
  for (const source of sources) {
    for (const [key, detail] of Object.entries(source.pointDetails ?? {})) if (vertices.has(key) && !pointDetails[key]) pointDetails[key] = detail;
    for (const [key, note] of edgeNoteIndex(source)) if (!notes.has(key)) notes.set(key, note);
  }
  const rows = lines.map(line => line.slice(1).map((b, j) => notes.get(trackEdgeKey(line[j], b)) ?? null));
  return {
    pointDetails: Object.keys(pointDetails).length ? pointDetails : undefined,
    edgeNotes: rows.some(row => row.some(note => note !== null)) ? rows : undefined,
  };
}

export function changeSelectionDetails<T extends GeometryDetails & { edgeColors?: (string | null)[][] }>(track: T, points: Coordinate[], detail: PointDetail): T {
  if (detail.color !== undefined && !validColor(detail.color)) throw new Error('颜色格式无效');
  if (detail.note !== undefined && detail.note.length > 1600) throw new Error('备注最多1600字');
  const unique = [...new Map(points.map(p => [p.join(','), p])).values()];
  const vertices = new Set(track.segments.flat().map(p => p.join(',')));
  if (!unique.length || unique.some(p => !vertices.has(p.join(',')))) throw new Error('请重新选择路线上的点');
  if (unique.length === 1) {
    const key = unique[0].join(',');
    return {...track, pointDetails: {...track.pointDetails, [key]: {...track.pointDetails?.[key], ...detail}}};
  }
  const edges = selectedEdges(track.segments, unique);
  if (!edges.length) throw new Error('所选点之间没有相连线段，请再选择相邻点');
  const colors = track.segments.map((line, i) => line.slice(1).map((_, j) => track.edgeColors?.[i]?.[j] ?? null));
  const notes = track.segments.map((line, i) => line.slice(1).map((_, j) => track.edgeNotes?.[i]?.[j] ?? null));
  for (const {segment, edge} of edges) {
    if (detail.color !== undefined) colors[segment][edge] = detail.color;
    if (detail.note !== undefined) notes[segment][edge] = detail.note;
  }
  return {...track, ...(detail.color !== undefined ? {edgeColors: colors} : {}), ...(detail.note !== undefined ? {edgeNotes: notes} : {})};
}
