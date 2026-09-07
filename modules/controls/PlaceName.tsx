import { usePlaceName } from '../navigation/usePlaceName';
import type { Coordinate } from '../navigation/types';

export function PlaceName({
  center,
  zoom,
}: {
  center: Coordinate | null;
  zoom: number;
}) {
  const world = zoom < 3;
  const result = usePlaceName(center, !world);
  const label = world
    ? '世界地图'
    : result?.place
      ? zoom < 8
        ? result.place.region
        : result.place.local
      : result
        ? result.failed
          ? '地名暂不可用'
          : '未命名区域'
        : '地名查询中…';
  const coordinates = center
    ? `${center[1].toFixed(2)}°, ${center[0].toFixed(2)}°`
    : '';
  return (
    <span
      className="current-place"
      aria-label={`地图中心地名：${label}`}
      title={
        world
          ? '世界地图'
          : `地图中心：${result?.place?.full || label} · ${coordinates}（Photon / OpenStreetMap）`
      }
    >
      <span aria-hidden="true">·</span> {label}
    </span>
  );
}
