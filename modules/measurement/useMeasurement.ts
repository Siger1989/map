import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import type { Pose } from '../objectTransform/math';
import { readElevation } from '../terrain/elevation';
import { MAX_POINTS, MEASUREMENT_KEY, parseMeasurement, validHeight, validPoint, type MeasurePoint } from './data';

/** Owns one saved measuring sketch; never writes tracks, markers or collection stores. */
export function useMeasurement() {
  const [active, setActive] = useState(false), [adding, setAdding] = useState(true);
  const [points, setPoints] = useState<MeasurePoint[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(''), [preview, setPreview] = useState<Pose | null>(null);
  const [undoStack, setUndoStack] = useState<MeasurePoint[][]>([]);
  const current = useRef(points), requests = useRef(new Map<string, AbortController>());
  const ready = useRef(false);
  const commit = (next: MeasurePoint[], history = true) => {
    if (next.length > MAX_POINTS || !next.every(validPoint)) { setError('坐标或海拔超出支持范围'); return false; }
    try { localStorage.setItem(MEASUREMENT_KEY, JSON.stringify({ version: 1, points: next })); }
    catch { setError('测量尚未保存，请检查本机存储后重试'); return false; }
    if (history) setUndoStack(s => [...s.slice(-29), current.current]);
    current.current = next; setPoints(next); setError(''); return true;
  };
  useEffect(() => {
    try { current.current = parseMeasurement(localStorage.getItem(MEASUREMENT_KEY)); setPoints(current.current); ready.current = true; }
    catch (e) { setError(e instanceof Error ? e.message : '无法读取测量'); }
    return () => { requests.current.forEach(r => r.abort()); requests.current.clear(); };
  }, []);
  const fillHeight = (point: MeasurePoint) => {
    const request = new AbortController(); requests.current.set(point.id, request);
    void readElevation(...point.coordinates, AbortSignal.any([request.signal, AbortSignal.timeout(12000)]))
      .then(height => {
        if (request.signal.aborted || !validHeight(height)) return;
        const live = current.current.find(p => p.id === point.id);
        if (!live || live.altitude !== null || live.coordinates.join() !== point.coordinates.join()) return;
        commit(current.current.map(p => p.id === point.id ? { ...p, altitude: height, heightSource: 'terrain' } : p), false);
      }).catch(() => { /* Unknown height stays explicit; numeric input remains available. */ })
      .finally(() => requests.current.delete(point.id));
  };
  return { active, adding, points, selected, error, preview, setPreview, canUndo: undoStack.length > 0,
    open: () => { setActive(true); setAdding(!current.current.length); setSelected(current.current.at(-1)?.id ?? null); },
    close: () => { setActive(false); setPreview(null); },
    select: (id: string) => { setSelected(id); setAdding(false); setPreview(null); },
    setAdding,
    add: (coordinates: Coordinate, height: number | null) => {
      if (!ready.current) return;
      if (current.current.length >= MAX_POINTS) { setError(`每次测量最多 ${MAX_POINTS} 个点`); return; }
      const p: MeasurePoint = { id: crypto.randomUUID(), coordinates: [...coordinates], altitude: validHeight(height) ? height : null, heightSource: validHeight(height) ? 'terrain' : 'unknown' };
      if (commit([...current.current, p])) { setSelected(p.id); if (p.altitude === null) fillHeight(p); }
    },
    update: (id: string, patch: Partial<Pick<MeasurePoint, 'coordinates' | 'altitude'>>) => {
      if (!ready.current) return false;
      return commit(current.current.map(p => p.id === id ? { ...p, ...patch, heightSource: ((patch.altitude === undefined ? p.altitude : patch.altitude) === null ? 'unknown' : 'manual') } : p));
    },
    remove: () => { if (selected && commit(current.current.filter(p => p.id !== selected))) setSelected(null); },
    clear: () => { if (!ready.current) return; if (commit([])) { setSelected(null); setAdding(true); setPreview(null); } },
    undo: () => { const prior = undoStack.at(-1); if (prior && commit(prior, false)) { setUndoStack(s => s.slice(0, -1)); setSelected(prior.at(-1)?.id ?? null); setPreview(null); } },
  };
}
export type MeasurementState = ReturnType<typeof useMeasurement>;
