import { metresBetween, type Coordinate } from '../navigation/types.ts';
export type JourneySample = {
  coordinates: Coordinate;
  distance: number;
  part: number;
};
export type ElevationSample = JourneySample & { elevation: number | null };
export const lineLength = (line: Coordinate[]) =>
  line.slice(1).reduce((sum, p, i) => sum + metresBetween(line[i], p), 0);
export function pointAlong(line: Coordinate[], distance: number): Coordinate {
  for (let i = 1; i < line.length; i++) {
    const length = metresBetween(line[i - 1], line[i]);
    if (distance <= length && length > 0) {
      const t = Math.max(0, distance / length),
        a = line[i - 1],
        b = line[i];
      const longitude = a[0] + (((b[0] - a[0] + 540) % 360) - 180) * t;
      return [((longitude + 540) % 360) - 180, a[1] + (b[1] - a[1]) * t];
    }
    distance -= length;
  }
  return line.at(-1)!;
}
/** Bounded DEM workload; each independent line keeps its own endpoints. */
export function sampleTerrain(segments: Coordinate[][]): JourneySample[] {
  const lines = segments.filter((l) => l.length >= 2),
    lengths = lines.map(lineLength);
  const total = lengths.reduce((a, b) => a + b, 0),
    extra = Math.max(0, 192 - lines.length * 2);
  let offset = 0;
  return lines.flatMap((line, part) => {
    const length = lengths[part];
    const count =
      2 +
      Math.min(
        Math.max(0, Math.floor(length / 30) - 1),
        Math.floor((extra * length) / (total || 1)),
      );
    const samples = Array.from({ length: count }, (_, i) => {
      const d = (length * i) / (count - 1);
      return {
        coordinates:
          i === 0
            ? line[0]
            : i === count - 1
              ? line.at(-1)!
              : pointAlong(line, d),
        distance: offset + d,
        part,
      };
    });
    offset += length;
    return samples;
  });
}
export function weatherStops(line: Coordinate[]): JourneySample[] {
  const length = lineLength(line),
    count = Math.max(2, Math.min(6, Math.ceil(length / 5000) + 1));
  return Array.from({ length: count }, (_, i) => ({
    coordinates:
      i === 0
        ? line[0]
        : i === count - 1
          ? line.at(-1)!
          : pointAlong(line, (length * i) / (count - 1)),
    distance: (length * i) / (count - 1),
    part: 0,
  }));
}
export function elevationStats(samples: ElevationSample[]) {
  const values = samples.flatMap((s) =>
    s.elevation === null ? [] : [s.elevation],
  );
  let up = 0,
    down = 0,
    base: number | null = null,
    last: number | null = null,
    part = -1;
  const add = (difference: number) => {
    if (difference > 0) up += difference;
    else down -= difference;
  };
  const flush = () => {
    if (base !== null && last !== null) add(last - base);
    base = null;
    last = null;
  };
  for (const s of samples) {
    if (s.part !== part || s.elevation === null) flush();
    part = s.part;
    if (s.elevation === null) continue;
    if (base === null) base = s.elevation;
    // Accumulate gentle slopes, suppress reversals smaller than three metres.
    if (Math.abs(s.elevation - base) >= 3) {
      add(s.elevation - base);
      base = s.elevation;
    }
    last = s.elevation;
  }
  flush();
  const complete = samples.length > 0 && values.length === samples.length;
  const first = samples[0]?.elevation ?? null,
    end = samples.at(-1)?.elevation ?? null;
  return {
    complete,
    available: values.length,
    count: samples.length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    start: first,
    end,
    ascent: complete ? up : null,
    descent: complete ? down : null,
    change:
      samples.every((s) => s.part === 0) && first !== null && end !== null
        ? end - first
        : null,
  };
}
