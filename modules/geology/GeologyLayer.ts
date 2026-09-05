import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import type { LayerSettings } from '../map/types';
import { geologyUnit, INITIAL_GEOLOGY, type GeologyState } from './data';
import { GeocloudLayer } from './geocloud/GeocloudLayer';

export const GEOLOGY_SOURCE = 'geology-source';
export const GEOLOGY_LAYER_IDS = ['geology-units', 'geology-boundaries', 'geology-structures', 'geology-faults'];

/** Surface map draped by MapLibre terrain; never an inferred subsurface volume. */
export class GeologyLayer {
  private state: GeologyState = INITIAL_GEOLOGY;
  private enabled = false;
  private lastEmission = '';
  private cloud: GeocloudLayer;
  constructor(private map: MapLibreMap, private onChange: (state: GeologyState) => void) {
    this.cloud = new GeocloudLayer(map, onChange);
    map.on('idle', this.inspect);
    map.on('click', this.pick);
    map.on('error', this.onError);
  }
  private emit() {
    const signature = JSON.stringify(this.state);
    if (signature !== this.lastEmission) {
      this.lastEmission = signature;
      this.onChange(this.state);
    }
  }
  private add() {
    if (this.map.getSource(GEOLOGY_SOURCE)) return;
    this.map.addSource(GEOLOGY_SOURCE, {
      type: 'vector', tiles: [window.location.origin + '/api/geology/tiles/{z}/{x}/{y}'],
      // The currently served world compilation has data through z5. Higher
      // Chinese carto tiles are empty; overscaling retains honest coarse geometry.
      maxzoom: 5,
      attribution: '<a href="https://tiles.macrostrat.org/" target="_blank">Macrostrat · CC BY 4.0</a> · <a href="https://doi.org/10.4095/223767" target="_blank">Chorlton / Geological Survey of Canada · 2007 世界地质概览</a>',
    });
    const before = this.map.getLayer('hillshade') ? 'hillshade' : undefined;
    this.map.addLayer({
      id: 'geology-units', type: 'fill', source: GEOLOGY_SOURCE, 'source-layer': 'units',
      paint: { 'fill-color': ['to-color', ['get', 'color'], '#a8b5be'], 'fill-opacity': 0.85 },
    }, before);
    this.map.addLayer({
      id: 'geology-boundaries', type: 'line', source: GEOLOGY_SOURCE, 'source-layer': 'units',
      paint: { 'line-color': '#30323d', 'line-width': 0.65, 'line-opacity': 0.5 },
    }, before);
    this.map.addLayer({
      id: 'geology-structures', type: 'line', source: GEOLOGY_SOURCE, 'source-layer': 'lines',
      filter: ['!', ['in', 'fault', ['downcase', ['to-string', ['get', 'type']]]]],
      paint: { 'line-color': '#243c71', 'line-width': 1.6, 'line-dasharray': [3, 2] },
    }, before);
    this.map.addLayer({
      id: 'geology-faults', type: 'line', source: GEOLOGY_SOURCE, 'source-layer': 'lines',
      filter: ['in', 'fault', ['downcase', ['to-string', ['get', 'type']]]],
      paint: { 'line-color': '#8b1825', 'line-width': 2 },
    }, before);
  }
  sync(settings: LayerSettings) {
    const useWorld = settings.geology && settings.geologySource === 'world';
    const newlyEnabled = useWorld && !this.enabled;
    this.enabled = useWorld;
    if (this.enabled) this.add();
    for (const id of GEOLOGY_LAYER_IDS) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', this.enabled ? 'visible' : 'none');
    }
    if (this.map.getLayer('geology-units')) this.map.setPaintProperty('geology-units', 'fill-opacity', settings.geologyOpacity);
    if (newlyEnabled) this.state = { ...INITIAL_GEOLOGY, status: 'loading' };
    if (!this.enabled) this.state = { ...INITIAL_GEOLOGY };
    if (newlyEnabled) this.lastEmission = '';
    if (settings.geologySource === 'world' || !settings.geology) this.emit();
    this.cloud.sync(settings.geology && settings.geologySource === 'geocloud20w', settings.geologyOpacity);
    if (this.enabled) this.inspect();
  }
  retry() { this.cloud.retry(); }
  isReady() { return this.enabled ? this.state.status === 'ready' && Boolean(this.map.getSource(GEOLOGY_SOURCE)) && this.map.isSourceLoaded(GEOLOGY_SOURCE) : this.cloud.isReady(); }
  private inspect = () => {
    if (!this.enabled || !this.map.getSource(GEOLOGY_SOURCE) || !this.map.isSourceLoaded(GEOLOGY_SOURCE)) return;
    const features = this.map.queryRenderedFeatures(undefined, { layers: ['geology-units'] });
    const units = [...new Map(features.map((f) => {
      const unit = geologyUnit(f.properties);
      return [unit.key, unit] as const;
    })).values()];
    // Keep the full source list for attribution even when the legend scrolls.
    const sources = [...new Map(units.map((u) => [u.source, { name: u.source, url: u.sourceUrl }])).values()];
    this.state = { ...this.state, status: units.length ? 'ready' : this.state.status === 'error' ? 'error' : 'empty', legend: units, sources };
    this.emit();
  };
  private pick = (event: MapMouseEvent) => {
    if (!this.enabled || !this.map.getLayer('geology-units')) return;
    const feature = this.map.queryRenderedFeatures(event.point, { layers: ['geology-units'] })[0];
    this.state = { ...this.state, selection: feature ? geologyUnit(feature.properties) : null };
    this.emit();
  };
  private onError = (event: unknown) => {
    if (this.enabled && event && typeof event === 'object' && 'sourceId' in event && event.sourceId === GEOLOGY_SOURCE) {
      this.state = { ...INITIAL_GEOLOGY, status: 'error' };
      this.emit();
    }
  };
  dispose() {
    this.cloud.dispose();
    this.map.off('idle', this.inspect);
    this.map.off('click', this.pick);
    this.map.off('error', this.onError);
  }
}
