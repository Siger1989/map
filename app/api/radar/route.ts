/** Older clients receive a permanent local response without a provider request. */
export function GET(_request: Request) {
  return Response.json({ error: '雷达天气已移除' }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}
