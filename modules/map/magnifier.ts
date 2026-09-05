import type { Map } from 'maplibre-gl';
import type { ScreenPoint } from '../tracks/drawing';
/** Copy the actual rendered map before WebGL discards its drawing buffer. */
export function observeMagnifier(
  map: Map,
  target: HTMLCanvasElement,
  point: ScreenPoint,
): () => void {
  const context = target.getContext('2d');
  if (!context) return () => {};
  const capture = () => {
    const source = map.getCanvas(),
      container = map.getCanvasContainer();
    if (!source.width || !container.clientWidth || !container.clientHeight)
      return;
    const sx = source.width / container.clientWidth,
      sy = source.height / container.clientHeight;
    const area = 96 / 3;
    context.fillStyle = '#10212b';
    context.fillRect(0, 0, target.width, target.height);
    try {
      context.drawImage(
        source,
        (point.x - area / 2) * sx,
        (point.y - area / 2) * sy,
        area * sx,
        area * sy,
        0,
        0,
        target.width,
        target.height,
      );
    } catch {
      context.fillStyle = '#c7d9e1';
      context.font = '20px sans-serif';
      context.fillText('影像待加载', 30, 95);
    }
  };
  map.on('render', capture);
  map.triggerRepaint();
  return () => {
    map.off('render', capture);
  };
}
