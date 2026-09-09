import type { Coordinate } from '../navigation/types';

/** Cut at removed vertices. No new edge may span the resulting gap. Lone survivors remain points. */
export function cutNodes(lines: Coordinate[][], points: Coordinate[]) {
  const removed = new Set(points.map(p => p.join(',')));
  return lines.flatMap(line => {
    const runs: Coordinate[][] = [];
    let run: Coordinate[] = [];
    for (const p of line) {
      if (removed.has(p.join(','))) { if (run.length) runs.push(run); run = []; }
      else run.push(p);
    }
    if (run.length) runs.push(run);
    return runs;
  });
}
