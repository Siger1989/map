import { useEffect, useMemo, useRef, useState } from 'react';
import { coordinate, type Coordinate } from '../navigation/types';
import { keepsOriginalPoints } from './provenance';
import { usePlaceName } from '../navigation/usePlaceName';
import { drawingRecord, storeDrawingRecord } from './archive';
import {
  DRAFT_ID,
  equalCoordinate,
  moveTrackNode,
  type TrackNode,
} from './editing';
import {
  DEFAULT_TRACK_STYLE,
  normalizeTrackStyle,
  TRACK_STYLE_STORAGE,
  type TrackStyle,
} from './style';
import {
  MAX_TRACK_POINTS,
  parseSavedTracks,
  TRACK_STORAGE,
  type ManualTrack,
} from './drawing';
import {
  appendStroke,
  appendVertex,
  appendRoadVertex,
  draftVertices,
  EMPTY_DRAFT,
  undoDraft,
  moveDraftNode,
} from './draft';
import { connectedTracks, endpoints, joinSegments } from './snapping';
export function useManualTracks() {
  const [saved, setSaved] = useState<ManualTrack[]>([]);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const startedAt = useRef(Date.now());
  const [draftState, setDraftState] = useState(EMPTY_DRAFT);
  const draftRef = useRef(draftState);
  draftRef.current = draftState;
  const [anchor, setAnchor] = useState<Coordinate | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copyName, setCopyName] = useState<string | null>(null);
  const [selectedId, select] = useState<string | null>(null);
  const [nodeHistory, setNodeHistory] = useState<ManualTrack[]>([]);
  const [snapping, setSnapping] = useState(true);
  const [roadSnapping, setRoadSnapping] = useState(true);
  const [riverSnapping, setRiverSnapping] = useState(false);
  const [editing, setEditing] = useState(false),
    [drawing, setDrawing] = useState(false);
  const [style, setStyle] = useState<TrackStyle>(DEFAULT_TRACK_STYLE);
  const [visible, setVisible] = useState(true),
    [error, setError] = useState('');
  const vertices = useMemo(() => draftVertices(draftState), [draftState]);
  const place = usePlaceName(draftState.segments[0]?.[0] ?? null, true);
  const candidates = useMemo(
    () => [
      ...endpoints(draftState.segments),
      ...vertices,
      ...saved.flatMap((t) => [...endpoints(t.segments), ...(t.nodes ?? [])]),
    ],
    [draftState.segments, vertices, saved],
  );
  const overlaySaved = useMemo(
    () => saved.filter((t) => t.id !== editingId),
    [saved, editingId],
  );
  useEffect(() => {
    try {
      setSaved(parseSavedTracks(localStorage.getItem(TRACK_STORAGE)));
    } catch {
      setError('本机轨迹存档无法读取；新轨迹仍可绘制。');
    }
    try {
      setStyle(
        normalizeTrackStyle(
          JSON.parse(localStorage.getItem(TRACK_STYLE_STORAGE) ?? 'null'),
        ),
      );
    } catch {}
  }, []);
  useEffect(() => {
    const reload = () => {
      try {
        setSaved(parseSavedTracks(localStorage.getItem(TRACK_STORAGE)));
      } catch {
        /* Existing state remains available. */
      }
    };
    window.addEventListener('guanyun-data-changed', reload);
    return () => window.removeEventListener('guanyun-data-changed', reload);
  }, []);
  const persist = (tracks: ManualTrack[]) => {
    try {
      localStorage.setItem(TRACK_STORAGE, JSON.stringify(tracks));
      savedRef.current = tracks;
      setSaved(tracks);
      return true;
    } catch {
      setError('本机存储空间不足，轨迹尚未保存。');
      return false;
    }
  };
  const withinLimit = (extra: number, newSegment = false) => {
    if (newSegment && draftRef.current.segments.length >= 100) {
      setError('草稿已达 100 笔，请先保存合并后再续画。');
      setDrawing(false);
      return false;
    }
    if (
      draftRef.current.segments.reduce((n, points) => n + points.length, 0) +
        extra <=
      MAX_TRACK_POINTS
    )
      return true;
    setError('轨迹点数已达上限，请先保存。');
    setDrawing(false);
    return false;
  };
  const resetDraft = () => {
    draftRef.current = EMPTY_DRAFT;
    setDraftState(EMPTY_DRAFT);
    setCopyName(null);
    setEditingId(null);
    setAnchor(null);
    setNodeHistory([]);
    startedAt.current = Date.now();
  };
  const saveDraft = (name = '') => {
    try {
      const records = savedRef.current;
      if (!editingId && records.length >= 20)
        throw new Error(
          '已保存 20 条轨迹，请先删除不需要的轨迹。当前草稿已保留。',
        );
      const prior = records.find((t) => t.id === editingId);
      const track = drawingRecord({
        segments: draftRef.current.segments,
        nodes: draftVertices(draftRef.current).slice(0, MAX_TRACK_POINTS),
        prior,
        id: crypto.randomUUID(),
        name: name || copyName || '',
        style,
        createdAt: startedAt.current,
        now: Date.now(),
        place: place?.place?.local,
      });
      const next = storeDrawingRecord(track, localStorage);
      savedRef.current = next;
      setSaved(next);
      resetDraft();
      select(null);
      setError('');
      setEditing(false);
      setDrawing(false);
      return true;
    } catch (error) {
      setError(
        error instanceof Error && error.name !== 'QuotaExceededError'
          ? `${error.message} 当前草稿已保留。`
          : '本机存储空间不足，当前草稿已保留，请释放空间后重试保存。',
      );
      return false;
    }
  };
  return {
    saveForMarker: () => {
      const priorIds = new Set(savedRef.current.map(t => t.id));
      const prior = editingId;
      if (!saveDraft()) return null;
      return prior ?? savedRef.current.find(t => !priorIds.has(t.id))?.id ?? null;
    },
    saved,
    overlaySaved,
    draft: draftState.segments,
    vertices,
    candidates,
    mode: 'points' as const,
    anchor,
    setAnchor,
    editingId,
    draftName: copyName,
    selectedId,
    select,
    nodeUndoId: nodeHistory.at(-1)?.id ?? null,
    moveNode: (node: TrackNode, to: Coordinate) => {
      if (!coordinate(to) || equalCoordinate(node.coordinate, to)) return false;
      if (node.trackId === DRAFT_ID) {
        const next = moveDraftNode(draftRef.current, node.coordinate, to);
        if (next === draftRef.current) return false;
        draftRef.current = next;
        setDraftState(next);
        if (anchor && equalCoordinate(anchor, node.coordinate)) setAnchor(to);
        select(DRAFT_ID);
        setError('');
        return true;
      }
      const track = saved.find((t) => t.id === node.trackId);
      if (
        !track ||
        keepsOriginalPoints(track) ||
        track.id === editingId ||
        !track.segments.some((line) =>
          line.some((p) => equalCoordinate(p, node.coordinate)),
        )
      )
        return false;
      const next = moveTrackNode(track, node.coordinate, to);
      if (!persist(saved.map((t) => (t.id === track.id ? next : t))))
        return false;
      setNodeHistory((history) => [...history.slice(-19), track]);
      select(track.id);
      setError('');
      return true;
    },
    undoNodeMove: () => {
      const prior = nodeHistory.at(-1);
      if (
        !prior ||
        prior.id === editingId ||
        !saved.some((t) => t.id === prior.id)
      )
        return;
      if (
        persist(
          saved.map((t) =>
            t.id === prior.id
              ? { ...t, segments: prior.segments, nodes: prior.nodes }
              : t,
          ),
        )
      ) {
        setNodeHistory((history) => history.slice(0, -1));
        setError('');
      }
    },
    rename: (id: string, name: string) => {
      const value = name.trim().slice(0, 60);
      if (value)
        persist(saved.map((t) => (t.id === id ? { ...t, name: value } : t)));
    },
    snapping,
    setSnapping,
    roadSnapping,
    setRoadSnapping: (enabled: boolean) => {
      setRoadSnapping(enabled);
      if (enabled) setRiverSnapping(false);
    },
    riverSnapping,
    setRiverSnapping: (enabled: boolean) => {
      setRiverSnapping(enabled);
      if (enabled) setRoadSnapping(false);
    },
    canUndo: draftState.history.length > 0,
    editing,
    drawing,
    rodLength: 48,
    style,
    visible,
    error,
    setVisible,
    setStyle: (next: TrackStyle) => {
      const value = normalizeTrackStyle(next);
      setStyle(value);
      try {
        localStorage.setItem(TRACK_STYLE_STORAGE, JSON.stringify(value));
      } catch {
        setError('线条样式已改变，但本机未能记住设置。');
      }
    },
    start: () => {
      select(DRAFT_ID);
      setEditing(true);
      setDrawing(true);
      setVisible(true);
      setError('');
    },
    startNew: (name = '') => {
      if (draftRef.current.segments.length && !saveDraft(name)) return false;
      resetDraft();
      select(DRAFT_ID);
      setEditing(true);
      setDrawing(true);
      setVisible(true);
      setError('');
      return true;
    },
    pause: () => setDrawing(false),
    resume: () => setDrawing(true),
    finish: () => {
      setDrawing(false);
      setEditing(false);
    },
    complete: () => {
      if (draftRef.current.segments.length) saveDraft();
      setDrawing(false);
      setEditing(false);
    },
    addStroke: (points: Coordinate[]) => {
      if (points.length >= 2 && withinLimit(points.length, true)) {
        setDraftState((d) => appendStroke(d, points));
        setAnchor(points.at(-1)!);
      }
    },
    addVertex: (point: Coordinate, section?: Coordinate[]) => {
      if (section?.length) {
        if (withinLimit(section.length + 1, true))
          setDraftState((d) => appendRoadVertex(d, section));
        return;
      }
      if (
        withinLimit(
          draftRef.current.pointLine === null &&
            draftRef.current.segments.length
            ? 2
            : 1,
          draftRef.current.pointLine === null,
        )
      )
        setDraftState((d) => appendVertex(d, point));
    },
    undo: () => {
      const next = undoDraft(draftRef.current);
      setDraftState(next);
      setAnchor(next.segments.at(-1)?.at(-1) ?? null);
    },
    clearDraft: () => {
      select(editingId);
      resetDraft();
      setError('');
    },
    continueTrack: (id: string) => {
      if (draftRef.current.segments.length && !saveDraft()) return false;
      const track = savedRef.current.find((t) => t.id === id);
      if (!track) return false;
      setCopyName(
        keepsOriginalPoints(track) ? `${track.name} · 手绘副本` : null,
      );
      const nextDraft = {
        segments: track.segments,
        kinds: track.segments.map(() => 'freehand' as const),
        history: [],
        pointLine: null,
        nodes: track.nodes,
      };
      draftRef.current = nextDraft;
      setDraftState(nextDraft);
      startedAt.current = Date.now();
      select(DRAFT_ID);
      setNodeHistory([]);
      // Editing a recorded/imported time series starts a copy; its original stays immutable.
      setEditingId(keepsOriginalPoints(track) ? null : id);
      setAnchor(track.segments.at(-1)?.at(-1) ?? null);
      setStyle(normalizeTrackStyle(track.style));
      setEditing(true);
      setDrawing(true);
      setVisible(true);
      setError('');
      return true;
    },
    save: saveDraft,
    remove: (id: string) => {
      if (persist(saved.filter((track) => track.id !== id))) {
        setNodeHistory((history) => history.filter((t) => t.id !== id));
        if (selectedId === id) select(null);
      }
    },
    reverseTrack: (id: string) => {
      if (saved.some((t) => t.id === id && keepsOriginalPoints(t))) return;
      if (
        persist(
          saved.map((track) =>
            track.id === id
              ? {
                  ...track,
                  ...(track.sharedRoute
                    ? {
                        sharedRoute: {
                          ...track.sharedRoute,
                          stops: track.sharedRoute.stops.slice().reverse(),
                        },
                      }
                    : {}),
                  segments: joinSegments(track.segments)
                    .reverse()
                    .map((line) => line.slice().reverse()),
                }
              : track,
          ),
        )
      )
        setNodeHistory([]);
    },
    mergeTrack: (id: string) => {
      const seed = saved.find((t) => t.id === id);
      if (!seed || keepsOriginalPoints(seed)) return;
      const connected = connectedTracks(
          seed,
          saved.filter((t) => !keepsOriginalPoints(t)),
        ),
        segments = joinSegments(connected.flatMap((t) => t.segments));
      if (connected.length < 2) {
        setError('没有端点相接的已保存线路；先开启吸附将端点接上。');
        return;
      }
      if (segments.length !== 1) {
        setError('存在分岔或未连接部分，请先编辑成连续线路再合并。');
        return;
      }
      if (segments[0].length > MAX_TRACK_POINTS) {
        setError('合并后点数超过 6000，暂不能合并。');
        return;
      }
      const ids = new Set(connected.map((t) => t.id));
      const merged = {
        ...seed,
        sharedRoute: undefined,
        segments,
        nodes: connected
          .flatMap((t) => t.nodes ?? [])
          .slice(0, MAX_TRACK_POINTS),
      };
      if (
        persist(
          saved
            .filter((t) => !ids.has(t.id) || t.id === seed.id)
            .map((t) => (t.id === seed.id ? merged : t)),
        )
      ) {
        setError('');
        setNodeHistory([]);
      }
    },
    updateStyle: (id: string, next: TrackStyle) =>
      persist(
        saved.map((track) =>
          track.id === id
            ? { ...track, style: normalizeTrackStyle(next) }
            : track,
        ),
      ),
  };
}
export type ManualTracksState = ReturnType<typeof useManualTracks>;
