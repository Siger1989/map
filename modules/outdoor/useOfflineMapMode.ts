import { useEffect, useRef } from 'react';
import type { LayerSettings } from '../map/types';
import { offlineMapOnly } from './tileCache';
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
      callbacks.current.clearSource(trip.provider === 'imported' ? trip.sourceId ?? '' : '');
      try { localStorage.setItem('shantu.offline-package.v1',trip.id); } catch {}
    }
    callbacks.current.change({
      temperature: false,
      contours: false,
      clouds: false,
      rain: false,
      geology: false,
      elevationColors: false,
      ...(trip ? trip.display ?? { satellite:false,tiandituBase:'vec' as const,offlineBasemap:true,roads:true,labels:true,rasterLevel:null } : {}),
      ...(trip?.provider === 'imported' ? {
        terrain: false, offlineBasemap: false, rasterLevel: null,
        rasterDatums: { ...readRasterDatums(), ...(trip.sourceId && trip.datum ? { [`custom:${trip.sourceId}`]: trip.datum } : {}) },
      } : {}),
      offlineMaxZoom: offlineMapOnly() ? trip?.zoom ?? trip?.display?.offlineMaxZoom ?? 14 : null,
    });
  };
  useEffect(() => {
    const online = () => {
      let id=''; try { id=localStorage.getItem('shantu.offline-package.v1')??''; } catch {}
      const trip=tripPackages().find(p=>p.id===id);
      callbacks.current.change({ offlineMaxZoom:offlineMapOnly() ? trip?.zoom ?? trip?.display?.offlineMaxZoom ?? 14 : null });
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
