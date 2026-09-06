import * as THREE from 'three';
import type { SectionSettings } from './types';
import { localMatrix, planeBasis } from './planeMath';

export function clipModelPolygon(
  polygon: THREE.Vector3[],
  axis: THREE.Vector3,
  limit: number,
) {
  const result: THREE.Vector3[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      da = a.dot(axis) - limit,
      db = b.dot(axis) - limit;
    if (da <= 0) result.push(a);
    if (da <= 0 !== db <= 0) result.push(a.clone().lerp(b, da / (da - db)));
  }
  return result;
}
/** Original model triangles supply the cap; no scene-wide mesh boolean. */
export function applyModelPlane(
  scene: THREE.Scene,
  origin: {
    x: number;
    y: number;
    meterInMercatorCoordinateUnits: () => number;
  },
  settings: SectionSettings | null,
  side: number,
) {
  for (const old of [...scene.children].filter(
    (object) => object.name === 'free-section-cap',
  )) {
    old.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    scene.remove(old);
  }
  const unit = origin.meterInMercatorCoordinateUnits();
  const annotationToMercator = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, 0)
    .scale(new THREE.Vector3(unit, unit, unit));
  const transform = settings
    ? annotationToMercator.invert().multiply(localMatrix(settings))
    : new THREE.Matrix4();
  const basis = settings
    ? planeBasis(
        settings.plane!.heading,
        settings.plane!.tilt,
        settings.plane!.roll,
      )
    : null;
  const planes =
    settings && basis
      ? [
          new THREE.Plane(basis.n.clone().multiplyScalar(-side), 0),
          new THREE.Plane(basis.u.clone(), -settings.plane!.width / 2),
          new THREE.Plane(basis.u.clone().negate(), -settings.plane!.width / 2),
          new THREE.Plane(basis.v.clone(), -settings.plane!.height / 2),
          new THREE.Plane(
            basis.v.clone().negate(),
            -settings.plane!.height / 2,
          ),
        ].map((plane) => plane.applyMatrix4(transform))
      : [];
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      const changed =
        material.clippingPlanes?.length !== planes.length ||
        material.clipIntersection !== Boolean(settings);
      material.clippingPlanes = planes;
      material.clipIntersection = Boolean(settings);
      if (changed) material.needsUpdate = true;
    }
    if (object instanceof THREE.Mesh && object.userData.annotationId)
      meshes.push(object);
  });
  if (!settings || !basis) return;
  for (const mesh of meshes) {
    const matrix = transform.clone().invert().multiply(mesh.matrixWorld),
      position = mesh.geometry.getAttribute('position'),
      index = mesh.geometry.index;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const vertices = [0, 1, 2].map((j) =>
        new THREE.Vector3()
          .fromBufferAttribute(position, index ? index.getX(i + j) : i + j)
          .applyMatrix4(matrix),
      );
      for (let j = 0; j < 3; j++) {
        const a = vertices[j],
          b = vertices[(j + 1) % 3],
          da = a.dot(basis.n),
          db = b.dot(basis.n);
        if (da <= 0 !== db <= 0) points.push(a.clone().lerp(b, da / (da - db)));
      }
    }
    if (points.length < 3) continue;
    const center = points
      .reduce((sum, p) => sum.add(p), new THREE.Vector3())
      .divideScalar(points.length);
    points.sort(
      (a, b) =>
        Math.atan2(
          a.clone().sub(center).dot(basis.v),
          a.clone().sub(center).dot(basis.u),
        ) -
        Math.atan2(
          b.clone().sub(center).dot(basis.v),
          b.clone().sub(center).dot(basis.u),
        ),
    );
    let polygon = points;
    for (const [axis, limit] of [
      [basis.u, settings.plane!.width / 2],
      [basis.u.clone().negate(), settings.plane!.width / 2],
      [basis.v, settings.plane!.height / 2],
      [basis.v.clone().negate(), settings.plane!.height / 2],
    ] as [THREE.Vector3, number][])
      polygon = clipModelPolygon(polygon, axis, limit);
    if (polygon.length < 3) continue;
    const vertices: number[] = [];
    for (let i = 1; i < polygon.length - 1; i++)
      for (const p of [polygon[0], polygon[i], polygon[i + 1]])
        vertices.push(p.x, p.y, p.z);
    const geometry = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    const material = (
      Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    ) as THREE.MeshBasicMaterial;
    const cap = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: material.color,
        side: THREE.DoubleSide,
        transparent: material.transparent,
        opacity: material.opacity,
        depthTest: material.depthTest,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    cap.name = 'free-section-cap';
    cap.matrixAutoUpdate = false;
    cap.matrix.copy(transform);
    cap.frustumCulled = false;
    cap.renderOrder = 30;
    scene.add(cap);
  }
}
