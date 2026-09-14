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
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${data.annotations.map((p) => `<Placemark><name>${escapeXML(p.name)}</name><Point><coordinates>${p.coordinates.join(',')}</coordinates></Point></Placemark>`).join('')}${tracks.map((t) => `<Placemark><name>${escapeXML(t.name)}</name><ExtendedData><Data name="shantu-route-style"><value>${escapeXML(trackStyleText(t))}</value></Data></ExtendedData><MultiGeometry>${t.segments.map((s) => `<LineString><tessellate>1</tessellate><coordinates>${s.map((p) => p.join(',')).join(' ')}</coordinates></LineString>`).join('')}</MultiGeometry></Placemark>`).join('')}</Document></kml>`;
}
