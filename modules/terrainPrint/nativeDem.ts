import type { TerrainPrintSelection } from './TerrainPrintPanel';

export const nativeFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const local = new URL('/api/terrain-print-source', window.location.origin);
  if (url.origin === 'https://cmr.earthdata.nasa.gov' && url.pathname === '/search/granules.json') {
    local.searchParams.set('catalog', url.search.slice(1));
    return fetch(local, { signal: init?.signal, cache: 'no-store' });
  }
  if (url.origin !== 'https://data.nsidc.earthdatacloud.nasa.gov' || url.search || url.hash) {
    throw new Error('不支持此高程数据服务。');
  }
  local.searchParams.set('file', url.pathname);
  // Only NASA receives Range. WebView reads a complete, independently addressed chunk.
  const headers = new Headers(init?.headers);
  const range = headers.get('Range');
  const requested = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
  if (!requested || !range) throw new Error('无效的高程读取范围。');
  headers.delete('Range');
  local.searchParams.set('wire', 'bytes');
  local.searchParams.set('range', range);
  const response = await fetch(local, { ...init, headers, cache: 'no-store' });
  if (!response.ok) return response;
  const contentRange = response.headers.get('X-Shantu-Content-Range') ?? '';
  const interval = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
  if (response.status !== 200 || !interval) throw new Error('高程服务返回的区段无效。');
  const [start, end, total] = interval.slice(1).map(Number);
  if (start !== Number(requested[1]) || end !== Math.min(Number(requested[2]), total - 1) || end < start) {
    throw new Error('高程服务返回了其他区段。');
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== end - start + 1) throw new Error('高程区段数据不完整。');
  return new Response(bytes, { status: 206, headers: { 'Content-Range': contentRange } });
};

export async function loadNativeTerrainPrintDem(selection: TerrainPrintSelection, token: string, signal: AbortSignal) {
  const { getTerrainPrintDem, TerrainPrintDemError } = await import('./dem');
  return getTerrainPrintDem(selection, {
    token, signal, fetch: nativeFetch, useTransportAuthorization: true,
    nativeHeader: async (url, signal) => {
      const local = new URL('/api/terrain-print-source', window.location.origin);
      local.searchParams.set('file', new URL(url).pathname);
      local.searchParams.set('geoKeys', '1');
      const response = await fetch(local, {
        headers: token.trim() ? { Authorization: 'Bearer ' + token.trim() } : undefined,
        signal, cache: 'no-store',
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 428) {
          throw new TerrainPrintDemError(response.status === 428 ? 'AUTH_REQUIRED' : 'AUTH_INVALID', 401, '请检查 NASA Earthdata 下载授权。');
        }
        throw new TerrainPrintDemError('DEM_UNAVAILABLE', 502, 'Android 无法复核这张 NASA 高程瓦片的文件头。');
      }
      return response.json();
    },
  });
}
