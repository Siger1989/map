import { basemapConfiguration } from '../cartography/basemaps.ts';
import { offlinePlaces } from '../offlineRouting/provider.ts';
import { normalizeTiandituPlaces, normalizeTiandituSuggestions, buildTiandituSearchURL } from './tiandituSearch.ts';
import { buildTiandituGeocoderURL, isAddressLike, normalizeTiandituGeocode } from './tiandituGeocoder.ts';
import { buildPhotonSearchURL, normalizePhoton } from './photonSearch.ts';
import { createPlaceSearchTransport, PlaceSearchError, searchErrorMessage, type SearchProvider } from './placeSearchTransport.ts';
import { coordinate, type Coordinate, type RoutePlace } from './types.ts';
import { credentialScope, mapBound, nearChina, queryCity, sortPlaces, mergeSuggestions } from './placeSearchHelpers.ts';
import { cachePlaces, readCachedPlaces, type PlaceCacheSource } from './offlinePlaceCache.ts';
import {
  CONTEXT_RADIUS_METERS, boundedMapSearch, contextAnchorCity, contextAnchorSuggestions, exactContextAnchors,
  contextAnchorPrefixSuggestions, contextPlaceMatchesCity, isContextAnchorCompletion, parseContextAnchorPrefix,
  parseContextSearchQuery, withinContextRadius,
} from './contextSearch.ts';

// TianDiTu request fields/statuses follow official docs; coordinate reference is unspecified by them.
export type PlaceSearchSource = 'auto' | SearchProvider;
export type SearchPageToken = {
  provider: SearchProvider; query: string; start: number; queryType?: number;
  mapBound?: string; specify?: string; city?: string; nationwide?: boolean;
  searchQuery?: string; nearby?: { anchor: Coordinate; radiusMeters: number }; nearbyName?: string;
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
  isOnline?: () => boolean;
  readCache?: (query: string, source?: PlaceCacheSource) => RoutePlace[];
  saveCache?: (query: string, places: RoutePlace[]) => void;
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
  const isOnline = config.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const readCache = config.readCache ?? readCachedPlaces;
  const saveCache = config.saveCache ?? cachePlaces;
  const safeReadCache = (query: string, source: PlaceSearchSource) => {
    try { return readCache(query, source === 'auto' ? 'auto' : source); } catch { return []; }
  };
  const safeSaveCache = (query: string, places: RoutePlace[]) => {
    if (!places.length || !isOnline()) return;
    try { saveCache(query, places); } catch { /* Persistent cache is an optional enhancement. */ }
  };
  const transport = createPlaceSearchTransport(config);

  async function searchOne(query: string, near: Coordinate | null, signal: AbortSignal,
    provider: SearchProvider, options: PlaceSearchOptions, queryType?: number,
    preserveCityWhenWide = false, skipGeocoder = false): Promise<SearchPageResult> {
    const requestQuery = options.page?.searchQuery ?? query;
    if (provider === 'photon') {
      const searchNear = options.page?.nearby?.anchor ?? near;
      const url = buildPhotonSearchURL(requestQuery, searchNear, options);
      const result = await transport.get(url, provider, `photon:${url}`, signal, (data) => normalizePhoton(data, requestQuery, options.nationwide ? undefined : options.city));
      let places = options.page?.nearby
        ? withinContextRadius(result.places, options.page.nearby.anchor, options.page.nearby.radiusMeters)
        : result.places;
      places = sortPlaces(places, options.page?.nearby?.anchor ?? near, options.nationwide ? undefined : options.city);
      safeSaveCache(query, places);
      if (requestQuery !== query) safeSaveCache(requestQuery, places);
      return { ...result, places };
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
        if (geocoded.length) {
          safeSaveCache(query, geocoded);
          return { places: geocoded, suggestions: [] };
        }
      } catch (error) {
        if (!(error instanceof PlaceSearchError) || error.category !== 'noresult') throw error;
      }
    }
    const start = Math.max(0, Math.min(300, Math.floor(page?.start ?? 0)));
    const nationwide = options.nationwide ?? page?.nationwide ?? false;
    const city = page?.city ?? options.city ?? queryCity(query);
    const bound = page?.mapBound ?? mapBound(city ? null : near, nationwide);
    const isLocalViewport = Boolean(near && !city && !nationwide && near[0] >= 73 && near[0] <= 136 && near[1] >= 3 && near[1] <= 54);
    const type = page?.queryType ?? queryType ?? (isLocalViewport ? 2 : 1);
    const specify = page?.specify ?? (nationwide && !preserveCityWhenWide ? undefined : city);
    const url = buildTiandituSearchURL(requestQuery, cfg.token, {
      start, count: PAGE_SIZE, queryType: type, mapBound: bound,
      specify,
    });
    const cacheKey = `tianditu:${credentialScope(cfg.token)}:${requestQuery}:${start}:${type}:${bound}:${specify ?? ''}`;
    let result: ReturnType<typeof checkedTdt>;
    try { result = await transport.get(url, provider, cacheKey, signal, (data) => checkedTdt(data, requestQuery)); }
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
    let places = result.places;
    if (page?.nearby) places = withinContextRadius(places, page.nearby.anchor, page.nearby.radiusMeters);
    places = sortPlaces(places, page?.nearby?.anchor ?? near, options.city);
    safeSaveCache(query, places);
    if (requestQuery !== query) safeSaveCache(requestQuery, places);
    const contextualNext = next && page?.nearby
      ? { ...next, searchQuery: requestQuery, nearby: page.nearby, ...(page.nearbyName ? { nearbyName: page.nearbyName } : {}) }
      : next;
    return { places, suggestions: result.suggestions, ...(contextualNext ? { next: contextualNext } : {}) };
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
      if (!isOnline()) {
        return { places: [], suggestions: [], warnings: [
          ...(options.page.nearby ? [`按${options.page.nearbyName ?? '参照地点'}附近搜索；列表距离仍按地图中心显示，不代表GPS。`] : []),
          '当前离线，没有更多已缓存地点。',
        ] };
      }
      const page = await searchOne(query, near, signal, options.page.provider, { ...options, page: options.page });
      return { places: page.places, suggestions: page.suggestions,
        warnings: options.page.nearby ? [`按${options.page.nearbyName ?? '参照地点'}附近搜索；列表距离仍按地图中心显示，不代表GPS。`] : [],
        ...(page.next ? { next: page.next } : {}) };
    }
    const contextualQuery = parseContextSearchQuery(query);
    const contextPrefix = contextualQuery ? null : parseContextAnchorPrefix(query);
    if (!contextualQuery && isContextAnchorCompletion(query)) {
      return { places: [], suggestions: [], warnings: ['请继续输入完整的参照地点名称，再搜索附近地点。'] };
    }
    const cfg = getConfig();
    const effectiveOptions = options.nationwide ? { ...options, city: undefined } : options;
    const hasChinaContext = Boolean(queryCity(query) || /[\p{Script=Han}]/u.test(query)
      || (options.city && /[\p{Script=Han}]/u.test(options.city)));
    const primary: SearchProvider = source === 'auto'
      ? cfg.domestic && (nearChina(near) || hasChinaContext || (!near && !options.city)) ? 'tianditu' : 'photon'
      : source;
    if (contextualQuery) {
      const contextProvider: SearchProvider = source === 'auto' && primary === 'tianditu' && !cfg.token ? 'photon' : primary;
      const cacheSource = source;
      const nearbyWarning = `按检索到的${contextualQuery.anchor}参考点附近搜索${contextualQuery.target}；具体入口请在地图核对，列表距离仍按地图中心显示，不代表GPS。`;
      const cached = safeReadCache(query, cacheSource);
      if (!isOnline()) {
        if (cached.length) return { places: cached, suggestions: [], warnings: [nearbyWarning, '离线缓存，可能已过期。'] };
        return { places: [], suggestions: [], warnings: [`离线且未缓存“${contextualQuery.anchor}附近${contextualQuery.target}”搜索结果；请联网搜索一次或下载地点库。`] };
      }
      try {
        const anchorQueryType = effectiveOptions.city ? 1 : 2;
        const anchorPage = await searchOne(contextualQuery.anchor, near, signal, contextProvider,
          { ...effectiveOptions, nationwide: false }, anchorQueryType, true, true);
        safeSaveCache(contextualQuery.anchor, anchorPage.places);
        const anchorPlaces = anchorPage.places.filter((place) => contextPlaceMatchesCity(place, effectiveOptions.city));
        const exactAnchors = exactContextAnchors(anchorPlaces, contextualQuery.anchor);
        if (exactAnchors.length !== 1) {
          const placeSuggestions = exactAnchors.length
            ? contextAnchorSuggestions(exactAnchors, contextualQuery.target)
            : contextAnchorSuggestions(anchorPlaces, contextualQuery.target);
          const cities = exactAnchors.map(contextAnchorCity);
          const cityCanDisambiguate = cities.every(Boolean) && new Set(cities).size === exactAnchors.length;
          const suggestions = exactAnchors.length
            ? (cityCanDisambiguate ? placeSuggestions : [])
            : placeSuggestions;
          return { places: [], suggestions,
            warnings: [exactAnchors.length > 1
              ? cityCanDisambiguate
                ? `“${contextualQuery.anchor}”存在多个真实地点，请从建议中补充城市。`
                : `找到多个同名“${contextualQuery.anchor}”参考点，请补充更具体的地标或入口名称。`
              : `未能唯一确认参照地点“${contextualQuery.anchor}”，请从真实地点建议中选择或补充城市。`] };
        }
        const anchor = exactAnchors[0];
        const radiusMeters = CONTEXT_RADIUS_METERS;
        const page: SearchPageToken = {
          provider: contextProvider, query, searchQuery: contextualQuery.target, start: 0, queryType: 2,
          mapBound: boundedMapSearch(anchor.coordinates, radiusMeters), nationwide: false,
          ...(effectiveOptions.city ? { city: effectiveOptions.city } : {}),
          nearby: { anchor: anchor.coordinates, radiusMeters },
          nearbyName: contextualQuery.anchor,
        };
        const targetPage = await searchOne(query, near, signal, contextProvider,
          { ...effectiveOptions, page }, 2, true, true);
        return { places: targetPage.places, suggestions: targetPage.suggestions,
          warnings: [nearbyWarning, ...(anchorPage.next ? [`参照点以首屏检索到的唯一“${contextualQuery.anchor}”名称匹配结果为准，其他同名地点尚未逐页检查。`] : [])],
          ...(targetPage.next ? { next: targetPage.next } : {}) };
      } catch (error) {
        if (signal.aborted) throw error;
        const fallback = safeReadCache(query, cacheSource);
        if (fallback.length) return { places: fallback, suggestions: [], warnings: [nearbyWarning, '离线缓存，可能已过期。'] };
        if (source !== 'auto') throw error;
        return { places: [], suggestions: [], warnings: [nearbyWarning, error instanceof Error ? error.message : searchErrorMessage('service')] };
      }
    }
    if (contextPrefix) {
      const contextProvider: SearchProvider = source === 'auto' && primary === 'tianditu' && !cfg.token ? 'photon' : primary;
      if (!isOnline()) {
        const cached = safeReadCache(contextPrefix.anchor, source);
        const suggestions = contextAnchorPrefixSuggestions(cached, contextPrefix.target, contextPrefix.anchor);
        return { places: [], suggestions, warnings: [suggestions.length
          ? '已从本机离线缓存找到参照地点建议，位置可能已过期。'
          : `离线且未缓存“${contextPrefix.anchor}”参照地点候选；请联网搜索后选择真实参照点。`] };
      }
      try {
        const prefixPage = await searchOne(contextPrefix.anchor, near, signal, contextProvider,
          { ...effectiveOptions, nationwide: false }, effectiveOptions.city ? 1 : 2, true, true);
        const candidates = prefixPage.places.filter((place) => contextPlaceMatchesCity(place, effectiveOptions.city));
        const suggestions = contextAnchorPrefixSuggestions(candidates, contextPrefix.target, contextPrefix.anchor);
        return { places: [], suggestions, warnings: [suggestions.length
          ? `找到与“${contextPrefix.anchor}”匹配的真实参照地点，请选择后搜索附近${contextPrefix.target}。`
          : `暂未找到名称包含“${contextPrefix.anchor}”的真实参照地点。`] };
      } catch (error) {
        if (signal.aborted) throw error;
        const cached = safeReadCache(query, source);
        return { places: cached, suggestions: [], warnings: [
          ...(cached.length ? ['离线缓存，可能已过期。'] : []),
          error instanceof Error ? error.message : searchErrorMessage('service'),
        ] };
      }
    }
    if (!isOnline()) {
      const cached = safeReadCache(query, source);
      if (cached.length) return { places: cached, suggestions: [], warnings: ['离线缓存，可能已过期。'] };
      const roads = (await offlineSearch(query)).slice(0, PAGE_SIZE)
        .map((place) => ({ ...place, source: 'offline' as const, precision: 'street' as const }));
      return { places: roads, suggestions: [], warnings: roads.length ? ['以下是已下载路网中的道路位置，定位较粗略。'] : ['当前离线，且没有可用的地点缓存或已下载路网结果。'] };
    }
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
      if (source !== 'auto') {
        const fallback = safeReadCache(query, source);
        if (fallback.length) return { places: fallback, suggestions: [], warnings: ['离线缓存，可能已过期。'] };
        throw error;
      }
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
    const cached = safeReadCache(query, source);
    if (cached.length) return { places: cached, suggestions, warnings: [...warnings, '离线缓存，可能已过期。'] };
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
