export type SamplingPolicy = {
  mode: 'power' | 'standard' | 'accuracy' | 'custom';
  intervalSeconds: number;
  distanceMetres: number;
  stationarySeconds: number;
  adaptive: boolean;
  distanceOnly: boolean;
  recordOnNavigation: boolean;
};
export const SAMPLING_KEY = 'shantu.recording-sampling.v1';
export const SAMPLING_PRESETS = {
  power: {
    intervalSeconds: 10,
    distanceMetres: 10,
    stationarySeconds: 60,
    adaptive: true,
  },
  standard: {
    intervalSeconds: 4,
    distanceMetres: 5,
    stationarySeconds: 30,
    adaptive: false,
  },
  accuracy: {
    intervalSeconds: 1,
    distanceMetres: 2,
    stationarySeconds: 10,
    adaptive: false,
  },
} as const;
export const DEFAULT_SAMPLING: SamplingPolicy = {
  mode: 'standard',
  ...SAMPLING_PRESETS.standard,
  distanceOnly: false,
  recordOnNavigation: false,
};
const integer = (value: unknown, minimum: number, maximum: number) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= minimum &&
  value <= maximum;
export function validSampling(value: unknown): value is SamplingPolicy {
  const p = value as SamplingPolicy | null;
  return (
    !!p &&
    ['power', 'standard', 'accuracy', 'custom'].includes(p.mode) &&
    integer(p.intervalSeconds, 1, 30) &&
    integer(p.distanceMetres, 1, 100) &&
    integer(p.stationarySeconds, 10, 90) &&
    p.stationarySeconds >= p.intervalSeconds &&
    typeof p.adaptive === 'boolean' &&
    typeof p.distanceOnly === 'boolean' &&
    typeof p.recordOnNavigation === 'boolean'
  );
}
/** Sampling only; stale fixes, accuracy, speed and segment limits are checked by the recorder. */
export function acceptsSample(
  distance: number,
  seconds: number,
  policy: SamplingPolicy,
) {
  if (seconds < policy.intervalSeconds) return false;
  return (
    distance >= policy.distanceMetres ||
    (!policy.distanceOnly && seconds >= policy.stationarySeconds)
  );
}
