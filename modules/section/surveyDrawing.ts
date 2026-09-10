import { surveyContours } from './surveyContours.ts';
import {
  surveyBasis,
  surveyHeight,
  surveyStations,
  surveyCoordinate,
  type SurveyLine,
  type SurveyTerrain,
} from './surveyLine.ts';
import type { Annotation } from '../annotations/data.ts';
import { surveyPointData, surveyRecordPages } from './surveyRecords.ts';
import {
  SURVEY_PX_PER_MM,
  surveyScaleWidth,
  surveyHorizontalScale,
} from './surveyScale.ts';

const xml = (s: string) =>
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
const num = (v: number) => Number(v.toFixed(2));
/** Deterministic engineering sheet. The plan preserves aspect and shares the section's x transform. */
export function surveyDrawing(
  line: SurveyLine,
  data: SurveyTerrain,
  name: string,
  markers: Annotation[] = [],
) {
  const W = 1800,
    left = 100,
    width = surveyScaleWidth(data.end - data.start, line.printScale),
    right = left + width,
    top = 200,
    bottom = 670;
  const span = data.end - data.start,
    planTop = 810,
    planHeight = (width * data.halfWidth * 2) / span,
    planBottom = planTop + planHeight;
  const stations = surveyStations(line).map((s) => ({
    ...s,
    ...surveyPointData(line, s.id, s.label, markers),
  }));
  const values = data.heights.slice(
    Math.floor(data.rows / 2) * data.columns,
    (Math.floor(data.rows / 2) + 1) * data.columns,
  );
  const finite = values.filter((v): v is number => v !== null);
  const wells = markers
    .filter(
      (m) =>
        m.borehole &&
        m.sectionAnchor &&
        stations.some((s) => s.id === (m.sectionAnchor!.stationId ?? m.id)),
    )
    .map((m) => ({
      marker: m,
      station: stations.find(
        (s) => s.id === (m.sectionAnchor!.stationId ?? m.id),
      )!,
    }));
  const wellBottoms = wells.flatMap(({ marker, station }) => {
    const h = surveyHeight(data, station.distance),
      depth = marker.borehole!.depth;
    return h === null || depth === null ? [] : [h - depth];
  });
  const lo = Math.min(...finite, ...wellBottoms),
    hi = Math.max(...finite);
  if (!finite.length) throw new Error('勘探线上没有可用高程，请重新读取地形');
  const step = Math.max(
      1,
      10 ** Math.floor(Math.log10(Math.max(1, (hi - lo) / 5))),
    ),
    low = Math.floor((lo - step) / step) * step,
    high = Math.ceil((hi + step) / step) * step;
  const coordinatesTop = planBottom + 155;
  const H = Math.max(
      1480,
      coordinatesTop + Math.ceil(stations.length / 3) * 68 + 130,
    ),
    x = (s: number) => left + ((s - data.start) / span) * width,
    y = (h: number) => bottom - ((h - low) / (high - low)) * (bottom - top);
  const text = (xx: number, yy: number, label: string, size = 23, extra = '') =>
    `<text x="${num(xx)}" y="${num(yy)}" font-size="${size}" ${extra}>${xml(label)}</text>`;
  const segment = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    attrs = '',
  ) =>
    `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" ${attrs}/>`;
  const path = (points: [number, number][]) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${num(p[0])},${num(p[1])}`).join(' ');
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" style="fill:white;stroke:none"/><style>text{font-family:'Microsoft YaHei','Noto Sans SC',sans-serif;fill:#161b1c}line,path,rect{stroke:#222;fill:none}text{stroke:none}.grid{stroke:#ddd;stroke-dasharray:5 5}.guide{stroke:#9ba4a5;stroke-dasharray:6 6}.contour{stroke:#946344;stroke-width:1.1;fill:none}</style><rect x="20" y="110" width="1760" height="${H - 140}"/><rect x="26" y="116" width="1748" height="${H - 152}"/>`;
  const title = line.info?.title || `${name} · 勘探线地形剖面及平面图`;
  const titleChunks = Array.from(title).reduce<string[]>((chunks, c, i) => {
    if (i % 55 === 0) chunks.push('');
    chunks[chunks.length - 1] += c;
    return chunks;
  }, []);
  titleChunks.forEach((chunk, i) => {
    svg += text(
      900,
      titleChunks.length === 1 ? 62 : 34 + i * 32,
      chunk,
      titleChunks.length === 1 ? 32 : 26,
      'text-anchor="middle"',
    );
  });
  const bearing = surveyBasis(line).bearing;
  svg += text(
    900,
    96,
    `方向角 A→B ${num(bearing)}°（真北起顺时针） · 等高距 ${line.interval} m · A 为里程零点`,
    20,
    'text-anchor="middle"',
  );
  svg +=
    segment(1335, 116, 1335, H - 36) +
    text(680, 156, '地 形 剖 面', 28, 'text-anchor="middle"') +
    text(left, 187, '高程（m）', 21);
  svg +=
    text(left, 155, `${num((bearing + 180) % 360)}° ←`, 20) +
    text(right, 187, `→ ${num(bearing)}°`, 20, 'text-anchor="end"');
  for (let i = 0; i <= 5; i++) {
    const height = low + ((high - low) * i) / 5,
      yy = y(height),
      distance = data.start + (span * i) / 5,
      xx = x(distance);
    svg +=
      segment(left, yy, right, yy, 'class="grid"') +
      text(left - 10, yy + 6, String(num(height)), 19, 'text-anchor="end"');
    svg +=
      segment(xx, bottom, xx, bottom + 8) +
      text(xx, bottom + 33, String(num(distance)), 19, 'text-anchor="middle"');
  }
  svg +=
    segment(left, top, left, bottom) +
    segment(left, bottom, right, bottom) +
    text(
      (left + right) / 2,
      bottom + 68,
      '沿线水平距离（m）',
      23,
      'text-anchor="middle"',
    );
  let curve = '',
    pen = false;
  values.forEach((h, i) => {
    if (h === null) {
      pen = false;
      return;
    }
    curve += `${pen ? 'L' : 'M'}${num(left + (i / (data.columns - 1)) * width)},${num(y(h))} `;
    pen = true;
  });
  svg += `<path d="${curve}" stroke-width="2.6"/>`;
  for (const { marker, station } of wells) {
    const h = surveyHeight(data, station.distance),
      depth = marker.borehole!.depth,
      xx = x(station.distance);
    if (h === null || depth === null) {
      svg += text(
        xx,
        h === null ? bottom - 20 : y(h) + 30,
        `${station.label} 钻井 · ${depth === null ? '深度未填' : '地面高程缺测'}`,
        17,
        'text-anchor="middle"',
      );
      continue;
    }
    const end = y(h - depth);
    svg +=
      segment(xx, y(h), xx, end, 'class="borehole" stroke-width="2.5"') +
      `<path d="M${num(xx - 7)},${num(end - 11)} L${num(xx)},${num(end)} L${num(xx + 7)},${num(end - 11)}" stroke-width="2.5"/>` +
      text(
        xx + (xx > right - 160 ? -12 : 12),
        (y(h) + end) / 2 + 6,
        `钻井 ${num(depth)} m`,
        19,
        xx > right - 160 ? 'text-anchor="end"' : '',
      );
  }
  svg +=
    text(left, planTop - 27, '等高线平面图', 26) +
    `<rect x="${left}" y="${planTop}" width="${width}" height="${num(planHeight)}"/>`;
  const contours = surveyContours(data, line.interval),
    labels: [number, number][] = [];
  for (const contour of contours)
    for (const grid of contour.paths) {
      const points: [number, number][] = grid.map((p) => [
        left + (p[0] / (data.columns - 1)) * width,
        planTop + (p[1] / (data.rows - 1)) * planHeight,
      ]);
      const thick = Math.abs((contour.level / line.interval) % 5) < 1e-6;
      svg += `<path d="${path(points)}" class="contour" style="stroke-width:${thick ? 2 : 1}"/>`;
      const p = points[Math.floor(points.length * 0.35)];
      if (
        points.length > 8 &&
        p &&
        p[0] > left + 24 &&
        p[0] < right - 24 &&
        p[1] > planTop + 18 &&
        p[1] < planBottom - 18 &&
        labels.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 65)
      ) {
        labels.push(p);
        svg += text(
          p[0],
          p[1],
          String(num(contour.level)),
          17,
          'text-anchor="middle" style="paint-order:stroke;stroke:white;stroke-width:5;stroke-linejoin:round"',
        );
      }
    }
  const py = planTop + planHeight / 2;
  svg +=
    segment(
      left,
      py,
      right,
      py,
      'stroke-dasharray="12 6" style="stroke:#ac372d;stroke-width:2"',
    ) +
    segment(
      x(0),
      py,
      x(surveyBasis(line).length),
      py,
      'style="stroke:#ac372d;stroke-width:3"',
    );
  for (const s of stations) {
    const xx = x(s.distance),
      h = surveyHeight(data, s.distance);
    svg += segment(xx, h === null ? bottom : y(h), xx, py, 'class="guide"');
    if (h !== null)
      svg +=
        `<circle cx="${num(xx)}" cy="${num(y(h))}" r="5" fill="#111"/>` +
        text(xx, y(h) - 15, s.label, 22, 'text-anchor="middle"');
    svg +=
      `<circle cx="${num(xx)}" cy="${num(py)}" r="5" fill="#111"/>` +
      text(xx, py - 14, s.label, 22, 'text-anchor="middle"');
  }
  const nx = right - 40,
    ny = planTop + Math.min(60, planHeight * 0.25),
    rad = (bearing * Math.PI) / 180;
  svg +=
    segment(
      nx,
      ny,
      nx + Math.cos(rad) * 30,
      ny - Math.sin(rad) * 30,
      'stroke-width="2"',
    ) +
    text(
      nx + Math.cos(rad) * 42,
      ny - Math.sin(rad) * 42,
      'N',
      20,
      'text-anchor="middle"',
    );
  const horizontal = surveyHorizontalScale(span, width),
    vertical = ((high - low) * 1000 * SURVEY_PX_PER_MM) / (bottom - top);
  svg += text(
    left,
    planBottom + 36,
    `水平 1:${num(horizontal)} · 纵向 1:${num(vertical)} · 全图打印宽 420 mm`,
    21,
  );
  svg += text(
    left,
    planBottom + 66,
    `剖面纵向放大 ${num((bottom - top) / (high - low) / (width / span))} 倍 · 局部平面距离`,
    19,
  );
  svg += text(left, coordinatesTop - 8, '测点坐标（WGS84，经度 / 纬度）', 22);
  stations.forEach((s, i) => {
    const p = surveyCoordinate(line, s.distance),
      xx = left + (i % 3) * 400,
      yy = coordinatesTop + 24 + Math.floor(i / 3) * 68;
    svg +=
      text(xx, yy, `${s.label}  经 ${p[0].toFixed(6)}°`, 19) +
      text(xx, yy + 24, `纬 ${p[1].toFixed(6)}°`, 19);
  });
  const missing = data.heights.filter((h) => h === null).length;
  svg += text(
    left,
    planBottom + 94,
    `采样间距约 ${num(span / (data.columns - 1))} m · ${missing ? `缺测 ${missing} 格，空白处无数据` : '地形完整'} · ${new Date(data.sampledAt).toISOString().slice(0, 10)}`,
    19,
  );
  svg += text(1550, 160, '图 例', 32, 'text-anchor="middle"');
  [
    ['地形交线', '#222', ''],
    ['等高线', '#946344', ''],
    ['AB 基线', '#ac372d', ''],
    ['延长线', '#ac372d', '10 5'],
    ['↓ 钻井 / 深度', '#222', ''],
  ].forEach(([label, color, dash], i) => {
    const yy = 210 + i * 50;
    svg +=
      segment(
        1370,
        yy,
        1460,
        yy,
        `style="stroke:${color};stroke-width:2" stroke-dasharray="${dash}"`,
      ) + text(1480, yy + 8, label, 23);
  });
  svg +=
    text(1380, 450, '点号 / 名称', 21) +
    text(1760, 450, '里程 / 高程(m)', 19, 'text-anchor="end"');
  stations.slice(0, 12).forEach((s, i) => {
    const yy = 485 + i * 30,
      h = surveyHeight(data, s.distance);
    svg +=
      text(
        1380,
        yy,
        `${s.label} ${s.name === s.label ? '' : s.name.slice(0, 7) + (s.name.length > 7 ? '…' : '')}`,
        19,
      ) +
      text(
        1760,
        yy,
        `${num(s.distance)} / ${h === null ? '—' : num(h)}`,
        18,
        'text-anchor="end"',
      );
  });
  svg += text(1380, 900, '完整名称与备注见资料附表', 19);
  const info = line.info;
  const fields = [
    ['项目', info?.project],
    ['图名', info?.title || name],
    ['图号', info?.number],
    ['编制', info?.author],
    ['审核', info?.reviewer],
    ['日期', info?.date],
    ['资料补充', info?.source],
    ['备注', info?.note],
  ];
  let infoY = H - 520;
  for (const [label, value] of fields) {
    svg +=
      segment(1350, infoY - 25, 1760, infoY - 25) +
      text(1360, infoY, label ?? '', 19);
    const chunks = (value || '—').match(/.{1,16}/gu) ?? ['—'];
    chunks.slice(0, 2).forEach((chunk, i) => {
      svg += text(
        1460,
        infoY + i * 22,
        chunk + (i === 1 && chunks.length > 2 ? '…' : ''),
        18,
      );
    });
    infoY += chunks.length > 1 ? 54 : 38;
  }
  svg +=
    text(55, H - 58, data.source, 18) +
    text(
      55,
      H - 84,
      '地图地形采样；精度受 DEM 分辨率影响。等高线与剖面来自同一网格。',
      19,
    );
  const overview = { svg: svg + '</svg>', width: W, height: H };
  return {
    ...overview,
    pages: [overview, ...surveyRecordPages(line, data, name, markers)],
  };
}
