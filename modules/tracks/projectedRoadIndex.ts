import type { ScreenPoint } from './drawing';
import {
  type ProjectedRoadSegment,
  type RoadLine,
  type RoadProject,
} from './roadSnapping.ts';

const CELL_SIZE = 64;
const MAX_CELLS_PER_SEGMENT = 64;

function finite(point: ScreenPoint | null): point is ScreenPoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * A screen-space broad phase for road snapping. Build once for a fixed
 * projection and reuse while the map view and source lines remain unchanged.
 * The caller owns that projection lifetime; changing it requires rebuilding.
 */
export class ProjectedRoadIndex {
  readonly lines: RoadLine[];
  readonly overflowCount: number;
  readonly maxRadius: number;
  private readonly cells = new Map<string, ProjectedRoadSegment[]>();
  private readonly overflow: ProjectedRoadSegment[] = [];

  constructor(
    lines: RoadLine[],
    project: RoadProject,
    maxRadius = 22,
  ) {
    this.lines = lines;
    this.maxRadius = maxRadius;
    let order = 0;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      for (let index = 0; index < line.coordinates.length - 1; index++) {
        const a = line.coordinates[index],
          b = line.coordinates[index + 1],
          screenA = project(a),
          screenB = project(b);
        if (!finite(screenA) || !finite(screenB)) {
          order++;
          continue;
        }
        const segment: ProjectedRoadSegment = {
          order: order++,
          lineIndex,
          line,
          index,
          a,
          b,
          screenA: { x: screenA.x, y: screenA.y },
          screenB: { x: screenB.x, y: screenB.y },
        };
        this.add(segment);
      }
    }
    this.overflowCount = this.overflow.length;
  }

  candidatesAt(
    point: ScreenPoint,
    radius: number,
  ): readonly ProjectedRoadSegment[] {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
    // The grid was padded only to maxRadius. A larger request must retain
    // correctness by considering every segment.
    if (!Number.isFinite(radius) || radius > this.maxRadius) {
      return [...this.allSegments()];
    }
    const candidates = new Set<ProjectedRoadSegment>(this.overflow);
    const cell = this.key(this.cell(point.x), this.cell(point.y));
    for (const segment of this.cells.get(cell) ?? []) candidates.add(segment);
    return [...candidates].sort((a, b) => a.order - b.order);
  }

  private *allSegments(): Iterable<ProjectedRoadSegment> {
    const all = [...this.overflow];
    for (const segments of this.cells.values()) all.push(...segments);
    // This uncommon path is for a caller asking outside the configured radius.
    const unique = new Set(all);
    yield* [...unique].sort((a, b) => a.order - b.order);
  }

  private add(segment: ProjectedRoadSegment) {
    const pad = this.maxRadius;
    const minX = Math.floor((Math.min(segment.screenA.x, segment.screenB.x) - pad) / CELL_SIZE);
    const maxX = Math.floor((Math.max(segment.screenA.x, segment.screenB.x) + pad) / CELL_SIZE);
    const minY = Math.floor((Math.min(segment.screenA.y, segment.screenB.y) - pad) / CELL_SIZE);
    const maxY = Math.floor((Math.max(segment.screenA.y, segment.screenB.y) + pad) / CELL_SIZE);
    const width = maxX - minX + 1,
      height = maxY - minY + 1;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width * height > MAX_CELLS_PER_SEGMENT) {
      this.overflow.push(segment);
      return;
    }
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = this.key(x, y);
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(segment);
        else this.cells.set(key, [segment]);
      }
    }
  }

  private cell(value: number) {
    return Math.floor(value / CELL_SIZE);
  }

  private key(x: number, y: number) {
    return `${x},${y}`;
  }
}
