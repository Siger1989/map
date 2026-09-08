import jsQR from 'jsqr';

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
    const result = decodeQr(bitmap, bitmap.width, bitmap.height) || (bitmap.height>bitmap.width ? decodeQr(bitmap,bitmap.width,bitmap.height,{x:0,y:Math.max(0,bitmap.height-bitmap.width),width:bitmap.width,height:Math.min(bitmap.width,bitmap.height)}) : null);
    if (!result)
      throw new Error('没有找到二维码，请选择清晰、完整的二维码图片');
    if (result.length > 100000) throw new Error('二维码内容过长');
    return result;
  } finally {
    bitmap.close();
  }
}
