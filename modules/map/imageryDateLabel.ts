import { usesSentinel, usesTianditu } from '../cartography/sentinel.ts';
import { tiandituBase } from '../cartography/tianditu.ts';
import type { SatelliteState } from '../satellite/satellite';
import type { MapSource } from '../mapSources/types';
import type { LayerSettings } from './types';

export type ImageryDateLabel = { text: string; kind: 'imagery' | 'source' };

export function imageryDateSourceKey(
  settings: LayerSettings,
  mapSource: MapSource | null | undefined,
  domestic: boolean,
): string | null {
  if (mapSource) return `custom:${mapSource.id}:${mapSource.kind}`;
  if (usesSentinel(settings)) return 'sentinel-2025';
  if (usesTianditu(settings, domestic) && tiandituBase(settings) === 'img')
    return 'tianditu-imagery';
  if (settings.satellite && settings.imageryMode === 'latest')
    return 'nasa-latest';
  return null;
}

export function imageryDateLabel(
  settings: LayerSettings,
  mapSource: MapSource | null | undefined,
  domestic: boolean,
  satellite: SatelliteState | null,
): ImageryDateLabel | null {
  if (mapSource) {
    return mapSource.kind === 'image'
      ? { text: '影像日期：未提供', kind: 'imagery' }
      : { text: '图源日期：未提供', kind: 'source' };
  }
  if (usesSentinel(settings))
    return { text: '影像日期：2025年合成', kind: 'imagery' };
  if (usesTianditu(settings, domestic) && tiandituBase(settings) === 'img')
    return { text: '影像日期：未提供', kind: 'imagery' };
  if (settings.satellite && settings.imageryMode === 'latest') {
    if (satellite?.ready && /^\d{4}-\d{2}-\d{2}$/.test(satellite.date))
      return { text: `影像日期：${satellite.date}`, kind: 'imagery' };
    return {
      text: satellite?.status.includes('正在检查')
        ? '影像日期：查询中…'
        : '影像日期：未提供',
      kind: 'imagery',
    };
  }
  return null;
}
