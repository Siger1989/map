import {
  formatDistance,
  formatDuration,
  TRAVEL_MODES,
} from '../navigation/types';
import {
  elevationStats,
  sampleTerrain,
  type ElevationSample,
} from '../journey/metrics';
import { readProfile } from '../journey/elevationProvider';
import type { ShareRoute } from './data';
import { renderRouteMap } from './mapImage';
import { routeQrImage } from './qrImage';
import {
  routeColorSections,
  sectionElevation,
  groupColorSections,
} from '../tracks/colorSections';
const altitude = (v: number | null) =>
  v === null ? '暂无' : `${Math.round(v)} m`;
export function composeRouteImage(
  data: ShareRoute,
  map: HTMLCanvasElement,
  samples: ElevationSample[],
  qr?: { canvas: HTMLCanvasElement | null; note: string },
) {
  const canvas = document.createElement('canvas');
  const sections = routeColorSections(
    data.track ?? {
      segments: data.segments,
      style: { color: '#4dffb5', width: 2 },
    },
  );
  const groups = groupColorSections(sections);
  const shownSections = groups.slice(0, 16);
  const legendHeight =
    shownSections.length * 78 + (groups.length > 16 ? 60 : 25);
  canvas.width = 1200;
  canvas.height = (qr ? 2670 : 1980) + legendHeight;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('无法生成分享图片');
  c.fillStyle = '#112b31';
  c.fillRect(0, 0, 1200, canvas.height);
  c.drawImage(map, 0, 0, 1200, 1250);
  const line = (text: string, y: number, size = 25, color = '#d4e5e4') => {
    c.font = `${size}px sans-serif`;
    c.fillStyle = color;
    c.fillText(text, 45, y, 1110);
  };
  line('山兔 · ' + data.name, 1315, 36, '#f4faf6');
  line(
    `${TRAVEL_MODES.find((m) => m.id === data.mode)?.label} · 全程 ${formatDistance(data.distance)} · ${data.duration === null ? '用时未估算' : `预计 ${formatDuration(data.duration)}`} ${data.approach ? '· 含当前位置到起点' : ''}`,
    1360,
  );
  const stats = elevationStats(samples);
  line(
    `累计上升 ${altitude(stats.ascent)}    下降 ${altitude(stats.descent)}    海拔 ${altitude(stats.min)} — ${altitude(stats.max)}`,
    1402,
  );
  line('海拔变化图 · 地形模型采样', 1450, 24, '#9de8c4');
  const left = 120,
    right = 1120,
    top = 1490,
    bottom = 1720,
    total = samples.at(-1)?.distance ?? 0;
  if (stats.min !== null && stats.max !== null) {
    const range = Math.max(10, stats.max - stats.min);
    c.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const y = bottom - ((bottom - top) * i) / 2;
      c.strokeStyle = '#41616a';
      c.beginPath();
      c.moveTo(left, y);
      c.lineTo(right, y);
      c.stroke();
      line(String(Math.round(stats.min + (range * i) / 2)), y, 20);
    }
    for (const section of sections) {
      const points = sectionElevation(samples, section),
        runs: ElevationSample[][] = [];
      let run: ElevationSample[] = [];
      for (const p of points) {
        if (p.elevation === null) {
          if (run.length) runs.push(run);
          run = [];
        } else run.push(p);
      }
      if (run.length) runs.push(run);
      const xx = (d: number) => left + (d / (total || 1)) * (right - left),
        yy = (h: number) =>
          bottom - ((h - stats.min!) / range) * (bottom - top);
      for (const points of runs) {
        c.beginPath();
        points.forEach((p, i) =>
          i
            ? c.lineTo(xx(p.distance), yy(p.elevation!))
            : c.moveTo(xx(p.distance), yy(p.elevation!)),
        );
        c.strokeStyle = section.color;
        c.lineWidth = 4;
        c.stroke();
        c.lineTo(xx(points.at(-1)!.distance), bottom);
        c.lineTo(xx(points[0].distance), bottom);
        c.closePath();
        c.fillStyle = section.color;
        c.globalAlpha = 0.22;
        c.fill();
        c.globalAlpha = 1;
      }
    }
    line('0 km', 1760, 21);
    c.fillText((total / 1000).toFixed(1) + ' km', 1020, 1760);
  } else line('高程数据暂不可用，请联网后重试；未填充或虚构海拔。', 1600);
  line(
    stats.complete
      ? '高程为地形模型估算；累计爬升受采样间距影响。'
      : `高程覆盖 ${stats.available}/${stats.count} 点，缺失处断开，累计升降暂不提供。`,
    1805,
    22,
  );
  line(
    data.estimated
      ? '原轨迹几何；出行用时为估算，车辆通行条件未核实。'
      : '道路规划 · Valhalla / FOSSGIS · 不含实时交通',
    1845,
    22,
  );
  line('底图 © OpenStreetMap contributors · OpenFreeMap', 1887, 22);
  line(
    '高程：区域 FABDEM V1-2 (CC BY-NC-SA 4.0) / 区域外 Mapzen、SRTM',
    1924,
    20,
  );
  line('完整线路与主要地名；较长路线的小地名需放大地图查看。', 1959, 19);
  shownSections.forEach((s, i) => {
    const yy = 1998 + i * 78,
      h = elevationStats(
        s.sections.flatMap((section) => sectionElevation(samples, section)),
      );
    c.fillStyle = s.color;
    c.fillRect(45, yy - 20, 26, 12);
    c.fillStyle = '#edf7f4';
    c.font = '22px sans-serif';
    c.fillText(
      `第 ${i + 1} 段 · 同色累计 ${formatDistance(s.length)} · 海拔 ${altitude(h.min)}～${altitude(h.max)}`,
      88,
      yy,
      1060,
    );
    c.fillText(`路况/备注：${s.condition || '未录入'}`, 88, yy + 32, 1060);
  });
  if (groups.length > 16)
    line(
      `共 ${groups.length} 种颜色，图上列前16种；完整颜色与备注请附路线包。`,
      1998 + 16 * 78,
      22,
    );
  if (qr) {
    c.save();
    c.translate(0, legendHeight);
    c.fillStyle = '#fff';
    c.fillRect(20, 1990, 640, 640);
    if (qr.canvas) c.drawImage(qr.canvas, 40, 2010, 600, 600);
    c.fillStyle = '#edf7f4';
    c.font = 'bold 30px sans-serif';
    c.fillText('山兔扫码载入路线', 685, 2070);
    c.font = '23px sans-serif';
    const text = qr.canvas
      ? '工具 → 扫码载入路线，也可从分享图片识别。离线读取，无需登录。' +
        qr.note
      : qr.note;
    let current = '',
      row = 0;
    for (const char of text) {
      if (c.measureText(current + char).width > 465) {
        c.fillText(current, 685, 2125 + row * 39);
        row++;
        current = '';
      }
      current += char;
    }
    if (current) c.fillText(current, 685, 2125 + row * 39);
    c.font = '22px sans-serif';
    c.fillText('图片与GPX/KML保留原始线形。', 685, 2605);
    c.restore();
  }
  return canvas;
}
export async function renderRouteImage(
  data: ShareRoute,
  signal: AbortSignal,
): Promise<File> {
  const cancel = new AbortController();
  const workSignal = AbortSignal.any([
    signal,
    cancel.signal,
    AbortSignal.timeout(90000),
  ]);
  let map: HTMLCanvasElement, profile: ElevationSample[];
  try {
    [map, profile] = await Promise.all([
      renderRouteMap(data, workSignal),
      readProfile(sampleTerrain(data.segments), workSignal),
    ]);
  } finally {
    cancel.abort();
  }
  signal.throwIfAborted();
  const qr = await routeQrImage(data);
  signal.throwIfAborted();
  const canvas = composeRouteImage(data, map, profile, qr);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('图片编码失败'))),
      'image/jpeg',
      0.9,
    ),
  );
  signal.throwIfAborted();
  return new File([blob], `Shantu-route-${Date.now()}.jpg`, {
    type: 'image/jpeg',
  });
}
