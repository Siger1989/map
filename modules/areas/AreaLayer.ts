import type { Map } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { Coordinate } from '../navigation/types';
import type { MapArea } from './data';
import { syncOverlayData } from '../map/overlayData';
export type AreaOverlay = {
  items: MapArea[];
  selected: string | null;
  draft: Coordinate[];
  preview?: { id: string; index: number; coordinate: Coordinate } | null;
};
export class AreaLayer {
  constructor(private map: Map) {}
  sync(state: AreaOverlay) {
    const m = this.map;
    if (!m.getSource('area-shapes'))
      m.addSource('area-shapes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    if (!m.getLayer('area-fill')) {
      m.addLayer({
        id: 'area-fill',
        type: 'fill',
        source: 'area-shapes',
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 },
      });
      m.addLayer({
        id: 'area-border',
        type: 'line',
        source: 'area-shapes',
        filter: ['!=', '$type', 'Point'],
        paint: { 'line-color': ['get', 'color'], 'line-width': 3 },
      });
      m.addLayer({
        id: 'area-nodes',
        type: 'circle',
        source: 'area-shapes',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      });
    }
    const data: FeatureCollection = { type: 'FeatureCollection', features: [] };
    for (const area of state.items.filter((a) => a.visible)) {
      const points = area.boundary.map((p, i) =>
        state.preview?.id === area.id &&
        (i === state.preview.index ||
          (state.preview.index === 0 && i === area.boundary.length - 1))
          ? state.preview.coordinate
          : p,
      );
      data.features.push({
        type: 'Feature',
        properties: { id: area.id, color: area.color },
        geometry: { type: 'Polygon', coordinates: [points] },
      });
      if (area.id === state.selected) {
        let previous: { x: number; y: number } | null = null;
        points.slice(0, -1).forEach((p, index) => {
          const xy = m.project(p);
          if (
            previous &&
            Math.hypot(previous.x - xy.x, previous.y - xy.y) < 16 &&
            index !== points.length - 2
          )
            return;
          previous = xy;
          data.features.push({
            type: 'Feature',
            properties: {
              id: area.id,
              index,
              lng: p[0],
              lat: p[1],
              color: area.color,
            },
            geometry: { type: 'Point', coordinates: p },
          });
        });
      }
    }
    if (state.draft.length) {
      if (state.draft.length > 1)
        data.features.push({
          type: 'Feature',
          properties: { id: 'draft-area', color: '#66cfa2' },
          geometry: { type: 'LineString', coordinates: state.draft },
        });
      state.draft.forEach((p, i) =>
        data.features.push({
          type: 'Feature',
          properties: {
            id: 'draft-area',
            index: i,
            lng: p[0],
            lat: p[1],
            color: '#66cfa2',
          },
          geometry: { type: 'Point', coordinates: p },
        }),
      );
    }
    syncOverlayData(m, 'area-shapes', data);
  }
  pickNode(p: { x: number; y: number }) {
    if (!this.map.getLayer('area-nodes')) return null;
    const hits = this.map
      .queryRenderedFeatures(
        [
          [p.x - 14, p.y - 14],
          [p.x + 14, p.y + 14],
        ],
        { layers: ['area-nodes'] },
      )
      .filter((f) => f.properties.id !== 'draft-area');
    const hit = hits
      .map((f) => ({
        f,
        xy: this.map.project([f.properties.lng, f.properties.lat]),
      }))
      .sort(
        (a, b) =>
          Math.hypot(a.xy.x - p.x, a.xy.y - p.y) -
          Math.hypot(b.xy.x - p.x, b.xy.y - p.y),
      )[0];
    return hit
      ? {
          kind: 'area' as const,
          id: String(hit.f.properties.id),
          index: Number(hit.f.properties.index),
          coordinate: [
            Number(hit.f.properties.lng),
            Number(hit.f.properties.lat),
          ] as Coordinate,
        }
      : null;
  }
  pick(p: { x: number; y: number }) {
    if (!this.map.getLayer('area-fill')) return null;
    return (
      this.pickNode(p)?.id ??
      this.map.queryRenderedFeatures([p.x, p.y], { layers: ['area-fill'] })[0]
        ?.properties.id ??
      null
    );
  }
}
