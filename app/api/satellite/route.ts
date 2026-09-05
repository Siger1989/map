let cached: { date: string; cachedAt: number } | null = null;
let inflight: Promise<string> | null = null;
export async function GET() {
  try {
    if (cached && Date.now() - cached.cachedAt < 30 * 60 * 1000)
      return Response.json({ date: cached.date });
    inflight ??= (async () => {
      const response = await fetch(
        'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml',
        { signal: AbortSignal.timeout(20000) },
      );
      if (!response.ok) throw new Error('Satellite metadata unavailable');
      const xml = await response.text();
      const id =
        '<ows:Identifier>VIIRS_SNPP_CorrectedReflectance_TrueColor</ows:Identifier>';
      const start = xml.indexOf(id);
      if (start < 0) throw new Error('Satellite layer unavailable');
      const layer = xml.slice(start, xml.indexOf('</Layer>', start));
      const date = layer.match(/<Default>(\d{4}-\d{2}-\d{2})<\/Default>/)?.[1];
      if (!date) throw new Error('Satellite date unavailable');
      cached = { date, cachedAt: Date.now() };
      return date;
    })();
    return Response.json(
      { date: await inflight },
      { headers: { 'Cache-Control': 'public, max-age=900' } },
    );
  } catch {
    return Response.json(
      { error: '无法获取卫星影像日期，请稍后重试' },
      { status: 502 },
    );
  } finally {
    inflight = null;
  }
}
