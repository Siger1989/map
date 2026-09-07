import * as THREE from 'three';
import { planePoint } from './planeMath';
import { scaleLabel, metreTicks } from './scale';
import type { SectionSettings } from './types';

/** Ruler is an overlay on the same plane basis as the surface; does not affect intersections. */
export class SectionRuler extends THREE.Group {
  private labels = new Map<string, THREE.CanvasTexture>();
  configure(settings: SectionSettings) {
    this.clearGeometry();
    const p = settings.plane;
    if (!p) return;
    const size = Math.min(p.width, p.height) / 28,
      tick = size / 2;
    const points: THREE.Vector3[] = [];
    const label = (text: string, u: number, v: number) => {
      let texture = this.labels.get(text);
      if (!texture) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#102532dd';
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = '#e9fff8';
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 33);
        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        this.labels.set(text, texture);
      }
      const corners = [
        [-2, -0.5],
        [2, -0.5],
        [2, 0.5],
        [-2, 0.5],
      ].map(([x, y]) => planePoint(settings, u + x * size, v + y * size));
      const geometry = new THREE.BufferGeometry().setFromPoints([
        corners[0],
        corners[1],
        corners[2],
        corners[0],
        corners[2],
        corners[3],
      ]);
      geometry.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(
          [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
          2,
        ),
      );
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        }),
      );
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.add(mesh);
    };
    const unit = settings.scale?.unit ?? 'm',
      interval = settings.scale?.interval ?? 'auto';
    for (const distance of metreTicks(0, p.width, 5, interval).ticks) {
      const u = distance - p.width / 2,
        v = -p.height / 2;
      points.push(
        planePoint(settings, u, v),
        planePoint(settings, u, v + tick),
      );
      label(`${scaleLabel(distance, unit)} ${unit}`, u, v - size);
    }
    for (const distance of metreTicks(0, p.height, 5, interval).ticks) {
      const u = -p.width / 2,
        v = distance - p.height / 2;
      points.push(
        planePoint(settings, u, v),
        planePoint(settings, u + tick, v),
      );
      if (distance > 0)
        label(`${scaleLabel(distance, unit)} ${unit}`, u - size * 2.5, v);
    }
    const line = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: '#e9fff8',
        depthTest: false,
        depthWrite: false,
      }),
    );
    line.frustumCulled = false;
    line.renderOrder = 2;
    this.add(line);
    // Reuse textures during drags, with a bounded cache across many size changes.
    if (this.labels.size > 100) {
      const used = new Set(
        this.children.flatMap((o) =>
          o instanceof THREE.Mesh ? [o.material.map] : [],
        ),
      );
      for (const [text, texture] of this.labels)
        if (!used.has(texture)) {
          texture.dispose();
          this.labels.delete(text);
        }
    }
  }
  private clearGeometry() {
    for (const child of this.children) {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.clear();
  }
  dispose() {
    this.clearGeometry();
    for (const texture of this.labels.values()) texture.dispose();
    this.labels.clear();
  }
}
