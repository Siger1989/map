import { coordinate, type RoutePlace } from '../navigation/types.ts';

/** Share only the selected place, never the user's live location or private notes. */
export function placeShareData(place: RoutePlace) {
  if (!coordinate(place.coordinates)) throw new Error('地点坐标无效');
  const name = place.name.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) || '地图位置';
  const [lng, lat] = place.coordinates;
  const coordinates = `${lng.toFixed(6)}, ${lat.toFixed(6)}`;
  const url = new URL('https://uri.amap.com/marker');
  url.search = new URLSearchParams({ position: `${lng},${lat}`, name, coordinate: 'wgs84', src: '山兔', callnative: '0' }).toString();
  return { name, coordinates, url: url.href, text: `${name}\n经度、纬度：${coordinates}（WGS84）\n${url.href}\n来自山兔` };
}
