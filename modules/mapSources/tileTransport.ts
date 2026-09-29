function isTiandituHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'tianditu.gov.cn' || normalized.endsWith('.tianditu.gov.cn');
}

/** Fetch Tianditu browser-key tiles from the official site in the browser. */
function tiandituBrowserUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (!isTiandituHost(url.hostname)) return;
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      if (url.port === '80') url.port = '';
    }
    if (url.protocol !== 'https:') return;
    return url.toString();
  } catch {
    return;
  }
}

/** Fetch one user-map tile using the access mode required by its provider. */
export async function fetchMapTile(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  const browserUrl = tiandituBrowserUrl(url);
  if (browserUrl) {
    return fetch(browserUrl, {
      method: 'GET',
      signal,
      credentials: 'omit',
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg' },
    });
  }

  const endpoint = new URL('/api/map-tile', globalThis.location?.origin ?? 'http://localhost');
  endpoint.searchParams.set('url', url);
  return fetch(endpoint, {
    method: 'GET',
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg' },
  });
}
