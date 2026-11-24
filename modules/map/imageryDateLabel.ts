import { usesSentinel, usesTianditu } from '../cartography/sentinel.ts';
import { tiandituBase } from '../cartography/tianditu.ts';
import type { MapSource } from '../mapSources/types';
import type { LayerSettings } from './types';

export type ImageryDateLabel = { text: string; kind: 'imagery' | 'source' };

export function imageryDateLabel(
  settings: LayerSettings,
  mapSource: MapSource | null | undefined,
  domestic: boolean,
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
  return null;
}
