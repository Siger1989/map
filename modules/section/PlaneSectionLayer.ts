import * as THREE from 'three';
import type {
  Map as TerrainMap,
  CustomLayerInterface,
  CustomRenderMethodInput,
} from 'maplibre-gl';
import type { Annotation } from '../annotations/data';
import {
  INITIAL_SECTION_STATUS,
  type SectionSettings,
  type SectionStatus,
} from './types';
import {
  clipFaceTriangle,
  coordinate,
  localMatrix,
  mercator,
  planeBasis,
  planePoint,
} from './planeMath';
import { TerrainClip } from './terrainClip';

/** A finite rectangle, extruded toward the viewer, cuts the original terrain. */
export class PlaneSectionLayer implements CustomLayerInterface {
  id = 'section-plane';
  type = 'custom' as const;
  renderingMode = '3d' as const;
  private settings: SectionSettings = {
    enabled: false,
    altitude: 1500,
    color: '#ffffff',
  };
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private inverse = new THREE.Matrix4();
  private face = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  private rim = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: '#334155', depthTest: false }),
  );
  private guide = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: '#9de8c4', depthTest: false }),
  );
  private glass = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: '#9de8c4',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    }),
  );
  private handles: HTMLButtonElement[] = [];
  private originalTerrain: ReturnType<TerrainMap['getTerrain']> = null;
  private originalPitch: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private side = 1;
  private drag: {
    id: number;
    handle: number;
    start: THREE.Vector3;
    settings: SectionSettings;
  } | null = null;
  private status = INITIAL_SECTION_STATUS;
  private items: Annotation[] = [];
  constructor(
    private map: TerrainMap,
    private notify: (status: SectionStatus) => void,
    private clip: TerrainClip,
    private change: (settings: SectionSettings) => void,
    private onPlane: (settings: SectionSettings | null, side: number) => void,
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
    this.scene.add(this.face, this.rim, this.glass, this.guide);
    for (const mesh of [this.face, this.rim, this.glass, this.guide])
      mesh.frustumCulled = false;
    this.glass.renderOrder = 2;
    this.rim.renderOrder = 3;
    this.guide.renderOrder = 4;
    for (let i = 0; i < 5; i++) {
      const button = document.createElement('button');
      button.className = `section-plane-handle ${i === 0 ? 'is-center' : 'is-corner'}`;
      button.textContent = i === 0 ? '✥' : '↔';
      button.setAttribute(
        'aria-label',
        i === 0 ? '拖动切面位置' : `拖动切面角点${i}缩放`,
      );
      button.style.display = 'none';
      button.addEventListener('pointerdown', (event) =>
        this.beginDrag(event, i),
      );
      button.addEventListener('pointermove', this.moveDrag);
      button.addEventListener('pointerup', this.endDrag);
      button.addEventListener('pointercancel', this.cancelDrag);
      button.addEventListener('lostpointercapture', this.cancelDrag);
      button.addEventListener('click', (event) => event.stopPropagation());
      this.map.getContainer().appendChild(button);
      this.handles.push(button);
    }
  }
  configure(settings: SectionSettings, items: Annotation[]) {
    const previous = this.settings;
    this.settings = settings;
    this.items = items;
    if (previous.enabled !== settings.enabled) {
      if (settings.enabled) {
        this.originalTerrain = this.map.getTerrain();
        this.originalPitch =
          this.map.getPitch() < 5 ? this.map.getPitch() : null;
        this.map.setTerrain({ source: 'elevation', exaggeration: 1 });
        if (this.originalPitch !== null) this.map.jumpTo({ pitch: 55 });
      } else {
        this.clip.disable();
        this.onPlane(null, this.side);
        this.drag = null;
        this.map.setTerrain(this.originalTerrain);
        if (this.originalPitch !== null)
          this.map.jumpTo({ pitch: this.originalPitch });
        this.handles.forEach((handle) => (handle.style.display = 'none'));
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
      }
    }
    if (settings.enabled && settings.plane) {
      this.face.material.color.set(settings.color);
      if (
        previous.plane !== settings.plane ||
        previous.altitude !== settings.altitude ||
        !previous.enabled
      ) {
        // Remove a stale cap immediately; the next bounded sampling pass rebuilds it.
        this.face.visible = this.rim.visible = false;
        this.updateGuide();
        this.schedule();
      }
    }
    this.map.triggerRepaint();
  }
  private updateGuide() {
    const plane = this.settings.plane!;
    const points = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) =>
      planePoint(this.settings, (x * plane.width) / 2, (y * plane.height) / 2),
    );
    this.guide.geometry.dispose();
    this.guide.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.glass.geometry.dispose();
    this.glass.geometry = new THREE.BufferGeometry().setFromPoints([
      points[0],
      points[1],
      points[2],
      points[0],
      points[2],
      points[3],
    ]);
  }
  private onData = (event: { sourceId?: string; sourceDataType?: string }) => {
    if (event.sourceId === 'elevation' && event.sourceDataType === 'content')
      this.schedule();
  };
  private schedule = () => {
    if (!this.settings.enabled || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sample();
    }, 90);
  };
  refresh = () => {
    this.schedule();
    this.map.triggerRepaint();
  };
  private sample() {
    if (!this.settings.enabled || !this.settings.plane) return;
    const settings = this.settings,
      plane = settings.plane!,
      m = mercator(plane.center);
    const columns = 64,
      rows = 32;
    const points: THREE.Vector3[] = [],
      distances: number[] = [];
    let valid = 0,
      min = Infinity,
      max = -Infinity;
    const heights = new Map<string, number | null>();
    for (let y = 0; y <= rows; y++)
      for (let x = 0; x <= columns; x++) {
        const p = planePoint(
          settings,
          (x / columns - 0.5) * plane.width,
          (y / rows - 0.5) * plane.height,
        );
        const ll = coordinate(m.x + p.x * m.unit, m.y + p.y * m.unit),
          unit = mercator(ll).unit;
        const key = `${ll[0].toFixed(7)},${ll[1].toFixed(7)}`;
        if (!heights.has(key))
          heights.set(key, this.map.queryTerrainElevation(ll));
        const height = heights.get(key);
        const altitude = ((settings.altitude + p.z) * m.unit) / unit;
        const available =
          height !== null && height !== undefined && Number.isFinite(height);
        distances.push(
          available ? ((altitude - height!) * unit) / m.unit : NaN,
        );
        points.push(p);
        if (available) {
          valid++;
          min = Math.min(min, height!);
          max = Math.max(max, height!);
        }
      }
    const face: number[] = [],
      rim: number[] = [];
    const triangle = (indices: number[]) => {
      const cut = clipFaceTriangle(
        indices.map((i) => points[i]),
        indices.map((i) => distances[i]),
      );
      for (let i = 1; i < cut.polygon.length - 1; i++)
        for (const p of [cut.polygon[0], cut.polygon[i], cut.polygon[i + 1]])
          face.push(p.x, p.y, p.z);
      if (cut.rim.length === 2)
        for (const p of cut.rim) rim.push(p.x, p.y, p.z);
    };
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const a = y * (columns + 1) + x,
          b = a + 1,
          c = b + columns + 1,
          d = a + columns + 1;
        triangle([a, b, c]);
        triangle([a, c, d]);
      }
    this.face.geometry.dispose();
    this.face.geometry = new THREE.BufferGeometry();
    this.face.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(face, 3),
    );
    this.rim.geometry.dispose();
    this.rim.geometry = new THREE.BufferGeometry();
    this.rim.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(rim, 3),
    );
    this.face.visible = this.rim.visible = true;
    this.status = {
      ...INITIAL_SECTION_STATUS,
      phase:
        valid === points.length
          ? 'ready'
          : valid
            ? 'partial'
            : this.map.isSourceLoaded('elevation')
              ? 'error'
              : 'loading',
      min: Number.isFinite(min) ? min : -500,
      max: Number.isFinite(max) ? max : 9000,
      valid,
      samples: points.length,
      spacing: Math.max(plane.width / columns, plane.height / rows),
      models: this.items.filter((item) => item.visible && item.kind !== 'pin')
        .length,
    };
    this.notify(this.status);
    this.map.triggerRepaint();
  }
  prerender(_gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    if (!this.settings.enabled || !this.settings.plane) return;
    this.camera.projectionMatrix
      .fromArray(input.defaultProjectionData.mainMatrix)
      .multiply(localMatrix(this.settings));
    this.inverse.copy(this.camera.projectionMatrix).invert();
    const eye = new THREE.Vector3(0, 0, -1).applyMatrix4(this.inverse);
    const dot = eye.dot(
      planeBasis(
        this.settings.plane.heading,
        this.settings.plane.tilt,
        this.settings.plane.roll,
      ).n,
    );
    if (Math.abs(dot) > 1) this.side = dot > 0 ? 1 : -1;
    this.clip.update(this.settings, this.inverse, this.side);
    this.onPlane(this.settings, this.side);
  }
  render(gl: WebGL2RenderingContext, _input: CustomRenderMethodInput) {
    if (!this.settings.enabled || !this.settings.plane || !this.renderer)
      return;
    if (this.clip.matched < 2) {
      this.notify({ ...this.status, phase: 'error' });
      return;
    }
    this.renderer.resetState();
    this.renderer.setViewport(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
    );
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
    const { width, height } = this.settings.plane;
    [
      [0, 0],
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].forEach(([x, y], i) => {
      const p = planePoint(
        this.settings,
        (x * width) / 2,
        (y * height) / 2,
      ).applyMatrix4(this.camera.projectionMatrix);
      const handle = this.handles[i];
      if (!handle) return;
      const visible =
        p.z >= -1 && p.z <= 1 && Math.abs(p.x) < 1.03 && Math.abs(p.y) < 1.03;
      handle.style.display = visible ? '' : 'none';
      handle.style.left = `${((p.x + 1) * this.map.getCanvas().clientWidth) / 2}px`;
      handle.style.top = `${((1 - p.y) * this.map.getCanvas().clientHeight) / 2}px`;
    });
  }
  private rayPoint(
    event: PointerEvent,
    corner: boolean,
    settings = this.settings,
  ) {
    const rect = this.map.getCanvas().getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    const near = new THREE.Vector3(x, y, -1).applyMatrix4(this.inverse),
      far = new THREE.Vector3(x, y, 1).applyMatrix4(this.inverse);
    const ray = new THREE.Ray(near, far.sub(near).normalize());
    const normal = corner
      ? planeBasis(
          settings.plane!.heading,
          settings.plane!.tilt,
          settings.plane!.roll,
        ).n
      : new THREE.Vector3(0, 0, 1);
    if (Math.abs(normal.dot(ray.direction)) < 0.025) return null;
    return ray.intersectPlane(new THREE.Plane(normal, 0), new THREE.Vector3());
  }
  private beginDrag(event: PointerEvent, handle: number) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.isPrimary || event.button !== 0 || !this.settings.plane) return;
    const start = this.rayPoint(event, handle !== 0);
    if (!start) return;
    this.map.stop();
    this.drag = { id: event.pointerId, handle, start, settings: this.settings };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  private moveDrag = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    event.preventDefault();
    event.stopPropagation();
    const p = this.rayPoint(event, this.drag.handle !== 0);
    if (!p) return;
    const settings = this.settings,
      plane = settings.plane!;
    if (this.drag.handle === 0) {
      const m = mercator(plane.center),
        delta = p.sub(this.drag.start);
      const center = coordinate(m.x + delta.x * m.unit, m.y + delta.y * m.unit);
      if (Math.abs(center[1]) > 85) return;
      this.change({ ...settings, plane: { ...plane, center } });
    } else {
      const { u, v } = planeBasis(plane.heading, plane.tilt, plane.roll);
      this.change({
        ...settings,
        plane: {
          ...plane,
          width: Math.max(50, Math.min(200000, Math.abs(p.dot(u)) * 2)),
          height: Math.max(50, Math.min(30000, Math.abs(p.dot(v)) * 2)),
        },
      });
    }
  };
  private endDrag = (event: PointerEvent) => {
    if (this.drag?.id !== event.pointerId) return;
    event.stopPropagation();
    this.drag = null;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  };
  private cancelDrag = () => {
    if (!this.drag) return;
    const original = this.drag.settings;
    this.drag = null;
    this.change(original);
  };
  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.map.off('sourcedata', this.onData);
    this.map.off('moveend', this.schedule);
    this.clip.disable();
    this.onPlane(null, this.side);
    if (this.map.getLayer(this.id)) this.map.removeLayer(this.id);
  }
  onRemove() {
    this.handles.forEach((handle) => handle.remove());
    this.handles = [];
    for (const mesh of [this.face, this.rim, this.glass, this.guide]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.renderer?.dispose();
  }
}
