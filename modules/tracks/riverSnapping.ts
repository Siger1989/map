import { roadLines } from './roadSnapping.ts';
const WATERWAYS = new Set(['river', 'stream', 'canal']);
/** Only centerlines from the waterway layer; water polygons and road vectors are excluded. */
export function riverLines(features: Parameters<typeof roadLines>[0]) {
  return roadLines(features, WATERWAYS, 'waterway:');
}
export function riverHint(hint: string) {
  return hint
    .replaceAll('道路与河流', '河流水系')
    .replaceAll('道路 / 小路', '河流')
    .replaceAll('道路', '河流')
    .replaceAll('断路', '水系断点')
    .replaceAll('沿路', '沿河');
}
