import type { Coordinate } from '../navigation/types';

export type CoordinateQueryResult =
  | { status: 'not-coordinate' }
  | { status: 'invalid'; error: string }
  | { status: 'valid'; coordinate: Coordinate; latitude: number; longitude: number };

const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const LAT_LABEL = '(?:纬度|latitude|lat)';
const LON_LABEL = '(?:经度|longitude|lon|lng)';
// Labels are an input syntax only when followed by a numeric value. Place names
// such as London, Portland or 纬度咖啡 must continue through normal place search.
const HAS_COORDINATE_LABEL = new RegExp(`(?:^|[\\s,])(?:${LAT_LABEL}|${LON_LABEL})\\s*[:：=]?\\s*[+-]?(?:\\d|\\.)`, 'i');

function checked(latitude: number, longitude: number): CoordinateQueryResult {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { status: 'invalid', error: '坐标必须是有限的十进制数。' };
  }
  if (latitude < -90 || latitude > 90) {
    return { status: 'invalid', error: '纬度需在 -90° 到 90° 之间。' };
  }
  if (longitude < -180 || longitude > 180) {
    return { status: 'invalid', error: '经度需在 -180° 到 180° 之间。' };
  }
  return { status: 'valid', coordinate: [longitude, latitude], latitude, longitude };
}

function labeledValue(text: string, label: string): number | null {
  const matches = [...text.matchAll(new RegExp(`${label}\\s*[:：=]?\\s*(${NUMBER})`, 'gi'))];
  if (matches.length !== 1) return null;
  return Number(matches[0][1]);
}

/** Parse Google Maps-style decimal latitude, longitude into internal [longitude, latitude]. */
export function parseCoordinateQuery(input: string): CoordinateQueryResult {
  const text = input.trim().replace(/，/g, ',');
  if (!text) return { status: 'not-coordinate' };

  if (HAS_COORDINATE_LABEL.test(text)) {
    const latitude = labeledValue(text, LAT_LABEL);
    const longitude = labeledValue(text, LON_LABEL);
    if (latitude === null || longitude === null) {
      return { status: 'invalid', error: '坐标标签需同时写明纬度和经度，例如“纬度 39.9，经度 116.4”。' };
    }
    const numericTokens = text.match(new RegExp(NUMBER, 'g')) ?? [];
    if (numericTokens.length !== 2) {
      return { status: 'invalid', error: '坐标格式请只填写一组纬度和经度。' };
    }
    return checked(latitude, longitude);
  }

  const pair = new RegExp(`^\\s*(${NUMBER})(?:\\s*,\\s*|\\s+)(${NUMBER})\\s*$`).exec(text);
  if (pair) return checked(Number(pair[1]), Number(pair[2]));

  // A numeric-only pair/triple with coordinate separators is more likely an
  // attempted coordinate than a place name. Report it locally instead of
  // sending malformed coordinates to a geocoder.
  if (/^[+\-\d.,\s]+$/.test(text) && (text.match(new RegExp(NUMBER, 'g'))?.length ?? 0) >= 2) {
    return { status: 'invalid', error: '坐标格式应为“纬度, 经度”，且只填写两个数值。' };
  }
  return { status: 'not-coordinate' };
}

function expandExponent(value: number): string {
  if (Object.is(value, -0)) return '0';
  const text = String(value);
  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
  if (!match) return text;
  const [, sign, integer, fraction = '', exponentText] = match;
  const exponent = Number(exponentText);
  const digits = integer + fraction;
  const decimalPosition = integer.length + exponent;
  if (decimalPosition <= 0) return `${sign}0.${'0'.repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length) return `${sign}${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

/** Format an internal WGS84 [longitude, latitude] tuple as exact round-trip Google Maps text. */
export function formatCoordinateQuery(coordinate: Coordinate): string {
  const [longitude, latitude] = coordinate;
  const result = checked(latitude, longitude);
  if (result.status !== 'valid') throw new RangeError(result.status === 'invalid' ? result.error : '坐标无效。');
  return `${expandExponent(latitude)}, ${expandExponent(longitude)}`;
}
