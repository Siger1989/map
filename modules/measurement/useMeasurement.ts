import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import { readElevation } from '../terrain/elevation';
import {
  MEASUREMENT_KEY,
  MAX_POINTS,
  removeMeasurePoint,
  parseMeasurement,
  validHeight,
  validPoint,
  type MeasurePoint,
} from './data';
import { useSavedMeasurements } from './useSavedMeasurements';
import { copyPoints, type SavedMeasurement } from './saved';

const PAIR_KEY = 'shantu.measurement.path.v1';
/** A separate pair store preserves older polyline measurements unchanged. Heights always follow terrain. */
export function useMeasurement() {
  const saved = useSavedMeasurements();
  const [active, setActive] = useState(false),
    [slot, setSlot] = useState<number | null>(0);
  const [points, setPoints] = useState<MeasurePoint[]>([]),
    [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(''),
    [reading, setReading] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<
    { points: MeasurePoint[]; recordId: string | null }[]
  >([]);
  const currentRecord = useRef<string | null>(null);
  const current = useRef(points),
    ready = useRef(false),
    requests = useRef(new Map<string, AbortController>());
  const commit = (
    next: MeasurePoint[],
    history = true,
    recordId: string | null = currentRecord.current,
  ) => {
    if (!ready.current || next.length > MAX_POINTS || !next.every(validPoint))
      return false;
    try {
      localStorage.setItem(
        PAIR_KEY,
        JSON.stringify({ version: 1, points: next, savedId: recordId }),
      );
    } catch {
      setError('测量尚未保存，请检查本机存储后重试');
      return false;
    }
    if (history)
      setUndoStack((s) => [
        ...s.slice(-29),
        { points: current.current, recordId: currentRecord.current },
      ]);
    currentRecord.current = recordId;
    current.current = next;
    setPoints(next);
    setError('');
    return true;
  };
  const abortReads = () => {
    requests.current.forEach((r) => r.abort());
    requests.current.clear();
    setReading([]);
  };
  const fillHeight = (point: MeasurePoint) => {
    requests.current.get(point.id)?.abort();
    const request = new AbortController();
    requests.current.set(point.id, request);
    setReading((s) => [...new Set([...s, point.id])]);
    void readElevation(
      ...point.coordinates,
      AbortSignal.any([request.signal, AbortSignal.timeout(12000)]),
    )
      .then((height) => {
        if (request.signal.aborted || !validHeight(height)) return;
        const live = current.current.find((p) => p.id === point.id);
        if (!live || live.coordinates.join() !== point.coordinates.join())
          return;
        commit(
          current.current.map((p) =>
            p.id === point.id
              ? { ...p, altitude: height, heightSource: 'terrain' }
              : p,
          ),
          false,
        );
      })
      .catch(() => {
        /* Missing terrain height is shown explicitly, never replaced by zero. */
      })
      .finally(() => {
        if (requests.current.get(point.id) === request) {
          requests.current.delete(point.id);
          setReading((s) => s.filter((id) => id !== point.id));
        }
      });
  };
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PAIR_KEY);
      const legacy = parseMeasurement(
        saved ??
          localStorage.getItem('shantu.measurement.pair.v1') ??
          localStorage.getItem(MEASUREMENT_KEY),
      );
      const id = saved ? JSON.parse(saved).savedId : null;
      currentRecord.current =
        typeof id === 'string' && id.length <= 100 ? id : null;
      const pair = legacy;
      current.current = pair.map((p) => ({
        ...p,
        altitude: p.heightSource === 'terrain' ? p.altitude : null,
        heightSource: p.heightSource === 'terrain' ? 'terrain' : 'unknown',
      }));
      setPoints(current.current);
      ready.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取测量');
    }
    return () => {
      requests.current.forEach((r) => r.abort());
      requests.current.clear();
    };
  }, []);
  const place = (
    index: number,
    coordinates: Coordinate,
    height: number | null,
  ) => {
    if (!ready.current || index < 0 || index >= MAX_POINTS) return false;
    const actual = Math.min(index, current.current.length);
    const id = current.current[actual]?.id ?? crypto.randomUUID();
    requests.current.get(id)?.abort();
    const p: MeasurePoint = {
      id,
      coordinates: [...coordinates],
      altitude: validHeight(height) ? height : null,
      heightSource: validHeight(height) ? 'terrain' : 'unknown',
    };
    const next = [...current.current];
    next[actual] = p;
    if (!commit(next)) return false;
    setSelected(id);
    setSlot(next.length < 2 ? 1 : null);
    if (p.altitude === null) fillHeight(p);
    return true;
  };
  const record = saved.items.find((item) =>
    currentRecord.current
      ? item.id === currentRecord.current
      : item.points.some((p) => points.some((point) => point.id === p.id)),
  );
  return {
    saved,
    record,
    isSaved:
      !!record && JSON.stringify(record.points) === JSON.stringify(points),
    saveToMap: () => {
      if (record && current.current.length < 2) {
        if (!saved.remove(record.id)) return false;
        return commit(current.current, false, null);
      }
      const id = record?.id ?? currentRecord.current ?? crypto.randomUUID();
      if (!commit(current.current, false, id)) return false;
      return saved.save(current.current, id);
    },
    removeSelected: () => {
      const index = current.current.findIndex((p) => p.id === selected);
      if (index < 0) return;
      const id = current.current[index].id,
        next = removeMeasurePoint(current.current, id);
      if (!commit(next, true, record?.id ?? currentRecord.current)) return;
      requests.current.get(id)?.abort();
      requests.current.delete(id);
      setReading((s) => s.filter((p) => p !== id));
      setSelected(next[Math.min(index, next.length - 1)]?.id ?? null);
      setSlot(next.length < 2 ? next.length : null);
    },
    load: (item: SavedMeasurement) => {
      if (!commit(copyPoints(item.points), false, item.id)) return false;
      abortReads();
      setUndoStack([]);
      setSelected(item.points.at(-1)!.id);
      setSlot(null);
      setActive(true);
      current.current.filter((p) => p.altitude === null).forEach(fillHeight);
      return true;
    },
    active,
    adding: slot !== null,
    slot,
    points,
    selected,
    error,
    reading,
    canUndo: undoStack.length > 0,
    open: () => {
      setActive(true);
      setSlot(current.current.length < 2 ? current.current.length : null);
      setSelected(current.current.at(-1)?.id ?? null);
      current.current.filter((p) => p.altitude === null).forEach(fillHeight);
    },
    close: () => {
      setActive(false);
    },
    select: (id: string) => {
      setSelected(id);
      setSlot(null);
    },
    pick: (index: number) => {
      if (index >= MAX_POINTS) {
        setError('最多添加200个测量点');
        return;
      }
      setSlot(index);
      setSelected(current.current[index]?.id ?? null);
    },
    add: (coordinates: Coordinate, height: number | null) =>
      slot !== null && place(slot, coordinates, height),
    move: (id: string, coordinates: Coordinate, height: number | null) => {
      const index = current.current.findIndex((p) => p.id === id);
      return index >= 0 && place(index, coordinates, height);
    },
    retryHeights: () =>
      current.current.filter((p) => p.altitude === null).forEach(fillHeight),
    clear: () => {
      if (commit([], true, null)) {
        abortReads();
        setSelected(null);
        setSlot(0);
      }
    },
    undo: () => {
      const prior = undoStack.at(-1);
      if (prior && commit(prior.points, false, prior.recordId)) {
        abortReads();
        setUndoStack((s) => s.slice(0, -1));
        setSelected(prior.points.at(-1)?.id ?? null);
        setSlot(prior.points.length < 2 ? prior.points.length : null);
        prior.points.filter((p) => p.altitude === null).forEach(fillHeight);
      }
    },
  };
}
export type MeasurementState = ReturnType<typeof useMeasurement>;
