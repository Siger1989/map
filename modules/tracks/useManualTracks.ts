import { useEffect, useMemo, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
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
  draftVertices,
  EMPTY_DRAFT,
  undoDraft,
  type DrawingMode,
} from './draft';
import {
  connectedTracks,
  endpoints,
  hasLoosePoints,
  joinSegments,
} from './snapping';
export function useManualTracks() {
  const [saved, setSaved] = useState<ManualTrack[]>([]);
  const [draftState, setDraftState] = useState(EMPTY_DRAFT);
  const draftRef = useRef(draftState);
  draftRef.current = draftState;
  const [mode, setMode] = useState<DrawingMode>('freehand');
  const [anchor, setAnchor] = useState<Coordinate | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [snapping, setSnapping] = useState(true);
  const [roadSnapping, setRoadSnapping] = useState(false);
  const [editing, setEditing] = useState(false),
    [drawing, setDrawing] = useState(false);
  const [rodLength, setRodLength] = useState(48);
  const [style, setStyle] = useState<TrackStyle>(DEFAULT_TRACK_STYLE);
  const [visible, setVisible] = useState(true),
    [error, setError] = useState('');
  const vertices = useMemo(() => draftVertices(draftState), [draftState]);
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
  const persist = (tracks: ManualTrack[]) => {
    try {
      localStorage.setItem(TRACK_STORAGE, JSON.stringify(tracks));
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
  return {
    saved,
    overlaySaved,
    draft: draftState.segments,
    vertices,
    candidates,
    mode,
    anchor,
    setAnchor,
    editingId,
    snapping,
    setSnapping,
    roadSnapping,
    setRoadSnapping,
    canUndo: draftState.history.length > 0,
    setMode: (next: DrawingMode) => {
      setMode(next);
      if (next === 'freehand')
        setAnchor(draftRef.current.segments.at(-1)?.at(-1) ?? null);
    },
    editing,
    drawing,
    rodLength,
    style,
    visible,
    error,
    setRodLength,
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
      setEditing(true);
      setDrawing(true);
      setVisible(true);
      setError('');
    },
    pause: () => setDrawing(false),
    resume: () => setDrawing(true),
    finish: () => {
      setDrawing(false);
      setEditing(false);
    },
    addStroke: (points: Coordinate[]) => {
      if (points.length >= 2 && withinLimit(points.length, true)) {
        setDraftState((d) => appendStroke(d, points));
        setAnchor(points.at(-1)!);
      }
    },
    addVertex: (point: Coordinate) => {
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
      setDraftState(EMPTY_DRAFT);
      setAnchor(null);
      setEditingId(null);
      setError('');
    },
    continueTrack: (id: string) => {
      if (draftRef.current.segments.length) {
        setError('请先保存或清空当前草稿，再续画其他线路。');
        return false;
      }
      const track = saved.find((t) => t.id === id);
      if (!track) return false;
      setDraftState({
        segments: track.segments,
        kinds: track.segments.map(() => 'freehand'),
        history: [],
        pointLine: null,
      });
      setEditingId(id);
      setAnchor(track.segments.at(-1)?.at(-1) ?? null);
      setMode('freehand');
      setStyle(normalizeTrackStyle(track.style));
      setEditing(true);
      setDrawing(true);
      setVisible(true);
      setError('');
      return true;
    },
    save: (name: string) => {
      if (
        !draftState.segments.some((line) => line.length >= 2) ||
        hasLoosePoints(draftState.segments)
      ) {
        setError('每段至少需要两个位置，请继续点选或撤销孤立点。');
        return false;
      }
      if (!editingId && saved.length >= 20) {
        setError('已保存 20 条轨迹，请先删除不需要的轨迹。');
        return false;
      }
      const prior = saved.find((t) => t.id === editingId);
      const track: ManualTrack = {
        id: prior?.id ?? crypto.randomUUID(),
        name:
          name.trim().slice(0, 60) ||
          prior?.name ||
          `手绘轨迹 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
        segments: joinSegments(draftState.segments),
        createdAt: prior?.createdAt ?? Date.now(),
        style,
        nodes: [...(prior?.nodes ?? []), ...vertices].slice(
          0,
          MAX_TRACK_POINTS,
        ),
      };
      if (
        !persist(
          prior
            ? saved.map((t) => (t.id === prior.id ? track : t))
            : [...saved, track],
        )
      )
        return false;
      setDraftState(EMPTY_DRAFT);
      setEditingId(null);
      setAnchor(null);
      setError('');
      setEditing(false);
      setDrawing(false);
      return true;
    },
    remove: (id: string) => persist(saved.filter((track) => track.id !== id)),
    reverseTrack: (id: string) =>
      persist(
        saved.map((track) =>
          track.id === id
            ? {
                ...track,
                segments: joinSegments(track.segments)
                  .reverse()
                  .map((line) => line.slice().reverse()),
              }
            : track,
        ),
      ),
    mergeTrack: (id: string) => {
      const seed = saved.find((t) => t.id === id);
      if (!seed) return;
      const connected = connectedTracks(seed, saved),
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
      )
        setError('');
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
