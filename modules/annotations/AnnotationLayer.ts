import * as THREE from 'three';
import {
  Marker,
  MercatorCoordinate,
  type Map,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
} from 'maplibre-gl';
import { altitudeRange, dimensions, type Annotation } from './data';
import type { LayerSettings } from '../map/types';

/** One world metre per geometry unit; buried solids render as transparent X-ray overlays. */
export class AnnotationLayer implements CustomLayerInterface {
  id = 'annotation-models';
  type = 'custom' as const;
  renderingMode = '3d' as const;
  private map?: Map;
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private markers: Marker[] = [];
  private items: Annotation[] = [];
  private selected: string | null = null;
  private settings: Pick<LayerSettings, 'terrain' | 'exaggeration'> = {
    terrain: true,
    exaggeration: 1,
  };
  private origin = MercatorCoordinate.fromLngLat([103.28, 31.08]);
  constructor(private onSelect: (id: string) => void) {}
  onAdd(map: Map, gl: WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.rebuild();
  }
  update(
    items: Annotation[],
    selected: string | null,
    settings: LayerSettings,
  ) {
    if (
      this.items === items &&
      this.selected === selected &&
      this.settings.terrain === settings.terrain &&
      this.settings.exaggeration === settings.exaggeration
    )
      return;
    this.items = items;
    this.selected = selected;
    this.settings = {
      terrain: settings.terrain,
      exaggeration: settings.exaggeration,
    };
    this.rebuild();
  }
  private clear() {
    this.markers.forEach((marker) => marker.remove());
    this.markers = [];
    this.scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.LineSegments
      ) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          material.dispose();
      }
    });
    this.scene.clear();
  }
  private rebuild() {
    this.clear();
    const map = this.map;
    if (!map) return;
    const first = this.items.find((a) => a.visible);
    this.origin = MercatorCoordinate.fromLngLat(
      first?.coordinates ?? [103.28, 31.08],
    );
    const originUnit = this.origin.meterInMercatorCoordinateUnits();
    for (const item of this.items) {
      if (!item.visible) continue;
      const element = document.createElement('button');
      element.className = `annotation-marker ${item.id === this.selected ? 'is-selected' : ''} ${item.placement === 'underground' ? 'is-underground' : ''}`;
      element.style.setProperty('--marker-color', item.color);
      element.type = 'button';
      element.textContent = `${item.placement === 'underground' ? '▽ ' : '● '}${item.name || '未命名'}`;
      element.title = `${item.name} · 点击编辑`;
      element.setAttribute('aria-label', `编辑标记 ${item.name}`);
      element.onclick = (event) => {
        event.stopPropagation();
        this.onSelect(item.id);
      };
      this.markers.push(
        new Marker({ element, anchor: 'bottom' })
          .setLngLat(item.coordinates)
          .addTo(map),
      );
      if (item.kind === 'pin' || item.groundElevation === null) continue;
      const ground = this.settings.terrain
        ? item.groundElevation * this.settings.exaggeration
        : 0;
      const range = altitudeRange(item, ground);
      if (!range) continue;
      const mercator = MercatorCoordinate.fromLngLat(item.coordinates);
      const localUnit = mercator.meterInMercatorCoordinateUnits();
      const [width, length, height] = dimensions(item);
      let geometry: THREE.BufferGeometry;
      if (item.kind === 'box')
        geometry = new THREE.BoxGeometry(width, length, height);
      else if (item.kind === 'sphere')
        geometry = new THREE.SphereGeometry(width / 2, 32, 20);
      else {
        geometry = new THREE.CylinderGeometry(width / 2, width / 2, height, 48);
        geometry.rotateX(Math.PI / 2);
      }
      const underground = item.placement === 'underground';
      const material = new THREE.MeshBasicMaterial({
        color: item.color,
        transparent: true,
        opacity: underground ? Math.min(item.opacity, 0.45) : item.opacity,
        depthWrite: false,
        depthTest: !underground,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const frame = new THREE.Group();
      frame.position.set(
        (mercator.x - this.origin.x) / originUnit,
        (mercator.y - this.origin.y) / originUnit,
        (range.center * localUnit) / originUnit,
      );
      frame.scale.set(
        localUnit / originUnit,
        -localUnit / originUnit,
        localUnit / originUnit,
      );
      const rotation = new THREE.Group();
      rotation.rotation.set(
        (item.pitch * Math.PI) / 180,
        (item.roll * Math.PI) / 180,
        (-item.heading * Math.PI) / 180,
        'ZYX',
      );
      rotation.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, item.kind === 'box' ? 1 : 18),
        new THREE.LineBasicMaterial({
          color: item.color,
          transparent: true,
          opacity: item.id === this.selected ? 1 : 0.8,
          depthWrite: false,
          depthTest: !underground,
        }),
      );
      rotation.add(edges);
      frame.add(rotation);
      this.scene.add(frame);
      mesh.renderOrder = underground ? 20 : 0;
      edges.renderOrder = underground ? 21 : 1;
      mesh.frustumCulled = false;
      edges.frustumCulled = false;
    }
    map.triggerRepaint();
  }
  render(_gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    if (!this.renderer || !this.map || !this.scene.children.length) return;
    const unit = this.origin.meterInMercatorCoordinateUnits();
    const local = new THREE.Matrix4()
      .makeTranslation(this.origin.x, this.origin.y, 0)
      .scale(new THREE.Vector3(unit, unit, unit));
    this.camera.projectionMatrix
      .fromArray(input.defaultProjectionData.mainMatrix)
      .multiply(local);
    this.renderer.resetState();
    this.renderer.setViewport(
      0,
      0,
      this.map.getCanvas().width,
      this.map.getCanvas().height,
    );
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
  }
  onRemove() {
    this.clear();
    this.renderer?.dispose();
    this.map = undefined;
  }
}
