/** Display/analysis thresholds; edit here without changing storage or map rendering. */
export const SLOPE_BANDS = [
  { maximum: 10, color: '#16853b', label: '缓' },
  { maximum: 20, color: '#e8b523', label: '较陡' },
  { maximum: Infinity, color: '#ed492c', label: '陡' },
] as const;
export const ANALYSIS_POLICY = {
  maximumGapSeconds: 120,
  maximumSpeedMetresPerSecond: 80,
  minimumSlopeSpanMetres: 30,
  steepestWindowMetres: 50,
  steepThresholdPercent: 20,
  missingColor: '#8b9699',
} as const;
