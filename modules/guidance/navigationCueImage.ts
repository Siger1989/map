/** Rasterize the installed Heroicons 24/outline ChevronUp path for MapLibre symbols. */
export function createNavigationCueChevronImage(color: '#ffffff' | '#ffd08a'): ImageData | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const pixelRatio = 2;
  canvas.width = 24 * pixelRatio;
  canvas.height = 24 * pixelRatio;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(pixelRatio, pixelRatio);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const drawChevron = () => {
    context.beginPath();
    // Heroicons v2 ChevronUpIcon path: m4.5 15.75 7.5-7.5 7.5 7.5
    context.moveTo(4.5, 15.75);
    context.lineTo(12, 8.25);
    context.lineTo(19.5, 15.75);
    context.stroke();
  };
  context.strokeStyle = color === '#ffffff' ? '#17452f' : '#563719';
  context.lineWidth = 5;
  drawChevron();
  context.strokeStyle = color;
  context.lineWidth = 2.5;
  drawChevron();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Rasterize Lucide's filled ArrowBigUp path as a white lead arrow with a blue edge. */
export function createNavigationCueLeadImage(): ImageData | null {
  if (typeof document === 'undefined' || typeof Path2D === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const pixelRatio = 2;
  canvas.width = 26 * pixelRatio;
  canvas.height = 36 * pixelRatio;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(pixelRatio, pixelRatio);
  context.translate(13, 18);
  context.scale(1.2, 1.7);
  context.translate(-12, -12);
  context.lineJoin = 'round';
  context.lineWidth = 1.7;
  const arrow = new Path2D('M9 19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-6a1 1 0 0 1 1-1h3.293a.707.707 0 0 0 .5-1.207l-7.086-7.086a1 1 0 0 0-1.414 0l-7.086 7.086a.707.707 0 0 0 .5 1.207H8a1 1 0 0 1 1 1z');
  context.fillStyle = '#ffffff';
  context.fill(arrow);
  context.strokeStyle = '#46b9ff';
  context.stroke(arrow);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
