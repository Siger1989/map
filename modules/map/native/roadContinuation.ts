import { roadSection, type RoadLine, type RoadMatch, type RoadProject } from '../../tracks/roadSnapping.ts';
import { roadPathDetailed, type RoadPathResult } from '../../tracks/roadPath.ts';

/** Point-to-point selection is an explicit route request; freehand keeps its anti-jump guard. */
export function nativeRoadContinuation(
  start: RoadMatch,
  end: RoadMatch,
  lines: RoadLine[],
  project: RoadProject,
  mode?: 'points' | 'freehand',
): RoadPathResult {
  if (mode !== 'points' && start.line.id === end.line.id) {
    const section = roadSection(start, end, project);
    return section ? { status: 'ready', section } : { status: 'disconnected' };
  }
  return roadPathDetailed(start, end, lines);
}
