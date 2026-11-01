type Point = { x: number; y: number };
type Candidate<T> = { value: T; point: Point; order: number };

/** Exact nearest point within a CSS-pixel radius, for a single immutable projection snapshot. */
export class ProjectedPointIndex<T> {
  private readonly cells = new Map<string, Candidate<T>[]>();
  private readonly cellSize: number;
  constructor(items: readonly T[], project: (value: T) => Point | null, cellSize = 32) {
    if (!(cellSize > 0 && Number.isFinite(cellSize))) throw new RangeError('Invalid point grid size');
    this.cellSize = cellSize;
    items.forEach((value, order) => {
      const point = project(value);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      const key = this.key(Math.floor(point.x / cellSize), Math.floor(point.y / cellSize));
      const list = this.cells.get(key) ?? [];
      list.push({ value, point: { ...point }, order });
      this.cells.set(key, list);
    });
  }
  nearest(point: Point, radius: number, accept: (value: T) => boolean = () => true): T | null {
    if (![point.x, point.y, radius].every(Number.isFinite) || radius < 0 || radius > this.cellSize * 4) return null;
    let best: Candidate<T> | null = null, distance = radius;
    const x0 = Math.floor((point.x - radius) / this.cellSize), x1 = Math.floor((point.x + radius) / this.cellSize);
    const y0 = Math.floor((point.y - radius) / this.cellSize), y1 = Math.floor((point.y + radius) / this.cellSize);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      for (const candidate of this.cells.get(this.key(x, y)) ?? []) {
        if (!accept(candidate.value)) continue;
        const d = Math.hypot(point.x - candidate.point.x, point.y - candidate.point.y);
        if (d < distance || d === distance && (!best || candidate.order < best.order)) {
          best = candidate; distance = d;
        }
      }
    }
    return best?.value ?? null;
  }
  private key(x: number, y: number) { return `${x},${y}`; }
}
