/** A fixed-origin, cacheable proxy: upstream tiles do not send CORS headers. */
export async function GET(_request: Request, context: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await context.params;
  if (![z, x, y].every((v) => /^\d+$/.test(v))) return new Response('Invalid tile', { status: 400 });
  const zoom = Number(z), tx = Number(x), ty = Number(y);
  if (zoom > 5 || tx >= 2 ** zoom || ty >= 2 ** zoom) return new Response('Invalid tile', { status: 400 });
  try {
    const response = await fetch(`https://tiles.macrostrat.org/carto/${zoom}/${tx}/${ty}.mvt`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return new Response('Geology source unavailable', { status: 502 });
    const body = await response.arrayBuffer();
    if (body.byteLength > 4 * 1024 * 1024) return new Response('Tile too large', { status: 502 });
    return new Response(body, { headers: {
      'Content-Type': 'application/vnd.mapbox-vector-tile',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return new Response('Geology source unavailable', { status: 502 }); }
}
