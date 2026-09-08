import { useEffect, useRef, useState } from 'react';
import { reverseRegion } from '../navigation/provider';
import {
  coordinateKey,
  readRegions,
  REGION_STORAGE,
  validateRegions,
  type CollectionRegion,
} from './regions';
import type { CatalogEntry } from './catalog';
export function useRegions(entries: CatalogEntry[]) {
  const [regions, setRegions] = useState(() => {
    try {
      return readRegions(localStorage.getItem(REGION_STORAGE));
    } catch {
      return {};
    }
  });
  const [message, setMessage] = useState(''),
    [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0);
  const current = useRef(regions);
  current.current = regions;
  const signature = entries
    .map((e) => e.key + '|' + coordinateKey(e.coordinates))
    .join(';');
  const save = (key: string, value: CollectionRegion) => {
    try {
      const next = validateRegions({
        ...readRegions(localStorage.getItem(REGION_STORAGE)),
        [key]: value,
      });
      localStorage.setItem(REGION_STORAGE, JSON.stringify(next));
      current.current = next;
      setRegions(next);
      return true;
    } catch {
      setMessage('地区分类未保存，请检查本机存储；原收藏保留');
      return false;
    }
  };
  useEffect(() => {
    const job = new AbortController();
    void (async () => {
      setLoading(true);
      for (const entry of entries) {
        if (job.signal.aborted) break;
        const c = coordinateKey(entry.coordinates),
          old = current.current[entry.key];
        if (
          old?.coordinateKey === c &&
          (old.province ||
            Date.now() - old.checkedAt < (retry ? 0 : 30 * 60000))
        )
          continue;
        try {
          const shared = Object.values(current.current).find(
            (r) => r.coordinateKey === c && r.source === 'auto' && r.province,
          );
          const region =
            shared ?? (await reverseRegion(entry.coordinates, job.signal));
          if (
            !job.signal.aborted &&
            !(
              current.current[entry.key]?.source === 'manual' &&
              current.current[entry.key]?.coordinateKey === c
            )
          )
            save(entry.key, {
              ...region,
              coordinateKey: c,
              source: 'auto',
              checkedAt: Date.now(),
            });
        } catch {
          if (!job.signal.aborted) {
            setMessage('部分地区暂未识别，可重试或在条目中填写省市');
            if (
              !(
                current.current[entry.key]?.source === 'manual' &&
                current.current[entry.key]?.coordinateKey === c
              )
            )
              save(entry.key, {
                coordinateKey: c,
                country: '',
                province: '',
                city: '',
                source: 'auto',
                checkedAt: Date.now(),
              });
          }
        }
      }
      if (!job.signal.aborted) setLoading(false);
    })();
    return () => job.abort();
  }, [signature, retry]);
  return {
    regions,
    loading,
    message,
    retry: () => setRetry((n) => n + 1),
    save,
  };
}
