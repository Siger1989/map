import type { ManualTrack } from '../tracks/drawing.ts';
import { validAltitude, type PhotoAltitude } from './details.ts';
import {
  coordinate,
  metresBetween,
  type Coordinate,
} from '../navigation/types.ts';

export function photoTime(raw: unknown, offset?: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(
    raw.trim(),
  );
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  const check = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  if (
    y < 1970 ||
    y > 2100 ||
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    h > 23 ||
    mi > 59 ||
    se > 59
  )
    return null;
  if (offset !== undefined && offset !== null && offset !== '') {
    const z = /^([+-])(\d{2}):(\d{2})$/.exec(String(offset).trim());
    if (
      !z ||
      Number(z[2]) > 14 ||
      Number(z[3]) > 59 ||
      (Number(z[2]) === 14 && Number(z[3]) !== 0)
    )
      return null;
    return (
      check.getTime() -
      (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3])) * 60000
    );
  }
  const local = new Date(y, mo - 1, d, h, mi, se);
  return local.getHours() === h && local.getDate() === d
    ? local.getTime()
    : null;
}

export type PhotoMatch = {
  coordinates: Coordinate;
  kind: 'point' | 'interpolated';
  altitude?: PhotoAltitude;
};
/** Never interpolate over pauses, missing timestamps or gaps longer than two minutes. */
export function matchPhoto(
  track: ManualTrack,
  time: number | null,
): PhotoMatch | null {
  if (time === null || !Number.isFinite(time)) return null;
  const matches: PhotoMatch[] = [];
  for (let s = 0; s < track.segments.length; s++) {
    const line = track.segments[s],
      times = track.samples?.[s];
    if (!times) continue;
    for (let i = 0; i < line.length; i++) {
      const t = times[i]?.time;
      if (
        t === null ||
        t === undefined ||
        !Number.isFinite(t) ||
        !coordinate(line[i])
      )
        continue;
      const altitude = times[i]?.altitude;
      if (t === time)
        matches.push({
          coordinates: line[i],
          kind: 'point',
          ...(validAltitude(altitude)
            ? { altitude: { metres: altitude, source: 'track' as const } }
            : {}),
        });
      const next = times[i + 1]?.time,
        end = line[i + 1];
      if (
        next === null ||
        next === undefined ||
        !Number.isFinite(next) ||
        !coordinate(end) ||
        next <= t ||
        next - t > 120000 ||
        time <= t ||
        time >= next
      )
        continue;
      if (metresBetween(line[i], end) / ((next - t) / 1000) > 80) continue;
      const f = (time - t) / (next - t),
        delta = ((end[0] - line[i][0] + 540) % 360) - 180;
      matches.push({
        coordinates: [
          ((line[i][0] + delta * f + 540) % 360) - 180,
          line[i][1] + (end[1] - line[i][1]) * f,
        ],
        kind: 'interpolated',
        ...(validAltitude(altitude) && validAltitude(times[i + 1]?.altitude)
          ? {
              altitude: {
                metres: altitude + (times[i + 1].altitude! - altitude) * f,
                source: 'interpolated' as const,
              },
            }
          : {}),
      });
    }
  }
  if (
    !matches.length ||
    matches.some(
      (m) => metresBetween(m.coordinates, matches[0].coordinates) > 1,
    )
  )
    return null;
  return matches[0];
}

export function localPhotoInput(time: number | null) {
  if (time === null || !Number.isFinite(time)) return '';
  const d = new Date(time);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
