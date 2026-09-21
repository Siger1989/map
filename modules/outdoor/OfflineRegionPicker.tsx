import { useState } from 'react';
import { validateRegion, type TripPackage } from './offline';
import './offlineRegion.css';
export function OfflineRegionPicker({ readBounds, onDone, onCancel }: {
  readBounds: () => TripPackage['bounds'] | null;
  onDone: (bounds: TripPackage['bounds']) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState('');
  return <div className="offline-region-picker" aria-label="选择离线地图范围">
    <div className="offline-region-frame"><span>移动、缩放地图，把下载范围放入框内</span></div>
    <section className="offline-region-actions"><strong>离线地图选区</strong><div><button onClick={onCancel}>取消</button><button onClick={() => { try { const b = readBounds(); if (!b) throw new Error('地图尚未就绪'); onDone(validateRegion(b)); } catch(e) { setError((e as Error).message); } }}>使用框内范围</button></div>{error && <p role="status">{error}</p>}</section>
  </div>;
}
