export type CollectionRegion = {
  coordinateKey: string;
  country: string;
  province: string;
  city: string;
  source: 'auto' | 'manual';
  checkedAt: number;
  language?: 'local';
  district?: string;
  township?: string;
  street?: string;
  locality?: string;
};
export type CollectionRegions = Record<string, CollectionRegion>;
export const REGION_STORAGE = 'shantu.collection-regions.v1';
export const coordinateKey = (xy: [number, number]) =>
  xy.map((v) => v.toFixed(6)).join(',');
export function validateRegions(v: unknown): CollectionRegions {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).length > 3000 ||
    !Object.entries(v).every(
      ([key, r]) =>
        /^(route|track|annotation|section|area):.{1,200}$/.test(key) &&
        r &&
        typeof r.coordinateKey === 'string' &&
        /^-?\d{1,3}\.\d{6},-?\d{1,2}\.\d{6}$/.test(r.coordinateKey) &&
        [r.country, r.province, r.city].every(
          (s) => typeof s === 'string' && s.length <= 80,
        ) &&
        [r.district, r.township, r.street, r.locality].every(
          (s) => s === undefined || (typeof s === 'string' && s.length <= 80),
        ) &&
        ['auto', 'manual'].includes(r.source) &&
        Number.isFinite(r.checkedAt),
    )
  )
    throw new Error('收藏地区信息无效，原数据已保留');
  return v as CollectionRegions;
}
export const readRegions = (raw: string | null) =>
  raw === null ? {} : validateRegions(JSON.parse(raw));
export function normalizeRegion(
  raw: unknown,
): Pick<
  CollectionRegion,
  | 'country'
  | 'province'
  | 'city'
  | 'district'
  | 'township'
  | 'street'
  | 'locality'
> {
  const features = (
    raw as { features?: { properties?: Record<string, unknown> }[] }
  )?.features;
  const p = Array.isArray(features) ? (features[0]?.properties ?? {}) : {};
  const text = (v: unknown) =>
    typeof v === 'string' ? v.trim().slice(0, 80) : '';
  // Missing administrative fields remain unknown; don't infer a city from a street or a nearby POI.
  return {
    country: text(p.country),
    province: text(p.state),
    city: text(p.city || p.county),
    ...(!!p.county && { district: text(p.county) }),
    ...(!!p.district && { township: text(p.district) }),
    ...(!!p.street && { street: text(p.street) }),
    ...(!!p.locality && { locality: text(p.locality) }),
  };
}
