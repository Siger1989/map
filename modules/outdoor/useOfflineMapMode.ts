import { useEffect, useRef } from 'react';
import type { LayerSettings } from '../map/types';
import { offlineMapOnly, OFFLINE_MAP_KEY, setOfflineMapOnly } from './tileCache';
import { tripPackages, type TripPackage } from './offline';
import { readRasterDatums } from '../mapSources/coordinates';
export function useOfflineMapMode(
  change: (patch: Partial<LayerSettings>) => void,
  clearSource: (id: string) => void,
) {
  const callbacks = useRef({ change, clearSource });
  callbacks.current = { change, clearSource };
  const open = (trip?: TripPackage) => {
    if (trip) {
      try {
        const previousId=localStorage.getItem('shantu.offline-package.v1');
        const previousMode=localStorage.getItem(OFFLINE_MAP_KEY);
        try {
          localStorage.setItem('shantu.offline-package.v1',trip.id);
          localStorage.setItem(OFFLINE_MAP_KEY, 'true');
        } catch (error) {
          try {
            if (previousId===null) localStorage.removeItem('shantu.offline-package.v1');
            else localStorage.setItem('shantu.offline-package.v1',previousId);
            if (previousMode===null) localStorage.removeItem(OFFLINE_MAP_KEY);
            else localStorage.setItem(OFFLINE_MAP_KEY,previousMode);
          } catch { /* Preserve the original storage failure. */ }
          throw error;
        }
      } catch { throw new Error('缓存包选择未能保存，未切换离线地图'); }
      setOfflineMapOnly(true);
      callbacks.current.clearSource(trip.provider === 'imported' ? trip.sourceId ?? '' : '');
    }
    callbacks.current.change({
      contours: false,
      geology: false,
      elevationColors: false,
      ...(trip ? trip.display ?? { satellite:false,tiandituBase:'vec' as const,offlineBasemap:true,roads:true,labels:true,rasterLevel:null } : {}),
      ...(trip?.provider === 'imported' ? {
        terrain: false, offlineBasemap: false, rasterLevel: null,
        rasterDatums: { ...readRasterDatums(), ...(trip.sourceId && trip.datum ? { [`custom:${trip.sourceId}`]: trip.datum } : {}) },
      } : {}),
      offlineMaxZoom: trip ? trip.zoom ?? trip.display?.offlineMaxZoom ?? 14 : offlineMapOnly() ? 14 : null,
    });
  };
  useEffect(() => {
    const online = () => {
      let only = offlineMapOnly();
      try { only=localStorage.getItem(OFFLINE_MAP_KEY)==='true'; } catch {}
      let id=''; try { id=localStorage.getItem('shantu.offline-package.v1')??''; } catch {}
      const trip=tripPackages().find(p=>p.id===id);
      if (only && !trip) {
        only=false;
        try { localStorage.setItem(OFFLINE_MAP_KEY, 'false'); } catch {}
      }
      setOfflineMapOnly(only);
      let sourceId=''; try { sourceId=localStorage.getItem('shantu-selected-map')??''; } catch {}
      // Re-selecting the same ID advances useMapSources' revision and rebuilds
      // the raster source so cache-only changes take effect immediately.
      callbacks.current.clearSource(sourceId);
      callbacks.current.change({ offlineMaxZoom:only ? trip?.zoom ?? trip?.display?.offlineMaxZoom ?? 14 : null });
    };
    online();
    window.addEventListener('shantu:offline-map-mode',online);
    if (offlineMapOnly()) {
      let id='';try { id=localStorage.getItem('shantu.offline-package.v1')??''; } catch {}
      open(tripPackages().find(p=>p.id===id));
    }
    return () => window.removeEventListener('shantu:offline-map-mode',online);
  }, []);
  return open;
}
