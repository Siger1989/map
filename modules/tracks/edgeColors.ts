import type { Coordinate } from '../navigation/types.ts';
import { metresBetween } from '../navigation/types.ts';
import { normalizeTrackStyle, type TrackStyle } from './style.ts';

export type TrackEdgeColors = (string | null)[][];
type ColoredGeometry = {
  segments: Coordinate[][];
  edgeColors?: TrackEdgeColors;
  style?: TrackStyle;
  colorConditions?: Record<string, string>;
};
const key = (a: Coordinate, b: Coordinate) =>
  [a.join(','), b.join(',')].sort().join('|');
export function validEdgeColors(
  value: unknown,
  segments: Coordinate[][],
): value is TrackEdgeColors {
  return (
    Array.isArray(value) &&
    value.length === segments.length &&
    value.every(
      (row, i) =>
        Array.isArray(row) &&
        row.length === Math.max(0, segments[i].length - 1) &&
        row.every(
          (c) =>
            c === null || (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)),
        ),
    )
  );
}
export function edgeColorIndex(source: ColoredGeometry) {
  const colors = new Map<string, string | null>();
  source.segments.forEach((line, i) =>
    line
      .slice(1)
      .forEach((b, j) =>
        colors.set(
          key(line[j], b),
          source.edgeColors?.[i]?.[j] ??
            ('style' in source
              ? normalizeTrackStyle(source.style).color
              : null),
        ),
      ),
  );
  return colors;
}
/** Remapping follows physical edges, so reversal/joining/deletion cannot recolour a source line. */
export function inheritEdgeColors(
  segments: Coordinate[][],
  sources: ColoredGeometry[],
  fallback: string | null = null,
): TrackEdgeColors | undefined {
  type Edge = { a: Coordinate; b: Coordinate; color: string | null };
  const colors = new Map<string, string | null>(),
    byPoint = new Map<string, Edge[]>();
  for (const source of sources) {
    const index = edgeColorIndex(source);
    for (const [id, color] of index) if (!colors.has(id)) colors.set(id, color);
    source.segments.forEach((line) =>
      line.slice(1).forEach((b, j) => {
        const edge = {
          a: line[j],
          b,
          color: index.get(key(line[j], b)) ?? null,
        };
        for (const p of [line[j], b]) {
          const id = p.join(',');
          byPoint.set(id, [...(byPoint.get(id) ?? []), edge]);
        }
      }),
    );
  }
  const rows = segments.map((line) =>
    line.slice(1).map((b, j) => {
      const a = line[j],
        id = key(a, b);
      if (colors.has(id)) return colors.get(id)!;
      // joinSegments treats endpoints within 15 cm as identical and retains one coordinate.
      const edge = [
        ...(byPoint.get(a.join(',')) ?? []),
        ...(byPoint.get(b.join(',')) ?? []),
      ].find(
        (e) =>
          (metresBetween(e.a, a) < 0.15 && metresBetween(e.b, b) < 0.15) ||
          (metresBetween(e.b, a) < 0.15 && metresBetween(e.a, b) < 0.15),
      );
      return edge ? edge.color : fallback;
    }),
  );
  return rows.some((row) => row.some((c) => c !== null)) ? rows : undefined;
}
export function preserveTrackColors<T extends ColoredGeometry>(
  next: T,
  sources: ColoredGeometry[],
): T {
  const conditions: Record<string, string> = {};
  for (const source of [...sources, next])
    for (const [color, note] of Object.entries(source.colorConditions ?? {})) {
      conditions[color] = [
        ...new Set([
          ...(conditions[color]?.split('；') ?? []),
          ...note.split('；'),
        ]),
      ]
        .filter(Boolean)
        .join('；');
      if (conditions[color].length > 1600)
        throw new Error('同色路段备注合并后过长，请先整理备注；原路线保留');
    }
  if (Object.keys(conditions).length > 128)
    throw new Error('合并后的颜色备注超过128种，请先整理；原路线保留');
  return {
    ...next,
    ...(Object.keys(conditions).length ? { colorConditions: conditions } : {}),
    edgeColors: inheritEdgeColors(
      next.segments,
      sources.map((s) => ({ ...s, style: s.style })),
      normalizeTrackStyle(next.style).color,
    ),
  };
}
export function coloredLineParts(
  coordinates: Coordinate[],
  colors: Map<string, string | null>,
  fallback: string,
) {
  const parts: { coordinates: Coordinate[]; color: string }[] = [];
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1],
      b = coordinates[i],
      color = colors.get(key(a, b)) ?? fallback,
      previous = parts.at(-1);
    if (previous?.color === color) previous.coordinates.push(b);
    else parts.push({ coordinates: [a, b], color });
  }
  return parts;
}
