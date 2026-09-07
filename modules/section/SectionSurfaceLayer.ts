import * as THREE from 'three';
import type {
  Map as TerrainMap,
  CustomLayerInterface,
  CustomRenderMethodInput,
} from 'maplibre-gl';
import type { Annotation } from '../annotations/data';
import type { SectionSettings, SectionStatus } from './types';
import { localMatrix, planeBasis, planePoint } from './planeMath';
import {
  sampleSection,
  type ProfilePoint,
  type SectionProfileData,
} from './contours';
import { loadedTerrainSampler } from './loadedTerrain';

/** Non-destructive overlay. Never patches terrain shaders or clips model materials. */
export class SectionSurfaceLayer implements CustomLayerInterface {
  id = 'section-plane';
  type = 'custom' as const;
  renderingMode = '3d' as const;
  private settings: SectionSettings = {
    enabled: false,
    altitude: 0,
    color: '#9de8c4',
  };
  private items: Annotation[] = [];
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private inverse = new THREE.Matrix4();
  private rendered = false;
  private glass = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: '#9de8c4',
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  );
  private guide = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: '#9de8c4',
      depthTest: false,
      depthWrite: false,
    }),
  );
  private rim = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: '#ffb85f',
      depthTest: false,
      depthWrite: false,
    }),
  );
  private cursor = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({
      color: '#ffffff',
      size: 12,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
    }),
  );
  private timer: ReturnType<typeof setTimeout> | null = null;
  private originalPitch: number | null = null;
  private stopped = false;
  constructor(
    private map: TerrainMap,
    private notify: (data: SectionProfileData) => void,
    private status: (s: SectionStatus) => void,
  ) {
    map.on('sourcedata', this.onData);
    map.on('moveend', this.schedule);
  }
  onAdd(_map: TerrainMap, gl: WebGL2RenderingContext) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.map.getCanvas(),
      context: gl,
    });
    this.renderer.autoClear = false;
    [this.glass, this.guide, this.rim, this.cursor].forEach((o, i) => {
      o.frustumCulled = false;
      o.renderOrder = i;
      this.scene.add(o);
    });
  }
  configure(settings: SectionSettings, items: Annotation[]) {
    const old = this.settings,
      changed = old !== settings || this.items !== items;
    this.settings = settings;
    this.items = items;
    if (!old.enabled && settings.enabled) {
      this.originalPitch = this.map.getPitch() < 5 ? this.map.getPitch() : null;
      if (this.originalPitch !== null) this.map.jumpTo({ pitch: 55 });
    }
    if (!settings.enabled) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.rendered = false;
      if (old.enabled && this.originalPitch !== null)
        this.map.jumpTo({ pitch: this.originalPitch });
      this.map.triggerRepaint();
      return;
    }
    if (!settings.plane || !changed) return;
    const p = settings.plane,
      corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([x, y]) =>
        planePoint(settings, (x * p.width) / 2, (y * p.height) / 2),
      );
    this.replace(this.guide, corners);
    this.replace(this.glass, [
      corners[0],
      corners[1],
      corners[2],
      corners[0],
      corners[2],
      corners[3],
    ]);
    this.glass.material.color.set(settings.color);
    this.guide.material.color.set(settings.color);
    this.replace(this.rim, []);
    this.setCursor(null);
    this.rendered = false;
    this.notify({
      settings,
      curves: [],
      createdAt: Date.now(),
      valid: 0,
      samples: 0,
      spacing: 0,
      phase: 'loading',
    });
    this.schedule();
    this.map.triggerRepaint();
  }
  private replace(
    object: THREE.Mesh | THREE.Line | THREE.Points,
    points: THREE.Vector3[],
  ) {
    object.geometry.dispose();
    object.geometry = new THREE.BufferGeometry().setFromPoints(points);
  }
  setCursor(point: ProfilePoint | null) {
    this.replace(
      this.cursor,
      point ? [new THREE.Vector3().fromArray(point.local)] : [],
    );
    this.map.triggerRepaint();
  }
  private onData = (e: { sourceId?: string; sourceDataType?: string }) => {
    if (e.sourceId === 'elevation' && e.sourceDataType === 'content')
      this.schedule();
  };
  private schedule = () => {
    if (
      this.stopped ||
      !this.settings.enabled ||
      !this.settings.plane ||
      this.timer
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sample();
    }, 140);
  };
  refresh() {
    this.schedule();
  }
  private sample() {
    if (this.stopped || !this.settings.enabled || !this.settings.plane) return;
    try {
      const data = sampleSection(
        this.settings,
        this.items,
        loadedTerrainSampler(this.map),
      );
      this.replace(
        this.rim,
        data.curves.flatMap((c) =>
          c.points
            .slice(1)
            .flatMap((p, i) => [
              new THREE.Vector3().fromArray(c.points[i].local),
              new THREE.Vector3().fromArray(p.local),
            ]),
        ),
      );
      this.notify(data);
      this.status({
        phase: data.phase,
        min: data.curves.length
          ? Math.min(...data.curves.map((c) => c.min))
          : this.settings.altitude,
        max: data.curves.length
          ? Math.max(...data.curves.map((c) => c.max))
          : this.settings.altitude,
        spacing: data.spacing,
        samples: data.samples,
        valid: data.valid,
        tiles: 0,
        models: new Set(
          data.curves
            .filter((c) => c.source === 'model')
            .map((c) => c.id.split(':').slice(0, -1).join(':')),
        ).size,
      });
    } catch {
      this.replace(this.rim, []);
      this.notify({
        settings: this.settings,
        curves: [],
        createdAt: Date.now(),
        valid: 0,
        samples: 0,
        spacing: 0,
        phase: 'error',
      });
    }
    this.map.triggerRepaint();
  }
  render(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    if (!this.settings.enabled || !this.settings.plane || !this.renderer)
      return;
    this.camera.projectionMatrix
      .fromArray(input.defaultProjectionData.mainMatrix)
      .multiply(localMatrix(this.settings));
    this.inverse.copy(this.camera.projectionMatrix).invert();
    this.rendered = true;
    this.renderer.resetState();
    this.renderer.setViewport(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
    );
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
  }
  pick(point: { x: number; y: number }) {
    if (!this.rendered || !this.settings.enabled || !this.settings.plane)
      return false;
    const x = (point.x / this.map.getCanvas().clientWidth) * 2 - 1,
      y = 1 - (point.y / this.map.getCanvas().clientHeight) * 2;
    const near = new THREE.Vector3(x, y, -1).applyMatrix4(this.inverse),
      far = new THREE.Vector3(x, y, 1).applyMatrix4(this.inverse);
    const ray = new THREE.Ray(near, far.sub(near).normalize()),
      p = this.settings.plane,
      b = planeBasis(p.heading, p.tilt, p.roll);
    const hit = ray.intersectPlane(
      new THREE.Plane(b.n, 0),
      new THREE.Vector3(),
    );
    return (
      !!hit &&
      Math.abs(hit.dot(b.u)) <= p.width / 2 &&
      Math.abs(hit.dot(b.v)) <= p.height / 2
    );
  }
  dispose() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.map.off('sourcedata', this.onData);
    this.map.off('moveend', this.schedule);
  }
  onRemove() {
    this.dispose();
    [this.glass, this.guide, this.rim, this.cursor].forEach((o) => {
      o.geometry.dispose();
      o.material.dispose();
    });
    this.renderer?.dispose();
  }
}
