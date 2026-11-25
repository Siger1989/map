import type { TerrainPrintSelection } from './TerrainPrintPanel';

const nativeFetch: typeof fetch = (input, init) => {
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
  return fetch(local, { ...init, cache: 'no-store' });
};

export async function loadNativeTerrainPrintDem(selection: TerrainPrintSelection, token: string, signal: AbortSignal) {
  const { getTerrainPrintDem } = await import('./dem');
  return getTerrainPrintDem(selection, { token, signal, fetch: nativeFetch });
}
