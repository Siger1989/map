import { createContext } from 'react';
import type { Coordinate } from '../navigation/types';

export interface SkyOrigin {
  coordinates: Coordinate;
  markerName?: string;
}

export const OpenMarkerSky = createContext<((origin: SkyOrigin) => void) | null>(null);
