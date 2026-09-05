export type SectionSettings = {
  enabled: boolean;
  altitude: number;
  color: string;
};
export type SectionStatus = {
  phase: 'idle' | 'loading' | 'ready' | 'partial' | 'error';
  min: number;
  max: number;
  spacing: number;
  samples: number;
  valid: number;
  tiles: number;
  models: number;
};
export const INITIAL_SECTION_STATUS: SectionStatus = {
  phase: 'idle',
  min: -500,
  max: 9000,
  spacing: 0,
  samples: 0,
  valid: 0,
  tiles: 0,
  models: 0,
};
