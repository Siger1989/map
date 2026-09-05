import type {
  Map as TerrainMap,
  AddProtocolAction,
  RasterDEMTileSource,
  GeoJSONSource,
} from 'maplibre-gl';
import { TERRAIN_MAXZOOM } from '../terrain/terrain';
import { altitudeRange, type Annotation } from '../annotations/data';
import { SectionTerrainStore } from './elevation';
import { terrainEdges, tileCoordinate, type TerrainTile } from './terrainMath';
import {
  INITIAL_SECTION_STATUS,
  type SectionSettings,
  type SectionStatus,
} from './types';
import { sectionFill, sectionOutline } from './appearance';
import { coveredContours } from './contourCoverage';
type Protocols = {
  addProtocol: (name: string, action: AddProtocolAction) => void;
  removeProtocol: (name: string) => void;
};
const DEM = 'section-elevation',
  FILL = 'section-cut-fill',
  EDGES = 'section-cut-edges';
let serial = 0;

/** Native 3D clipping retains projection, frustum culling and camera gestures. */
export class SectionLayer {
  private protocol = `terrain-section-${++serial}`;
  private settings: SectionSettings = {
    enabled: false,
    altitude: 1500,
    color: '#ffffff',
  };
  private items: Annotation[] = [];
  private applied = 1500;
  private revision = 0;
  private abort = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private reportTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = 0;
  private failed = 0;
  private tiles = new Map<
    string,
    {
      tile: TerrainTile;
      min: number;
      max: number;
      valid: number;
      lines: number[][][];
    }
  >();
  private originalTerrain: ReturnType<TerrainMap['getTerrain']> = null;
  private originalPitch: number | null = null;
  constructor(
    private map: TerrainMap,
    private notify: (status: SectionStatus) => void,
    private protocols: Protocols,
    private onAltitude: (altitude: number | null) => void,
    private store = new SectionTerrainStore(),
  ) {
    protocols.addProtocol(this.protocol, this.loadTile);
    map.on('moveend', this.onViewChange);
    map.on('resize', this.onViewChange);
  }
  configure(settings: SectionSettings, items: Annotation[]) {
    const changed = settings.altitude !== this.settings.altitude;
    const colorChanged = settings.color !== this.settings.color;
    const toggled = settings.enabled !== this.settings.enabled;
    this.settings = settings;
    this.items = items;
    if (toggled) {
      if (settings.enabled) this.open();
      else this.close();
    } else if (settings.enabled) {
      if (changed) this.schedule();
      if (colorChanged) this.updateColor();
    }
  }
  private updateColor() {
    this.map.setPaintProperty(
      FILL,
      'color-relief-color',
      sectionFill(this.applied, this.settings.color),
    );
    this.map.setPaintProperty(
      `${EDGES}-rim`,
      'line-color',
      sectionOutline(this.settings.color),
    );
  }
  private url() {
    return `${this.protocol}://${this.revision}/{z}/{x}/{y}`;
  }
  private open() {
    this.originalTerrain = this.map.getTerrain();
    this.originalPitch = this.map.getPitch() < 5 ? this.map.getPitch() : null;
    this.applied = this.settings.altitude;
    this.map.addSource(DEM, {
      type: 'raster-dem',
      tiles: [this.url()],
      encoding: 'terrarium',
      // Match the base terrain. Changing this during a terrain swap resizes the
      // shared RTT color target without a compatible depth target in MapLibre 6.7.
      tileSize: 256,
      maxzoom: TERRAIN_MAXZOOM,
    });
    this.map.setSourceTileLodParams(4, 1, DEM);
    this.map.addSource(EDGES, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    const before = this.map.getLayer('annotation-models')
      ? 'annotation-models'
      : undefined;
    this.map.addLayer(
      {
        id: FILL,
        type: 'color-relief',
        // The cap must use the same clipped samples and LOD as its 3D surface.
        source: DEM,
        paint: {
          // Interpolating padded DEM borders can reopen a hairline inside a flat cap.
          resampling: 'nearest',
          'color-relief-color': sectionFill(this.applied, this.settings.color),
          'color-relief-opacity': 1,
        },
      },
      before,
    );
    for (const [suffix, width, color] of [
      ['rim', 1.8, sectionOutline(this.settings.color)],
    ] as const) {
      this.map.addLayer(
        {
          id: `${EDGES}-${suffix}`,
          type: 'line',
          source: EDGES,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': color,
            'line-width': width,
            'line-opacity': 0.95,
          },
        },
        before,
      );
    }
    this.map.setTerrain({ source: DEM, exaggeration: 1 });
    if (this.originalPitch !== null) this.map.jumpTo({ pitch: 55 });
    this.onAltitude(this.applied);
    this.notify({ ...INITIAL_SECTION_STATUS, phase: 'loading' });
  }
  private schedule() {
    // Keep the slider responsive without continuously rebuilding every DEM tile.
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = null;
        this.apply();
      }, 350);
  }
  private onViewChange = () => {
    if (!this.settings.enabled) return;
    // MapLibre loads newly visible tiles itself. Panning must not reload the entire source.
    if (this.settings.altitude !== this.applied) this.schedule();
    if (!this.reportTimer)
      this.reportTimer = setTimeout(() => {
        this.reportTimer = null;
        this.report();
      }, 250);
  };
  refresh = () => {
    if (this.settings.enabled) this.schedule();
  };
  private apply() {
    if (!this.settings.enabled) return;
    if (this.map.isMoving()) {
      this.schedule();
      return;
    }
    this.abort.abort();
    this.abort = new AbortController();
    this.revision++;
    this.pending = 0;
    this.failed = 0;
    this.tiles.clear();
    this.applied = this.settings.altitude;
    this.updateColor();
    (this.map.getSource(EDGES) as GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: [],
    });
    (this.map.getSource(DEM) as RasterDEMTileSource)?.setTiles([this.url()]);
    this.onAltitude(this.applied);
    this.report();
  }
  private loadTile: AddProtocolAction = async (request, controller) => {
    const match = request.url.match(/:\/\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/);
    if (!match) throw new Error('无效剖面瓦片');
    const revision = Number(match[1]);
    if (!this.settings.enabled || revision !== this.revision)
      throw new DOMException('过期剖面', 'AbortError');
    const signal = AbortSignal.any([
      controller.signal,
      this.abort.signal,
      AbortSignal.timeout(15000),
    ]);
    const tile = {
      z: Number(match[2]),
      x: Number(match[3]),
      y: Number(match[4]),
    };
    const altitude = this.applied;
    this.pending++;
    try {
      const heights = await this.store.read(tile, signal);
      signal.throwIfAborted();
      const data = await this.store.image(heights, altitude);
      if (signal.aborted) {
        data.close();
        signal.throwIfAborted();
      }
      const key = `${tile.z}/${tile.x}/${tile.y}`;
      let min = Infinity,
        max = -Infinity,
        valid = 0;
      for (const height of heights)
        if (Number.isFinite(height)) {
          min = Math.min(min, height);
          max = Math.max(max, height);
          valid++;
        }
      if (this.tiles.size >= 128)
        this.tiles.delete(this.tiles.keys().next().value!);
      this.tiles.set(key, {
        tile,
        min,
        max,
        valid,
        lines: terrainEdges(heights, tile, altitude),
      });
      return { data };
    } catch (error) {
      if (
        !controller.signal.aborted &&
        !this.abort.signal.aborted &&
        revision === this.revision
      )
        this.failed++;
      throw error;
    } finally {
      if (revision === this.revision && this.settings.enabled) {
        this.pending--;
        if (!this.reportTimer)
          this.reportTimer = setTimeout(() => {
            this.reportTimer = null;
            this.report();
          }, 250);
      }
    }
  };
  private report() {
    if (!this.settings.enabled) return;
    let min = Infinity,
      max = -Infinity,
      valid = 0,
      spacing = 0;
    const features: GeoJSON.Feature<GeoJSON.MultiLineString>[] = [];
    let tiles = 0;
    const bounds = this.map.getBounds();
    const entries = [...this.tiles.values()];
    for (const { tile, min: low, max: high, valid: count, lines } of entries) {
      // Keep cached contours cheap; only publish entries intersecting the current viewport.
      const sw = tileCoordinate(tile, 0, 256),
        ne = tileCoordinate(tile, 256, 0);
      if (
        !bounds.contains(tileCoordinate(tile, 128, 128)) &&
        !bounds.contains(sw) &&
        !bounds.contains(ne) &&
        !(
          bounds.getWest() >= sw[0] &&
          bounds.getWest() <= ne[0] &&
          bounds.getNorth() >= sw[1] &&
          bounds.getSouth() <= ne[1]
        )
      )
        continue;
      tiles++;
      min = Math.min(min, low);
      max = Math.max(max, high);
      valid += count;
      const latitude = tileCoordinate(tile, 128, 128)[1];
      spacing = Math.max(
        spacing,
        (40075016.686 * Math.cos((latitude * Math.PI) / 180)) /
          (2 ** tile.z * 256),
      );
      const visibleLines = coveredContours({ tile, lines }, entries);
      if (visibleLines.length)
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'MultiLineString', coordinates: visibleLines },
        });
    }
    let models = 0;
    for (const item of this.items) {
      if (!item.visible || !this.map.getBounds().contains(item.coordinates))
        continue;
      const range = altitudeRange(item);
      if (range) {
        min = Math.min(min, range.bottom);
        max = Math.max(max, range.top);
        models++;
      }
    }
    (this.map.getSource(EDGES) as GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features,
    });
    this.notify({
      phase:
        this.pending > 0
          ? 'loading'
          : this.failed
            ? valid
              ? 'partial'
              : 'error'
            : valid
              ? 'ready'
              : 'loading',
      min: Number.isFinite(min) ? Math.floor((min - 100) / 50) * 50 : -500,
      max: Number.isFinite(max) ? Math.ceil((max + 100) / 50) * 50 : 9000,
      spacing,
      samples: tiles * 65536,
      valid,
      tiles,
      models,
    });
  }
  private close() {
    this.abort.abort();
    this.abort = new AbortController();
    this.revision++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.reportTimer) clearTimeout(this.reportTimer);
    this.reportTimer = null;
    this.onAltitude(null);
    if (this.map.getTerrain()?.source === DEM)
      this.map.setTerrain(this.originalTerrain);
    for (const id of [`${EDGES}-rim`, FILL])
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    for (const id of [EDGES, DEM])
      if (this.map.getSource(id)) this.map.removeSource(id);
    if (this.originalPitch !== null)
      this.map.jumpTo({ pitch: this.originalPitch });
    this.originalPitch = null;
    this.tiles.clear();
    this.pending = 0;
    this.failed = 0;
    this.notify({ ...INITIAL_SECTION_STATUS });
  }
  dispose() {
    this.map.off('moveend', this.onViewChange);
    this.map.off('resize', this.onViewChange);
    this.settings = { ...this.settings, enabled: false };
    this.close();
    this.protocols.removeProtocol(this.protocol);
    this.store.clear();
  }
}
