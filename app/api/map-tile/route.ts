import { proxyMapTileRequest } from '../../../tools/map-tile-proxy.mjs';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return proxyMapTileRequest(request);
}
