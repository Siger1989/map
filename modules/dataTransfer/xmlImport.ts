import { readTrackStyle } from '../tracks/styleExchange.ts';
import { coordinate, type Coordinate } from '../navigation/types.ts';
import { newAnnotation } from '../annotations/data.ts';
import type { Transfer } from './types.ts';
import { validateTransfer } from './validation.ts';
export function parseXml(
  text: string,
  filename: string,
  convert?: (p: Coordinate) => Coordinate,
): Transfer {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error('不支持带外部实体的 XML');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML 文件无法解析');
  const data: Transfer = {
    format: 'guanyun-backup',
    version: 1,
    tracks: [],
    annotations: [],
    favorites: [],
  };
  const elements = (root: Document | Element, name: string) =>
    Array.from(root.getElementsByTagNameNS('*', name));
  const label = (el: Element) =>
    (
      elements(el, 'name')[0]?.textContent?.trim() ||
      filename.replace(/\.[^.]+$/, '')
    ).slice(0, 60);
  const point = (lng: string | null, lat: string | null): Coordinate => {
    if (lng === null || lat === null || !lng.trim() || !lat.trim())
      throw new Error('坐标缺失');
    const p: Coordinate = [Number(lng), Number(lat)];
    if (!coordinate(p)) throw new Error('坐标超出地图范围');
    return convert ? convert(p) : p;
  };
  const addTrack = (name: string, segments: Coordinate[][]) => {
    if (!segments.length || segments.some((s) => s.length < 2))
      throw new Error('轨迹分段至少需要两个点');
    data.tracks.push({
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      source: doc.documentElement.localName === 'gpx' ? 'gpx' : 'kml',
      segments,
    });
  };
  const addPin = (name: string, coordinates: Coordinate) =>
    data.annotations.push({
      ...newAnnotation('pin', coordinates, null, crypto.randomUUID()),
      name,
    });
  const applyStyle = (element: Element) => {
    const text =
      elements(element, 'route-style')[0]?.textContent ??
      elements(element, 'Data').find(
        (e) => e.getAttribute('name') === 'shantu-route-style',
      )?.textContent;
    if (text?.trim()) {
      const track = data.tracks.at(-1)!;
      Object.assign(track, readTrackStyle(text, track.segments));
    }
  };
  if (doc.documentElement.localName === 'gpx') {
    for (const trk of elements(doc, 'trk')) {
      const lines = elements(trk, 'trkseg').map((seg) =>
        elements(seg, 'trkpt'),
      );
      addTrack(
        label(trk),
        lines.map((line) =>
          line.map((p) => point(p.getAttribute('lon'), p.getAttribute('lat'))),
        ),
      );
      data.tracks.at(-1)!.samples = lines.map((line) =>
        line.map((p) => {
          const t = elements(p, 'time')[0]?.textContent?.trim(),
            a = elements(p, 'ele')[0]?.textContent?.trim();
          const time = t ? Date.parse(t) : null,
            altitude = a ? Number(a) : null;
          if (
            (time !== null && !Number.isFinite(time)) ||
            (altitude !== null && !Number.isFinite(altitude))
          )
            throw new Error('GPX 时间或海拔无效');
          return { time, altitude };
        }),
      );
      applyStyle(trk);
    }
    for (const rte of elements(doc, 'rte'))
      addTrack(label(rte), [
        elements(rte, 'rtept').map((p) =>
          point(p.getAttribute('lon'), p.getAttribute('lat')),
        ),
      ]);
    for (const p of elements(doc, 'wpt'))
      addPin(label(p), point(p.getAttribute('lon'), p.getAttribute('lat')));
  } else if (doc.documentElement.localName === 'kml') {
    if (
      elements(doc, 'NetworkLink').length ||
      elements(doc, 'Polygon').length ||
      elements(doc, 'Track').length
    )
      throw new Error(
        '当前支持 KML 点和线；请先将面、动态轨迹或网络链接转成普通点线',
      );
    const coords = (el: Element) =>
      (elements(el, 'coordinates')[0]?.textContent?.trim() || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((s) => {
          const v = s.split(',');
          return point(v[0] ?? null, v[1] ?? null);
        });
    for (const pm of elements(doc, 'Placemark')) {
      const lines = elements(pm, 'LineString').map(coords);
      if (lines.length) {
        addTrack(label(pm), lines);
        applyStyle(pm);
      }
      for (const p of elements(pm, 'Point')) {
        const list = coords(p);
        if (list.length !== 1) throw new Error('KML 点坐标无效');
        addPin(label(pm), list[0]);
      }
    }
  } else
    throw new Error('请选择 GPX、KML、KMZ 或山兔 JSON 备份（兼容旧版观云）');
  if (!data.tracks.length && !data.annotations.length)
    throw new Error('文件中没有可导入的点或轨迹');
  return validateTransfer(data);
}
