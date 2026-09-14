import type { TrackOverlay } from '../tracks/TrackLayer';
import type { ManualTrack } from '../tracks/drawing';
import type { RouteEditSession } from '../tracks/routeEdit';
import { DRAFT_ID } from '../tracks/editing.ts';

export type TrackOverlayInput = Omit<TrackOverlay, 'saved' | 'draft'> & {
  saved: ManualTrack[];
  draft: ManualTrack['segments'];
  session: RouteEditSession | null;
  recording: ManualTrack | null;
};

/** Composition only: no storage, geometry editing, React state or map calls. */
export function composeTrackOverlay({
  saved,
  draft,
  session,
  recording,
  ...display
}: TrackOverlayInput): TrackOverlay {
  let visibleTracks = saved;
  if (session) {
    const replaced = new Set(session.sources.map((source) => source.id));
    visibleTracks = saved.filter((track) => !replaced.has(track.id));
    if (session.track.id !== DRAFT_ID) visibleTracks.push(session.track);
  }
  if (recording) visibleTracks = [...visibleTracks, recording];
  return {
    ...display,
    saved: visibleTracks,
    draft: session
      ? session.original.id === DRAFT_ID
        ? session.track.segments
        : []
      : draft,
    draftEdgeColors: session?.track.edgeColors ?? display.draftEdgeColors,
    style: session?.track.style ?? display.style,
    nodes: session?.track.nodes ?? display.nodes,
    activeNode: session?.selected
      ? { trackId: session.track.id, coordinate: session.selected }
      : null,
    editing: !!session || display.drawing,
    movableTrackId:
      session && session.branch === null ? session.track.id : null,
    connecting: session?.branch != null,
    snapTargets: !!session && session.branch === null && display.snapTargets,
  };
}
