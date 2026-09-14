import type { ManualTrack } from '../tracks/drawing';
import { metresBetween } from '../navigation/types.ts';
import type { ElevationSample } from '../journey/metrics';
import { finiteHeight } from '../routeAnalysis/elevationColors.ts';

export function trackHeights(track: ManualTrack): ElevationSample[] {
  let distance = 0;
  return track.segments.flatMap((line, part) =>
    line.map((coordinates, i) => {
      if (i) distance += metresBetween(line[i - 1], coordinates);
      const h = track.samples?.[part]?.[i]?.altitude;
      return {
        coordinates,
        distance,
        part,
        elevation: finiteHeight(h) ? h : null,
      };
    }),
  );
}
/** Display-only DEM interpolation; keep originals, timestamps, pause boundaries and holes. */
export function withTerrainHeights(
  track: ManualTrack,
  terrain: ElevationSample[],
): ManualTrack {
  const groups = new Map<number, ElevationSample[]>();
  for (const p of terrain) {
    if (!groups.has(p.part)) groups.set(p.part, []);
    groups.get(p.part)!.push(p);
  }
  let distance = 0;
  const samples = track.segments.map((line, part) => {
    const profile = groups.get(part) ?? [];
    let cursor = 0;
    return line.map((p, index) => {
      if (index) distance += metresBetween(line[index - 1], p);
      const original = track.samples?.[part]?.[index];
      if (finiteHeight(original?.altitude)) return original!;
      while (
        cursor + 1 < profile.length &&
        profile[cursor + 1].distance <= distance
      )
        cursor++;
      const a = profile[cursor],
        b = profile[cursor + 1];
      let altitude: number | null = null;
      if (a && Math.abs(a.distance - distance) < 0.01) altitude = a.elevation;
      else if (
        a &&
        b &&
        finiteHeight(a.elevation) &&
        finiteHeight(b.elevation) &&
        distance >= a.distance &&
        distance <= b.distance &&
        b.distance > a.distance
      )
        altitude =
          a.elevation +
          ((b.elevation - a.elevation) * (distance - a.distance)) /
            (b.distance - a.distance);
      return { time: original?.time ?? null, altitude };
    });
  });
  return { ...track, samples };
}
