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
  private markers = new globalThis.Map<string, Marker>();
  private frames = new globalThis.Map<string, THREE.Group>();
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
    // During dragging only position changes. Retain DOM targets and GPU geometry.
    const movingOnly =
      this.selected === selected &&
      this.settings.terrain === settings.terrain &&
      this.settings.exaggeration === settings.exaggeration &&
      items.length === this.items.length &&
      items.every((item, index) => {
        const old = this.items[index];
        return Object.keys(old).every(
          (key) =>
            key === 'coordinates' ||
            old[key as keyof Annotation] === item[key as keyof Annotation],
        );
      });
    if (movingOnly) {
      const unit = this.origin.meterInMercatorCoordinateUnits();
      items.forEach((item, index) => {
        if (item === this.items[index]) return;
        this.markers.get(item.id)?.setLngLat(item.coordinates);
        const frame = this.frames.get(item.id);
        if (frame && item.groundElevation !== null) {
          const mercator = MercatorCoordinate.fromLngLat(item.coordinates);
          const ratio = mercator.meterInMercatorCoordinateUnits() / unit;
          const range = altitudeRange(
            item,
            settings.terrain ? item.groundElevation * settings.exaggeration : 0,
          )!;
          frame.position.set(
            (mercator.x - this.origin.x) / unit,
            (mercator.y - this.origin.y) / unit,
            range.center * ratio,
          );
          frame.scale.set(ratio, -ratio, ratio);
        }
      });
      this.items = items;
      this.map?.triggerRepaint();
      return;
    }
    this.items = items;
    this.selected = selected;
    this.settings = {
      terrain: settings.terrain,
      exaggeration: settings.exaggeration,
    };
    this.rebuild();
  }
  private clear(removeMarkers = true) {
    if (removeMarkers) {
      this.markers.forEach((marker) => marker.remove());
      this.markers.clear();
    }
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
    this.frames.clear();
    this.hasRendered = false;
  }
  private rebuild() {
    this.clear(false);
    const map = this.map;
    if (!map) return;
    for (const [id, marker] of this.markers) {
      if (!this.items.some((item) => item.id === id && item.visible)) {
        marker.remove();
        this.markers.delete(id);
      }
    }
    const first = this.items.find((a) => a.visible);
    this.origin = MercatorCoordinate.fromLngLat(
      first?.coordinates ?? [103.28, 31.08],
    );
    const originUnit = this.origin.meterInMercatorCoordinateUnits();
    for (const item of this.items) {
      if (!item.visible) continue;
      const existing = this.markers.get(item.id);
      const element =
        existing?.getElement() ?? document.createElement('button');
      element.className = `annotation-marker ${item.id === this.selected ? 'is-selected' : ''} ${item.placement === 'underground' ? 'is-underground' : ''}`;
      element.style.setProperty('--marker-color', item.color);
      element.setAttribute('type', 'button');
      element.dataset.annotationId = item.id;
      element.textContent = `${item.placement === 'underground' ? '▽ ' : '● '}${item.name || '未命名'}`;
      element.title = `${item.name} · 点击查看，长按拖动位置`;
      element.setAttribute('aria-label', `编辑标记 ${item.name}`);
      element.onclick = (event) => {
        event.stopPropagation();
        this.onSelect(item.id);
      };
      if (existing) existing.setLngLat(item.coordinates);
      else
        this.markers.set(
          item.id,
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
      mesh.userData.annotationId = item.id;
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
          color: item.id === this.selected ? '#ffffff' : item.color,
          transparent: true,
          opacity: item.id === this.selected ? 1 : 0.8,
          depthWrite: false,
          depthTest: !underground,
        }),
      );
      rotation.add(edges);
      frame.add(rotation);
      this.scene.add(frame);
      this.frames.set(item.id, frame);
      mesh.renderOrder = underground ? 20 : 0;
      edges.renderOrder = underground ? 21 : 1;
      mesh.frustumCulled = false;
      edges.frustumCulled = false;
    }
    map.triggerRepaint();
  }
  /** The custom layer uses a combined view/projection matrix in local metre space. */
  pickForMove(point: { x: number; y: number }) {
    const id = this.pick(point);
    const item = this.items.find(
      (candidate) => candidate.id === id && candidate.visible,
    );
    // Use the stored ground anchor, not the hit face's elevated/buried position.
    return item ? { id: item.id, coordinate: item.coordinates } : null;
  }
  pick(point: { x: number; y: number }): string | null {
    if (!this.map || !this.scene.children.length || !this.hasRendered)
      return null;
    const canvas = this.map.getCanvas();
    const x = (point.x / canvas.clientWidth) * 2 - 1;
    const y = 1 - (point.y / canvas.clientHeight) * 2;
    const inverse = this.camera.projectionMatrix.clone().invert();
    const near = new THREE.Vector3(x, y, -1).applyMatrix4(inverse);
    const far = new THREE.Vector3(x, y, 1).applyMatrix4(inverse);
    this.scene.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(near, far.sub(near).normalize());
    return (
      ray
        .intersectObjects(this.scene.children, true)
        .find((hit) => hit.object instanceof THREE.Mesh)?.object.userData
        .annotationId ?? null
    );
  }
  private hasRendered = false;
  render(_gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    if (!this.renderer || !this.map || !this.scene.children.length) return;
    const unit = this.origin.meterInMercatorCoordinateUnits();
    const local = new THREE.Matrix4()
      .makeTranslation(this.origin.x, this.origin.y, 0)
      .scale(new THREE.Vector3(unit, unit, unit));
    this.camera.projectionMatrix
      .fromArray(input.defaultProjectionData.mainMatrix)
      .multiply(local);
    this.hasRendered = true;
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
