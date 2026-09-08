import type { ProfilePoint, SectionProfileData } from './contours';
import { coordinate, mercator, planePoint } from './planeMath.ts';
import { noteColor, validSection, type ProfileNote } from './profileNotes.ts';

export type ProfileMapPoint = {
  label: string;
  name: string;
  point: ProfilePoint;
  color: string;
};
const longitude = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

/** Use the same ENU/Mercator transform as the displayed section, with no terrain resampling. */
export function profileMapData(
  data: SectionProfileData,
  cursor: ProfilePoint,
  notes: ProfileNote[],
) {
  const s = data.settings;
  if (!validSection(s)) throw new Error('剖面参数无效，无法生成平面地图');
  const p = s.plane!,
    m = mercator(p.center);
  const corners: ProfileMapPoint[] = [
    [-1, 1, 'A', '左上角'],
    [1, 1, 'B', '右上角'],
    [1, -1, 'C', '右下角'],
    [-1, -1, 'D', '左下角'],
  ].map(([a, b, label, name]) => {
    const u = (Number(a) * p.width) / 2,
      v = (Number(b) * p.height) / 2;
    const local = planePoint(s, u, v);
    const lngLat = coordinate(m.x + local.x * m.unit, m.y + local.y * m.unit);
    return {
      label: String(label),
      name: `剖面${name}（面内 U/V）`,
      color: '#11624d',
      point: {
        u,
        v,
        local: local.toArray() as [number, number, number],
        coordinates: [longitude(lngLat[0]), lngLat[1]],
        altitude: s.altitude + local.z,
      },
    };
  });
  const points: ProfileMapPoint[] = [
    ...corners,
    { label: 'P', name: '当前所选点', point: cursor, color: '#193c41' },
    ...notes.map((n, i) => ({
      label: String(i + 1),
      name: n.name || `测点 ${i + 1}`,
      point: n.point,
      color: noteColor(n, i),
    })),
  ];
  const unwrap = ([lng, lat]: [number, number]): [number, number] => [
    p.center[0] + longitude(lng - p.center[0]),
    lat,
  ];
  const coordinates = [
    ...points.map((p) => p.point.coordinates),
    ...data.curves.flatMap((c) => c.points.map((p) => p.coordinates)),
  ];
  const bounds: [[number, number], [number, number]] = [
    [Infinity, Infinity],
    [-Infinity, -Infinity],
  ];
  for (const xy of coordinates) {
    if (!xy.every(Number.isFinite) || Math.abs(xy[1]) > 85.051129)
      throw new Error('剖面超出平面底图范围，无法完整生成地图');
    const q = unwrap(xy);
    for (let i = 0; i < 2; i++) {
      bounds[0][i] = Math.min(bounds[0][i], q[i]);
      bounds[1][i] = Math.max(bounds[1][i], q[i]);
    }
  }
  return { corners, points, bounds, unwrap };
}

export function profileCoordinateRows(
  points: ProfileMapPoint[],
): [string, string][] {
  return points.map(({ label, name, point: p }) => [
    `${label} · ${name}`,
    `经度 ${p.coordinates[0].toFixed(7)}°，纬度 ${p.coordinates[1].toFixed(7)}°，海拔 ${p.altitude.toFixed(2)} m`,
  ]);
}
