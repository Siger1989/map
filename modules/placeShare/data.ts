import { coordinate, type RoutePlace } from '../navigation/types.ts';

export type PlaceShareSource = RoutePlace & {
  /** Prepared by a feature that needs to share more than the basic place fields. */
  shareText?: string;
  shareSummary?: string;
};

/** Share only the selected place and fields explicitly provided by the caller. */
export function placeShareData(place: PlaceShareSource) {
  if (!coordinate(place.coordinates)) throw new Error('地点坐标无效');
  const name = place.name.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) || '地图位置';
  const [lng, lat] = place.coordinates;
  const coordinates = `${lng.toFixed(6)}, ${lat.toFixed(6)}`;
  const url = new URL('https://uri.amap.com/marker');
  url.search = new URLSearchParams({ position: `${lng},${lat}`, name, coordinate: 'wgs84', src: '山兔', callnative: '0' }).toString();
  const standardText = `${name}\n经度、纬度：${coordinates}（WGS84）\n${url.href}\n来自山兔`;
  return {
    name,
    coordinates,
    url: url.href,
    text: place.shareText ? `${place.shareText}\n${url.href}\n来自山兔` : standardText,
    summary: place.shareSummary ?? '名称、坐标和地图链接',
  };
}
