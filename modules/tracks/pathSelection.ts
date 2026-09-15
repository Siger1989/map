import { metresBetween, type Coordinate } from '../navigation/types.ts';
import type { ManualTrack } from './drawing.ts';
import { preserveTrackColors } from './edgeColors.ts';
import { materializeSections } from './sections.ts';
export type SelectedPath = { part: number; from: number; to: number };
/** Chainage identifies the clicked traversal, including overlapping alternatives. */
export function pathAtDistance(
  track: ManualTrack,
  distance: number,
): SelectedPath | null {
  let cursor = 0;
  for (let part = 0; part < track.segments.length; part++) {
    const line = track.segments[part];
    for (let i = 1; i < line.length; i++) {
      const length = metresBetween(line[i - 1], line[i]);
      if (distance <= cursor + length + 0.01) {
        const ids = materializeSections(track).edges[part],
          id = ids[i - 1];
        let from = i - 1,
          to = i;
        while (from > 0 && ids[from - 1] === id) from--;
        while (to < line.length - 1 && ids[to] === id) to++;
        return { part, from, to };
      }
      cursor += length;
    }
  }
  return null;
}
export function selectedPathPoints(
  track: ManualTrack,
  path?: SelectedPath | null,
) {
  if (!path) return [];
  return track.segments[path.part]?.slice(path.from, path.to + 1) ?? [];
}
export function removeSelectedPath(
  track: ManualTrack,
  path: SelectedPath,
): ManualTrack {
  const line = track.segments[path.part];
  if (
    !line ||
    !Number.isInteger(path.from) ||
    !Number.isInteger(path.to) ||
    path.from < 0 ||
    path.to >= line.length ||
    path.from >= path.to
  )
    throw new Error('请重新选择要删除的实际路段');
  // Keep the two boundary vertices. Unused interior vertices disappear only from this path.
  const segments = track.segments.flatMap((row, part) =>
    part !== path.part
      ? [row]
      : [row.slice(0, path.from + 1), row.slice(path.to)],
  );
  const surviving = new Set(segments.flat().map((p) => p.join(',')));
  const nodes: Coordinate[] = [
    ...(track.nodes ?? []),
    line[path.from],
    line[path.to],
  ].filter((p) => surviving.has(p.join(',')));
  return preserveTrackColors(
    { ...track, segments, nodes, sharedRoute: undefined },
    [track],
  );
}
