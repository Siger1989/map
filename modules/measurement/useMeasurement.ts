import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import { readElevation } from '../terrain/elevation';
import {
  MEASUREMENT_KEY,
  parseMeasurement,
  validHeight,
  validPoint,
  type MeasurePoint,
} from './data';

const PAIR_KEY = 'shantu.measurement.pair.v1';
/** A separate pair store preserves older polyline measurements unchanged. Heights always follow terrain. */
export function useMeasurement() {
  const [active, setActive] = useState(false),
    [slot, setSlot] = useState<0 | 1 | null>(0);
  const [points, setPoints] = useState<MeasurePoint[]>([]),
    [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(''),
    [reading, setReading] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<MeasurePoint[][]>([]);
  const current = useRef(points),
    ready = useRef(false),
    requests = useRef(new Map<string, AbortController>());
  const commit = (next: MeasurePoint[], history = true) => {
    if (!ready.current || next.length > 2 || !next.every(validPoint))
      return false;
    try {
      localStorage.setItem(
        PAIR_KEY,
        JSON.stringify({ version: 1, points: next }),
      );
    } catch {
      setError('测量尚未保存，请检查本机存储后重试');
      return false;
    }
    if (history) setUndoStack((s) => [...s.slice(-29), current.current]);
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
        saved ?? localStorage.getItem(MEASUREMENT_KEY),
      );
      const pair = legacy.length > 2 ? [legacy[0], legacy.at(-1)!] : legacy;
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
    index: 0 | 1,
    coordinates: Coordinate,
    height: number | null,
  ) => {
    if (!ready.current) return false;
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
  return {
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
      setSlot(
        current.current.length < 2 ? (current.current.length as 0 | 1) : null,
      );
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
    pick: (index: 0 | 1) => {
      setSlot(index);
      setSelected(current.current[index]?.id ?? null);
    },
    add: (coordinates: Coordinate, height: number | null) =>
      slot !== null && place(slot, coordinates, height),
    move: (id: string, coordinates: Coordinate, height: number | null) => {
      const index = current.current.findIndex((p) => p.id === id);
      return index >= 0 && place(index as 0 | 1, coordinates, height);
    },
    retryHeights: () =>
      current.current.filter((p) => p.altitude === null).forEach(fillHeight),
    clear: () => {
      if (commit([])) {
        abortReads();
        setSelected(null);
        setSlot(0);
      }
    },
    undo: () => {
      const prior = undoStack.at(-1);
      if (prior && commit(prior, false)) {
        abortReads();
        setUndoStack((s) => s.slice(0, -1));
        setSelected(prior.at(-1)?.id ?? null);
        setSlot(prior.length < 2 ? (prior.length as 0 | 1) : null);
        prior.filter((p) => p.altitude === null).forEach(fillHeight);
      }
    },
  };
}
export type MeasurementState = ReturnType<typeof useMeasurement>;
