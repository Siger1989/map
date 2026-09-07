import { deliverPhoto } from '../photos/export';
import type { Contour, ProfilePoint, SectionProfileData } from './contours';

export function chartFrame(curves: Contour[], width: number, height: number) {
  const points = curves.flatMap((c) => c.points),
    us = points.map((p) => p.u),
    vs = points.map((p) => p.v);
  const minU = points.length ? Math.min(...us) : -1,
    maxU = points.length ? Math.max(...us) : 1,
    minV = points.length ? Math.min(...vs) : -1,
    maxV = points.length ? Math.max(...vs) : 1;
  const scale = Math.min(
    (width - 40) / Math.max(1, maxU - minU),
    (height - 32) / Math.max(1, maxV - minV),
  );
  return {
    x: (p: Pick<ProfilePoint, 'u'>) =>
      width / 2 + (p.u - (minU + maxU) / 2) * scale,
    y: (p: Pick<ProfilePoint, 'v'>) =>
      height / 2 - (p.v - (minV + maxV) / 2) * scale,
    minU,
    maxU,
    minV,
    maxV,
  };
}
export function profileDetails(
  data: SectionProfileData,
  curve: Contour | undefined,
  point: (ProfilePoint & { distance: number }) | null,
): [string, string][] {
  const s = data.settings,
    p = s.plane!;
  return [
    [
      '当前交线',
      curve
        ? `${curve.name}（${curve.source === 'terrain' ? '地形采样' : '模型网格'} · ${curve.closed ? '闭合' : '开放'}）`
        : '暂无交线',
    ],
    [
      '所选点坐标',
      point
        ? `经度 ${point.coordinates[0].toFixed(7)}°，纬度 ${point.coordinates[1].toFixed(7)}°（WGS84）`
        : '—',
    ],
    [
      '所选点海拔',
      point
        ? `${point.altitude.toFixed(2)} m；沿交线 ${point.distance.toFixed(2)} m`
        : '—',
    ],
    [
      '所选点面内坐标',
      point ? `U ${point.u.toFixed(2)} m，V ${point.v.toFixed(2)} m` : '—',
    ],
    [
      '本条交线',
      curve
        ? `长度约 ${curve.length.toFixed(2)} m；最低 ${curve.min.toFixed(2)} m，最高 ${curve.max.toFixed(2)} m；${curve.points.length} 个顶点`
        : '—',
    ],
    [
      '剖面中心',
      `${p.center[0].toFixed(7)}°，${p.center[1].toFixed(7)}°；中心海拔 ${s.altitude.toFixed(2)} m`,
    ],
    ['剖面尺寸', `宽 ${p.width.toFixed(2)} m × 高 ${p.height.toFixed(2)} m`],
    [
      '剖面姿态',
      `方向 ${p.heading.toFixed(2)}°；倾角 ${p.tilt.toFixed(2)}°；面内转角 ${(p.roll ?? 0).toFixed(2)}°`,
    ],
    [
      '地形采样',
      `有效 ${data.valid}/${data.samples}；最大面内步长约 ${data.spacing.toFixed(2)} m；共 ${data.curves.length} 条交线`,
    ],
    [
      '数据来源',
      '模型：山兔标记几何；地形：成都覆盖区 FABDEM V1-2，其他区域 Mapzen / SRTM',
    ],
    [
      '读图说明',
      '横轴 U、纵轴 V 为剖面内距离；海拔单独读取。线长按局部三维坐标估算；缺失地形不连线。',
    ],
    [
      '高程说明',
      '使用当前地形高程和模型设置，未作独立测量或垂直基准转换。显示小数不代表测量精度。',
    ],
    [
      '采样时间',
      new Date(data.createdAt).toLocaleString('zh-CN', { hour12: false }),
    ],
    [
      '许可署名',
      'FABDEM：Hawker / Neal · CC BY-NC-SA 4.0；其他地形随原始数据来源许可',
    ],
  ];
}
/** Chart and footer share the exact snapshot and interpolated cursor used on screen. */
export async function downloadProfile(
  data: SectionProfileData,
  curve: Contour,
  point: ProfilePoint & { distance: number },
) {
  const width = 1600,
    chartHeight = 660,
    padding = 64,
    fontSize = 27,
    lineHeight = 41;
  const canvas = document.createElement('canvas'),
    ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('此设备暂时无法生成图片');
  ctx.font = `${fontSize}px sans-serif`;
  const rows: string[] = [];
  for (const [label, value] of profileDetails(data, curve, point)) {
    let row = '';
    for (const ch of `${label}：${value}`) {
      if (ctx.measureText(row + ch).width > width - 2 * padding) {
        rows.push(row);
        row = '    ';
      }
      row += ch;
    }
    rows.push(row);
  }
  canvas.width = width;
  canvas.height = chartHeight + 176 + rows.length * lineHeight + 48;
  ctx.fillStyle = '#f6faf8';
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.fillStyle = '#123b40';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText('山兔 · 剖面交线与海拔', padding, 65);
  ctx.font = '25px sans-serif';
  ctx.fillText('完整模型保留 · 橙色为当前交线 · 圆点为所选位置', padding, 109);
  const f = chartFrame(data.curves, width - 2 * padding, chartHeight);
  ctx.save();
  ctx.translate(padding, 132);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width - 2 * padding, chartHeight);
  ctx.strokeStyle = '#d2ded8';
  ctx.strokeRect(1, 1, width - 2 * padding - 2, chartHeight - 2);
  for (const c of data.curves) {
    ctx.beginPath();
    c.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(f.x(p), f.y(p));
      else ctx.lineTo(f.x(p), f.y(p));
    });
    ctx.strokeStyle = c.id === curve.id ? '#c65f12' : '#84aaa2';
    ctx.lineWidth = c.id === curve.id ? 4 : 2;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(f.x(point), f.y(point), 9, 0, Math.PI * 2);
  ctx.fillStyle = '#123b40';
  ctx.fill();
  ctx.font = '23px sans-serif';
  ctx.fillText('V / m', 12, 28);
  ctx.fillText('U / m', width - 2 * padding - 85, chartHeight - 12);
  ctx.fillText(
    `U ${f.minU.toFixed(1)} ～ ${f.maxU.toFixed(1)} m；V ${f.minV.toFixed(1)} ～ ${f.maxV.toFixed(1)} m`,
    15,
    chartHeight - 12,
  );
  ctx.restore();
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = '#193c41';
  rows.forEach((row, i) =>
    ctx.fillText(row, padding, chartHeight + 176 + i * lineHeight),
  );
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('图片编码失败'))),
      'image/jpeg',
      0.94,
    ),
  );
  const name = `山兔-剖面-${new Date(data.createdAt).toISOString().replace(/[:.]/g, '-')}.jpg`;
  return deliverPhoto(new File([blob], name, { type: 'image/jpeg' }), false);
}
