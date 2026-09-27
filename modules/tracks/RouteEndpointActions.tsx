import { useState } from 'react';
import { coordinate, type Coordinate, type RoutePlace } from '../navigation/types';

export function routeEndpointPlace(routeName: string, label: string, stopName: string | undefined, point: Coordinate): RoutePlace {
  if (!coordinate(point)) throw new Error('地点坐标无效');
  return { name: `${routeName} · ${label}${stopName ? ` · ${stopName}` : ''}`, coordinates: [...point] };
}

/** Reuses the place-share dialog; copying keeps the original WGS84 coordinate order. */
export function RouteEndpointActions({ routeName, label, stopName, point, onShare }: {
  routeName: string; label: string; stopName?: string; point: Coordinate;
  onShare?: (place: RoutePlace) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${point[0].toFixed(6)}, ${point[1].toFixed(6)}`);
      setCopied(true); setError('');
    } catch { setError('复制失败，请点击分享后复制信息'); }
  };
  return <span className="route-endpoint-actions">
    <button aria-label={`复制${label}坐标`} title="复制经度、纬度（WGS84）" onClick={() => void copy()}>{copied ? '已复制' : '复制'}</button>
    {onShare && <button aria-label={`分享${label}地点`} onClick={() => onShare(routeEndpointPlace(routeName, label, stopName, point))}>分享</button>}
    <span className="route-endpoint-feedback" role="status">{error || (copied ? '已复制，经度在前、纬度在后' : '')}</span>
  </span>;
}
