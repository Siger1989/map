export const AREA_DISPLAY_UNIT_STORAGE_KEY = 'shantu-area-display-unit-v1';

export const AREA_DISPLAY_UNITS = [
  { id: 'm2', label: 'm²', squareMetres: 1 },
  { id: 'km2', label: 'km²', squareMetres: 1_000_000 },
  { id: 'ha', label: 'ha 公顷', squareMetres: 10_000 },
  { id: 'mu', label: '亩', squareMetres: 2000 / 3 },
  { id: 'ft2', label: 'ft²', squareMetres: 0.09290304 },
  { id: 'acre', label: 'acre 英亩', squareMetres: 4046.8564224 },
  { id: 'mi2', label: 'mi²', squareMetres: 2_589_988.110336 },
] as const;

export type AreaDisplayUnit = (typeof AREA_DISPLAY_UNITS)[number]['id'];
const DEFAULT_AREA_DISPLAY_UNIT: AreaDisplayUnit = 'm2';

export function convertAreaFromSquareMetres(area: number, unit: AreaDisplayUnit): number {
  if (!Number.isFinite(area) || area < 0) return 0;
  const definition = AREA_DISPLAY_UNITS.find(item => item.id === unit);
  return area / (definition?.squareMetres ?? 1);
}

export function formatAreaValue(area: number, unit: AreaDisplayUnit): string {
  const value = convertAreaFromSquareMetres(area, unit);
  return new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 4 }).format(value);
}

export function readAreaDisplayUnit(): AreaDisplayUnit {
  try {
    const stored = localStorage.getItem(AREA_DISPLAY_UNIT_STORAGE_KEY);
    return AREA_DISPLAY_UNITS.some(item => item.id === stored) ? stored as AreaDisplayUnit : DEFAULT_AREA_DISPLAY_UNIT;
  } catch {
    return DEFAULT_AREA_DISPLAY_UNIT;
  }
}

export function writeAreaDisplayUnit(unit: AreaDisplayUnit): boolean {
  if (!AREA_DISPLAY_UNITS.some(item => item.id === unit)) return false;
  try {
    localStorage.setItem(AREA_DISPLAY_UNIT_STORAGE_KEY, unit);
    return true;
  } catch {
    return false;
  }
}
