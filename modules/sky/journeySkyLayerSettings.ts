import { constellationOptions } from './constellations.ts';

export interface JourneySkyLayerSettings {
  sun: boolean;
  moon: boolean;
  constellations: boolean;
  milkyWay: boolean;
  constellationId: string;
}

export const journeySkyLayerKey = 'shantu.journey-sky-layers.v1';
export const defaultJourneySkyLayers: JourneySkyLayerSettings = {
  sun: true, moon: true, constellations: false, milkyWay: false, constellationId: 'all',
};

export function parseJourneySkyLayers(value: string | null): JourneySkyLayerSettings {
  let parsed: unknown;
  try { parsed = value ? JSON.parse(value) : null; }
  catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...defaultJourneySkyLayers };
  const saved = parsed as Partial<Record<keyof JourneySkyLayerSettings, unknown>>;
  function toggle(key: 'sun' | 'moon' | 'constellations' | 'milkyWay') {
    const option = saved[key];
    return typeof option === 'boolean' ? option : defaultJourneySkyLayers[key];
  }
  const id = saved.constellationId;
  return {
    sun: toggle('sun'), moon: toggle('moon'), constellations: toggle('constellations'), milkyWay: toggle('milkyWay'),
    constellationId: typeof id === 'string' && constellationOptions.some(option => option.id === id) ? id : 'all',
  };
}
