import type { ManualTrack } from '../tracks/drawing';
import {
  elevationColor,
  finiteHeight,
  routeElevationScale,
} from './elevationColors.ts';

/** Split sparse edges along their measured endpoint heights so two-point lines also show a gradient. */
export function elevationLineParts(
  track: Pick<ManualTrack, 'segments' | 'samples'>,
) {
  const scale = routeElevationScale(track);
  const edges = track.segments.reduce(
    (n, line) => n + Math.max(0, line.length - 1),
    0,
  );
  const limit = Math.max(
    1,
    Math.min(32, Math.floor(12000 / Math.max(1, edges))),
  );
  return track.segments.flatMap((line, part) => {
    const result: {
      coordinates: ManualTrack['segments'][number];
      color: string;
      muted: boolean;
    }[] = [];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i],
        start = track.samples?.[part]?.[i - 1]?.altitude,
        end = track.samples?.[part]?.[i]?.altitude;
      const complete = finiteHeight(start) && finiteHeight(end);
      const steps =
        complete && scale && scale.max > scale.min
          ? Math.max(
              1,
              Math.min(
                limit,
                Math.ceil(
                  (Math.abs(end - start) / (scale.max - scale.min)) * 32,
                ),
              ),
            )
          : 1;
      const point = (t: number): typeof a =>
        t === 0
          ? a
          : t === 1
            ? b
            : [
                ((a[0] + (((b[0] - a[0] + 540) % 360) - 180) * t + 540) % 360) -
                  180,
                a[1] + (b[1] - a[1]) * t,
              ];
      for (let step = 0; step < steps; step++) {
        const color = elevationColor(
          complete ? start + ((end - start) * (step + 0.5)) / steps : null,
          scale,
        );
        const previous = result.at(-1),
          next = point((step + 1) / steps);
        if (previous?.color === color) previous.coordinates.push(next);
        else
          result.push({
            coordinates: [point(step / steps), next],
            color,
            muted: false,
          });
      }
    }
    return result;
  });
}
