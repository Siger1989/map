import { lazy, Suspense, useContext, useState } from 'react';
import { Mountain, Sunrise } from 'lucide-react';
import { OpenMarkerSky } from './markerView';
import type { Coordinate } from '../navigation/types';
import './markerSolarTimeline.css';

const LiveMarkerSolarDay = lazy(() => import('./LiveMarkerSolarDay'));
const STORAGE_PREFIX = 'shantu.marker-solar-timeline.v1:';

function readPreference(key: string) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

interface Props {
  markerId: string;
  coordinates: Coordinate;
  markerName: string;
}

function MarkerSolarToggle({ markerId, coordinates, markerName }: Props) {
  const openSky = useContext(OpenMarkerSky);
  const storageKey = STORAGE_PREFIX + markerId;
  const [enabled, setEnabled] = useState(() => readPreference(storageKey));
  const [lng, lat] = coordinates;
  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    try {
      if (next) localStorage.setItem(storageKey, '1');
      else localStorage.removeItem(storageKey);
    } catch { /* The open panel still works when storage is unavailable. */ }
  };
  return <div className="marker-solar-timeline">
    <div className="marker-solar-actions">
      <button type="button" className="marker-solar-switch" role="switch" aria-checked={enabled} onClick={toggle}>
        <Sunrise size={13} aria-hidden="true" />
        <span>日出日落时间轴</span>
        <i aria-hidden="true" />
      </button>
      {openSky && (
        <button className="marker-sky-open" type="button"
          onClick={() => openSky({ coordinates: [lng, lat], markerName: markerName.trim() || '未命名标记' })}>
          <Mountain size={13} aria-hidden="true" />从此处观景
        </button>
      )}
    </div>
    {enabled && <Suspense fallback={<small className="marker-solar-loading">载入时间轴…</small>}>
      <LiveMarkerSolarDay key={lng + ',' + lat} lng={lng} lat={lat} />
    </Suspense>}
  </div>;
}

export function MarkerSolarTimeline(props: Props) {
  return <MarkerSolarToggle key={props.markerId} {...props} />;
}
