import { useEffect, useState } from 'react';
import {
  COLLECTION_STORAGE,
  defaultLayout,
  parseLayout,
  validateLayout,
  type CollectionLayout,
} from './data';

export function useCollections() {
  const [layout, setLayout] = useState(defaultLayout),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    const reload = () => {
      try {
        setLayout(parseLayout(localStorage.getItem(COLLECTION_STORAGE)));
        setReady(true);
        setMessage('');
      } catch {
        setReady(false);
        setMessage('收藏分组无法读取，原路线仍可打开。');
      }
    };
    const changed = (e: StorageEvent) => {
      if (e.key === COLLECTION_STORAGE || e.key === null) reload();
    };
    reload();
    window.addEventListener('storage', changed);
    window.addEventListener('guanyun-data-changed', reload);
    return () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener('guanyun-data-changed', reload);
    };
  }, []);
  const update = (
    change: (layout: CollectionLayout) => CollectionLayout,
    success: string,
  ) => {
    if (!ready) return false;
    try {
      // Read the latest snapshot so a second open tab cannot silently erase its groups.
      const next = validateLayout(
        change(parseLayout(localStorage.getItem(COLLECTION_STORAGE))),
      );
      localStorage.setItem(COLLECTION_STORAGE, JSON.stringify(next));
      window.dispatchEvent(new Event('guanyun-data-changed'));
      setLayout(next);
      setMessage(success);
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error && error.message.includes('分组')
          ? error.message
          : '存储空间不足，整理未保存，请释放空间后重试。',
      );
      return false;
    }
  };
  return {
    layout,
    ready,
    message,
    update,
    clearMessage: () => {
      if (ready) setMessage('');
    },
  };
}
