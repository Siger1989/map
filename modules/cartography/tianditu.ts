import type { LayerSettings } from '../map/types';

/** National WMTS catalogue, checked against the official service page and capabilities. */
export const TIANDITU_LAYERS = {
  vec: { name: '矢量底图', maxzoom: 18 },
  img: { name: '卫星影像', maxzoom: 18 },
  ter: { name: '地形晕渲', maxzoom: 14 },
  cva: { name: '矢量注记', maxzoom: 19 },
  cia: { name: '影像注记', maxzoom: 18 },
  cta: { name: '地形注记', maxzoom: 18 },
  ibo: { name: '全球境界', maxzoom: 18 },
} as const;
export type TiandituLayer = keyof typeof TIANDITU_LAYERS;
export type TiandituBase = 'vec' | 'img' | 'ter';
export function tiandituBase(
  s: Pick<LayerSettings, 'satellite' | 'tiandituBase'>,
): TiandituBase {
  return s.tiandituBase ?? (s.satellite ? 'img' : 'vec');
}
export function tiandituLayers(s: LayerSettings): TiandituLayer[] {
  const base = tiandituBase(s);
  const annotation =
    s.tiandituLabels && s.tiandituLabels !== 'auto'
      ? s.tiandituLabels
      : ({ vec: 'cva', img: 'cia', ter: 'cta' } as const)[base];
  return [
    base,
    ...(s.labels && annotation !== 'none' ? [annotation] : []),
    ...(s.tiandituBoundaries ? ['ibo' as const] : []),
  ];
}
export const TDT_SOURCE_IDS: Record<TiandituLayer, string> = {
  vec: 'relief',
  img: 'detail',
  ter: 'domestic-terrain',
  cva: 'domestic-labels-map',
  cia: 'domestic-labels-image',
  cta: 'domestic-labels-terrain',
  ibo: 'domestic-boundaries',
};
