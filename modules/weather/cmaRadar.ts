export type RadarFrame = {
  id: string;
  observedAt: string;
  imagePath: string;
};

export type RadarDirectory = {
  frames: RadarFrame[];
  latestAt: string | null;
  source: '国家气象数据网';
  product: '全国雷达拼图 · 组合反射率';
  unit: 'dBZ';
};

const DATE_RE = /^\d{8}$/;
const FRAME_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function parseBeijingRadarTime(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{14}$/.test(value)) return null;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8)), hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12)), second = Number(value.slice(12, 14));
  const utc = Date.UTC(year, month - 1, day, hour - 8, minute, second);
  const check = new Date(utc + 8 * 3600_000);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day || check.getUTCHours() !== hour ||
      check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) return null;
  return new Date(utc).toISOString();
}

export function isValidRadarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(4, 6)), day = Number(value.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function isOfficialRadarFrameUrl(value: unknown, row: Record<string, unknown>): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const name = typeof row.cfname === 'string' ? row.cfname : '';
    const pathDate = url.pathname.split('/')[3] ?? '';
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname === 'image.data.cma.cn' &&
      url.port === '' && url.username === '' && url.password === '' && !url.search && !url.hash &&
      /^\/vis\/RAD__B0_CR\/\d{8}\/[A-Za-z0-9_.-]+\.png$/.test(url.pathname) &&
      /^\d{8}$/.test(pathDate) && new RegExp(`(?:^|_)${pathDate}(?:_|\\d)`).test(name) && name.length > 0 &&
      url.pathname.endsWith(`/${name}`);
  } catch { return false; }
}

export function normalizeRadarDirectory(raw: unknown, requestedDate: string, now = Date.now()): RadarDirectory {
  if (!isValidRadarDate(requestedDate)) throw new Error('雷达日期格式无效');
  const root = raw as { code?: unknown; data?: { data?: unknown } } | null;
  if (!root || !(root.code === 200 || root.code === '200') || !Array.isArray(root.data?.data))
    throw new Error('国家气象数据网未返回可用雷达目录');
  const frames: RadarFrame[] = [];
  for (const candidate of root.data.data) {
    if (!candidate || typeof candidate !== 'object') continue;
    const row = candidate as Record<string, unknown>;
    if (row.dataCode !== 'RAD__B0_CR' || !FRAME_ID_RE.test(String(row.id ?? '')) ||
        typeof row.vshijian !== 'string' || !row.vshijian.startsWith(requestedDate)) continue;
    const observedAt = parseBeijingRadarTime(row.vshijian);
    if (!observedAt || Date.parse(observedAt) > now || !isOfficialRadarFrameUrl(row.fileURL, row)) continue;
    frames.push({
      id: String(row.id),
      observedAt,
      imagePath: buildRadarRequestUrl(requestedDate, String(row.id)),
    });
  }
  frames.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  const unique = frames.filter((frame, index) => frames.findIndex(other => other.id === frame.id) === index);
  return {
    frames: unique,
    latestAt: unique[0]?.observedAt ?? null,
    source: '国家气象数据网',
    product: '全国雷达拼图 · 组合反射率',
    unit: 'dBZ',
  };
}

export function buildRadarRequestUrl(date?: string, frame?: string): string {
  if (date !== undefined && !isValidRadarDate(date)) throw new Error('雷达日期格式无效');
  if (frame !== undefined && !FRAME_ID_RE.test(frame)) throw new Error('雷达帧标识无效');
  const query = new URLSearchParams();
  if (date) query.set('date', date);
  if (frame) query.set('frame', frame);
  return `/api/radar${query.size ? `?${query}` : ''}`;
}
