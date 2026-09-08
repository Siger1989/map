import type { Contour, ProfilePoint, SectionProfileData } from './contours';
import { chartFrame } from './chartFrame';
import { scaleLabel } from './scale';
import { noteDetails, noteColor, type ProfileNote } from './profileNotes';
import { profileMapData, profileCoordinateRows } from './profileMapData';
import { renderProfileMap } from './profileMap';
export { chartFrame } from './chartFrame';
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
      '比例尺设置',
      `单位 ${s.scale?.unit ?? 'm'}；基础间隔 ${s.scale?.interval === undefined || s.scale.interval === 'auto' ? '自动' : `${scaleLabel(s.scale.interval, s.scale.unit)} ${s.scale.unit}`}，密集时显示整数倍主刻度`,
    ],
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
export async function* profileImages(
  data: SectionProfileData,
  curve: Contour | undefined,
  point: ProfilePoint & { distance: number },
  notes: ProfileNote[] = [],
  signal: AbortSignal = new AbortController().signal,
  title = '剖面交线与海拔',
) {
  const width = 1600,
    chartHeight = 660,
    padding = 64,
    fontSize = 27,
    lineHeight = 41;
  const canvas = document.createElement('canvas'),
    ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('此设备暂时无法生成图片');
  const plan = profileMapData(data, point, notes);
  const map = await renderProfileMap(data, curve, plan, signal);
  ctx.font = `${fontSize}px sans-serif`;
  const rows: string[] = [];
  for (const [label, value] of [
    [
      '点位坐标',
      'WGS84，经度在前、纬度在后；A–D 对应剖面四角，P 为当前点，数字对应上方保存测点。',
    ],
    ...profileCoordinateRows(plan.points),
    ...profileDetails(data, curve, point),
    ...noteDetails(notes),
  ]) {
    let row = '';
    for (const ch of `${label}：${value}`) {
      if (ch === '\n') {
        rows.push(row);
        row = '    ';
        continue;
      }
      if (ctx.measureText(row + ch).width > width - 2 * padding) {
        rows.push(row);
        row = '    ';
      }
      row += ch;
    }
    rows.push(row);
  }
  canvas.width = width;
  const mapTop = chartHeight + 250,
    footerTop = mapTop + map.height + 64,
    pageRows = 100,
    pages = Math.max(1, Math.ceil(rows.length / pageRows));
  for (let page = 0; page < pages; page++) {
    signal.throwIfAborted();
    const footer = rows.slice(page * pageRows, (page + 1) * pageRows);
    canvas.height = footerTop + footer.length * lineHeight + 48;
    ctx.fillStyle = '#f6faf8';
    ctx.fillRect(0, 0, width, canvas.height);
    ctx.fillStyle = '#123b40';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(`山兔 · ${title}`, padding, 65, width - 2 * padding);
    ctx.font = '25px sans-serif';
    ctx.fillText(
      `橙色为当前交线 · 白芯为所选位置 · 彩色编号为保存测点${pages > 1 ? ` · 第 ${page + 1}/${pages} 张` : ''}`,
      padding,
      109,
    );
    const f = chartFrame(
      data.curves,
      width - 2 * padding,
      chartHeight,
      notes.map((n) => n.point),
      23,
      data.settings.scale?.interval ?? 'auto',
    );
    const unit = data.settings.scale?.unit ?? 'm';
    ctx.save();
    ctx.translate(padding, 132);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width - 2 * padding, chartHeight);
    ctx.strokeStyle = '#d2ded8';
    ctx.strokeRect(1, 1, width - 2 * padding - 2, chartHeight - 2);
    ctx.font = '23px sans-serif';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#193c41';
    ctx.strokeStyle = '#d2ded8';
    for (const u of f.uTicks.ticks) {
      const x = f.x({ u });
      ctx.beginPath();
      ctx.moveTo(x, f.top);
      ctx.lineTo(x, f.bottom);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(scaleLabel(u, unit), x, f.bottom + 30);
    }
    for (const v of f.vTicks.ticks) {
      const y = f.y({ v });
      ctx.beginPath();
      ctx.moveTo(f.left, y);
      ctx.lineTo(f.right, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(scaleLabel(v, unit), f.left - 10, y + 8);
    }
    ctx.textAlign = 'left';
    for (const c of data.curves) {
      ctx.beginPath();
      c.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(f.x(p), f.y(p));
        else ctx.lineTo(f.x(p), f.y(p));
      });
      ctx.strokeStyle = c.id === curve?.id ? '#c65f12' : '#84aaa2';
      ctx.lineWidth = c.id === curve?.id ? 4 : 2;
      ctx.stroke();
    }
    notes.forEach((n, i) => {
      ctx.beginPath();
      ctx.arc(f.x(n.point), f.y(n.point), 12, 0, Math.PI * 2);
      ctx.fillStyle = noteColor(n, i);
      ctx.fill();
      ctx.fillText(String(i + 1), f.x(n.point) + 16, f.y(n.point) - 12);
    });
    ctx.beginPath();
    ctx.arc(f.x(point), f.y(point), 9, 0, Math.PI * 2);
    ctx.fillStyle = '#123b40';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(f.x(point), f.y(point), 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.fillStyle = '#123b40';
    ctx.font = '23px sans-serif';
    ctx.fillText(`V / ${unit}`, 12, 28);
    ctx.fillText(`U / ${unit}`, width - 2 * padding - 105, chartHeight - 12);
    ctx.beginPath();
    ctx.moveTo(f.right - f.bar * f.scale, 30);
    ctx.lineTo(f.right - f.bar * f.scale, 40);
    ctx.lineTo(f.right, 40);
    ctx.lineTo(f.right, 30);
    ctx.strokeStyle = '#193c41';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(
      `${scaleLabel(f.bar, unit)} ${unit}`,
      f.right - (f.bar * f.scale) / 2,
      28,
    );
    ctx.textAlign = 'left';
    ctx.restore();
    ctx.fillStyle = '#123b40';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('剖面位置 · 平面地图', padding, chartHeight + 194);
    ctx.font = '24px sans-serif';
    ctx.fillText(
      '虚线为边框的垂直投影；竖直面上下边重合，同位置编号合并显示，全部坐标列于下方。',
      padding,
      chartHeight + 233,
    );
    ctx.drawImage(map, padding, mapTop);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = '#193c41';
    footer.forEach((row, i) =>
      ctx.fillText(row, padding, footerTop + i * lineHeight),
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('图片编码失败'))),
        'image/jpeg',
        0.94,
      ),
    );
    const name = `山兔-剖面-${new Date(data.createdAt).toISOString().replace(/[:.]/g, '-')}${pages > 1 ? `-${page + 1}` : ''}.jpg`;
    signal.throwIfAborted();
    yield new File([blob], name, { type: 'image/jpeg' });
  }
}
