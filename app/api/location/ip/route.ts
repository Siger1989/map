import { coordinate } from '../../../../modules/navigation/types';

/** Fixed upstream only; disclose a coarse estimate without returning the user's IP. */
export async function GET() {
  try {
    const response = await fetch('https://ipwho.is/', { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!response.ok) throw new Error('IP location unavailable');
    const data = await response.json() as { success?: unknown; latitude?: unknown; longitude?: unknown };
    const coordinates = [data.longitude, data.latitude];
    if (data.success !== true || !coordinate(coordinates)) throw new Error('Invalid IP location');
    return Response.json({ coordinates, accuracy: 50000, timestamp: Date.now(), source: 'network', provider: 'ip' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'IP定位暂不可用，请检查网络或切换自动定位。' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
