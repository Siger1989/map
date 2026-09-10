import type { RouteQr } from './qrCodec';
import type { Transfer } from '../outdoor/exchange';
import type { ManualTrack } from '../tracks/drawing';

/** Scanning only creates a saved track. Guidance requires an explicit later action. */
export function qrTransfer(
  data: RouteQr,
  now = Date.now(),
): { transfer: Transfer; track: ManualTrack } {
  const track: ManualTrack = {
    id: crypto.randomUUID(),
    name:
      data.name +
      (data.tolerance
        ? `（扫码${data.tolerance > 50 ? '概括' : '简化'}·${data.tolerance}米）`
        : '（扫码）'),
    createdAt: now,
    segments: data.segments.map((line) => line.map((p) => [...p])),
    source: 'shared',
    ...(data.style ? { style: data.style } : {}),
    ...(data.edgeColors ? { edgeColors: data.edgeColors } : {}),
    ...(data.colorConditions ? { colorConditions: data.colorConditions } : {}),
    navigationMode: data.mode,
    sharedRoute: {
      stops: data.stops.map((s) => ({
        name: s.name,
        coordinates: [...s.coordinates],
      })),
      duration: data.duration ?? null,
      tolerance: data.tolerance,
    },
  };
  return {
    track,
    transfer: {
      format: 'guanyun-backup',
      version: 1,
      tracks: [track],
      favorites: [],
      annotations: [],
    },
  };
}
