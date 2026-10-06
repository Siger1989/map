import { isOfficialRadarFrameUrl, isValidRadarDate, normalizeRadarDirectory, parseBeijingRadarTime, type RadarDirectory } from '../../../modules/weather/cmaRadar.ts';

const DIRECTORY_URL = 'https://data.cma.cn/api/vis/getVasData';
const DIRECTORY_TTL = 30_000;
const JSON_LIMIT = 8 * 1024 * 1024;
const PNG_LIMIT = 12 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
type DirectoryRecord = { value: RadarDirectory; imageUrls: Map<string, string>; expiresAt: number };
const cache = new Map<string, DirectoryRecord>();
const inflight = new Map<string, Promise<DirectoryRecord>>();
const DIRECTORY_CACHE_MAX = 3;

function pruneDirectoryCache(now: number) {
  for (const [date, item] of cache) if (item.expiresAt <= now) cache.delete(date);
  while (cache.size > DIRECTORY_CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (!oldest) break;
    cache.delete(oldest[0]);
  }
}

function beijingDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now).replaceAll('-', '');
}

function previousDate(date: string): string {
  const value = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)) - 1));
  return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}${String(value.getUTCDate()).padStart(2, '0')}`;
}

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('雷达响应过大');
  if (!response.body) throw new Error('雷达响应为空');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('雷达响应过大');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function fetchDirectory(date: string): Promise<DirectoryRecord> {
  pruneDirectoryCache(Date.now());
  const cached = cache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached;
  let work = inflight.get(date);
  if (!work) {
    work = (async () => {
      const url = new URL(DIRECTORY_URL);
      url.searchParams.set('datacode', 'RAD__B0_CR');
      url.searchParams.set('dDatetime', date);
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error('国家气象数据网雷达目录暂不可用');
      const bytes = await boundedBytes(response, JSON_LIMIT);
      let raw: unknown;
      try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new Error('国家气象数据网雷达目录格式无效'); }
      const normalized = normalizeRadarDirectory(raw, date);
      const root = raw as { data?: { data?: unknown[] } };
      const normalizedTimes = new Map(normalized.frames.map(frame => [frame.id, frame.observedAt]));
      const imageUrls = new Map<string, string>();
      for (const candidate of root.data?.data ?? []) {
        if (!candidate || typeof candidate !== 'object') continue;
        const row = candidate as Record<string, unknown>;
        const id = String(row.id ?? '');
        const observedAt = parseBeijingRadarTime(row.vshijian);
        if (!imageUrls.has(id) && normalizedTimes.get(id) === observedAt &&
            typeof row.vshijian === 'string' && row.vshijian.startsWith(date) && isOfficialRadarFrameUrl(row.fileURL, row)) {
          const secureUrl = new URL(row.fileURL as string);
          secureUrl.protocol = 'https:';
          imageUrls.set(id, secureUrl.toString());
        }
      }
      const record = { value: normalized, imageUrls, expiresAt: Date.now() + DIRECTORY_TTL };
      pruneDirectoryCache(Date.now());
      cache.set(date, record);
      pruneDirectoryCache(Date.now());
      return record;
    })().finally(() => inflight.delete(date));
    inflight.set(date, work);
  }
  return work;
}

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  const dateValues = url.searchParams.getAll('date');
  const frameValues = url.searchParams.getAll('frame');
  const hasDate = url.searchParams.has('date'), hasFrame = url.searchParams.has('frame');
  const suppliedDate = hasDate ? dateValues[0] : null;
  const frameId = hasFrame ? frameValues[0] : null;
  if (keys.some(key => key !== 'date' && key !== 'frame') ||
      dateValues.length > 1 || frameValues.length > 1 ||
      (hasDate && (!suppliedDate || !isValidRadarDate(suppliedDate))) ||
      (hasFrame && (!frameId || !/^[A-Za-z0-9_-]{1,80}$/.test(frameId))))
    return jsonError(400, '雷达请求参数无效');

  const today = beijingDate();
  const date = suppliedDate ?? today;
  if (date > today) return jsonError(400, '不能请求未来日期的雷达数据');
  try {
    let record = await fetchDirectory(date);
    if (frameId) {
      if (!record.value.frames.some(frame => frame.id === frameId)) return jsonError(404, '指定雷达时次不存在');
      const imageUrl = record.imageUrls.get(frameId);
      if (!imageUrl) return jsonError(502, '官方雷达图片地址校验失败');
      return await fetchOfficialImage(imageUrl);
    }
    if (!suppliedDate && record.value.frames.length === 0) {
      record = await fetchDirectory(previousDate(today));
    }
    return Response.json(record.value, {
      headers: { 'Cache-Control': 'public, max-age=15', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return jsonError(502, error instanceof Error ? error.message : '雷达数据暂不可用');
  }
}

async function fetchOfficialImage(source: string): Promise<Response> {
  const imageUrl = new URL(source);
  if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'image.data.cma.cn' ||
      imageUrl.port || imageUrl.username || imageUrl.password || imageUrl.search || imageUrl.hash ||
      !/^\/vis\/RAD__B0_CR\/\d{8}\/[A-Za-z0-9_.-]+\.png$/.test(imageUrl.pathname))
    throw new Error('官方雷达图片地址校验失败');
  const response = await fetch(imageUrl, {
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
    headers: { Referer: 'https://data.cma.cn/', 'User-Agent': 'Mozilla/5.0 ShantuWeatherRadar/1.0', Accept: 'image/png' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('国家气象数据网雷达图片暂不可用');
  const image = await boundedBytes(response, PNG_LIMIT);
  if (image.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((value, index) => image[index] !== value))
    throw new Error('国家气象数据网返回的文件不是PNG图片');
  const headers = new Headers({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=120', 'X-Content-Type-Options': 'nosniff' });
  headers.set('Content-Length', String(image.byteLength));
  return new Response(Buffer.from(image), { status: 200, headers });
}
