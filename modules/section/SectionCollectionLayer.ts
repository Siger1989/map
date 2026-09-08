import type { Map } from 'maplibre-gl';
import type { Annotation } from '../annotations/data';
import type { SectionObject } from './sectionObjects';
import { SectionSurfaceLayer } from './SectionSurfaceLayer';
/** Other saved planes share the existing surface sampler; only the selected plane owns editing and charts. */
export class SectionCollectionLayer {
  private layers = new globalThis.Map<string, SectionSurfaceLayer>();
  constructor(private map: Map) {}
  configure(
    items: SectionObject[],
    selectedId: string | null,
    annotations: Annotation[],
  ) {
    const visible = items.filter(
      (s) => s.id !== selectedId && s.settings.enabled,
    );
    for (const [id, layer] of this.layers) {
      if (!visible.some((s) => s.id === id)) {
        if (this.map.getLayer(layer.id)) this.map.removeLayer(layer.id);
        else layer.dispose();
        this.layers.delete(id);
      }
    }
    for (const item of visible) {
      let layer = this.layers.get(item.id);
      if (!layer) {
        layer = new SectionSurfaceLayer(
          this.map,
          () => {},
          () => {},
          { id: `saved-section-${item.id}`, passive: true },
        );
        this.map.addLayer(
          layer,
          this.map.getLayer('section-plane') ? 'section-plane' : undefined,
        );
        this.layers.set(item.id, layer);
      }
      layer.configure(item.settings, annotations);
    }
  }
  pick(point: { x: number; y: number }) {
    for (const [id, layer] of [...this.layers].reverse())
      if (layer.pick(point)) return id;
    return null;
  }
  dispose() {
    for (const layer of this.layers.values()) layer.dispose();
    this.layers.clear();
  }
}
