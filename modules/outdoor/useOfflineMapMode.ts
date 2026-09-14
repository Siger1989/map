import { useEffect, useRef } from 'react';
import type { LayerSettings } from '../map/types';
import { offlineMapOnly } from './tileCache';
export function useOfflineMapMode(
  change: (patch: Partial<LayerSettings>) => void,
  clearSource: (id: string) => void,
) {
  const callbacks = useRef({ change, clearSource });
  callbacks.current = { change, clearSource };
  const open = () => {
    callbacks.current.clearSource('');
    callbacks.current.change({
      satellite: false,
      contours: false,
      clouds: false,
      rain: false,
      geology: false,
      elevationColors: false,
      roads: true,
      labels: true,
    });
  };
  useEffect(() => {
    if (offlineMapOnly()) open();
  }, []);
  return open;
}
