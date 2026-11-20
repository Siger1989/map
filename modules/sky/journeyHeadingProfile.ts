import { journeyBearing } from './journeyCamera.ts';
import { shortestTurn } from './skyPoseMotion.ts';
import type { SkyJourneyCoordinate } from './journeyPlayback.ts';

type Vertex = { coordinates: SkyJourneyCoordinate; distanceM: number };
export interface JourneyTurn {
  distanceM: number;
  sum: number;
  firstMoment: number;
  secondMoment: number;
}

/** Prefix moments let even a densely recorded switchback be sampled with three binary searches. */
export function indexJourneyTurns(points: readonly Vertex[]): JourneyTurn[] {
  const turns: JourneyTurn[] = [];
  let previous: Vertex | undefined;
  let vertex = points[0];
  let sum = 0, firstMoment = 0, secondMoment = 0;
  for (let i = 1; i < points.length; i++) {
    const next = points[i];
    if (next.distanceM - vertex.distanceM <= .001) continue;
    if (previous) {
      const incoming = journeyBearing(vertex.coordinates, previous.coordinates) + 180;
      const outgoing = journeyBearing(vertex.coordinates, next.coordinates);
      const change = shortestTurn(incoming, outgoing);
      if (Math.abs(change) > .00001) {
        const distanceM = vertex.distanceM - points[0].distanceM;
        sum += change;
        firstMoment += change * distanceM;
        secondMoment += change * distanceM * distanceM;
        turns.push({ distanceM, sum, firstMoment, secondMoment });
      }
    }
    previous = vertex;
    vertex = next;
  }
  return turns;
}

function through(turns: readonly JourneyTurn[], distance: number) {
  let low = 0, high = turns.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (turns[middle].distanceM <= distance) low = middle + 1;
    else high = middle;
  }
  return low;
}

// Sum of turn angles weighted by (vertex distance - edge)^2 on [begin, end).
function moment(turns: readonly JourneyTurn[], begin: number, end: number, edge: number) {
  if (begin === end) return 0;
  const a = turns[begin - 1], b = turns[end - 1];
  return b.secondMoment - (a?.secondMoment ?? 0)
    - 2 * edge * (b.firstMoment - (a?.firstMoment ?? 0))
    + edge * edge * (b.sum - (a?.sum ?? 0));
}

/** Smooth only the camera's yaw along this segment. The arrow retains the exact local tangent. */
export function journeyCameraHeading(turns: readonly JourneyTurn[], distance: number, raw: number, radius: number) {
  if (!turns.length || radius <= 0) return raw;
  const start = through(turns, distance - radius);
  const finish = through(turns, distance + radius);
  if (start === finish) return raw;
  const center = Math.min(finish, through(turns, distance + .001));
  // Integrating a triangular kernel eases in and out with continuous angular velocity.
  const correction = (moment(turns, center, finish, distance + radius) -
    moment(turns, start, center, distance - radius)) / (2 * radius * radius);
  return ((raw + correction) % 360 + 360) % 360;
}
