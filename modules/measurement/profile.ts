import { copyPoints } from './saved.ts';
import {
  lengthLabel,
  measurementMetrics,
  pointLabel,
  type MeasurePoint,
} from './data.ts';

export const PROFILE_SEGMENTS = 10;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
/** Independent horizontal/vertical scales are explicit; unsampled ground is never invented. */
export function measurementProfile(
  points: MeasurePoint[],
  name: string,
  page = 0,
) {
  copyPoints(points);
  const all = measurementMetrics(points),
    pages = Math.ceil((points.length - 1) / PROFILE_SEGMENTS);
  if (!Number.isInteger(page) || page < 0 || page >= pages)
    throw new Error('测量图页码无效');
  const start = page * PROFILE_SEGMENTS,
    end = Math.min(points.length - 1, start + PROFILE_SEGMENTS);
  const chainage = [0];
  all.segments.forEach((s) => chainage.push(chainage.at(-1)! + s.horizontal));
  const shown = points.slice(start, end + 1),
    heights = shown.flatMap((p) => (p.altitude === null ? [] : [p.altitude]));
  const min = heights.length ? Math.min(...heights) : 0,
    max = heights.length ? Math.max(...heights) : 0;
  const range = Math.max(10, max - min),
    low = min - range * 0.15,
    high = max + range * 0.15;
  const span = Math.max(1, chainage[end] - chainage[start]),
    x = (i: number) => 115 + ((chainage[i] - chainage[start]) / span) * 985;
  const y = (altitude: number) => 460 - ((altitude - low) / (high - low)) * 300;
  const t = (x: number, y: number, s: string, cls = '') =>
    `<text x="${x}" y="${y}" class="${cls}">${escape(s)}</text>`;
  const line = (x1: number, y1: number, x2: number, y2: number, cls: string) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`;
  let drawing = '';
  for (let i = 0; i <= 5; i++) {
    const xx = 115 + (i / 5) * 985,
      yy = 460 - (i / 5) * 300;
    drawing += line(xx, 160, xx, 460, 'grid') + line(115, yy, 1100, yy, 'grid');
    drawing +=
      t(xx - 22, 487, (chainage[start] + (span * i) / 5).toFixed(1)) +
      t(30, yy + 5, (low + ((high - low) * i) / 5).toFixed(1));
  }
  drawing +=
    line(115, 160, 115, 460, 'axis') + line(115, 460, 1100, 460, 'axis');
  shown.forEach((p, j) => {
    const i = start + j,
      xx = x(i),
      yy = p.altitude === null ? 455 : y(p.altitude);
    drawing +=
      line(xx, yy, xx, 460, 'projection') +
      `<circle cx="${xx}" cy="${yy}" r="5" fill="${p.altitude === null ? '#92999b' : '#174d57'}"/>`;
    drawing += t(
      xx - 6,
      yy - 12 - (j % 2) * 16,
      pointLabel(i) + (p.altitude === null ? ' 海拔暂无' : ''),
      'point',
    );
    if (!j) return;
    const a = points[i - 1],
      metric = all.segments[i - 1];
    if (a.altitude === null || p.altitude === null) return;
    const ax = x(i - 1),
      ay = y(a.altitude);
    drawing +=
      line(ax, ay, xx, ay, 'horizontal') +
      line(xx, ay, xx, yy, 'projection') +
      line(ax, ay, xx, yy, 'measured');
    if (xx - ax > 70)
      drawing += t(
        (ax + xx) / 2 - 18,
        (ay + yy) / 2 - 10,
        metric.inclination === null ? '—' : `${metric.inclination.toFixed(1)}°`,
        'angle',
      );
  });
  const rowY = 622,
    height = rowY + shown.length * 30 + 105;
  let rows = '';
  shown.forEach((p, j) => {
    const i = start + j,
      m = i ? all.segments[i - 1] : null,
      yy = rowY + j * 30;
    rows += `<rect x="30" y="${yy - 20}" width="1140" height="30" fill="${j % 2 ? '#eef3f4' : '#ffffff'}"/>`;
    const values = [
      pointLabel(i),
      p.coordinates[0].toFixed(6),
      p.coordinates[1].toFixed(6),
      p.altitude?.toFixed(1) ?? '暂无',
      chainage[i].toFixed(1),
      m ? lengthLabel(m.horizontal) : '—',
      m?.inclination === null || !m ? '—' : m.inclination.toFixed(1) + '°',
      m?.bearing === null || !m ? '—' : m.bearing.toFixed(1) + '°',
    ];
    [44, 110, 270, 430, 565, 700, 870, 1020].forEach(
      (xx, k) => (rows += t(xx, yy, values[k])),
    );
  });
  return {
    width: 1200,
    height,
    pages,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}">
    <style>text{font-family:Arial,'Microsoft YaHei',sans-serif;font-size:16px;fill:#263e46}.title{font-size:30px;font-weight:700}.point{font-weight:700}.angle{fill:#915317;font-size:15px}.grid{stroke:#d9e3e7;stroke-width:1}.axis{stroke:#506b78;stroke-width:2}.measured{stroke:#174d57;stroke-width:3}.horizontal{stroke:#aa6e23;stroke-width:1.5;stroke-dasharray:8 5}.projection{stroke:#769aaa;stroke-width:1.3;stroke-dasharray:3 5}</style>
    <rect width="1200" height="${height}" fill="#fff"/><rect x="18" y="18" width="1164" height="${height - 36}" fill="none" stroke="#405c68"/>
    ${t(40, 62, '山兔 · 测量连线剖面图', 'title')}${t(40, 95, name.slice(0, 70))}${t(945, 62, `第 ${page + 1} / ${pages} 页`)}
    ${t(40, 128, '海拔 / m')}${t(930, 517, '累计水平距离 / m')}${drawing}
    ${t(40, 548, `总水平 ${lengthLabel(all.horizontal)}    总斜距 ${lengthLabel(all.spatial)}    水平/垂直比例不同；角度按真实高差与距离计算`)}
    ${t(40, 575, '实线：测量连线　长虚线：水平参考　短虚线：垂直投影　表格每段为上一点 → 当前点')}
    ${[44, 110, 270, 430, 565, 700, 870, 1020].map((xx, k) => t(xx, 599, ['点', '经度 / °', '纬度 / °', '海拔 / m', '累计 / m', '段水平距离', '水平夹角', '朝向 / 真北'][k])).join('')}${rows}
    ${t(40, height - 64, '坐标 WGS84 · 海拔来自地形数据；缺失海拔不计算夹角。上下坡由连线与海拔值表示。')}
    ${t(40, height - 36, '本图仅连接所选测量点，未对沿线地形连续采样；非完整地形剖面。')}
  </svg>`,
  };
}
