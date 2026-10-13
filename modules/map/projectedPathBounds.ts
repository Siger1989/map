export type ScreenPoint = [number, number];
export type ScreenBounds = { left: number; top: number; right: number; bottom: number };
export type ProjectedPaths = Array<Array<ScreenPoint>>;

/** Per-update index: callers create a fresh instance for each projection/update frame. */
export class ProjectedPathBoundsIndex {
  private readonly byProjected = new WeakMap<ProjectedPaths, Array<ScreenBounds | null | undefined>>();

  getPathBounds(projected: ProjectedPaths, pathIndex: number): ScreenBounds | null {
    let boundsByPath = this.byProjected.get(projected);
    if (!boundsByPath) {
      boundsByPath = [];
      this.byProjected.set(projected, boundsByPath);
    }
    if (pathIndex < 0 || pathIndex >= projected.length) return null;
    const cached = boundsByPath[pathIndex];
    if (cached !== undefined) return cached;

    const path = projected[pathIndex];
    if (!path.length) {
      boundsByPath[pathIndex] = null;
      return null;
    }
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const [x, y] of path) {
      // Unknown geometry must remain eligible for the original clipping path.
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        boundsByPath[pathIndex] = null;
        return null;
      }
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    const bounds = { left, top, right, bottom };
    boundsByPath[pathIndex] = bounds;
    return bounds;
  }
}

/** Inclusive overlap so strokes touching a marker edge are still clipped. */
export function isPathRelevant(localBounds: ScreenBounds, globalPathBounds: ScreenBounds | null): boolean {
  if (!globalPathBounds) return true;
  const values = [localBounds.left, localBounds.top, localBounds.right, localBounds.bottom,
    globalPathBounds.left, globalPathBounds.top, globalPathBounds.right, globalPathBounds.bottom];
  if (!values.every(Number.isFinite)) return true;
  return globalPathBounds.right >= localBounds.left && globalPathBounds.left <= localBounds.right &&
    globalPathBounds.bottom >= localBounds.top && globalPathBounds.top <= localBounds.bottom;
}
