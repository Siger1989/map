import { useEffect, useRef, useState } from 'react';
import {
  SAVED_MEASUREMENTS_KEY,
  parseSavedMeasurements,
  saveMeasurement,
  writeSavedMeasurements,
  type SavedMeasurement,
} from './saved';
import type { MeasurePoint } from './data';

export function useSavedMeasurements() {
  const [items, setItems] = useState<SavedMeasurement[]>([]),
    [error, setError] = useState('');
  const current = useRef(items),
    ready = useRef(false);
  const [removed, setRemoved] = useState<SavedMeasurement | null>(null);
  useEffect(() => {
    try {
      current.current = parseSavedMeasurements(
        localStorage.getItem(SAVED_MEASUREMENTS_KEY),
      );
      setItems(current.current);
      ready.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取已保存测量');
    }
  }, []);
  const commit = (next: SavedMeasurement[]) => {
    if (!ready.current) return false;
    try {
      writeSavedMeasurements(localStorage, next);
      current.current = next;
      setItems(next);
      setError('');
      return true;
    } catch {
      setError('保存到地图失败，请检查本机存储后重试；原记录已保留');
      return false;
    }
  };
  return {
    items,
    error,
    ready: ready.current,
    canRestore: !!removed,
    save: (points: MeasurePoint[], id: string) => {
      try {
        return commit(saveMeasurement(current.current, points, id, Date.now()));
      } catch (e) {
        setError(e instanceof Error ? e.message : '无法保存测量');
        return false;
      }
    },
    remove: (id: string) => {
      const item = current.current.find((p) => p.id === id);
      if (item && commit(current.current.filter((p) => p.id !== id)))
        setRemoved(item);
    },
    restore: () => {
      if (
        removed &&
        !current.current.some((p) => p.id === removed.id) &&
        commit([...current.current, removed])
      )
        setRemoved(null);
    },
  };
}
