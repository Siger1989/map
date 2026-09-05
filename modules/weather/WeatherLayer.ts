import * as THREE from 'three';
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map,
} from 'maplibre-gl';
import type { LayerSettings } from '../map/types';
import { rainColor, type WeatherData } from './data';

type Drop = {
  x: number;
  y: number;
  floor: number;
  height: number;
  phase: number;
  speed: number;
};
const seeded = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Model-driven illustration only: cloud geometry and drop trajectories are not observations. */
export class WeatherLayer implements CustomLayerInterface {
  id = 'cloud-rain-3d';
  type = 'custom' as const;
  renderingMode = '3d' as const;
  private map?: Map;
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private cloudGroup = new THREE.Group();
  private rainGroup = new THREE.Group();
  private drops: Drop[] = [];
  private dropGeometry?: THREE.BufferGeometry;
  private rainMaterial?: THREE.LineBasicMaterial;
  private origin = MercatorCoordinate.fromLngLat([103.55, 30.92]);
  private data: WeatherData | null = null;
  private index = 0;
  private settings: LayerSettings;
  private reducedMotion = false;
  private start = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(settings: LayerSettings) {
    this.settings = settings;
  }
  onAdd(map: Map, gl: WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.scene.add(this.cloudGroup, this.rainGroup);
    this.scene.add(new THREE.AmbientLight(0xe4f4ff, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(-10000, -20000, 30000);
    this.scene.add(sun);
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.start = performance.now();
    this.rebuild();
  }
  update(data: WeatherData | null, index: number, settings: LayerSettings) {
    const changed =
      this.data !== data ||
      this.index !== index ||
      this.settings.exaggeration !== settings.exaggeration ||
      this.settings.terrain !== settings.terrain;
    this.data = data;
    this.index = index;
    this.settings = settings;
    if (changed) this.rebuild();
    this.cloudGroup.visible = settings.clouds;
    this.rainGroup.visible = settings.rain;
    this.cloudGroup.traverse((object) => {
      if (object instanceof THREE.Mesh)
        (object.material as THREE.Material).opacity = settings.opacity * 0.48;
    });
    if (this.rainMaterial) this.rainMaterial.opacity = settings.opacity * 0.95;
    this.map?.triggerRepaint();
  }
  private clear(group: THREE.Group) {
    group.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.LineSegments
      ) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((m) => m.dispose());
      }
    });
    group.clear();
  }
  private rebuild() {
    this.clear(this.cloudGroup);
    this.clear(this.rainGroup);
    this.drops = [];
    this.dropGeometry = undefined;
    this.rainMaterial = undefined;
    if (!this.data || !this.map) return;
    this.origin = MercatorCoordinate.fromLngLat(this.data.anchor);
    const unit = this.origin.meterInMercatorCoordinateUnits();
    const matrices: THREE.Matrix4[][] = [[], [], []];
    const colors: number[] = [];
    this.data.cells.forEach((cell, cellIndex) => {
      const hour = cell.hours[this.index];
      if (!hour) return;
      const pos = MercatorCoordinate.fromLngLat([cell.lng, cell.lat]);
      const x = (pos.x - this.origin.x) / unit,
        y = (pos.y - this.origin.y) / unit;
      const floor = this.settings.terrain
        ? Math.max(0, cell.elevation ?? 0) * this.settings.exaggeration
        : 0;
      [hour.low, hour.mid, hour.high].forEach((cover, level) => {
        if (cover == null || cover < 5) return;
        const count = Math.ceil(cover / 12.5);
        for (let j = 0; j < count; j++) {
          const seed = cellIndex * 71 + level * 29 + j * 3;
          const location = new THREE.Vector3(
            x + (seeded(seed) - 0.5) * 25000,
            y + (seeded(seed + 1) - 0.5) * 27000,
            floor + [1800, 4200, 7600][level],
          );
          const scale = new THREE.Vector3(
            2800 + cover * 28,
            2600 + cover * 24,
            [500, 550, 350][level],
          );
          matrices[level].push(
            new THREE.Matrix4().compose(
              location,
              new THREE.Quaternion(),
              scale,
            ),
          );
        }
      });
      if (hour.rain == null || hour.rain < 0.1) return;
      const count = Math.min(130, Math.ceil(22 + hour.rain * 16));
      const color = new THREE.Color(rainColor(hour.rain));
      for (let j = 0; j < count; j++) {
        const seed = cellIndex * 107 + j * 5;
        this.drops.push({
          x: x + (seeded(seed) - 0.5) * 28000,
          y: y + (seeded(seed + 1) - 0.5) * 30000,
          floor: floor + 70,
          height: 2600,
          phase: seeded(seed + 2),
          speed: 0.22 + Math.min(0.4, hour.rain * 0.035),
        });
        for (let k = 0; k < 2; k++) colors.push(color.r, color.g, color.b);
      }
    });
    matrices.forEach((values, level) => {
      if (!values.length) return;
      const geometry = new THREE.SphereGeometry(1, 12, 8);
      const material = new THREE.MeshLambertMaterial({
        color: [0xc4d1da, 0xe0e9ef, 0xecf3f7][level],
        transparent: true,
        opacity: this.settings.opacity * 0.48,
        depthWrite: false,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, values.length);
      values.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.cloudGroup.add(mesh);
    });
    if (this.drops.length) {
      this.dropGeometry = new THREE.BufferGeometry();
      this.dropGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          new Float32Array(this.drops.length * 6),
          3,
        ),
      );
      this.dropGeometry.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(colors, 3),
      );
      this.rainMaterial = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: this.settings.opacity * 0.95,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(
        this.dropGeometry,
        this.rainMaterial,
      );
      lines.frustumCulled = false;
      this.rainGroup.add(lines);
    }
    this.cloudGroup.visible = this.settings.clouds;
    this.rainGroup.visible = this.settings.rain;
  }
  render(_gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    if (!this.renderer || !this.data) return;
    if (this.dropGeometry && this.settings.rain) {
      const elapsed = this.reducedMotion
        ? 0
        : (performance.now() - this.start) / 1000;
      const positions = this.dropGeometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      this.drops.forEach((d, i) => {
        const z =
          d.floor + (1 - ((d.phase + elapsed * d.speed) % 1)) * d.height;
        positions.setXYZ(i * 2, d.x, d.y, z);
        positions.setXYZ(i * 2 + 1, d.x + 90, d.y, Math.max(d.floor, z - 380));
      });
      positions.needsUpdate = true;
    }
    const unit = this.origin.meterInMercatorCoordinateUnits();
    const local = new THREE.Matrix4()
      .makeTranslation(this.origin.x, this.origin.y, 0)
      .scale(new THREE.Vector3(unit, unit, unit));
    this.camera.projectionMatrix
      .fromArray(input.defaultProjectionData.mainMatrix)
      .multiply(local);
    this.renderer.resetState();
    if (this.map)
      this.renderer.setViewport(
        0,
        0,
        this.map.getCanvas().width,
        this.map.getCanvas().height,
      );
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
    if (
      this.settings.rain &&
      this.drops.length &&
      !this.reducedMotion &&
      !document.hidden &&
      !this.timer
    ) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.map?.triggerRepaint();
      }, 33);
    }
  }
  onRemove() {
    if (this.timer) clearTimeout(this.timer);
    this.clear(this.cloudGroup);
    this.clear(this.rainGroup);
    this.renderer?.dispose();
    this.map = undefined;
  }
}
