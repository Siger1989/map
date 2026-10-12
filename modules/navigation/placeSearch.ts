import { basemapConfiguration } from '../cartography/basemaps.ts';
import { offlinePlaces } from '../offlineRouting/provider.ts';
import { normalizeTiandituPlaces, normalizeTiandituSuggestions, buildTiandituSearchURL } from './tiandituSearch.ts';
import { buildTiandituGeocoderURL, isAddressLike, normalizeTiandituGeocode } from './tiandituGeocoder.ts';
import { buildPhotonSearchURL, normalizePhoton } from './photonSearch.ts';
import { createPlaceSearchTransport, PlaceSearchError, searchErrorMessage, type SearchProvider } from './placeSearchTransport.ts';
import { coordinate, type Coordinate, type RoutePlace } from './types.ts';
import { credentialScope, mapBound, nearChina, queryCity, sortPlaces, mergeSuggestions } from './placeSearchHelpers.ts';

// TianDiTu request fields/statuses follow official docs; coordinate reference is unspecified by them.
export type PlaceSearchSource = 'auto' | SearchProvider;
export type SearchPageToken = {
  provider: SearchProvider; query: string; start: number; queryType?: number;
  mapBound?: string; specify?: string; city?: string; nationwide?: boolean;
};
export type PlaceSearchOptions = { city?: string; nationwide?: boolean; page?: SearchPageToken };
export type PlaceSearchDetailedResult = {
  places: RoutePlace[];
  suggestions: { label: string; query: string; city?: string }[];
  warnings: string[];
  next?: SearchPageToken;
};
export { PlaceSearchError };
export type { SearchErrorCategory } from './placeSearchTransport.ts';
type Config = {
  fetch?: (url: string, init: RequestInit) => Promise<{
    ok?: boolean; status?: number; headers?: { get(name: string): string | null };
    text?: () => Promise<string>; json?: () => Promise<unknown>;
  }>;
  getConfig?: () => { domestic: boolean; token: string };
  offlineSearch?: (query: string) => Promise<RoutePlace[]>;
  now?: () => number; timeoutMs?: number; minIntervalMs?: number;
};
const PAGE_SIZE = 20;
type SearchPageResult = {
  places: RoutePlace[];
  suggestions: PlaceSearchDetailedResult['suggestions'];
  next?: SearchPageToken;
};


function checkedTdt(data: unknown, query: string) {
  const status = data && typeof data === 'object' ? (data as { status?: unknown }).status : undefined;
  const info = Array.isArray(status) ? status[0] : status;
  const code = info && typeof info === 'object' ? Number((info as { infocode?: unknown }).infocode) : NaN;
  if (code === 3001) return { places: [], suggestions: normalizeTiandituSuggestions(data, query), total: 0 };
  let places: RoutePlace[];
  try { places = normalizeTiandituPlaces(data); }
  catch (error) {
    const category = code >= 2001 && code <= 2007 ? 'parameter'
      : code === 3000 || (Number.isFinite(code) && code !== 1000) ? 'service'
        : 'format';
    throw new PlaceSearchError(category, searchErrorMessage(category), { cause: error });
  }
  return {
    places,
    suggestions: normalizeTiandituSuggestions(data, query),
    total: data && typeof data === 'object' ? Number((data as { count?: unknown }).count) : NaN,
  };
}

export function createPlaceSearcher(config: Config = {}) {
  const getConfig = config.getConfig ?? basemapConfiguration;
  const offlineSearch = config.offlineSearch ?? offlinePlaces;
  const transport = createPlaceSearchTransport(config);

  async function searchOne(query: string, near: Coordinate | null, signal: AbortSignal,
    provider: SearchProvider, options: PlaceSearchOptions, queryType?: number,
    preserveCityWhenWide = false, skipGeocoder = false): Promise<SearchPageResult> {
    if (provider === 'photon') {
      const url = buildPhotonSearchURL(query, near, options);
      const result = await transport.get(url, provider, `photon:${url}`, signal, (data) => normalizePhoton(data, query, options.nationwide ? undefined : options.city));
      return { ...result, places: sortPlaces(result.places, near, options.nationwide ? undefined : options.city) };
    }
    const cfg = getConfig();
    if (!cfg.domestic || !cfg.token) throw new PlaceSearchError('auth', '天地图搜索授权未配置。');
    const page = options.page?.provider === 'tianditu' ? options.page : undefined;
    if (!page && !skipGeocoder && isAddressLike(query)) {
      const city = options.city?.trim();
      const address = city && !query.includes(city) ? `${city} ${query}` : query;
      const geocodeURL = buildTiandituGeocoderURL(address, cfg.token);
      try {
        const geocoded = await transport.get(geocodeURL, provider, `geocoder:${credentialScope(cfg.token)}:${address}`, signal,
          (data) => normalizeTiandituGeocode(data, address));
        if (geocoded.length) return { places: geocoded, suggestions: [] };
      } catch (error) {
        if (!(error instanceof PlaceSearchError) || error.category !== 'noresult') throw error;
      }
    }
    const start = Math.max(0, Math.min(300, Math.floor(page?.start ?? 0)));
    const nationwide = options.nationwide ?? page?.nationwide ?? false;
    const city = page?.city ?? options.city ?? queryCity(query);
    const bound = page?.mapBound ?? mapBound(city ? null : near, nationwide);
    const requestQuery = query;
    const isLocalViewport = Boolean(near && !city && !nationwide && near[0] >= 73 && near[0] <= 136 && near[1] >= 3 && near[1] <= 54);
    const type = page?.queryType ?? queryType ?? (isLocalViewport ? 2 : 1);
    const specify = page?.specify ?? (nationwide && !preserveCityWhenWide ? undefined : city);
    const url = buildTiandituSearchURL(requestQuery, cfg.token, {
      start, count: PAGE_SIZE, queryType: type, mapBound: bound,
      specify,
    });
    const cacheKey = `tianditu:${credentialScope(cfg.token)}:${requestQuery}:${start}:${type}:${bound}:${specify ?? ''}`;
    let result: ReturnType<typeof checkedTdt>;
    try { result = await transport.get(url, provider, cacheKey, signal, (data) => checkedTdt(data, query)); }
    catch (error) {
      if (error instanceof PlaceSearchError && error.category === 'noresult') return { places: [], suggestions: [] };
      throw error;
    }
    const hasMore = Number.isFinite(result.total) ? start + result.places.length < result.total : result.places.length === PAGE_SIZE;
    const next = hasMore && start + PAGE_SIZE <= 300 ? {
      provider, query, start: start + PAGE_SIZE, queryType: type, mapBound: bound,
      ...(specify ? { specify } : {}),
      ...(city && (!nationwide || preserveCityWhenWide) ? { city } : {}), nationwide,
    } : undefined;
    return { places: sortPlaces(result.places, near, options.city), suggestions: result.suggestions, ...(next ? { next } : {}) };
  }

  async function searchPlacesDetailed(rawQuery: string, near: Coordinate | null, signal: AbortSignal,
    source: PlaceSearchSource = 'auto', options: PlaceSearchOptions = {}): Promise<PlaceSearchDetailedResult> {
    const query = rawQuery.trim().slice(0, 120);
    if (query.length < 2) throw new PlaceSearchError('parameter', '请输入至少两个字符的地点名称。');
    if (near && !coordinate(near)) throw new PlaceSearchError('parameter', '搜索中心坐标无效。');
    signal.throwIfAborted();
    if (options.page) {
      if (options.page.query.trim() !== query) throw new PlaceSearchError('parameter', '分页搜索条件已变化，请重新搜索。');
      if (source !== 'auto' && source !== options.page.provider) throw new PlaceSearchError('parameter', '分页来源与当前搜索来源不一致。');
      const page = await searchOne(query, near, signal, options.page.provider, { ...options, page: options.page });
      return { places: page.places, suggestions: page.suggestions, warnings: [], ...(page.next ? { next: page.next } : {}) };
    }
    const cfg = getConfig();
    const effectiveOptions = options.nationwide ? { ...options, city: undefined } : options;
    const hasChinaContext = Boolean(queryCity(query) || /[\p{Script=Han}]/u.test(query)
      || (options.city && /[\p{Script=Han}]/u.test(options.city)));
    const primary: SearchProvider = source === 'auto'
      ? cfg.domestic && (nearChina(near) || hasChinaContext || (!near && !options.city)) ? 'tianditu' : 'photon'
      : source;
    const warnings: string[] = [];
    let suggestions: PlaceSearchDetailedResult['suggestions'] = [];
    let result: Awaited<ReturnType<typeof searchOne>> | undefined;
    try {
      result = await searchOne(query, near, signal, primary, effectiveOptions);
      if (result.places.length) return { ...result, warnings };
      suggestions = result.suggestions;
      warnings.push(`${primary === 'tianditu' ? '天地图' : 'Photon'}没有找到匹配地点。`);
      if (primary === 'tianditu' && !options.nationwide) {
        const broad = await searchOne(query, near, signal, primary, { ...effectiveOptions, nationwide: true }, 7, Boolean(effectiveOptions.city || queryCity(query)), true);
        suggestions = mergeSuggestions(suggestions, broad.suggestions);
        if (broad.places.length) return { ...broad, suggestions, warnings: [...warnings, '已扩大天地图搜索范围。'] };
      }
    } catch (error) {
      if (signal.aborted) throw error;
      if (source !== 'auto') throw error;
      if (error instanceof PlaceSearchError && !['network', 'service', 'rate', 'auth'].includes(error.category)) throw error;
      warnings.push(error instanceof Error ? error.message : searchErrorMessage('service'));
    }
    if (source !== 'auto') return { places: [], suggestions, warnings: warnings.length ? warnings : [searchErrorMessage('noresult')] };
    const secondary: SearchProvider | undefined = primary === 'tianditu' ? 'photon' : undefined;
    if (secondary) {
      try {
        const fallback = await searchOne(query, near, signal, secondary, effectiveOptions);
        suggestions = mergeSuggestions(suggestions, fallback.suggestions);
        if (fallback.places.length) return { ...fallback, suggestions, warnings: [...warnings, '已切换到Photon搜索。'] };
        warnings.push('Photon也没有找到匹配地点。');
      } catch (error) {
        if (signal.aborted) throw error;
        warnings.push(error instanceof Error ? error.message : searchErrorMessage('service'));
      }
    }
    signal.throwIfAborted();
    try {
      const places = (await offlineSearch(query)).slice(0, PAGE_SIZE).map((place) => ({ ...place, source: 'offline' as const, precision: 'street' as const }));
      signal.throwIfAborted();
      if (places.length) return { places, suggestions, warnings: [...warnings, '以下是已下载路网中的道路位置，定位较粗略。'] };
    } catch (error) {
      if (signal.aborted) throw error;
    }
    return { places: [], suggestions, warnings: warnings.length ? warnings : [searchErrorMessage('noresult')] };
  }
  return { searchPlacesDetailed };
}

const searcher = createPlaceSearcher();
export const searchPlacesDetailed = searcher.searchPlacesDetailed;
export function defaultPlaceSearchSource(): PlaceSearchSource { return 'auto'; }
