import { useEffect, useState } from 'react';
import type { Annotation } from './data';
import { reverseRegion } from '../navigation/provider';
import {
  readRegions,
  coordinateKey,
  REGION_STORAGE,
  type CollectionRegion,
} from '../collections/regions';
export function AnnotationLocation({
  item,
  onEdit,
}: {
  item: Annotation;
  onEdit: () => void;
}) {
  const [region, setRegion] = useState<CollectionRegion | null>(null),
    [status, setStatus] = useState('查询地区…');
  const key = coordinateKey(item.coordinates);
  useEffect(() => {
    const job = new AbortController(),
      id = `annotation:${item.id}`;
    setRegion(null);
    setStatus('查询地区…');
    try {
      const old = readRegions(localStorage.getItem(REGION_STORAGE))[id];
      if (old?.coordinateKey === key) setRegion(old);
    } catch {}
    void reverseRegion(item.coordinates, job.signal)
      .then((data) => {
        if (job.signal.aborted) return;
        let saved: ReturnType<typeof readRegions> = {},
          readable = true;
        try {
          saved = readRegions(localStorage.getItem(REGION_STORAGE));
        } catch {
          readable = false;
        }
        const old = saved[id],
          manual = old?.source === 'manual' && old.coordinateKey === key;
        const next: CollectionRegion = {
          ...data,
          coordinateKey: key,
          checkedAt: Date.now(),
          language: 'local',
          source: 'auto',
          ...(manual
            ? {
                country: old.country,
                province: old.province,
                city: old.city,
                source: 'manual' as const,
              }
            : {}),
        };
        setRegion(next);
        setStatus('Photon / OpenStreetMap · 附近地址');
        try {
          if (!readable) throw new Error('cache');
          localStorage.setItem(
            REGION_STORAGE,
            JSON.stringify({ ...saved, [id]: next }),
          );
        } catch {
          setStatus('地区已查到，本机未保存');
        }
      })
      .catch(() => {
        if (!job.signal.aborted) setStatus('地区暂未查到，坐标仍可使用');
      });
    return () => job.abort();
  }, [item.id, key]);
  return (
    <section className="annotation-location" aria-label="标记位置信息">
      <header>
        <strong>位置 · WGS84</strong>
        <button onClick={onEdit}>调整坐标</button>
      </header>
      <div className="annotation-coordinates">
        <span>经度 {item.coordinates[0].toFixed(6)}°</span>
        <span>纬度 {item.coordinates[1].toFixed(6)}°</span>
        <span>
          地面海拔{' '}
          {item.groundElevation === null
            ? '未取得'
            : `${item.groundElevation} m`}
        </span>
      </div>
      <dl>
        {(
          [
            ['国家', region?.country],
            ['省 / 州', region?.province],
            ['城市', region?.city],
            ['区县', region?.district],
            ['乡镇 / 街道', region?.township],
            ['社区 / 村', region?.locality],
            ['附近道路', region?.street],
          ] as const
        ).map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value || '—'}</dd>
          </div>
        ))}
      </dl>
      <small>{status}</small>
    </section>
  );
}
