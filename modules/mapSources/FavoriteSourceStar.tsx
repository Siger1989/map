import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { readFavoriteSourceKeys, subscribeFavoriteSourceKeys, writeFavoriteSourceKeys } from './favorites';
import './favoriteSourceSwitcher.css';

export function FavoriteSourceStar({ sourceKey, name, group }: { sourceKey: string; name: string; group: 'builtin' | 'saved' | 'public' }) {
  const [favoriteKeys, setFavoriteKeys] = useState(readFavoriteSourceKeys);
  const [failed, setFailed] = useState(false);
  const favorite = favoriteKeys.includes(sourceKey);
  useEffect(() => subscribeFavoriteSourceKeys(setFavoriteKeys), []);
  return <button type="button" className="map-source-favorite-star" data-group={group}
    aria-label={`${favorite ? '移出' : '加入'}常用：${name}`} aria-pressed={favorite}
    title={favorite ? '移出常用' : '加入常用'} onClick={event => {
      event.stopPropagation();
      const next = favorite ? favoriteKeys.filter(key => key !== sourceKey) : [...favoriteKeys, sourceKey];
      const saved = writeFavoriteSourceKeys(next);
      setFailed(!saved);
      if (saved) setFavoriteKeys(next);
    }}>
    <Star size={14} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
    {failed && <span className="map-source-favorite-error" role="status">未保存</span>}
  </button>;
}
