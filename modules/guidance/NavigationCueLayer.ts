import type { Map } from 'maplibre-gl';
import { syncOverlayData } from '../map/overlayData.ts';
import type { NavigationCueInput } from './navigationCueGeometry.ts';
import { createNavigationCueData } from './navigationCueGeometry.ts';
import { createNavigationCueChevronImage, createNavigationCueLeadImage } from './navigationCueImage.ts';
import { pathOf, type Path } from './geometry.ts';

export const NAVIGATION_CUE_SOURCE_ID = 'navigation-cues';
export const NAVIGATION_CUE_OUTLINE_LAYER_ID = 'navigation-cue-outline';
export const NAVIGATION_CUE_LAYER_ID = 'navigation-cue-arrows';
export const NAVIGATION_CUE_RIBBON_LAYER_ID = 'navigation-cue-route-ribbon';
export const NAVIGATION_CUE_OFFSET_REFERENCE_LAYER_ID = 'navigation-cue-offset-reference';
export const NAVIGATION_CUE_OFFSET_REFERENCE_OUTLINE_LAYER_ID = 'navigation-cue-offset-reference-outline';
export const NAVIGATION_CUE_ROUTE_PROJECTION_LAYER_ID = 'navigation-cue-route-projection';
export const NAVIGATION_CUE_ICON_ID = 'navigation-cue-chevron-route';
export const NAVIGATION_CUE_REJOIN_ICON_ID = 'navigation-cue-chevron-rejoin';
export const NAVIGATION_CUE_LEAD_ICON_ID = 'navigation-cue-lead-arrow';
export const NAVIGATION_CUE_MIN_ZOOM = 14;

/** MapLibre chevrons for close-range 3D guidance; callers own positioning and lifecycle. */
export class NavigationCueLayer {
  private map: Map;
  private previousProgress?: number;
  private previousCoordinates?: NavigationCueInput['coordinates'];
  private previousKind?: NavigationCueInput['kind'];
  private cachedPath: Path | null = null;
  private pathResolved = false;
  private ribbonVisible?: boolean;
  private currentInput: NavigationCueInput | null = null;

  constructor(map: Map) {
    this.map = map;
    map.on?.('resize', this.onResize);
  }

  private onResize = () => {
    if (!this.currentInput) return;
    if (this.map.isStyleLoaded && !this.map.isStyleLoaded()) return;
    this.sync(this.currentInput);
  };

  sync(input: NavigationCueInput | null) {
    const map = this.map;
    this.currentInput = input;
    const shouldShowRibbon = input?.kind === 'route' && input.cameraMode !== 'top';
    if (!map.getSource(NAVIGATION_CUE_SOURCE_ID)) {
      map.addSource(NAVIGATION_CUE_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.hasImage?.(NAVIGATION_CUE_ICON_ID)) {
      const image = createNavigationCueChevronImage('#ffffff');
      if (image) map.addImage(NAVIGATION_CUE_ICON_ID, image, { pixelRatio: 2, sdf: false });
    }
    if (!map.hasImage?.(NAVIGATION_CUE_REJOIN_ICON_ID)) {
      const image = createNavigationCueChevronImage('#ffd08a');
      if (image) map.addImage(NAVIGATION_CUE_REJOIN_ICON_ID, image, { pixelRatio: 2, sdf: false });
    }
    if (!map.hasImage?.(NAVIGATION_CUE_LEAD_ICON_ID)) {
      const image = createNavigationCueLeadImage();
      if (image) map.addImage(NAVIGATION_CUE_LEAD_ICON_ID, image, { pixelRatio: 2, sdf: false });
    }
    if (!map.getLayer(NAVIGATION_CUE_OUTLINE_LAYER_ID)) {
      map.addLayer({
        id: NAVIGATION_CUE_OUTLINE_LAYER_ID,
        type: 'line',
        source: NAVIGATION_CUE_SOURCE_ID,
        filter: ['all', ['==', ['get', 'role'], 'ribbon'], ['==', ['get', 'kind'], 'route']],
        minzoom: NAVIGATION_CUE_MIN_ZOOM,
        layout: { 'line-join': 'round', 'line-cap': 'round', visibility: shouldShowRibbon ? 'visible' : 'none' },
        paint: {
          'line-color': '#17382c',
          'line-width': ['case', ['==', ['get', 'closeView'], true], 18, 8],
          'line-opacity': 0.82,
        },
      });
    }
    if (!map.getLayer(NAVIGATION_CUE_RIBBON_LAYER_ID)) {
      map.addLayer({
        id: NAVIGATION_CUE_RIBBON_LAYER_ID,
        type: 'line',
        source: NAVIGATION_CUE_SOURCE_ID,
        filter: ['all', ['==', ['get', 'role'], 'ribbon'], ['==', ['get', 'kind'], 'route']],
        minzoom: NAVIGATION_CUE_MIN_ZOOM,
        layout: { 'line-join': 'round', 'line-cap': 'round', visibility: shouldShowRibbon ? 'visible' : 'none' },
        paint: {
          'line-color': '#39c878',
          'line-width': ['case', ['==', ['get', 'closeView'], true], 14, 4],
          'line-opacity': 0.98,
        },
      });
    }
    if (!map.getLayer(NAVIGATION_CUE_OFFSET_REFERENCE_OUTLINE_LAYER_ID)) {
      map.addLayer({
        id: NAVIGATION_CUE_OFFSET_REFERENCE_OUTLINE_LAYER_ID,
        type: 'line',
        source: NAVIGATION_CUE_SOURCE_ID,
        filter: ['all', ['==', ['get', 'role'], 'offset-reference'], ['==', ['get', 'kind'], 'route']],
        minzoom: NAVIGATION_CUE_MIN_ZOOM,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#65562f',
          'line-width': ['case', ['==', ['get', 'closeView'], true], 18, 8],
          'line-opacity': 0.82,
        },
      });
    }
    if (!map.getLayer(NAVIGATION_CUE_OFFSET_REFERENCE_LAYER_ID)) {
      map.addLayer({
        id: NAVIGATION_CUE_OFFSET_REFERENCE_LAYER_ID,
        type: 'line',
        source: NAVIGATION_CUE_SOURCE_ID,
        filter: ['all', ['==', ['get', 'role'], 'offset-reference'], ['==', ['get', 'kind'], 'route']],
        minzoom: NAVIGATION_CUE_MIN_ZOOM,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#ffd34f',
          'line-width': ['case', ['==', ['get', 'closeView'], true], 14, 4],
          'line-opacity': 0.9,
        },
      });
    }
    if (!map.getLayer(NAVIGATION_CUE_ROUTE_PROJECTION_LAYER_ID)) {
      map.addLayer({
        id: NAVIGATION_CUE_ROUTE_PROJECTION_LAYER_ID,
        type: 'circle',
        source: NAVIGATION_CUE_SOURCE_ID,
        filter: ['all', ['==', ['get', 'role'], 'route-projection'], ['==', ['get', 'kind'], 'route']],
        minzoom: NAVIGATION_CUE_MIN_ZOOM,
        paint: {
          'circle-radius': 5,
          'circle-color': '#858f93',
          'circle-opacity': 0.25,
          'circle-stroke-color': '#4f5a5e',
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.9,
        },
      });
    }
    if (!map.getLayer(NAVIGATION_CUE_LAYER_ID)) {
      map.addLayer({
        id: NAVIGATION_CUE_LAYER_ID,
        type: 'symbol',
        source: NAVIGATION_CUE_SOURCE_ID,
        filter: ['any', ['==', ['get', 'role'], 'chevron'], ['==', ['get', 'role'], 'rejoin'], ['==', ['get', 'role'], 'lead']],
        minzoom: NAVIGATION_CUE_MIN_ZOOM,
        layout: {
          'icon-image': ['match', ['get', 'role'], 'lead', NAVIGATION_CUE_LEAD_ICON_ID, ['match', ['get', 'kind'], 'rejoin', NAVIGATION_CUE_REJOIN_ICON_ID, NAVIGATION_CUE_ICON_ID]],
          // Keep the route chevrons aligned to the tilted map so they recede with perspective.
          'icon-size': ['match', ['get', 'role'], 'lead', 1.8, 'rejoin', 0.55, 0.85],
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-opacity': 0.98 },
      });
    }
    if (this.ribbonVisible !== undefined && this.ribbonVisible !== shouldShowRibbon) {
      const visibility = shouldShowRibbon ? 'visible' : 'none';
      map.setLayoutProperty?.(NAVIGATION_CUE_OUTLINE_LAYER_ID, 'visibility', visibility);
      map.setLayoutProperty?.(NAVIGATION_CUE_RIBBON_LAYER_ID, 'visibility', visibility);
    }
    this.ribbonVisible = shouldShowRibbon;

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

    const canvasHeight = map.getCanvas?.()?.clientHeight;
    const containerHeight = map.getContainer?.()?.clientHeight;
    const height = canvasHeight || containerHeight;
    const leadTargetMetres = Number.isFinite(height) && height > 0 && height <= 520 ? 20 : 50;
    const result = createNavigationCueData(input, this.previousProgress,
      this.pathResolved ? this.cachedPath : undefined, leadTargetMetres);
    this.previousProgress = result.progress;
    syncOverlayData(map, NAVIGATION_CUE_SOURCE_ID, result.data);
  }
}
