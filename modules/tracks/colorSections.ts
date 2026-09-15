import { metresBetween, type Coordinate } from '../navigation/types.ts';
import { edgeColorIndex } from './edgeColors.ts';
import { normalizeTrackStyle } from './style.ts';
import type { ManualTrack } from './drawing.ts';
import type { ElevationSample } from '../journey/metrics.ts';
import { materializeSections } from './sections.ts';
export type ColorConditions = Record<string, string>;
export const MAX_COLOR_NOTE = 1600;
export function validColorConditions(value: unknown): value is ColorConditions {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length <= 128 &&
    Object.entries(value).every(
      ([key, v]) =>
        /^#[0-9a-f]{6}$/i.test(key) &&
        typeof v === 'string' &&
        v.length <= MAX_COLOR_NOTE,
    )
  );
}
export type ColorSection = {
  id?: string;
  color: string;
  part: number;
  start: number;
  end: number;
  condition: string;
};
/** One legend row per colour, retaining separate physical ranges for the elevation chart. */
export function groupColorSections(sections: ColorSection[]) {
  const groups = new Map<
    string,
    {
      color: string;
      length: number;
      condition: string;
      sections: ColorSection[];
    }
  >();
  for (const section of sections) {
    const color = section.color.toLowerCase();
    const key = section.id ?? color;
    const group = groups.get(key) ?? {
      color,
      length: 0,
      condition: '',
      sections: [],
    };
    group.length += section.end - section.start;
    group.sections.push(section);
    group.condition = [
      ...new Set(
        [group.condition, section.condition]
          .flatMap((s) => s.split('；'))
          .filter(Boolean),
      ),
    ].join('；');
    groups.set(key, group);
  }
  return [...groups.values()];
}
/** Cumulative chainage follows the displayed traversal, not source archive order. */
export function routeColorSections(
  track: Pick<
    ManualTrack,
    'segments' | 'edgeColors' | 'style' | 'colorConditions' | 'sections'
  > & { id?: string },
  lines = track.segments,
): ColorSection[] {
  const index = edgeColorIndex(track),
    fallback = normalizeTrackStyle(track.style).color;
  const result: ColorSection[] = [];
  const sections = track.sections ? materializeSections(track) : null;
  const sectionIndex = new Map<string, string | null>();
  track.segments.forEach((line, part) =>
    line
      .slice(1)
      .forEach((b, edge) =>
        sectionIndex.set(
          [line[edge].join(','), b.join(',')].sort().join('|'),
          sections?.edges[part][edge] ?? null,
        ),
      ),
  );
  let distance = 0;
  lines
    .filter((l) => l.length >= 2)
    .forEach((line, part) => {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1],
          b = line[i],
          color =
            index.get([a.join(','), b.join(',')].sort().join('|')) ?? fallback;
        const length = metresBetween(a, b),
          previous = result.at(-1);
        const id =
          sectionIndex.get([a.join(','), b.join(',')].sort().join('|')) ??
          undefined;
        if (
          previous?.color === color &&
          previous.part === part &&
          previous.id === id
        )
          previous.end += length;
        else
          result.push({
            color,
            ...(id ? { id } : {}),
            part,
            start: distance,
            end: distance + length,
            condition: id
              ? (sections?.notes[id] ?? '')
              : (track.colorConditions?.[color] ?? ''),
          });
        distance += length;
      }
    });
  return result;
}
/** Slice/interpolate only between valid neighbouring samples in the same physical line. */
export function sectionElevation(
  samples: ElevationSample[],
  section: ColorSection,
): ElevationSample[] {
  const points = samples.filter((s) => s.part === section.part);
  const at = (distance: number): ElevationSample | undefined => {
    const exact = points.find((s) => Math.abs(s.distance - distance) < 1e-6);
    if (exact) return { ...exact, distance };
    const i = points.findIndex((s) => s.distance > distance);
    if (i <= 0) return undefined;
    const a = points[i - 1],
      b = points[i];
    const t = (distance - a.distance) / (b.distance - a.distance);
    return {
      ...a,
      distance,
      elevation:
        a.elevation === null || b.elevation === null
          ? null
          : a.elevation + (b.elevation - a.elevation) * t,
    };
  };
  return [
    at(section.start),
    ...points.filter(
      (s) =>
        s.distance > section.start + 1e-6 && s.distance < section.end - 1e-6,
    ),
    at(section.end),
  ].filter((s): s is ElevationSample => !!s);
}
