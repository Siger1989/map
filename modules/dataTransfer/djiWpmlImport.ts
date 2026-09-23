import { coordinate, type Coordinate } from '../navigation/types.ts';
import { MAX_SAVED_TRACKS, MAX_TRACK_POINTS } from '../tracks/drawing.ts';
import type { Transfer } from './types.ts';
import { validateTransfer } from './validation.ts';

/** DJI KMZ keeps its executable waypoints in waylines.wpml, not template.kml. */
export function parseDjiWpml(text: string, filename: string): Transfer {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error('不支持带外部实体的 WPML');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'kml')
    throw new Error('WPML 航线文件无法解析');
  const wpmlNamespace = doc.documentElement.getAttribute('xmlns:wpml');
  if (!wpmlNamespace || !/^https?:\/\/www\.(?:dji|uav)\.com\/wpmz\//.test(wpmlNamespace))
    throw new Error('KMZ 内的航线不是 DJI WPML 格式');

  const direct = (parent: Element, name: string) =>
    Array.from(parent.children).filter((child) =>
      child.localName === name || child.localName.endsWith(`:${name}`),
    );
  const onlyText = (parent: Element, name: string) =>
    direct(parent, name)[0]?.textContent?.trim() ?? '';
  const folders = Array.from(doc.getElementsByTagNameNS('*', 'Folder'));
  if (folders.length > MAX_SAVED_TRACKS)
    throw new Error('WPML 航线数量超出限制');
  const tracks: Transfer['tracks'] = [];
  let totalPoints = 0;
  for (const folder of folders) {
    const placemarks = direct(folder, 'Placemark');
    if (!placemarks.length) continue;
    const waypoints = placemarks.map((mark) => {
      const rawIndex = onlyText(mark, 'index');
      const index = Number(rawIndex);
      const raw = direct(mark, 'Point')[0]
        ? onlyText(direct(mark, 'Point')[0], 'coordinates')
        : '';
      const parts = raw.split(',').map((part) => part.trim());
      const point: Coordinate = [Number(parts[0]), Number(parts[1])];
      if (!/^(0|[1-9]\d*)$/.test(rawIndex) || !Number.isInteger(index) || parts.length < 2 ||
          !parts[0] || !parts[1] || !coordinate(point))
        throw new Error('WPML 航点编号或坐标无效');
      return { index, point };
    });
    waypoints.sort((a, b) => a.index - b.index);
    if (waypoints.length < 2 || waypoints.some((item, index) => item.index !== index))
      throw new Error('WPML 航线至少需要两个连续编号的航点');
    totalPoints += waypoints.length;
    if (totalPoints > MAX_TRACK_POINTS)
      throw new Error('WPML 航点数量超出限制');
    const title = onlyText(folder, 'name') || filename.replace(/\.[^.]+$/, '');
    tracks.push({
      id: crypto.randomUUID(),
      name: title.slice(0, 60),
      createdAt: Date.now(),
      source: 'kml',
      importFormat: 'DJI WPML',
      segments: [waypoints.map(({ point }) => point)],
    });
  }
  if (!tracks.length) throw new Error('WPML 中没有可导入的航线');
  return validateTransfer({
    format: 'guanyun-backup', version: 1, tracks, annotations: [], favorites: [],
    importWarnings: ['DJI WPML 仅导入航点连线；飞行高度、动作指令不导入，路线不代表地面可通行。'],
  });
}
