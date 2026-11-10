import type { MapSource } from './types.ts';

export type MapSourceBatchItem = {
  id: string;
  label: string;
  source: MapSource | null;
  skipped?: string;
};

/** Build a stable probe list without changing the selected source or view. */
export function mapSourceBatchItems(
  maps: MapSource[],
  currentSource: MapSource | null,
  currentBuiltinAvailable = true,
  builtinSources: MapSourceBatchItem[] = [],
): MapSourceBatchItem[] {
  const items: MapSourceBatchItem[] = [...builtinSources];
  const seen = new Set<string>();
  for (const item of items) if (item.source) seen.add(item.source.id);
  if (currentSource) {
    if (!seen.has(currentSource.id)) {
      seen.add(currentSource.id);
      const skipped = probeSkipReason(currentSource);
      items.push({
        id: `current:${currentSource.id}`,
        label: safeSourceLabel(currentSource.name),
        source: currentSource,
        ...(skipped ? { skipped } : {}),
      });
    }
  } else if (builtinSources.length === 0) {
    items.push({
      id: 'current:builtin',
      label: '当前内置图源',
      source: null,
      ...(!currentBuiltinAvailable ? { skipped: '当前内置图源没有可测试的在线瓦片模板' } : {}),
    });
  }
  for (const map of maps) {
    if (seen.has(map.id)) continue;
    seen.add(map.id);
    const skipped = probeSkipReason(map);
    items.push({
      id: `saved:${map.id}`,
      label: safeSourceLabel(map.name),
      source: map,
      ...(skipped ? { skipped } : {}),
    });
  }
  return items;
}

function probeSkipReason(source: MapSource): string | undefined {
  if (source.kind !== 'online') return '离线图源没有在线瓦片模板';
  const tiles = source.ovmap?.layers?.[0]?.tiles ?? source.tiles;
  if (!tiles?.some((tile) => typeof tile === 'string' && tile.trim())) return '缺少可测试的瓦片模板';
  return undefined;
}

function safeSourceLabel(name: string): string {
  return name
    .replace(/https?:\/\/\S+/gi, '[地址已隐藏]')
    .replace(/\b(key|token|secret|api[_-]?key)=\S+/gi, '$1=[已隐藏]')
    .slice(0, 80);
}
