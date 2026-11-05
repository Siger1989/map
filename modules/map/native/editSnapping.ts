import type { Coordinate } from '../../navigation/types.ts';
import { roadHint, type RoadSnapper } from '../../tracks/roadSnapping.ts';
import { riverHint } from '../../tracks/riverSnapping.ts';

export type NativeEditCoordinateSnap = { coordinate: Coordinate | null; hint: string };

/** Moving one existing node changes its location; it does not reroute the surrounding legs. */
export function snapNativeEditCoordinate(
  point: { x: number; y: number },
  options: { road: boolean; river: boolean; snapRoad: RoadSnapper; snapRiver: RoadSnapper },
): NativeEditCoordinateSnap | null {
  if (!options.road && !options.river) return null;
  const result = (options.river ? options.snapRiver : options.snapRoad)(point, null);
  const hint = result.status === 'disconnected' ? '道路不连通 · 保留原始点' : roadHint(result);
  return {
    coordinate: result.status === 'ready' ? result.match?.coordinate ?? null : null,
    hint: options.river ? riverHint(hint) : hint,
  };
}
