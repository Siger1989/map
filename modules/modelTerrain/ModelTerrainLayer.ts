import * as THREE from 'three';
import type {
  Map,
  CustomLayerInterface,
  CustomRenderMethodInput,
} from 'maplibre-gl';
import type { Annotation } from '../annotations/data';
import type { LayerSettings } from '../map/types';
import { loadedTerrainSampler } from '../section/loadedTerrain';
import { mercator } from '../section/planeMath';
import { terrainPatch } from './geometry';
import {
  TerrainModelMask,
  MODEL_MASK_SIZE,
  MODEL_MASK_COLUMNS,
  MODEL_MASK_ROWS,
} from './terrainMask';

/** Per-model local excavation and sampled rock contact, separate from section tools and saved data. */
export class ModelTerrainLayer implements CustomLayerInterface {
  id = 'model-terrain-contact';
  type = 'custom' as const;
  renderingMode = '3d' as const;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private renderer?: THREE.WebGLRenderer;
  private origin = mercator([0, 0]);
  private items: Annotation[] = [];
  private terrain = true;
  private exaggeration = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private stopped = false;
  private key = '';
  constructor(
    private map: Map,
    private mask: TerrainModelMask,
    private status: (message: string) => void,
  ) {
    map.on('moveend', this.schedule);
    map.on('sourcedata', this.onData);
  }
  onAdd(_map: Map, gl: WebGL2RenderingContext) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.map.getCanvas(),
      context: gl,
    });
    this.renderer.autoClear = false;
    this.schedule();
  }
  configure(items: Annotation[], settings: LayerSettings) {
    this.items = items.filter(
      (a) =>
        a.kind !== 'pin' &&
        a.visible &&
        (a.terrainIntersection !== false ||
          (a.terrainCut ?? a.placement === 'underground')),
    );
    this.terrain = settings.terrain;
    this.exaggeration = settings.exaggeration;
    const key = JSON.stringify([
      this.terrain,
      this.exaggeration,
      this.items.map((a) => [
        a.id,
        a.kind,
        a.coordinates,
        a.groundElevation,
        a.centerAltitude,
        a.placement,
        a.offset,
        a.width,
        a.length,
        a.height,
        a.heading,
        a.pitch,
        a.roll,
        a.footprint,
        a.terrainCut,
        a.terrainIntersection,
      ]),
    ]);
    if (key !== this.key) {
      this.key = key;
      this.generation++;
      this.mask.disable();
      this.clear();
      this.schedule();
    }
  }
  private onData = (e: { sourceId?: string }) => {
    if (e.sourceId === 'elevation') this.schedule();
  };
  private schedule = () => {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.rebuild().catch(() => {
        if (this.stopped) return;
        this.clear();
        this.mask.disable();
        this.status('地形交界暂未生成，移动视角或重新读取地形后重试');
        this.map.triggerRepaint();
      });
    }, 300);
  };
  private clear() {
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          m.dispose();
      }
    });
    this.scene.clear();
  }
  private async rebuild() {
    const generation = ++this.generation;
    if (!this.terrain || !this.items.length) {
      this.clear();
      this.mask.disable();
      this.map.triggerRepaint();
      this.status('');
      return;
    }
    const width = this.map.getCanvas().clientWidth,
      height = this.map.getCanvas().clientHeight;
    const items = this.items.filter((a) => {
      const p = this.map.project(a.coordinates);
      return (
        p.x > -300 && p.x < width + 300 && p.y > -300 && p.y < height + 300
      );
    });
    if (!items.length || this.map.getZoom() < 10) {
      this.clear();
      this.mask.disable();
      this.status('放大到模型附近，加载地形后显示交界');
      return;
    }
    const sample = loadedTerrainSampler(this.map),
      patches = [];
    for (const original of items) {
      if (this.stopped || generation !== this.generation) return;
      const item = {
        ...original,
        groundElevation:
          original.groundElevation === null
            ? null
            : original.groundElevation * this.exaggeration,
      };
      const patch = terrainPatch(
        item,
        (p) => {
          const h = sample(p);
          return h === null ? null : h * this.exaggeration;
        },
        MODEL_MASK_SIZE,
      );
      if (patch) patches.push(patch);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    if (this.stopped || generation !== this.generation) return;
    this.clear();
    if (!patches.some((p) => p.valid > 0)) {
      this.mask.disable();
      this.status('模型范围内的地形尚未加载，暂不生成交界');
      this.map.triggerRepaint();
      return;
    }
    this.origin = mercator(items[0].coordinates);
    const bounds = new Float32Array(80 * 4),
      pixels = new Uint8Array(
        MODEL_MASK_COLUMNS * MODEL_MASK_ROWS * MODEL_MASK_SIZE ** 2 * 4,
      );
    let maxSpacing = 0,
      missing = false;
    patches.forEach((p, i) => {
      const anchor = mercator(p.item.coordinates),
        wrap = Math.round(this.origin.x - anchor.x);
      const offsetX = (anchor.x + wrap - this.origin.x) / this.origin.unit,
        offsetY = (anchor.y - this.origin.y) / this.origin.unit,
        ratio = anchor.unit / this.origin.unit;
      bounds.set(
        [
          offsetX + p.bounds.min.x * ratio,
          offsetY + p.bounds.min.y * ratio,
          (p.bounds.max.x - p.bounds.min.x) * ratio,
          (p.bounds.max.y - p.bounds.min.y) * ratio,
        ],
        i * 4,
      );
      for (let y = 0; y < MODEL_MASK_SIZE; y++)
        for (let x = 0; x < MODEL_MASK_SIZE; x++) {
          const target =
            ((Math.floor(i / MODEL_MASK_COLUMNS) * MODEL_MASK_SIZE + y) *
              MODEL_MASK_COLUMNS *
              MODEL_MASK_SIZE +
              (i % MODEL_MASK_COLUMNS) * MODEL_MASK_SIZE +
              x) *
            4;
          pixels[target] = p.mask[y * MODEL_MASK_SIZE + x];
          pixels[target + 3] = 255;
        }
      const mesh = (
        values: number[],
        color: string,
        opacity: number,
        line = false,
      ) => {
        if (!values.length) return;
        const geometry = new THREE.BufferGeometry().setAttribute(
          'position',
          new THREE.Float32BufferAttribute(values, 3),
        );
        const object = line
          ? new THREE.LineSegments(
              geometry,
              new THREE.LineBasicMaterial({
                color,
                depthTest: false,
                transparent: true,
                opacity,
              }),
            )
          : new THREE.Mesh(
              geometry,
              new THREE.MeshBasicMaterial({
                color,
                side: THREE.DoubleSide,
                depthTest: true,
                depthWrite: false,
                transparent: true,
                opacity,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
              }),
            );
        object.position.set(offsetX, offsetY, 0);
        object.scale.setScalar(ratio);
        object.frustumCulled = false;
        object.renderOrder = line ? 35 : 30;
        this.scene.add(object);
      };
      mesh(p.walls, '#ffe59a', 0.85);
      if (p.item.terrainIntersection !== false) {
        mesh(p.faces, '#ffea58', 0.72);
        mesh(p.rim, '#ffffb0', 1, true);
      }
      maxSpacing = Math.max(maxSpacing, p.spacing);
      missing ||= p.valid < p.samples;
    });
    this.mask.setData(bounds, pixels, patches.length);
    this.status(
      `${missing ? '部分地形未加载，缺失处未裁切。' : ''}亮黄为模型与山体交界，浅黄为开挖侧壁；采样间隔约 ${maxSpacing.toFixed(1)} m${this.mask.matched < 2 ? '；当前渲染器未接入地表裁切' : ''}`,
    );
    this.map.triggerRepaint();
  }
  prerender(_gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    const local = new THREE.Matrix4()
      .makeTranslation(this.origin.x, this.origin.y, 0)
      .scale(
        new THREE.Vector3(this.origin.unit, this.origin.unit, this.origin.unit),
      );
    this.camera.projectionMatrix
      .fromArray(input.defaultProjectionData.mainMatrix)
      .multiply(local);
    this.mask.frame(this.camera.projectionMatrix.clone().invert());
  }
  render(_gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    this.prerender(_gl, input);
    if (!this.renderer || !this.scene.children.length) return;
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
    this.stopped = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.map.off('moveend', this.schedule);
    this.map.off('sourcedata', this.onData);
    this.clear();
    this.mask.disable();
    this.renderer?.dispose();
  }
}
