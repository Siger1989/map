import coverage from '@/modules/terrain/ground-coverage.json';

// Both the visible mesh, contour worker and point picker use this same resolver.
export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ z: string; x: string; y: string }>;
  },
) {
  const p = await params;
  if (!/^\d+$/.test(p.z) || !/^\d+$/.test(p.x) || !/^\d+\.png$/.test(p.y))
    return new Response('Invalid terrain tile', { status: 400 });
  const z = Number(p.z),
    x = Number(p.x),
    y = Number(p.y.slice(0, -4));
  if (z > 14 || x >= 2 ** z || y >= 2 ** z)
    return new Response('Invalid terrain coordinates', { status: 400 });
  const range = (coverage as Record<string, number[]>)[z];
  const local =
    range && x >= range[0] && x <= range[1] && y >= range[2] && y <= range[3];
  const destination = local
    ? new URL(`/terrain/fabdem-v1-2/${z}/${x}/${y}.png`, request.url).href
    : `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: destination,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
