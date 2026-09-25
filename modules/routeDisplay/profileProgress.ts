import type { ElevationSample } from '../journey/metrics';

export type ProfilePoint = { distance: number; elevation: number };
export type ProfileProgress = {
  distance: number | null;
  elevation: number | null;
  fillSegments: ProfilePoint[][];
  routeDistance: number;
};

const validDistance = (distance: number) =>
  Number.isFinite(distance) && distance >= 0;
const validElevation = (elevation: number | null): elevation is number =>
  typeof elevation === 'number' && Number.isFinite(elevation);

export function profileRouteDistance(samples: ElevationSample[]) {
  return samples.reduce(
    (max, sample) =>
      validDistance(sample.distance) && Number.isFinite(sample.part)
        ? Math.max(max, sample.distance)
        : max,
    0,
  );
}

function elevationAt(samples: ElevationSample[], distance: number) {
  const exact = samples.find(
    (sample) =>
      validDistance(sample.distance) &&
      Number.isFinite(sample.part) &&
      sample.distance === distance &&
      validElevation(sample.elevation),
  );
  if (exact) return exact.elevation;

  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (
      a.part !== b.part ||
      !Number.isFinite(a.part) ||
      !Number.isFinite(b.part) ||
      !validDistance(a.distance) ||
      !validDistance(b.distance) ||
      b.distance <= a.distance ||
      !validElevation(a.elevation) ||
      !validElevation(b.elevation)
    ) continue;
    if (distance > a.distance && distance < b.distance)
      return a.elevation +
        ((b.elevation - a.elevation) * (distance - a.distance)) /
          (b.distance - a.distance);
  }
  return null;
}

export function profilePointAt(
  samples: ElevationSample[],
  distance: number,
): { distance: number; elevation: number | null } | null {
  if (!Number.isFinite(distance)) return null;
  const routeDistance = profileRouteDistance(samples);
  const clamped = Math.max(0, Math.min(routeDistance, distance));
  return { distance: clamped, elevation: elevationAt(samples, clamped) };
}

/** Clamp real route progress and build only complete, connected elevation spans. */
export function profileProgress(
  samples: ElevationSample[],
  progress: number | null | undefined,
): ProfileProgress {
  const routeDistance = profileRouteDistance(samples);
  if (progress == null || !Number.isFinite(progress))
    return { distance: null, elevation: null, fillSegments: [], routeDistance };

  const distance = Math.max(0, Math.min(routeDistance, progress));
  const fillSegments: ProfilePoint[][] = [];
  let active: ProfilePoint[] = [];
  let previous: ElevationSample | null = null;
  const flush = () => {
    if (active.length >= 2) fillSegments.push(active);
    active = [];
  };
  const append = (sample: ElevationSample) => {
    if (!active.length || active.at(-1)!.distance !== sample.distance)
      active.push({ distance: sample.distance, elevation: sample.elevation! });
  };

  for (const sample of samples) {
    if (
      !validDistance(sample.distance) ||
      !Number.isFinite(sample.part) ||
      !validElevation(sample.elevation)
    ) {
      flush();
      previous = null;
      continue;
    }
    if (previous &&
        (previous.part !== sample.part || sample.distance <= previous.distance)) {
      flush();
      previous = null;
    }
    if (!previous) {
      previous = sample;
      continue;
    }
    if (distance <= previous.distance) {
      flush();
      break;
    }
    if (!validElevation(previous.elevation) || !validElevation(sample.elevation)) {
      flush();
      previous = null;
      continue;
    }

    append(previous);
    if (distance < sample.distance) {
      const startElevation = previous.elevation;
      const endElevation = sample.elevation;
      active.push({
        distance,
        elevation: startElevation +
          ((endElevation - startElevation) * (distance - previous.distance)) /
            (sample.distance - previous.distance),
      });
      flush();
      break;
    }
    append(sample);
    previous = sample;
    if (distance === sample.distance) {
      flush();
      break;
    }
  }
  flush();

  return {
    distance,
    elevation: profilePointAt(samples, distance)?.elevation ?? null,
    fillSegments,
    routeDistance,
  };
}
