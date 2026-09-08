import * as THREE from 'three';
import { dimensions, type Annotation } from './data.ts';

/** Shared by map rendering and plane intersections: identical tessellation and axes. */
export function modelGeometry(item: Annotation) {
  const [width, length, height] = dimensions(item);
  if (item.kind === 'box') return new THREE.BoxGeometry(width, length, height);
  if (item.kind === 'prism') {
    const shape = new THREE.Shape(
      item.footprint!.map(([x, y]) => new THREE.Vector2(x * width, y * length)),
    );
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
      steps: 1,
    });
    geometry.translate(0, 0, -height / 2);
    return geometry;
  }
  if (item.kind === 'sphere')
    return new THREE.SphereGeometry(width / 2, 32, 20);
  const geometry = new THREE.CylinderGeometry(width / 2, width / 2, height, 48);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}
export function modelRotation(item: Annotation) {
  return new THREE.Euler(
    (item.pitch * Math.PI) / 180,
    (item.roll * Math.PI) / 180,
    (-item.heading * Math.PI) / 180,
    'ZYX',
  );
}
