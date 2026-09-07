import { Matrix4, Vector4, type Mesh } from 'three';

/** Project the model silhouette with its render matrix, in CSS pixels.
 * The label's bottom center stays six pixels above the highest visible vertex.
 * This uses the rendered height, rotation and burial, without changing its ground anchor.
 */
export function modelLabelAnchor(
  mesh: Mesh,
  projection: Matrix4,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const matrix = new Matrix4().multiplyMatrices(projection, mesh.matrixWorld);
  const positions = mesh.geometry.getAttribute('position');
  const point = new Vector4();
  let top: { x: number; y: number } | null = null;
  for (let i = 0; i < positions.count; i++) {
    point.set(positions.getX(i), positions.getY(i), positions.getZ(i), 1);
    point.applyMatrix4(matrix);
    // Crossing the near plane cannot provide a stable screen-space label anchor.
    if (point.w <= 0 || point.z < -point.w) return null;
    const x = ((point.x / point.w + 1) * width) / 2;
    const y = ((1 - point.y / point.w) * height) / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (!top || y < top.y) top = { x, y };
  }
  return top ? { x: top.x, y: top.y - 6 } : null;
}
