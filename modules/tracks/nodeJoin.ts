import type { ManualTrack } from './drawing.ts';
import { MAX_TRACK_POINTS } from './drawing.ts';
import { equalCoordinate } from './editing.ts';
import type { Coordinate } from '../navigation/types.ts';
import { preserveTrackColors } from './edgeColors.ts';
import { joinUniqueSegments } from './snapping.ts';
import { keepsOriginalPoints } from './provenance.ts';

/** Join only the explicitly snapped target; interior junctions retain every branch. */
export function joinMovedRoute(
  moved: ManualTrack,
  target: ManualTrack,
  junction: Coordinate,
): ManualTrack {
  if (target.hidden || keepsOriginalPoints(target))
    throw new Error('目标路线受保护或已隐藏，请先复制为手绘路线。');
  if (!target.segments.some((l) => l.some((p) => equalCoordinate(p, junction))))
    throw new Error('吸附节点已变化，请重新选择。');
  const split = (line: Coordinate[]) => {
    const runs: Coordinate[][] = [];
    let start = 0;
    for (let i = 1; i < line.length - 1; i++)
      if (equalCoordinate(line[i], junction)) {
        runs.push(line.slice(start, i + 1));
        start = i;
      }
    runs.push(line.slice(start));
    return runs;
  };
  const segments = joinUniqueSegments(
    [...moved.segments, ...target.segments].flatMap(split),
  );
  if (segments.length > 100 || segments.flat().length > MAX_TRACK_POINTS)
    throw new Error('拼合后超过100段或6000点，当前编辑已保留。');
  const vertices = new Set(segments.flat().map((p) => p.join(',')));
  const nodes = [
    ...new Map(
      [...(moved.nodes ?? []), ...(target.nodes ?? []), junction].map((p) => [
        p.join(','),
        p,
      ]),
    ).values(),
  ].filter((p) => vertices.has(p.join(',')));
  return preserveTrackColors(
    { ...moved, segments, sharedRoute: undefined, nodes },
    [moved, target],
  );
}
