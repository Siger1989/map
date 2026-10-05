import jsQR from 'jsqr';

const IMAGE_CROP_LIMIT = 12;
const IMAGE_CROP_MAX_SIDE = 1200;

export function decodeQr(
  image: CanvasImageSource,
  width: number,
  height: number,
  crop?: {x:number;y:number;width:number;height:number},
): string | null {
  const area=crop??{x:0,y:0,width,height};
  const scale = Math.min(1, 1600 / Math.max(area.width, area.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(area.width * scale);
  canvas.height = Math.round(area.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('此设备无法读取二维码图像');
  context.drawImage(image, area.x,area.y,area.width,area.height,0,0,canvas.width,canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return (
    jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: 'attemptBoth',
    })?.data ?? null
  );
}
export async function readQr(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error('二维码图片不能超过 20 MB');
  const bitmap = await createImageBitmap(file);
  try {
    // The first pass handles ordinary images. Long screenshots often shrink
    // small QR codes below a useful module size, so retry a bounded set of
    // native-resolution square windows across the image.
    let result = decodeQr(bitmap, bitmap.width, bitmap.height);
    if (!result) {
      for (const crop of imageQrCrops(bitmap.width, bitmap.height)) {
        result = decodeQr(bitmap, bitmap.width, bitmap.height, crop);
        if (result) break;
      }
    }
    if (!result)
      throw new Error('没有找到二维码，请选择清晰、完整的二维码图片');
    if (result.length > 100000) throw new Error('二维码内容过长');
    return result;
  } finally {
    bitmap.close();
  }
}

function imageQrCrops(width: number, height: number) {
  const side = Math.floor(Math.min(width, height, IMAGE_CROP_MAX_SIDE));
  if (side <= 0) return [];
  const positions = (length: number) => {
    if (length <= side) return [0];
    const last = length - side;
    const step = Math.max(1, Math.floor(side / 2));
    const values: number[] = [];
    for (let position = 0; position < last; position += step) values.push(position);
    values.push(last);
    return values;
  };
  const candidates = positions(width)
    .flatMap((x) =>
      positions(height).map((y) => ({ x, y, width: side, height: side })),
    )
    .filter((crop) => crop.width !== width || crop.height !== height);
  if (candidates.length <= IMAGE_CROP_LIMIT) return candidates;
  return Array.from({ length: IMAGE_CROP_LIMIT }, (_, index) =>
    candidates[Math.round((index * (candidates.length - 1)) / (IMAGE_CROP_LIMIT - 1))],
  );
}
