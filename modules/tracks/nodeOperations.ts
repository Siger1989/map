import { coordinate, type Coordinate } from '../navigation/types.ts';
import { MAX_TRACK_POINTS, type ManualTrack } from './drawing.ts';
import { equalCoordinate } from './editing.ts';
import { keepsOriginalPoints } from './provenance.ts';
import { pathOf, project } from '../guidance/geometry.ts';
import { cutNodes } from './deleteNodes.ts';
import { preserveTrackColors } from './edgeColors.ts';
import { joinUniqueSegments } from './snapping.ts';

const editable = (track: ManualTrack) => {
  if (keepsOriginalPoints(track))
    throw new Error('实走时间点保留原样，请先通过继续绘制创建手绘副本。');
};
const changed = (
  track: ManualTrack,
  segments: Coordinate[][],
  nodes: Coordinate[],
): ManualTrack => {
  if (segments.length > 100 || segments.flat().length > MAX_TRACK_POINTS)
    throw new Error('路线超过100段或6000点，请减少节点后重试。');
  return preserveTrackColors(
    {
      ...track,
      segments,
      nodes: [...new Map(nodes.map((p) => [p.join(','), p])).values()],
      sharedRoute: undefined,
      updatedAt: Date.now(),
    },
    [track],
  );
};

/** Insert on precisely the selected leg; do not append to the end of the route. */
export function insertTrackNode(
  track: ManualTrack,
  point: Coordinate,
  chainage?: number,
) {
  editable(track);
  if (!coordinate(point)) throw new Error('节点坐标无效');
  if (track.segments.flat().some((p) => equalCoordinate(p, point)))
    return track;
  let best = { segment: -1, index: -1, offset: Infinity, preference: Infinity },
    distance = 0;
  track.segments.forEach((line, segment) => {
    for (let index = 1; index < line.length; index++) {
      const path = pathOf([line[index - 1], line[index]]),
        hit = project(path, point);
      const preference = Math.abs(distance + hit.distance - (chainage ?? 0));
      if (
        hit.offset < best.offset - 0.01 ||
        (Math.abs(hit.offset - best.offset) < 0.01 &&
          preference < best.preference)
      )
        best = { segment, index, offset: hit.offset, preference };
      distance += path.length;
    }
  });
  if (best.segment < 0 || best.offset > 2)
    throw new Error('请先点选路线上的位置，再按加号。');
  const segments = track.segments.map((line) => line.slice());
  segments[best.segment].splice(best.index, 0, point);
  const next = changed(track, segments, [...(track.nodes ?? []), point]);
  if (track.edgeColors) {
    const colors = track.edgeColors.map((row) => row.slice());
    const inherited = colors[best.segment][best.index - 1];
    colors[best.segment].splice(best.index - 1, 1, inherited, inherited);
    next.edgeColors = colors;
  }
  return next;
}

/** Remove the vertex and incident edges, preserving every other vertex. */
export function removeTrackNode(track: ManualTrack, point: Coordinate) {
  return removeTrackNodes(track, [point]);
}
export function removeTrackNodes(track: ManualTrack, points: Coordinate[]) {
  editable(track);
  const removed = new Set(points.map((p) => p.join(',')));
  if (!track.segments.flat().some((p) => removed.has(p.join(','))))
    return track;
  const segments = cutNodes(track.segments, points);
  return changed(
    track,
    segments,
    (track.nodes ?? []).filter((p) => !removed.has(p.join(','))),
  );
}

/** A new connected route preserves both source archives and their photos/markers. */
export function connectTrackNodes(
  a: ManualTrack,
  from: Coordinate,
  b: ManualTrack,
  to: Coordinate,
  id: string,
) {
  editable(a);
  editable(b);
  if (
    ![a, b].every((t, i) =>
      t.segments.flat().some((p) => equalCoordinate(p, i ? to : from)),
    )
  )
    throw new Error('连接节点已变化，请重新选择。');
  if (a.id === b.id && equalCoordinate(from, to))
    throw new Error('请选择另一个节点。');
  const segments = [
    ...a.segments,
    ...(a.id === b.id ? [] : b.segments),
    ...(equalCoordinate(from, to) ? [] : [[from, to]]),
  ];
  return preserveTrackColors(
    changed(
      {
        ...a,
        id,
        name: `${a.name} · 连接路线`.slice(0, 60),
        source: 'manual',
        sourceTrackIds: [
          ...new Set([
            a.id,
            b.id,
            ...(a.sourceTrackIds ?? []),
            ...(b.sourceTrackIds ?? []),
          ]),
        ]
          .filter((v) => v !== id)
          .slice(0, 100),
        createdAt: Date.now(),
      },
      joinUniqueSegments(segments),
      [...(a.nodes ?? []), ...(b.nodes ?? []), from, to],
    ),
    [a, b],
  );
}
