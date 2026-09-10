import type { SurveyTerrain } from './surveyLine.ts';
type P = [number, number];
/** Triangulate each known cell; missing cells yield no line rather than a guessed connection. */
export function surveyContours(data: SurveyTerrain, interval: number) {
  const finite = data.heights.filter((v): v is number => v !== null),
    min = Math.min(...finite),
    max = Math.max(...finite);
  if (!finite.length) return [];
  if (
    !Number.isFinite(interval) ||
    interval <= 0 ||
    (max - min) / interval > 160
  )
    throw new Error('等高线过密，请增大等高距后重试');
  const result: { level: number; paths: P[][] }[] = [];
  for (
    let level = Math.ceil(min / interval) * interval;
    level <= max;
    level += interval
  ) {
    const segments: [P, P][] = [];
    const triangle = (
      a: [number, number, number],
      b: [number, number, number],
      c: [number, number, number],
    ) => {
      const points: P[] = [];
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ])
        if (p[2] >= level !== q[2] >= level) {
          const f = (level - p[2]) / (q[2] - p[2]);
          points.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
        }
      if (
        points.length === 2 &&
        Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) >
          1e-9
      )
        segments.push([points[0], points[1]]);
    };
    for (let y = 0; y < data.rows - 1; y++)
      for (let x = 0; x < data.columns - 1; x++) {
        const a = data.heights[y * data.columns + x],
          b = data.heights[y * data.columns + x + 1],
          c = data.heights[(y + 1) * data.columns + x + 1],
          d = data.heights[(y + 1) * data.columns + x];
        if (a === null || b === null || c === null || d === null) continue;
        triangle([x, y, a], [x + 1, y, b], [x + 1, y + 1, c]);
        triangle([x, y, a], [x + 1, y + 1, c], [x, y + 1, d]);
      }
    const key = (p: P) => p.map((v) => v.toFixed(7)).join(','),
      edges = new Map<string, number[]>(),
      used = new Set<number>();
    segments.forEach((s, i) =>
      s.forEach((p) => {
        const k = key(p);
        edges.set(k, [...(edges.get(k) ?? []), i]);
      }),
    );
    const paths: P[][] = [];
    const walk = (first: P, edge: number) => {
      const path: P[] = [first];
      let point = first,
        current: number | undefined = edge;
      while (current !== undefined && !used.has(current)) {
        used.add(current);
        const s = segments[current];
        point = key(s[0]) === key(point) ? s[1] : s[0];
        path.push(point);
        current = edges.get(key(point))?.find((i) => !used.has(i));
      }
      paths.push(path);
    };
    segments.forEach((s, i) => {
      if (!used.has(i)) {
        const endpoint = s.find((p) => edges.get(key(p))?.length === 1);
        if (endpoint) walk(endpoint, i);
      }
    });
    segments.forEach((s, i) => {
      if (!used.has(i)) walk(s[0], i);
    });
    if (paths.length) result.push({ level, paths });
  }
  return result;
}
