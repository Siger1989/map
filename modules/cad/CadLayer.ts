import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { CadFeature } from './types.ts';
import { syncPlaceLabelLayerOrder } from '../map/overlayData.ts';

const SOURCE_ID = 'shantu-cad-reference-source';
const LABEL_SOURCE_ID = 'shantu-cad-reference-label-source';
const FILL_ID = 'cad-fill';
const OUTLINE_ID = 'cad-outline';
const LINE_ID = 'cad-line';
const POINT_ID = 'cad-point';
const LABEL_ID = 'cad-labels';
const FALLBACK_COLOR = '#e3bd54';
// Kept in sync with storage.ts; importing its runtime here would pull the CAD
// CRS project adapter into pure GeoJSON tests and the map layer bundle.
const CAD_CHANGED = 'shantu-cad-changed';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

type CadProperties = {
  cadDocumentId: string;
  cadFeatureId: string;
  cadFeatureType: string;
  cadLayer: string;
  cadColor: string;
  cadText?: string;
};
type CadMapDocument = { id: string; visible: boolean; mapFeatures: CadFeature[] };

function labelPosition(feature: CadFeature): Position | null {
  const geometry = feature.geometry;
  if (geometry.type === 'Point') return geometry.coordinates;
  if (geometry.type === 'LineString') return geometry.coordinates[Math.floor((geometry.coordinates.length - 1) / 2)] ?? null;
  const ring = geometry.coordinates[0];
  if (!ring?.length) return null;
  const vertices = ring.length > 1 ? ring.slice(0, -1) : ring;
  const sum = vertices.reduce(([x, y, z], point) => [x + point[0], y + point[1], z + (point[2] ?? 0)], [0, 0, 0]);
  return vertices.length ? [sum[0] / vertices.length, sum[1] / vertices.length] : null;
}

export function cadReferenceFeatureCollections(documents: readonly CadMapDocument[]): {
  features: FeatureCollection<Geometry, CadProperties>;
  labels: FeatureCollection<Geometry, CadProperties>;
} {
  const features: Feature<Geometry, CadProperties>[] = [];
  const labels: Feature<Geometry, CadProperties>[] = [];
  for (const document of documents) {
    if (!document.visible) continue;
    for (const item of document.mapFeatures) {
      const properties: CadProperties = {
        cadDocumentId: document.id,
        cadFeatureId: item.id,
        cadFeatureType: item.entityType,
        cadLayer: item.layer,
        cadColor: item.color ?? FALLBACK_COLOR,
        ...(item.text ? { cadText: item.text } : {}),
      };
      features.push({
        type: 'Feature',
        id: `${document.id}:${item.id}`,
        properties,
        geometry: item.geometry as Geometry,
      });
      if (item.text) {
        const coordinate = labelPosition(item);
        if (coordinate) labels.push({
          type: 'Feature',
          id: `${document.id}:${item.id}:label`,
          properties,
          geometry: { type: 'Point', coordinates: coordinate },
        });
      }
    }
  }
  return {
    features: { type: 'FeatureCollection', features },
    labels: { type: 'FeatureCollection', features: labels },
  };
}

export class CadLayer {
  private disposed = false;
  private request = 0;
  private cachedDocuments: CadMapDocument[] | null = null;
  private dirty = true;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private readonly map: MapLibreMap;
  private readonly onError: (message: string) => void;

  constructor(
    map: MapLibreMap,
    onError: (message: string) => void = () => {},
  ) {
    this.map = map;
    this.onError = onError;
    this.map.on('style.load', this.onStyleLoad);
    this.map.on('idle', this.onIdle);
    if (typeof window !== 'undefined') window.addEventListener(CAD_CHANGED, this.onChanged);
    // TerrainMap creates this controller while other layers may still be
    // settling. Read once now, then retry layer installation without rereading
    // IndexedDB until the style is ready.
    void this.refresh();
  }

  private onStyleLoad = () => {
    if (this.disposed) return;
    if (this.dirty || !this.cachedDocuments) void this.refresh();
    else this.applyCachedDocuments();
  };

  private onIdle = () => {
    // Wake an already scheduled bounded retry when MapLibre has settled the
    // style. Successful setData calls do not leave a retry pending, so this
    // cannot loop on the resulting style/data events.
    if (this.disposed || !this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.applyCachedDocuments();
  };

  private onChanged = () => {
    if (this.disposed) return;
    this.dirty = true;
    void this.refresh();
  };

  private scheduleRetry() {
    if (this.disposed || this.retryTimer || this.retryCount >= 30) return;
    this.retryCount++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.disposed) return;
      this.applyCachedDocuments();
    }, 100);
  }

  private ensureLayers(): boolean {
    if (!this.map.isStyleLoaded()) return false;
    if (!this.map.getSource(SOURCE_ID)) this.map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY });
    if (!this.map.getSource(LABEL_SOURCE_ID)) this.map.addSource(LABEL_SOURCE_ID, { type: 'geojson', data: EMPTY });
    const color = ['coalesce', ['get', 'cadColor'], FALLBACK_COLOR] as never;
    if (!this.map.getLayer(FILL_ID)) this.map.addLayer({
      id: FILL_ID, type: 'fill', source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': color, 'fill-opacity': 0.12 },
    });
    if (!this.map.getLayer(OUTLINE_ID)) this.map.addLayer({
      id: OUTLINE_ID, type: 'line', source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'line-color': color, 'line-width': 1.5, 'line-opacity': 0.9 },
    });
    if (!this.map.getLayer(LINE_ID)) this.map.addLayer({
      id: LINE_ID, type: 'line', source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': color, 'line-width': 1.5, 'line-opacity': 0.9 },
    });
    if (!this.map.getLayer(POINT_ID)) this.map.addLayer({
      id: POINT_ID, type: 'circle', source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 3, 'circle-color': color, 'circle-stroke-color': '#182019', 'circle-stroke-width': 1 },
    });
    if (!this.map.getLayer(LABEL_ID)) this.map.addLayer({
      id: LABEL_ID, type: 'symbol', source: LABEL_SOURCE_ID,
      layout: {
        'text-field': ['get', 'cadText'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-offset': [0, 0.7],
        'text-anchor': 'top',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': color, 'text-halo-color': '#101713', 'text-halo-width': 1.3 },
    });
    syncPlaceLabelLayerOrder(this.map);
    return true;
  }

  private async refresh() {
    const request = ++this.request;
    try {
      const { readCadDocuments } = await import('./storage.ts');
      const documents = await readCadDocuments();
      if (this.disposed || request !== this.request) return;
      this.cachedDocuments = documents;
      this.dirty = false;
      this.retryCount = 0;
      this.applyCachedDocuments();
    } catch (error) {
      if (this.disposed || request !== this.request) return;
      console.error('CAD reference map layer failed to refresh');
      this.onError('CAD参考图层加载失败，请检查CAD工程数据后重试');
    }
  }

  private applyCachedDocuments() {
    if (this.disposed || !this.cachedDocuments) return;
    try {
      if (!this.ensureLayers()) {
        this.scheduleRetry();
        return;
      }
      this.retryCount = 0;
      const data = cadReferenceFeatureCollections(this.cachedDocuments);
      const features = this.map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      const labels = this.map.getSource(LABEL_SOURCE_ID) as GeoJSONSource | undefined;
      if (!features || !labels) throw new Error('CAD map source unavailable');
      features.setData(data.features);
      labels.setData(data.labels);
      syncPlaceLabelLayerOrder(this.map);
    } catch (error) {
      if (this.disposed) return;
      console.error('CAD reference map layer failed to refresh');
      this.onError('CAD参考图层加载失败，请检查CAD工程数据后重试');
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.request++;
    this.map.off('style.load', this.onStyleLoad);
    this.map.off('idle', this.onIdle);
    if (typeof window !== 'undefined') window.removeEventListener(CAD_CHANGED, this.onChanged);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const id of [LABEL_ID, POINT_ID, LINE_ID, OUTLINE_ID, FILL_ID])
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    for (const id of [LABEL_SOURCE_ID, SOURCE_ID])
      if (this.map.getSource(id)) this.map.removeSource(id);
  }
}
