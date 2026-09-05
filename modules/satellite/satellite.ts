import type { Map } from 'maplibre-gl';
export const satelliteTile = (date: string) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg`;
export type SatelliteState = { date: string; status: string; ready: boolean };
function tileCoordinate(lng: number, lat: number) {
  const n = 256,
    safeLat = Math.max(-80, Math.min(80, lat));
  const x = ((lng + 180) / 360) * n;
  const rad = (safeLat * Math.PI) / 180;
  const y = ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n;
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    px: (x % 1) * 256,
    py: (y % 1) * 256,
  };
}
async function hasCoverage(
  url: string,
  px: number,
  py: number,
  signal: AbortSignal,
) {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
  });
  if (!response.ok) return false;
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法检查影像覆盖');
    ctx.drawImage(bitmap, 0, 0, 256, 256);
    const pixels = ctx.getImageData(
      Math.max(0, Math.min(240, Math.round(px) - 8)),
      Math.max(0, Math.min(240, Math.round(py) - 8)),
      16,
      16,
    ).data;
    let valid = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 35) valid++;
    return valid > 128;
  } finally {
    bitmap.close();
  }
}
export async function loadLatestSatellite(
  map: Map,
  lng: number,
  lat: number,
  signal: AbortSignal,
): Promise<SatelliteState> {
  const response = await fetch('/api/satellite', { signal });
  if (!response.ok) throw new Error('卫星日期暂不可用，保留历史地表底图');
  const { date } = (await response.json()) as { date?: unknown };
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error('卫星日期格式无效');
  const tile = tileCoordinate(lng, lat);
  // The newest global day can have no orbit coverage at the selected point yet.
  for (let days = 0; days < 5; days++) {
    const candidate = new Date(
      Date.parse(date + 'T00:00:00Z') - days * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    const url = satelliteTile(candidate)
      .replace('{z}', '8')
      .replace('{x}', String(tile.x))
      .replace('{y}', String(tile.y));
    if (!(await hasCoverage(url, tile.px, tile.py, signal))) continue;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (map.getLayer('satellite')) map.removeLayer('satellite');
    if (map.getSource('satellite')) map.removeSource('satellite');
    map.addSource('satellite', {
      type: 'raster',
      tiles: [satelliteTile(candidate)],
      tileSize: 256,
      maxzoom: 9,
      attribution:
        '<a href="https://worldview.earthdata.nasa.gov/" target="_blank">NASA GIBS / VIIRS Suomi NPP</a>',
    });
    map.addLayer(
      {
        id: 'satellite',
        type: 'raster',
        source: 'satellite',
        paint: {
          'raster-opacity': 0.92,
          'raster-saturation': -0.1,
          'raster-fade-duration': 400,
        },
      },
      'elevation-colors',
    );
    return {
      date: candidate,
      status: '当前位置最新可用 · VIIRS 真彩色 · 日期为 UTC',
      ready: true,
    };
  }
  throw new Error('近 5 日当前位置暂无可用影像，显示历史地表底图');
}
