import type { Dispatch, SetStateAction, RefObject } from 'react';
import type { Coordinate } from '../navigation/types';
import { type ManualTrack, MAX_SAVED_TRACKS } from './drawing';
import { type TrackNode, DRAFT_ID } from './editing';
import {
  type TrackDraft,
  replaceDraftGeometry,
  removeDraftNode,
} from './draft';
import {
  insertTrackNode,
  removeTrackNode,
  connectTrackNodes,
} from './nodeOperations';
type Commands = {
  draftRef: RefObject<TrackDraft>;
  savedRef: RefObject<ManualTrack[]>;
  draftTrack: () => ManualTrack;
  applyDraft: (draft: TrackDraft) => void;
  persist: (tracks: ManualTrack[]) => boolean;
  setNodeHistory: Dispatch<SetStateAction<ManualTrack[]>>;
  setError: (error: string) => void;
  setDraftState: (draft: TrackDraft) => void;
  select: (id: string | null) => void;
};
/** Geometry commands adapt the shared draft/archive operations to the active editing session. */
export function createTrackNodeCommands({
  draftRef,
  savedRef,
  draftTrack,
  applyDraft,
  persist,
  setNodeHistory,
  setError,
  setDraftState,
  select,
}: Commands) {
  return {
    insertNode: (id: string, point: Coordinate, distance?: number) => {
      try {
        if (id === DRAFT_ID) {
          const next = insertTrackNode(draftTrack(), point, distance);
          applyDraft(
            replaceDraftGeometry(
              draftRef.current,
              next.segments,
              next.nodes ?? [],
              draftRef.current.kinds,
              draftRef.current.pointLine,
              next.edgeColors,
            ),
          );
          return true;
        }
        const track = savedRef.current.find((t) => t.id === id);
        if (!track) return false;
        const next = insertTrackNode(track, point, distance);
        if (next === track) return true;
        if (!persist(savedRef.current.map((t) => (t.id === id ? next : t))))
          return false;
        setNodeHistory((h) => [...h.slice(-19), track]);
        setError('');
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    },
    removeNode: (node: TrackNode) => {
      try {
        if (node.trackId === DRAFT_ID) {
          applyDraft(removeDraftNode(draftRef.current, node.coordinate));
          return true;
        }
        const track = savedRef.current.find((t) => t.id === node.trackId);
        if (!track) return false;
        const next = removeTrackNode(track, node.coordinate);
        if (
          next === track ||
          !persist(
            savedRef.current.flatMap((t) =>
              t.id === track.id ? (next.segments.length ? [next] : []) : [t],
            ),
          )
        )
          return false;
        setNodeHistory((h) => [...h.slice(-19), track]);
        setError('');
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    },
    connectNodes: (from: TrackNode, to: TrackNode) => {
      try {
        if (from.trackId === DRAFT_ID || to.trackId === DRAFT_ID) {
          const a =
            from.trackId === DRAFT_ID
              ? draftTrack()
              : savedRef.current.find((t) => t.id === from.trackId);
          const b =
            to.trackId === DRAFT_ID
              ? draftTrack()
              : savedRef.current.find((t) => t.id === to.trackId);
          if (!a || !b) throw new Error('连接节点已变化，请重新选择。');
          // Keep draft geometry first so active stroke kinds/indices remain aligned.
          const next =
            from.trackId === DRAFT_ID
              ? connectTrackNodes(
                  a,
                  from.coordinate,
                  b,
                  to.coordinate,
                  DRAFT_ID,
                )
              : connectTrackNodes(
                  b,
                  to.coordinate,
                  a,
                  from.coordinate,
                  DRAFT_ID,
                );
          applyDraft(
            replaceDraftGeometry(
              draftRef.current,
              next.segments,
              next.nodes ?? [],
              next.segments.map(
                (_, i) => draftRef.current.kinds[i] ?? 'freehand',
              ),
              null,
              next.edgeColors,
            ),
          );
          const metadata = {
            ...draftRef.current,
            colorConditions: next.colorConditions,
            sections: next.sections,
          };
          draftRef.current = metadata;
          setDraftState(metadata);
          select(DRAFT_ID);
          return true;
        }
        const a = savedRef.current.find((t) => t.id === from.trackId),
          b = savedRef.current.find((t) => t.id === to.trackId);
        if (!a || !b) throw new Error('请选择两条已保存路线的节点。');
        if (savedRef.current.length >= MAX_SAVED_TRACKS)
          throw new Error(`已达 ${MAX_SAVED_TRACKS} 条路线，请先整理存档。`);
        const next = connectTrackNodes(
          a,
          from.coordinate,
          b,
          to.coordinate,
          crypto.randomUUID(),
        );
        if (!persist([...savedRef.current, next])) return false;
        select(next.id);
        setNodeHistory([]);
        setError('已生成连接路线，原线路及其照片保留。');
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    },
  };
}
