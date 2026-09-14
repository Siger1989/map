import type { ManualTrack } from '../tracks/drawing';
import type { ElevationSample } from '../journey/metrics';
import { trackHeights, withTerrainHeights } from './trackElevation.ts';
import { finiteHeight } from './elevationColors.ts';

/** Rendering/analysis copy only. Add DEM samples inside missing-height edges, never to editable geometry. */
export function terrainProfileTrack(
  track: ManualTrack,
  terrain: ElevationSample[],
): ManualTrack {
  const enriched = withTerrainHeights(track, terrain);
  const group = (points: ElevationSample[]) => {
    const groups = new Map<number, ElevationSample[]>();
    for (const point of points) {
      if (!groups.has(point.part)) groups.set(point.part, []);
      groups.get(point.part)!.push(point);
    }
    return groups;
  };
  const originals = group(trackHeights(enriched)),
    terrainParts = group(terrain);
  const segments: ManualTrack['segments'] = [];
  const samples: NonNullable<ManualTrack['samples']> = [];
  track.segments.forEach((line, part) => {
    const vertices = originals.get(part) ?? [];
    const points = (terrainParts.get(part) ?? []).sort(
      (a, b) => a.distance - b.distance,
    );
    const coordinates: typeof line = [],
      values: NonNullable<ManualTrack['samples']>[number] = [];
    let cursor = 0;
    line.forEach((coordinate, i) => {
      const distance = vertices[i].distance;
      while (
        cursor < points.length &&
        points[cursor].distance < distance - 0.01
      ) {
        const p = points[cursor++];
        if (
          i &&
          p.distance > vertices[i - 1].distance + 0.01 &&
          (!finiteHeight(track.samples?.[part]?.[i - 1]?.altitude) ||
            !finiteHeight(track.samples?.[part]?.[i]?.altitude))
        ) {
          coordinates.push(p.coordinates);
          values.push({ time: null, altitude: p.elevation });
        }
      }
      coordinates.push(coordinate);
      values.push(enriched.samples![part][i]);
    });
    segments.push(coordinates);
    samples.push(values);
  });
  return { ...track, segments, samples };
}
