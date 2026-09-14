/** Presentation density only; grade thresholds belong to routeAnalysis/config. */
export const ROUTE_WARNING_POLICY = {
  repeatDistanceMetres: 200,
  // Extremely sparse/long routes use evenly spaced marks across the whole run.
  maximumMarkersPerRun: 512,
} as const;
