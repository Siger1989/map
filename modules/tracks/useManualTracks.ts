import { createTrackNodeCommands } from './nodeCommands';
import { legacyColorNote, reverseDrawing } from './legacyArchiveActions';
import { useEffect, useMemo, useRef, useState } from 'react';
import { coordinate, type Coordinate } from '../navigation/types';
import { keepsOriginalPoints } from './provenance';
import { storeRouteEdit, type RouteEditSession } from './routeEdit';
import { usePlaceName } from '../navigation/usePlaceName';
import { drawingRecord, storeDrawingRecord } from './archive';
import { inheritEdgeColors } from './edgeColors';
import { editSection } from './sections';
import {
  assignNewEdges,
  draftFromTrack,
  readDrawingCheckpoint,
  writeDrawingCheckpoint,
} from './drawingCheckpoint';
import { collectData } from '../outdoor/exchange';
import { saveWorkbench } from '../collections/workbenchStore';
import { mergeTrackArchives } from './mergeArchives';
import { storeJoinedRouteEdit } from './joinedEditStore';
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
  branchDraft,
} from './draft';
import { endpoints, draftSnapNodes } from './snapping';
export function useManualTracks() {
  const [saved, setSaved] = useState<ManualTrack[]>([]);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const startedAt = useRef(Date.now());
  const sectionId = useRef('');
  const baseRevision = useRef<string | undefined>(undefined),
    outputId = useRef('');
  const [draftNote, setDraftNote] = useState('');
  const [draftReady, setDraftReady] = useState(false);
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
      ...draftSnapNodes(draftState.segments),
      ...saved
        .filter((t) => !t.hidden)
        .flatMap((t) => [...endpoints(t.segments), ...(t.nodes ?? [])]),
    ],
    [draftState.segments, saved],
  );
  const overlaySaved = useMemo(
    () => saved.filter((t) => t.id !== editingId && !t.hidden),
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
    try {
      const checkpoint = readDrawingCheckpoint(
        localStorage.getItem('shantu.drawing-draft.v1'),
      );
      if (checkpoint) {
        draftRef.current = checkpoint.draft;
        setDraftState(checkpoint.draft);
        setStyle(checkpoint.style);
        setCopyName(checkpoint.name);
        setEditingId(checkpoint.editingId);
        startedAt.current = checkpoint.startedAt;
        sectionId.current = checkpoint.sectionId;
        setDraftNote(checkpoint.note);
        baseRevision.current = checkpoint.baseRevision;
        outputId.current = checkpoint.outputId ?? crypto.randomUUID();
      }
      setDraftReady(true);
    } catch {
      setError(
        '上次绘制草稿无法读取，原备份保留；为避免覆盖，暂不开始新绘制。',
      );
    }
  }, []);
  useEffect(() => {
    if (!draftReady) return;
    try {
      writeDrawingCheckpoint(
        {
          draft: draftState,
          style,
          name: copyName,
          editingId,
          startedAt: startedAt.current,
          sectionId: sectionId.current,
          note: draftNote,
          baseRevision: baseRevision.current,
          outputId: outputId.current,
        },
        localStorage,
      );
    } catch {
      setError('草稿仍在当前窗口，自动备份失败；请先保存路线。');
    }
  }, [draftReady, draftState, style, copyName, editingId, draftNote]);
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
      const raw = JSON.stringify(tracks);
      localStorage.setItem(TRACK_STORAGE, raw);
      if (localStorage.getItem(TRACK_STORAGE) !== raw)
        throw new Error('存档写入未确认');
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
    sectionId.current = crypto.randomUUID();
    outputId.current = crypto.randomUUID();
    baseRevision.current = undefined;
    setDraftNote('');
    draftRef.current = EMPTY_DRAFT;
    setDraftState(EMPTY_DRAFT);
    setCopyName(null);
    setEditingId(null);
    setAnchor(null);
    setNodeHistory([]);
    startedAt.current = Date.now();
  };
  const draftAvailable = () => {
    if (!draftReady) setError('上次绘制草稿尚未恢复，原备份保留。');
    return draftReady;
  };
  const saveDraft = (name = '', selectSaved = false) => {
    if (!draftAvailable()) return false;
    try {
      const records = parseSavedTracks(localStorage.getItem(TRACK_STORAGE));
      const prior = records.find((t) => t.id === editingId);
      if (
        editingId &&
        (!prior ||
          !baseRevision.current ||
          JSON.stringify(prior) !== baseRevision.current)
      )
        throw new Error('原路线已改变，请先导出当前草稿再重新打开');
      const track = drawingRecord({
        segments: draftRef.current.segments,
        edgeColors: draftRef.current.edgeColors,
        colorConditions: draftRef.current.colorConditions,
        sections: draftRef.current.sections,
        nodes: draftVertices(draftRef.current).slice(0, MAX_TRACK_POINTS),
        prior,
        id: (outputId.current ||= crypto.randomUUID()),
        name: name || copyName || '',
        style,
        createdAt: startedAt.current,
        now: Date.now(),
        place: place?.place?.local,
      });
      const next = storeDrawingRecord(track, localStorage);
      savedRef.current = next;
      setSaved(next);
      baseRevision.current = JSON.stringify(track);
      writeDrawingCheckpoint(
        {
          draft: draftRef.current,
          style,
          name: copyName,
          editingId,
          startedAt: startedAt.current,
          sectionId: sectionId.current,
          note: draftNote,
          outputId: track.id,
          completed: track.id,
        },
        localStorage,
      );
      resetDraft();
      select(selectSaved ? track.id : null);
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
  const draftTrack = (): ManualTrack => ({
    id: DRAFT_ID,
    name: copyName || '路线草稿',
    createdAt: startedAt.current,
    source: 'manual',
    style,
    segments: draftRef.current.segments,
    edgeColors: draftRef.current.edgeColors,
    colorConditions: draftRef.current.colorConditions,
    sections: draftRef.current.sections,
    nodes: draftVertices(draftRef.current),
  });
  const applyDraft = (next: typeof EMPTY_DRAFT) => {
    draftRef.current = next;
    setDraftState(next);
    setAnchor(next.segments.at(-1)?.at(-1) ?? null);
    setError('');
  };
  return {
    commitEdit: (session: RouteEditSession) => {
      try {
        if (session.original.id === DRAFT_ID) {
          applyDraft({
            ...draftFromTrack(session.track),
            history: [
              ...draftRef.current.history,
              {
                kind: 'move',
                segments: draftRef.current.segments,
                nodes: draftRef.current.nodes,
                kinds: draftRef.current.kinds,
                pointLine: draftRef.current.pointLine,
                edgeColors: draftRef.current.edgeColors,
                sections: draftRef.current.sections,
              },
            ],
          });
          setEditing(true);
          setDrawing(true);
          return { track: session.track, removed: false, error: '' };
        }
        const save = session.sources.some((s) => s.id !== session.original.id)
          ? storeJoinedRouteEdit
          : storeRouteEdit;
        const result = save(
          session,
          localStorage,
          crypto.randomUUID(),
          Date.now(),
        );
        savedRef.current = result.records;
        setSaved(result.records);
        if (session.original.id === DRAFT_ID) resetDraft();
        select(result.removed ? null : result.track.id);
        setEditing(false);
        setDrawing(false);
        setError('');
        return { track: result.track, removed: result.removed, error: '' };
      } catch (e) {
        const message =
          e instanceof Error ? e.message : '保存失败，当前编辑已保留。';
        return { track: null, error: message };
      }
    },
    showTrack: (id: string, show = true) =>
      persist(
        savedRef.current.map((t) =>
          t.id === id ? { ...t, hidden: !show } : t,
        ),
      ),
    ...createTrackNodeCommands({
      draftRef,
      savedRef,
      draftTrack,
      applyDraft,
      persist,
      setNodeHistory,
      setError,
      setDraftState,
      select,
    }),
    branchFrom: (node: TrackNode) => {
      if (!draftAvailable()) return false;
      try {
        if (node.trackId === DRAFT_ID) {
          if (!withinLimit(1, true)) return false;
          applyDraft(branchDraft(draftRef.current, node.coordinate));
          setAnchor(node.coordinate);
          select(DRAFT_ID);
          setDrawing(true);
          setEditing(true);
          setVisible(true);
          return true;
        }
        if (draftRef.current.segments.length)
          throw new Error('请先处理已有绘制草稿。');
        const track = savedRef.current.find((t) => t.id === node.trackId);
        if (!track || keepsOriginalPoints(track))
          throw new Error('请选择手绘路线节点。');
        if (
          track.segments.length >= 100 ||
          track.segments.flat().length >= MAX_TRACK_POINTS
        )
          throw new Error('路线已达100段或6000点。');
        const next = branchDraft(draftFromTrack(track), node.coordinate);
        draftRef.current = next;
        setDraftState(next);
        setEditingId(track.id);
        baseRevision.current = JSON.stringify(track);
        outputId.current = crypto.randomUUID();
        setCopyName(null);
        setAnchor(node.coordinate);
        setStyle(normalizeTrackStyle(track.style));
        select(DRAFT_ID);
        setDrawing(true);
        setEditing(true);
        setVisible(true);
        setError('');
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    },
    saveForMarker: () => {
      const priorIds = new Set(savedRef.current.map((t) => t.id));
      const prior = editingId;
      if (!saveDraft()) return null;
      return (
        prior ?? savedRef.current.find((t) => !priorIds.has(t.id))?.id ?? null
      );
    },
    saved,
    overlaySaved,
    draft: draftState.segments,
    edgeColors: draftState.edgeColors,
    colorConditions: draftState.colorConditions,
    sections: draftState.sections,
    draftTrack,
    draftNote,
    setDraftCondition: (value: string) => {
      const note = value.slice(0, 1600);
      setDraftNote(note);
      const sections = draftRef.current.sections;
      if (sections?.edges.some((row) => row.includes(sectionId.current)))
        applyDraft({
          ...draftRef.current,
          sections: {
            ...sections,
            notes: { ...sections.notes, [sectionId.current]: note },
          },
        });
    },
    setDraftName: (value: string) => setCopyName(value.slice(0, 60)),
    beginSection: () => {
      sectionId.current = crypto.randomUUID();
      setDraftNote('');
    },
    editDraftSection: (id: string, color: string, note: string) =>
      applyDraft({
        ...draftRef.current,
        ...editSection(draftTrack(), id, color, note),
      }),
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
              ? {
                  ...t,
                  segments: prior.segments,
                  nodes: prior.nodes,
                  sharedRoute: prior.sharedRoute,
                  updatedAt: Date.now(),
                }
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
    setStyle: (next: TrackStyle, preserveExisting = true) => {
      const value = normalizeTrackStyle(next);
      if (value.color !== style.color) {
        sectionId.current = crypto.randomUUID();
        setDraftNote('');
        const draft = {
          ...draftRef.current,
          edgeColors: preserveExisting
            ? inheritEdgeColors(
                draftRef.current.segments,
                [{ ...draftRef.current, style }],
                style.color,
              )
            : undefined,
        };
        draftRef.current = draft;
        setDraftState(draft);
      }
      setStyle(value);
      try {
        localStorage.setItem(TRACK_STYLE_STORAGE, JSON.stringify(value));
      } catch {
        setError('线条样式已改变，但本机未能记住设置。');
      }
    },
    start: () => {
      if (!draftAvailable()) return false;
      select(DRAFT_ID);
      setEditing(true);
      setDrawing(true);
      setVisible(true);
      setError('');
    },
    startNew: (name = '') => {
      if (!draftAvailable()) return false;
      if (draftRef.current.segments.length) {
        setError('请先继续、保留或放弃已有草稿。');
        return false;
      }
      const note = draftNote;
      resetDraft();
      setCopyName(name);
      setDraftNote(note);
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
      if (draftRef.current.segments.length && !saveDraft('', true))
        return false;
      setDrawing(false);
      setEditing(false);
      setError('');
      return true;
    },
    addStroke: (points: Coordinate[]) => {
      if (points.length >= 2 && withinLimit(points.length, true)) {
        sectionId.current ||= crypto.randomUUID();
        applyDraft(
          assignNewEdges(
            appendStroke(draftRef.current, points),
            style.color,
            sectionId.current,
            draftNote,
          ),
        );
        setAnchor(points.at(-1)!);
      }
    },
    addVertex: (point: Coordinate, section?: Coordinate[]) => {
      sectionId.current ||= crypto.randomUUID();
      if (section?.length) {
        if (withinLimit(section.length + 1, true))
          applyDraft(
            assignNewEdges(
              appendRoadVertex(draftRef.current, section),
              style.color,
              sectionId.current,
              draftNote,
            ),
          );
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
        applyDraft(
          assignNewEdges(
            appendVertex(draftRef.current, point),
            style.color,
            sectionId.current,
            draftNote,
          ),
        );
    },
    undo: () => {
      const next = undoDraft(draftRef.current);
      applyDraft(next);
    },
    clearDraft: () => {
      if (!draftAvailable()) return false;
      try {
        localStorage.removeItem('shantu.drawing-draft.v1');
        if (localStorage.getItem('shantu.drawing-draft.v1') !== null)
          throw new Error();
        select(editingId);
        resetDraft();
        setError('');
        return true;
      } catch {
        setError('草稿备份未能清除，当前绘制已保留');
        return false;
      }
    },
    continueTrack: (id: string) => {
      if (!draftAvailable()) return false;
      if (draftRef.current.segments.length) {
        setError('请先处理已有绘制草稿。');
        return false;
      }
      const track = savedRef.current.find((t) => t.id === id);
      if (!track) return false;
      setCopyName(
        keepsOriginalPoints(track) ? `${track.name} · 手绘副本` : null,
      );
      const nextDraft = draftFromTrack(track);
      sectionId.current = crypto.randomUUID();
      setDraftNote('');
      draftRef.current = nextDraft;
      setDraftState(nextDraft);
      startedAt.current = Date.now();
      select(DRAFT_ID);
      setNodeHistory([]);
      // Editing a recorded/imported time series starts a copy; its original stays immutable.
      setEditingId(keepsOriginalPoints(track) ? null : id);
      baseRevision.current = JSON.stringify(track);
      outputId.current = crypto.randomUUID();
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
        return true;
      }
      return false;
    },
    reverseTrack: (id: string) => {
      if (saved.some((t) => t.id === id && keepsOriginalPoints(t))) return;
      if (persist(saved.map((t) => (t.id === id ? reverseDrawing(t) : t))))
        setNodeHistory([]);
    },
    mergeTrack: (id: string) => {
      try {
        const before = collectData();
        const next = saveWorkbench(before, mergeTrackArchives(before, id));
        savedRef.current = next.tracks;
        setSaved(next.tracks);
        select(id);
        setError('');
        setNodeHistory([]);
      } catch (e) {
        setError(e instanceof Error ? e.message : '合并未保存');
      }
    },
    setColorCondition: (id: string, color: string, value: string) => {
      try {
        return persist(legacyColorNote(id, color, value, localStorage));
      } catch (e) {
        setError(e instanceof Error ? e.message : '备注未保存');
        return false;
      }
    },
    updateStyle: (id: string, next: TrackStyle) =>
      persist(
        saved.map((track) =>
          track.id === id
            ? {
                ...track,
                style: normalizeTrackStyle(next),
                edgeColors:
                  normalizeTrackStyle(next).color !==
                  normalizeTrackStyle(track.style).color
                    ? undefined
                    : track.edgeColors,
              }
            : track,
        ),
      ),
  };
}
export type ManualTracksState = ReturnType<typeof useManualTracks>;
