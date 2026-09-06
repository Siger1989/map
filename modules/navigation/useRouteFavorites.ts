import { useEffect, useState } from 'react';
import {
  FAVORITES_STORAGE,
  parseFavorites,
  validFavorite,
  type RouteFavorite,
} from './favorites';
import type { PlannedRoute, RoutePlace } from './types';
export function useRouteFavorites() {
  const [items, setItems] = useState<RouteFavorite[]>([]),
    [message, setMessage] = useState('');
  const [messageRoute, setMessageRoute] = useState<number | null>(null);
  useEffect(() => {
    try {
      setItems(parseFavorites(localStorage.getItem(FAVORITES_STORAGE)));
    } catch {
      setMessage('收藏夹暂时无法读取。');
    }
  }, []);
  useEffect(() => {
    const reload = () => {
      try {
        setItems(parseFavorites(localStorage.getItem(FAVORITES_STORAGE)));
      } catch {
        /* Existing state remains available. */
      }
    };
    window.addEventListener('guanyun-data-changed', reload);
    return () => window.removeEventListener('guanyun-data-changed', reload);
  }, []);
  const persist = (next: RouteFavorite[]) => {
    try {
      localStorage.setItem(FAVORITES_STORAGE, JSON.stringify(next));
      setItems(next);
      return true;
    } catch {
      setMessage('本机存储空间不足，路线未能收藏。');
      return false;
    }
  };
  return {
    items,
    message,
    messageRoute,
    save: (start: RoutePlace, end: RoutePlace, route: PlannedRoute) => {
      setMessageRoute(route.createdAt);
      if (
        items.some(
          (f) =>
            f.route.createdAt === route.createdAt &&
            f.route.mode === route.mode &&
            f.start.name === start.name &&
            f.end.name === end.name,
        )
      ) {
        setMessage('这条路线已在收藏夹。');
        return;
      }
      if (items.length >= 20) {
        setMessage('最多收藏20条道路路线，请先移除不需要的路线。');
        return;
      }
      const item: RouteFavorite = {
        id: crypto.randomUUID(),
        name: `${start.name} → ${end.name}`,
        savedAt: Date.now(),
        start,
        end,
        route,
      };
      if (!validFavorite(item)) {
        setMessage('路线数据不完整或过大，无法保存。');
        return;
      }
      if (persist([item, ...items])) setMessage('已保存到本机收藏夹。');
    },
    remove: (id: string) => {
      if (persist(items.filter((i) => i.id !== id))) setMessage('已移除收藏。');
    },
  };
}
export type RouteFavoritesState = ReturnType<typeof useRouteFavorites>;
