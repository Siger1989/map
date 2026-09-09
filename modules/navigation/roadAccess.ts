import {
  coordinate,
  metresBetween,
  type Coordinate,
  type PlannedRoute,
  type RoutePlace,
  type RouteStep,
} from './types.ts';

/** Closest projected point among the provider's connected, mode-compatible road candidates. */
export function nearestRoadPlaces(
  input: unknown,
  stops: RoutePlace[],
): RoutePlace[] {
  if (!Array.isArray(input) || input.length !== stops.length)
    throw new Error('道路接入点返回不完整，请重试');
  return stops.map((stop, i) => {
    const candidates: Coordinate[] = (
      Array.isArray(input[i]?.edges) ? input[i].edges : []
    )
      .map((edge: { correlated_lon?: unknown; correlated_lat?: unknown }) => [
        edge.correlated_lon,
        edge.correlated_lat,
      ])
      .filter(coordinate);
    candidates.sort(
      (a, b) =>
        metresBetween(stop.coordinates, a) - metresBetween(stop.coordinates, b),
    );
    if (
      !candidates[0] ||
      metresBetween(stop.coordinates, candidates[0]) > 35000
    )
      throw new Error(
        `“${stop.name}”附近没有可接入的道路，请更换出行方式或地点`,
      );
    return { ...stop, coordinates: candidates[0] };
  });
}

/** Keep every chosen stop, including the out-and-back access at an off-road via. */
export function connectRoadAccess(
  route: PlannedRoute,
  stops: RoutePlace[],
): PlannedRoute {
  if (stops.length !== route.snapped.length || stops.length < 2)
    throw new Error('道路接入点数量不一致');
  const legs = stops.length === 2 ? [route.coordinates] : route.roadLegs;
  if (
    !legs ||
    legs.length !== stops.length - 1 ||
    legs.some((p) => p.length < 2)
  )
    throw new Error('道路分段不完整，无法保留途经点');
  const segments: NonNullable<PlannedRoute['segments']> = [],
    steps: RouteStep[] = [];
  let accessDistance = 0,
    accessDuration = 0,
    elapsed = 0;
  const access = (a: Coordinate, b: Coordinate, instruction: string) => {
    const distance = metresBetween(a, b);
    if (distance < 0.01) return;
    const duration = distance / 1.2; // Explicit walking estimate for the unverified direct access, never a driving road.
    segments.push({ kind: 'access', coordinates: [a, b] });
    steps.push({
      kind: 'access',
      instruction,
      coordinates: [a, b],
      distance,
      duration,
      elapsedSeconds: elapsed,
    });
    elapsed += duration;
    accessDistance += distance;
    accessDuration += duration;
  };
  legs.forEach((leg, i) => {
    access(stops[i].coordinates, leg[0], '沿虚线前往道路接入点 · 直线示意');
    segments.push({ kind: 'road', coordinates: leg });
    const legSteps = route.steps.filter((s) => (s.legIndex ?? 0) === i);
    legSteps.forEach((s) => {
      const instruction =
        s.instruction === '到达终点'
          ? metresBetween(leg.at(-1)!, stops[i + 1].coordinates) >= 0.01
            ? '到达道路出口，继续前往标记点'
            : i < legs.length - 1
              ? `到达途经点 ${i + 1}`
              : s.instruction
          : s.instruction;
      steps.push({ ...s, instruction, kind: 'road', elapsedSeconds: elapsed });
      elapsed += s.duration;
    });
    access(
      leg.at(-1)!,
      stops[i + 1].coordinates,
      i === legs.length - 1
        ? '离开道路前往终点 · 虚线直连示意'
        : `离开道路前往途经点 ${i + 1} · 虚线直连示意`,
    );
  });
  const coordinates = segments
    .flatMap((s) => s.coordinates)
    .filter(
      (p, i, all) =>
        i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1],
    );
  return {
    ...route,
    coordinates,
    segments,
    steps,
    stops,
    accessDistance,
    accessDuration,
    distance: route.distance + accessDistance,
    duration: route.duration + accessDuration,
  };
}
