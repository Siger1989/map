import type { TripPhoto } from './storage';
import { altitudeLabel, weatherSource } from './details';
import { describeWeather } from '../weather/data';
export function weatherLabel(photo: TripPhoto) {
  const w = photo.weather;
  if (!w) return `拍摄天气：${photo.weatherError || '正在查询'}`;
  const number = (v: number | null, suffix: string) =>
    v === null ? '未提供' : `${v.toFixed(1)}${suffix}`;
  return `${describeWeather(w.code)} · ${number(w.temperature, '℃')} · 风 ${number(w.wind, 'm/s')} · 小时降水 ${number(w.precipitation, 'mm')}`;
}
export async function renderPhotoExport(
  photo: TripPhoto,
  includeInfo: boolean,
): Promise<File> {
  const bitmap = await createImageBitmap(photo.detail ?? photo.preview);
  try {
    const rotation = photo.rotation ?? 0,
      swapped = rotation % 180 !== 0;
    const canvas = document.createElement('canvas');
    const width = swapped ? bitmap.height : bitmap.width,
      height = swapped ? bitmap.width : bitmap.height;
    // Give small legacy images a readable footer without claiming extra image detail.
    const scale = Math.max(1, Math.min(1000 / width, 4096 / height)),
      w = Math.max(1000, Math.round(width * scale)),
      h = Math.round(height * scale);
    const lines = includeInfo
      ? [
          photo.title || photo.name,
          new Date(photo.time).toLocaleString('zh-CN'),
          altitudeLabel(photo.altitude),
          `${photo.coordinates[1].toFixed(5)}, ${photo.coordinates[0].toFixed(5)} · ${photo.kind === 'interpolated' ? '轨迹时间估算位置' : '轨迹点位置'}`,
          weatherLabel(photo),
          ...(photo.weather
            ? [
                weatherSource(photo.weather),
                `天气时次 ${new Date(photo.weather.time).toLocaleString('zh-CN')} · 非现场实测`,
                'Open-Meteo.com · CC BY 4.0 · 降水为该时次前1小时累计',
              ]
            : []),
          photo.note || '',
        ].filter(Boolean)
      : [];
    const font = Math.max(18, Math.round(w / 44)),
      row = Math.round(font * 1.5),
      pad = font;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法生成分享图片');
    ctx.font = `${font}px sans-serif`;
    const wrapped: string[] = [];
    for (const line of lines) {
      let current = '';
      for (const c of line) {
        if (ctx.measureText(current + c).width > w - 2 * pad) {
          wrapped.push(current);
          current = '';
        }
        current += c;
      }
      if (current) wrapped.push(current);
    }
    canvas.width = w;
    canvas.height = h + (wrapped.length ? wrapped.length * row + 2 * pad : 0);
    ctx.fillStyle = '#09131b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-bitmap.width / 2, -bitmap.height / 2);
    ctx.drawImage(bitmap, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(bitmap.width, bitmap.height) / 200;
    for (const stroke of photo.strokes ?? []) {
      if (stroke.points.length === 1) {
        ctx.fillStyle = stroke.color;
        ctx.beginPath();
        ctx.arc(
          stroke.points[0][0] * bitmap.width,
          stroke.points[0][1] * bitmap.height,
          ctx.lineWidth / 2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        continue;
      }
      ctx.strokeStyle = stroke.color;
      ctx.beginPath();
      stroke.points.forEach(([x, y], i) =>
        i
          ? ctx.lineTo(x * bitmap.width, y * bitmap.height)
          : ctx.moveTo(x * bitmap.width, y * bitmap.height),
      );
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#e9f5ef';
    ctx.font = `${font}px sans-serif`;
    ctx.textBaseline = 'top';
    wrapped.forEach((line, i) => ctx.fillText(line, pad, h + pad + i * row));
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('分享图片生成失败'))),
        'image/jpeg',
        0.88,
      ),
    );
    return new File([blob], `Guanyun-photo-${photo.time}.jpg`, {
      type: 'image/jpeg',
    });
  } finally {
    bitmap.close();
  }
}
async function base64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('图片读取失败'));
    r.readAsDataURL(file);
  });
}
export async function deliverPhoto(file: File, share: boolean) {
  const native = window.GuanyunNative;
  if (native) {
    if (!native.photoOutput)
      throw new Error('当前APK尚不支持图片分享/保存，请使用新版APK');
    const result = native.photoOutput(file.name, await base64(file), share);
    if (result !== 'ok') throw new Error(result || '无法打开图片分享');
    return '已请求打开系统选择器';
  }
  if (share) {
    if (!navigator.canShare?.({ files: [file] }))
      throw new Error('此浏览器不支持文件分享，可点“保存图片”后分享');
    await navigator.share({ files: [file], title: '观云行程照片' });
    return '已交给系统分享';
  }
  const url = URL.createObjectURL(file),
    a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return '已下载图片副本';
}
