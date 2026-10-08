import { trackStyleText } from '../tracks/styleExchange.ts';
import { type ManualTrack } from '../tracks/drawing.ts';
import type { Transfer } from './types.ts';
const escapeXML = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
export function exportGPX(data: Transfer) {
  const tracks: Pick<
    ManualTrack,
    'name' | 'segments' | 'samples' | 'style' | 'edgeColors' | 'colorConditions'
  >[] = [
    ...data.tracks,
    ...data.favorites.map((f) => ({
      name: f.name,
      segments: [f.route.coordinates],
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Guanyun" xmlns="http://www.topografix.com/GPX/1/1">${data.annotations.map((p) => `<wpt lat="${p.coordinates[1]}" lon="${p.coordinates[0]}"><name>${escapeXML(p.name)}</name><desc>${escapeXML(p.note)}</desc></wpt>`).join('')}${tracks
    .map(
      (t) =>
        `<trk><name>${escapeXML(t.name)}</name><extensions><shantu:route-style xmlns:shantu="urn:shantu:route-style:1">${escapeXML(trackStyleText(t))}</shantu:route-style></extensions>${t.segments
          .map(
            (s, i) =>
              `<trkseg>${s
                .map((p, j) => {
                  const sample = t.samples?.[i]?.[j];
                  return `<trkpt lat="${p[1]}" lon="${p[0]}">${sample?.altitude != null ? `<ele>${sample.altitude}</ele>` : ''}${sample?.time != null ? `<time>${new Date(sample.time).toISOString()}</time>` : ''}</trkpt>`;
                })
                .join('')}</trkseg>`,
          )
          .join('')}</trk>`,
    )
    .join('')}</gpx>`;
}
export function exportKML(data: Transfer) {
  const tracks: Pick<
    ManualTrack,
    'name' | 'segments' | 'samples' | 'style' | 'edgeColors' | 'colorConditions'
  >[] = [
    ...data.tracks,
    ...data.favorites.map((f) => ({
      name: f.name,
      segments: [f.route.coordinates],
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${data.annotations.map((p) => `<Placemark><name>${escapeXML(p.name)}</name><Point><coordinates>${p.coordinates.join(',')}</coordinates></Point></Placemark>`).join('')}${tracks.map((t) => `<Placemark><name>${escapeXML(t.name)}</name><ExtendedData><Data name="shantu-route-style"><value>${escapeXML(trackStyleText(t))}</value></Data></ExtendedData><MultiGeometry>${t.segments.map((s, i) => kmlSegmentGeometries(s, t.samples?.[i])).join('')}</MultiGeometry></Placemark>`).join('')}</Document></kml>`;
}

function kmlSegmentGeometries(
  line: readonly (readonly [number, number])[],
  samples?: { altitude: number | null }[],
): string {
  if (!line.length) return '';
  const altitudes = line.map((_, index) => {
    const value = samples?.[index]?.altitude;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  });
  const hasAltitude = altitudes.some((value) => value !== null);
  if (line.length < 2) {
    if (hasAltitude) return `<Point><altitudeMode>absolute</altitudeMode><coordinates>${line[0].join(',')},${altitudes[0]}</coordinates></Point>`;
    return `<LineString><tessellate>1</tessellate><coordinates>${line.map((point) => point.join(',')).join(' ')}</coordinates></LineString>`;
  }
  if (!hasAltitude)
    return `<LineString><altitudeMode>clampToGround</altitudeMode><tessellate>1</tessellate><coordinates>${line.map((point) => point.join(',')).join(' ')}</coordinates></LineString>`;

  const geometries: string[] = [];
  const altitudeVertices = new Set<number>();
  let mode: 'absolute' | 'clampToGround' | null = null;
  let coordinates: string[] = [];
  const flush = () => {
    if (!mode || coordinates.length < 2) return;
    geometries.push(`<LineString><altitudeMode>${mode}</altitudeMode><tessellate>1</tessellate><coordinates>${coordinates.join(' ')}</coordinates></LineString>`);
  };
  for (let index = 0; index < line.length - 1; index++) {
    const absolute = altitudes[index] !== null && altitudes[index + 1] !== null;
    const nextMode = absolute ? 'absolute' : 'clampToGround';
    if (nextMode !== mode) {
      flush();
      mode = nextMode;
      coordinates = [];
    }
    const coordinateText = (pointIndex: number) => absolute
      ? `${line[pointIndex].join(',')},${altitudes[pointIndex]}`
      : line[pointIndex].join(',');
    if (!coordinates.length) coordinates.push(coordinateText(index));
    coordinates.push(coordinateText(index + 1));
    if (absolute) { altitudeVertices.add(index); altitudeVertices.add(index + 1); }
  }
  flush();
  for (let index = 0; index < line.length; index++) {
    const altitude = altitudes[index];
    if (altitude !== null && !altitudeVertices.has(index))
      geometries.push(`<Point><altitudeMode>absolute</altitudeMode><coordinates>${line[index].join(',')},${altitude}</coordinates></Point>`);
  }
  return geometries.join('');
}
