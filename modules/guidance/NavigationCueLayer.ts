import type { Map } from 'maplibre-gl';
import { syncOverlayData } from '../map/overlayData.ts';
import type { NavigationCueInput } from './navigationCueGeometry.ts';
import { createNavigationCueData } from './navigationCueGeometry.ts';
import { pathOf, type Path } from './geometry.ts';

export const NAVIGATION_CUE_SOURCE_ID = 'navigation-cues';
export const NAVIGATION_CUE_OUTLINE_LAYER_ID = 'navigation-cue-outline';
export const NAVIGATION_CUE_LAYER_ID = 'navigation-cue-arrows';
export const NAVIGATION_CUE_MIN_ZOOM = 14;

/** MapLibre chevrons for close-range 3D guidance; callers own positioning and lifecycle. */
export class NavigationCueLayer {
  private map: Map;
  private previousProgress?: number;
  private previousCoordinates?: NavigationCueInput['coordinates'];
  private previousKind?: NavigationCueInput['kind'];
  private cachedPath: Path | null = null;
  private pathResolved = false;

  constructor(map: Map) { this.map = map; }

  sync(input: NavigationCueInput | null) {
    const map = this.map;
    if (!map.getSource(NAVIGATION_CUE_SOURCE_ID)) {
      map.addSource(NAVIGATION_CUE_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer(NAVIGATION_CUE_OUTLINE_LAYER_ID)) {
      map.addLayer({
        id: NAVIGATION_CUE_OUTLINE_LAYER_ID,
        type: 'line',
        source: NAVIGATION_CUE_SOURCE_ID,
        minzoom: NAVIGATION_CUE_MIN_ZOOM,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#13251f',
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 7, 18, 9, 21, 12],
          'line-opacity': 0.82,
        },
      });
      map.addLayer({
        id: NAVIGATION_CUE_LAYER_ID,
        type: 'line',
        source: NAVIGATION_CUE_SOURCE_ID,
        minzoom: NAVIGATION_CUE_MIN_ZOOM,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['match', ['get', 'kind'], 'rejoin', '#ffbd62', '#9de8c4'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 4, 21, 6],
          'line-opacity': 0.98,
        },
      });
    }

    if (!input) {
      this.previousProgress = undefined;
      this.previousCoordinates = undefined;
      this.previousKind = undefined;
      this.cachedPath = null;
      this.pathResolved = false;
    } else if (input.coordinates !== this.previousCoordinates || input.kind !== this.previousKind) {
      this.previousProgress = undefined;
      this.previousKind = input.kind;
    }

    if (input && input.coordinates !== this.previousCoordinates) {
      this.previousCoordinates = input.coordinates;
      try { this.cachedPath = pathOf(input.coordinates); }
      catch { this.cachedPath = null; }
      this.pathResolved = true;
    }

    const result = createNavigationCueData(input, this.previousProgress,
      this.pathResolved ? this.cachedPath : undefined);
    this.previousProgress = result.progress;
    syncOverlayData(map, NAVIGATION_CUE_SOURCE_ID, result.data);
  }
}
