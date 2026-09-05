export type Hour = {
  time: number;
  temperature: number | null;
  rain: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  wind: number | null;
  direction: number | null;
  humidity: number | null;
  code: number | null;
};
export type WeatherCell = {
  lng: number;
  lat: number;
  elevation: number | null;
  hours: Hour[];
};
export type WeatherData = {
  cells: WeatherCell[];
  times: number[];
  fetchedAt: number;
  anchor: [number, number];
};
export const GRID_STEP = 0.32;
export const numberOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
export function gridPoints(lng: number, lat: number) {
  return Array.from({ length: 25 }, (_, i) => ({
    lng: Number((lng + ((i % 5) - 2) * GRID_STEP).toFixed(3)),
    lat: Number((lat + (Math.floor(i / 5) - 2) * GRID_STEP).toFixed(3)),
  }));
}
export function normalizeWeather(
  raw: unknown,
  points: { lng: number; lat: number }[],
  now = Date.now(),
): WeatherData {
  const records = Array.isArray(raw) ? raw : [raw];
  if (records.length !== points.length)
    throw new Error('天气数据不完整，请重试');
  const cells: WeatherCell[] = records.map((record, index) => {
    const h = record?.hourly;
    if (!h || !Array.isArray(h.time) || !h.time.length)
      throw new Error('天气服务未返回可用时段');
    return {
      ...points[index],
      elevation: numberOrNull(record.elevation),
      hours: h.time.map((time: unknown, i: number): Hour => {
        if (typeof time !== 'number' || !Number.isFinite(time))
          throw new Error('天气时间格式无效');
        const value = (key: string) => numberOrNull(h[key]?.[i]);
        return {
          time: time * 1000,
          temperature: value('temperature_2m'),
          rain: value('rain'),
          low: value('cloud_cover_low'),
          mid: value('cloud_cover_mid'),
          high: value('cloud_cover_high'),
          wind: value('wind_speed_10m'),
          direction: value('wind_direction_10m'),
          humidity: value('relative_humidity_2m'),
          code: value('weather_code'),
        };
      }),
    };
  });
  const times = cells[0].hours.map((h) => h.time);
  if (
    cells.some(
      (cell) =>
        cell.hours.length !== times.length ||
        cell.hours.some((h, i) => h.time !== times[i]),
    )
  )
    throw new Error('各位置的天气时段不一致');
  return {
    cells,
    times,
    fetchedAt: now,
    anchor: [points[12].lng, points[12].lat],
  };
}
export function nearestCell(
  data: WeatherData | null,
  lng: number,
  lat: number,
): WeatherCell | null {
  if (
    !data ||
    Math.abs(data.anchor[0] - lng) > GRID_STEP * 2.5 ||
    Math.abs(data.anchor[1] - lat) > GRID_STEP * 2.5
  )
    return null;
  return data.cells.reduce((a, b) =>
    Math.hypot(a.lng - lng, a.lat - lat) < Math.hypot(b.lng - lng, b.lat - lat)
      ? a
      : b,
  );
}
export const rainColor = (rain: number) =>
  rain < 0.1
    ? '#55747f'
    : rain < 1
      ? '#6ed8e9'
      : rain < 4
        ? '#41a9ec'
        : rain < 10
          ? '#6b72df'
          : '#c36acf';
export function describeWeather(code: number | null) {
  if (code === null) return '暂无天气状态';
  if (code <= 3) return ['晴', '晴间多云', '多云', '阴'][code];
  if (code <= 48) return '雾';
  if (code <= 57) return '毛毛雨';
  if (code <= 67) return '降雨';
  if (code <= 77) return '降雪';
  if (code <= 82) return '阵雨';
  if (code <= 86) return '阵雪';
  return '雷暴';
}
