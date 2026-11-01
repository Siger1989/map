import { useEffect, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import { readElevation } from '../terrain/elevation';

/** Read-only elevation at the selected marker position; never writes annotation or GPS data. */
export function useAnnotationCoordinateElevation(
  annotationId: string | undefined,
  coordinates: Coordinate | undefined,
  preview: boolean,
  cached: (point: Coordinate) => number | null,
) {
  const longitude = coordinates?.[0], latitude = coordinates?.[1];
  const key = `${annotationId ?? ''}:${longitude}:${latitude}:${preview}`;
  const [result, setResult] = useState({ key: '', elevation: null as number | null, status: '' });
  useEffect(() => {
    if (!annotationId || longitude === undefined || latitude === undefined || preview) return;
    const point: Coordinate = [longitude, latitude];
    const value = cached(point);
    if (value !== null && Number.isFinite(value)) {
      setResult({ key, elevation: value, status: '' });
      return;
    }
    const controller = new AbortController();
    setResult({ key, elevation: null, status: '查询中' });
    void readElevation(longitude, latitude, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]))
      .then((elevation) => {
        if (!controller.signal.aborted) setResult({ key, elevation: elevation !== null && Number.isFinite(elevation) ? elevation : null, status: '' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, elevation: null, status: '' });
      });
    return () => controller.abort();
  }, [annotationId, longitude, latitude, preview, cached, key]);
  // Do not show a previous marker's result at a new marker or during a drag.
  return result.key === key && !preview ? result : { elevation: null, status: preview ? '' : '查询中' };
}
