import {
  assertBounded,
  drillDefs,
  drillPattern,
  esc,
  fmt,
  num,
  text,
} from './patterns.ts';
import drillPatternData from './templates/drill-patterns.json' with { type: 'json' };
import { drillAssayLines, integratedBasicInfoHeight, renderIntegratedBasicInfo, renderIntegratedDrillFooter } from './integratedDrillRender.ts';
import { renderReferenceDrill } from './referenceDrillRender.ts';

const TOP = 96,
  MIN_HEIGHT = 700,
  MAX_ADAPTIVE_DEPTH_SCALE = 120;
export function sampleLanes(samples: any[]): {
  lanes: Record<string, number>;
  count: number;
} {
  const ends: number[] = [],
    lanes: Record<string, number> = {};
  for (const s of [...samples].sort(
    (a, b) =>
      num(a.top_m) - num(b.top_m) ||
      num(a.bottom_m) - num(b.bottom_m) ||
      text(a.id).localeCompare(text(b.id)),
  )) {
    const i = ends.findIndex((end) => end <= num(s.top_m) + 1e-9),
      lane = i < 0 ? ends.length : i;
    if (lane === ends.length) ends.push(num(s.bottom_m));
    else ends[lane] = num(s.bottom_m);
    lanes[text(s.id)] = lane;
  }
  return { lanes, count: ends.length };
}
const wrap = (v: string, max = 50) => {
  const out: string[] = [];
  for (const para of v.split(/\r?\n/)) {
    let line = '';
    for (const ch of para) {
      if (line.length >= max) {
        out.push(line);
        line = '';
      }
      line += ch;
    }
    out.push(line);
  }
  return out;
};
const escapedLines = (x: number, y: number, lines: string[], size = 11) =>
  lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${y + i * (size + 3)}" font-size="${size}">${esc(line)}</text>`,
    )
    .join('');
const place = (
  anchors: number[],
  heights: number[],
  lower: number,
  gap = 4,
) => {
  const out = [...anchors];
  for (let i = 1; i < out.length; i++)
    out[i] = Math.max(
      out[i],
      out[i - 1] + (heights[i - 1] + heights[i]) / 2 + gap,
    );
  if (out.length && out[0] - heights[0] / 2 < lower) {
    out[0] = lower + heights[0] / 2;
    for (let i = 1; i < out.length; i++)
      out[i] = Math.max(
        out[i],
        out[i - 1] + (heights[i - 1] + heights[i]) / 2 + gap,
      );
  }
  return out;
};
const listBottom = (positions: number[], heights: number[]) => {
  const index = positions.length - 1;
  const position = positions[index];
  const height = heights[index];
  return position === undefined || height === undefined
    ? 0
    : position + height / 2;
};
function visible(rows: any[], hi: number) {
  return rows
    .filter((r) => num(r.bottom_m) >= 0 && num(r.top_m) <= hi)
    .sort(
      (a, b) =>
        num(a.top_m) - num(b.top_m) || num(a.bottom_m) - num(b.bottom_m),
    );
}
function layerPattern(layer: any) {
  const catalog = drillPatternData as any;
  const patterns = catalog.patterns as Record<string, unknown>;
  const ids = catalog.codes as Record<string, string>;
  const id = text(layer.pattern_id);
  if (id && Object.hasOwn(patterns, id)) return `drill-${id}`;
  const code = text(layer.material_code);
  const mapped = code && ids[code];
  if (mapped && Object.hasOwn(patterns, mapped)) return `drill-${mapped}`;
  return drillPattern(layer.lithology_name);
}
function sampleLabelLayout(samples: any[], data: Record<string, any>, integrated: boolean) {
  const sampleLines = samples.map((r: any) => integrated ? [
    ...wrap(`样品 ${text(r.id)}　${fmt(r.top_m)}–${fmt(r.bottom_m)} m`, 46),
    ...wrap(`样长 ${fmt(r.length_m)} m；岩心长 ${fmt(r.core_m)} m`, 58),
    ...wrap(`计算采取率 ${fmt(r.recovery_percent)}%；原填采取率 ${fmt(r.recovery_raw_percent ?? r.recovery_original_percent)}%`, 58),
  ] : [
    ...wrap(`样品 ${text(r.id)}　${fmt(r.top_m)}–${fmt(r.bottom_m)} m`, 46),
    ...wrap(`样长 ${fmt(r.length_m)} m；岩心长 ${fmt(r.core_m)} m；采取率 ${fmt(r.recovery_percent)}%`, 58),
  ]);
  const assayLines = samples.map((sample: any) => drillAssayLines(sample, data, integrated ? 40 : 48));
  const heights = samples.map((_, i) => Math.max(sampleLines[i].length * 13 + 4, assayLines[i].length * 12 + 3));
  return { sampleLines, assayLines, heights };
}
function scaleForSampleDensity(samples: any[], heights: number[], hi: number, minimum: number): number {
  let required = minimum;
  const centers = samples.map((sample) => (Math.max(0, num(sample.top_m)) + Math.min(hi, num(sample.bottom_m))) / 2);
  if (centers.length && centers[0] > 1e-9)
    required = Math.max(required, (heights[0] / 2 + 8) / centers[0]);
  if (centers.length && hi - centers.at(-1)! > 1e-9)
    required = Math.max(required, heights.at(-1)! / 2 / (hi - centers.at(-1)!));
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1], current = samples[i];
    if (num(current.top_m) < num(previous.bottom_m) - 1e-9) continue;
    const previousCenter = (Math.max(0, num(previous.top_m)) + Math.min(hi, num(previous.bottom_m))) / 2;
    const currentCenter = (Math.max(0, num(current.top_m)) + Math.min(hi, num(current.bottom_m))) / 2;
    const centerGap = currentCenter - previousCenter;
    if (centerGap <= 1e-9) continue;
    const requiredGap = (heights[i - 1] + heights[i]) / 2 + 2;
    required = Math.max(required, requiredGap / centerGap);
  }
  return Math.max(minimum, Math.min(MAX_ADAPTIVE_DEPTH_SCALE, required));
}
function placeSampleLabels(anchors: number[], heights: number[], lower: number, upper: number, gap = 2): number[] {
  const out = place(anchors, heights, lower, gap);
  if (!out.length) return out;
  const needed = heights.reduce((sum, height) => sum + height, 0) + gap * (heights.length - 1);
  if (needed > upper - lower) return out;
  const last = out.length - 1;
  out[last] = Math.min(out[last], upper - heights[last] / 2);
  for (let i = last - 1; i >= 0; i--) {
    const maxY = out[i + 1] - (heights[i] + heights[i + 1]) / 2 - gap;
    out[i] = Math.min(out[i], maxY);
  }
  return out[0] - heights[0] / 2 < lower ? place(anchors, heights, lower, gap) : out;
}
function build(data: Record<string, any>, detail: boolean) {
  const endpoint = num(data.meta?.endpoint_m, NaN);
  if (!Number.isFinite(endpoint) || endpoint <= 0 || endpoint > 1e7)
    throw new Error('钻孔终孔深度缺失或超出安全范围');
  const integrated = data.schema_version === 'drill-integrated-1.0';
  const basicInfo = integrated ? renderIntegratedBasicInfo(data, 2300, 58) : null;
  const bodyTop = integrated ? TOP + integratedBasicInfoHeight(data) : TOP;
  const hi = detail ? Math.min(endpoint, 45) : endpoint;
  const samples = visible(data.samples || [], hi);
  const { sampleLines, assayLines, heights: sampleHeights } = sampleLabelLayout(samples, data, integrated);
  const minimumScale = Math.max(detail ? 25 : 9, MIN_HEIGHT / Math.max(hi, 1e-9));
  const scale = scaleForSampleDensity(samples, sampleHeights, hi, minimumScale);
  const y = (d: number) => bodyTop + d * scale;
  const layers = visible(data.layers || [], hi),
    turns = visible(data.turns || [], hi),
    structures = (data.structures || [])
      .filter((r: any) => num(r.depth_m) >= 0 && num(r.depth_m) <= hi)
      .sort((a: any, b: any) => num(a.depth_m) - num(b.depth_m));
  const { lanes, count: lane_count } = sampleLanes(samples);
  const cols = {
    depth: 58,
    turn: 100,
    layer: 465,
    lith: 605,
    desc: 700,
    sample: 1070,
    sampleLabel: 1220,
    assay: 1645,
    structure: 1850,
    structureLabel: 1900,
  };
  cols.sampleLabel = Math.max(cols.sampleLabel, cols.sample + lane_count * 16 + 70);
  cols.assay = cols.sampleLabel + 425;
  cols.structure = cols.assay + (integrated ? 390 : 310);
  cols.structureLabel = cols.structure + 50;
  const width = cols.structureLabel + 300,
    baseBottom = y(hi),
    labelTop = y(0) + 8;
  const layerAnchors = layers.map((r: any) =>
    y((Math.max(0, num(r.top_m)) + Math.min(hi, num(r.bottom_m))) / 2),
  );
  const layerLabels = layers.map((r: any) =>
    [...wrap(`层 ${text(r.id)}`, 12), `${fmt(r.top_m)}–${fmt(r.bottom_m)} m`],
  );
  const layerHeights = layerLabels.map((a) => Math.max(20, a.length * 14 + 4)),
    layerY = place(layerAnchors, layerHeights, labelTop);
  const descLines = layers.map((r: any) =>
    wrap(
      integrated
        ? `${text(r.lithology_name) || '岩性名称未提供'}；${text(r.description) || '描述未提供'}\n层长 ${fmt(r.thickness_m)} m；岩心长 ${fmt(r.core_m)} m\n计算采取率 ${fmt(r.recovery_percent)}%；原填采取率 ${fmt(r.recovery_raw_percent ?? r.recovery_original_percent)}%`
        : `${text(r.lithology_name) || '岩性名称未提供'}；${text(r.description) || '描述未提供'}\n层长 ${fmt(r.thickness_m)} m；岩心长 ${fmt(r.core_m)} m；采取率 ${fmt(r.recovery_percent)}%`,
      36,
    ),
  );
  const descHeights = descLines.map((ls) => Math.max(36, ls.length * 14 + 8)),
    descY = place(layerAnchors, descHeights, labelTop);
  const sampleAnchors = samples.map((r: any) =>
    y((Math.max(0, num(r.top_m)) + Math.min(hi, num(r.bottom_m))) / 2),
  );
  const sampleY = placeSampleLabels(sampleAnchors, sampleHeights, labelTop, baseBottom, 2);
  const structsY = place(
    structures.map((r: any) => y(r.depth_m)),
    structures.map(() => 19),
    labelTop,
  );
  const turnCardLines = turns.map((r) =>
      wrap(integrated
        ? `回次 ${text(r.id)}　${fmt(r.top_m)}–${fmt(r.bottom_m)} m　进尺 ${fmt(r.advance_m)} m　岩心长 ${fmt(r.core_m)} m\n计算采取率 ${fmt(r.recovery_percent)}%；原填采取率 ${fmt(r.recovery_raw_percent ?? r.recovery_original_percent)}%`
        : `回次 ${text(r.id)}　${fmt(r.top_m)}–${fmt(r.bottom_m)} m　进尺 ${fmt(r.advance_m)} m　岩心长 ${fmt(r.core_m)} m　采取率 ${fmt(r.recovery_percent)}%`, integrated ? 54 : 54),
    ),
    turnHeights = turnCardLines.map((ls) => ls.length * 12 + 4),
    turnY: number[] = [];
  let turnCursor = y(0) + 2;
  for (const h of turnHeights) {
    turnY.push(turnCursor + h / 2);
    turnCursor += h;
  }
  const labelBottom = Math.max(
    baseBottom,
    turnCursor,
    ...descY.map((v, i) => v + descHeights[i] / 2),
    ...sampleY.map((v, i) => v + sampleHeights[i] / 2),
    ...structsY.map((v) => v + 12),
  );
  const footer = labelBottom + 76;
  const integratedFooter = integrated ? renderIntegratedDrillFooter(data, width, footer + 44) : null;
  const height = integrated ? footer + 44 + Number(integratedFooter?.height ?? 0) : footer + 54;
  const analyteLabels = (Array.isArray(data.analysis_items)
    ? data.analysis_items.filter((item: any) => item?.show !== false).sort((a: any, b: any) => Number(a.order ?? 0) - Number(b.order ?? 0)).map((item: any) => text(item.code))
    : ['Au', 'Pb', 'Zn']);
  const section = (x: number, title: string) =>
    `<text x="${x}" y="${bodyTop - 20}" font-size="13" font-weight="bold">${esc(title)}</text><line x1="${x}" y1="${bodyTop - 14}" x2="${x + 100}" y2="${bodyTop - 14}" stroke="#888"/>`;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.ceil(height)}" viewBox="0 0 ${width} ${height}" role="img" aria-label="钻孔柱状矢量图"><defs>${drillDefs()}</defs><style>text{font-family:Arial,'Microsoft YaHei',sans-serif;fill:#222}.grid{stroke:#ccc;stroke-width:.7}.axis{stroke:#222;stroke-width:1}.layer-boundary{stroke:#222;stroke-width:1}.measured{stroke:#111;stroke-width:1.4;fill:none}.leader{stroke:#666;stroke-width:.7;fill:none}.sample-leader{stroke:#74808a;stroke-width:.55;opacity:.35;fill:none}.crop{stroke:#555;stroke-dasharray:5 4}</style><rect width="${width}" height="${height}" fill="white"/><text x="28" y="31" font-size="21" font-weight="bold">钻孔 ${esc(data.meta?.hole_id || data.project?.hole_id || '未命名')}</text><text x="28" y="53" font-size="12">沿孔深线性显示；纵向比例 ${fmt(scale, 2)} px/m；${detail ? `局部详图 0–${fmt(hi)} m` : '全孔视图'}</text>${section(cols.depth, '孔深 (m)')}${section(cols.turn, '回次记录列表')}${section(cols.layer, '分层区间')}${section(cols.lith, '岩性符号')}${section(cols.desc, '原文描述与岩心')}${section(cols.sample, `样品区间轨道（${lane_count}轨）`)}${section(cols.sampleLabel, '样品列表（按深度）')}${section(cols.assay, '分析项目结果')}${section(cols.structure, '孔径点位')}${section(cols.structureLabel, '孔径标签')}`,
  ];
  if (basicInfo) out.push(basicInfo.svg);
  // A measured depth scale shared by all interval tracks.
  const step = hi > 100 ? 10 : hi > 20 ? 5 : 1;
  for (let d = 0; d <= hi + 1e-9; d += step) {
    out.push(
      `<line class="grid" x1="${cols.depth}" y1="${y(d)}" x2="${width - 20}" y2="${y(d)}"/><text x="${cols.depth - 8}" y="${y(d) + 4}" text-anchor="end" font-size="10">${fmt(d, 0)}</text>`,
    );
  }
  out.push(
    `<line class="axis" x1="${cols.depth}" y1="${y(0)}" x2="${cols.depth}" y2="${y(hi)}"/>`,
  );
  out.push(`<line class="axis" x1="${cols.layer}" y1="${y(0)}" x2="${cols.layer}" y2="${y(hi)}"/><line class="axis" x1="${cols.layer + 22}" y1="${y(0)}" x2="${cols.layer + 22}" y2="${y(hi)}"/>`);
  out.push(`<line class="axis" x1="${cols.lith}" y1="${y(0)}" x2="${cols.lith}" y2="${y(hi)}"/><line class="axis" x1="${cols.lith + 64}" y1="${y(0)}" x2="${cols.lith + 64}" y2="${y(hi)}"/>`);
  // Turns have their own list column; the depth strip points at the real measured interval.
  turns.forEach((r: any, i: number) => {
    const top = num(r.top_m),
      bottom = Math.min(hi, num(r.bottom_m)),
      cy = turnY[i];
    out.push(
      `<line x1="${cols.turn + 12}" y1="${y(Math.max(0, top))}" x2="${cols.turn + 12}" y2="${y(bottom)}" stroke="#222" stroke-width="4"/><path class="leader" d="M${cols.turn + 17},${y(Math.max(0, top))}H${cols.turn + 27}V${cy}H${cols.turn + 33}"/>${escapedLines(cols.turn + 36, cy - turnHeights[i] / 2 + 10, turnCardLines[i], 9)}`,
    );
  });
  // Fill intervals without stroked crop edges; only measured boundaries are drawn below.
  const measuredBoundaries = new Set<number>();
  layers.forEach((r: any, i: number) => {
    const top = Math.max(0, num(r.top_m)),
      bottom = Math.min(hi, num(r.bottom_m)),
      mid = y((top + bottom) / 2),
      label = layerY[i];
    out.push(
      `<rect x="${cols.layer + 0.5}" y="${y(top)}" width="21" height="${Math.max(0, y(bottom) - y(top))}" fill="url(#drill-pending)"/><path class="leader" d="M${cols.layer + 22},${mid}L${cols.layer + 42},${label}"/>${escapedLines(cols.layer + 46, label - layerHeights[i] / 2 + 12, layerLabels[i], 10)}`,
    );
    out.push(
      `<rect x="${cols.lith + 0.5}" y="${y(top)}" width="63" height="${Math.max(0, y(bottom) - y(top))}" fill="url(#${layerPattern(r)})"/>`,
    );
    if (num(r.top_m) >= 0 && num(r.top_m) <= hi) measuredBoundaries.add(num(r.top_m));
    if (num(r.bottom_m) >= 0 && num(r.bottom_m) <= hi) measuredBoundaries.add(num(r.bottom_m));
    const descY0 = descY[i] - descHeights[i] / 2 + 12;
    out.push(
      `<path class="leader" d="M${cols.desc - 12},${mid}L${cols.desc - 3},${descY[i]}"/>${escapedLines(cols.desc, descY0, descLines[i], 10)}`,
    );
  });
  for (const boundary of measuredBoundaries) {
    const boundaryY = y(boundary);
    out.push(`<line class="layer-boundary" x1="${cols.layer}" y1="${boundaryY}" x2="${cols.lith + 64}" y2="${boundaryY}"/>`);
  }
  samples.forEach((r: any, i: number) => {
    const top = Math.max(0, num(r.top_m)),
      bottom = Math.min(hi, num(r.bottom_m)),
      mid = y((top + bottom) / 2),
      lane = lanes[text(r.id)] ?? 0,
      x = cols.sample + lane * 16,
      busX = cols.sampleLabel - 16 - Math.max(0, lane_count - 1 - lane) * 2,
      label = sampleY[i];
    out.push(
      `<line x1="${x}" y1="${y(top)}" x2="${x}" y2="${y(bottom)}" stroke="#b22" stroke-width="3"/><line x1="${x - 5}" y1="${y(top)}" x2="${x + 5}" y2="${y(top)}" stroke="#b22"/><line x1="${x - 5}" y1="${y(bottom)}" x2="${x + 5}" y2="${y(bottom)}" stroke="#b22"/><path class="sample-leader" d="M${x + 5},${mid}H${busX}V${label}H${cols.sampleLabel - 8}"/>${escapedLines(cols.sampleLabel, label - sampleHeights[i] / 2 + 10, sampleLines[i], 10)}${escapedLines(cols.assay, label - assayLines[i].length * 6 + 3, assayLines[i], 9)}`,
    );
  });
  structures.forEach((r: any, i: number) => {
    const sy = y(num(r.depth_m)),
      ly = structsY[i];
    out.push(
      `<circle cx="${cols.structure + 12}" cy="${sy}" r="4" fill="#176b8a"/><path class="leader" d="M${cols.structure + 18},${sy}L${cols.structureLabel - 8},${ly}"/>${escapedLines(cols.structureLabel, ly + 4, [`${fmt(r.depth_m)} m；孔径 ${fmt(r.diameter_mm)} mm`], 10)}`,
    );
  });
  const fullSummary = `全孔汇总：分层 ${num(data.summary?.layer_count, layers.length)} 条；样品 ${num(data.summary?.sample_count, samples.length)} 条；回次 ${num(data.summary?.turn_count, turns.length)} 条。`;
  const intersectSummary = `本详图相交记录：分层 ${layers.length} 条；样品 ${samples.length} 条；回次 ${turns.length} 条；孔径点 ${structures.length} 个。`;
  out.push(
    `<text x="28" y="${footer}" font-size="11">${esc(fullSummary)}</text><text x="28" y="${footer + 18}" font-size="11">${esc(detail ? intersectSummary : '全孔视图显示范围 0–' + fmt(hi) + ' m。')}</text>`,
  );
  if (detail && hi < endpoint)
    out.push(
      `<text x="${width - 25}" y="${y(hi) - 8}" text-anchor="end" font-size="10">窗口边缘截断并延续，不是实际层界</text>`,
    );
  out.push(`<text x="28" y="${footer + 36}" font-size="9">符号按本项目固定模板精确匹配；未知岩性留白待定，不代表行业标准认证。</text>`);
  if (integratedFooter) out.push(integratedFooter.svg);
  out.push('</svg>');
  return {
    svg: out.join(''),
    scale,
    hi,
    endpoint,
    y,
    width,
    height,
    layers,
    samples,
    turns,
    structures,
    lanes,
    lane_count,
    cols,
    layerY,
    layerAnchors,
    descY,
    descHeights,
    sampleY,
    sampleHeights,
    sampleAnchors,
    structsY,
    turnY,
    turnHeights,
    footer,
    integrated_footer: integratedFooter?.audit ?? null,
  };
}
export function renderDrill(data: Record<string, any>): {
  svg: string;
  detailSvg: string;
  audit: Record<string, unknown>;
} {
  assertBounded(data);
  const integrated = data.schema_version === 'drill-integrated-1.0';
  if (integrated) return renderReferenceDrill(data);
  const full = build(data, false),
    detail = build(data, true);
  const auditRecords = (rows: any[], layout: any, kind: string) =>
    rows.map((r, index) => {
      const top = num(r.top_m),
        bottom = num(r.bottom_m),
        pt = Math.max(0, top),
        pb = Math.min(layout.hi, bottom),
        anchorY = layout.y((layout.hi < bottom || top < 0 ? (pt + pb) / 2 : (top + bottom) / 2)),
        labelY = kind === 'layer'
          ? layout.layerY[layout.layers.indexOf(r)]
          : kind === 'sample'
            ? layout.sampleY[layout.samples.indexOf(r)]
            : kind === 'turn'
              ? layout.turnY[layout.turns.indexOf(r)]
              : null;
      return {
        kind,
        id: r.id,
        top_m: top,
        bottom_m: bottom,
        plotted_top_m: pt,
        plotted_bottom_m: pb,
        top_y: layout.y(top),
        bottom_y: layout.y(bottom),
        plotted_top_y: layout.y(pt),
        plotted_bottom_y: layout.y(pb),
        label_anchor_y: anchorY,
        label_moved: labelY == null ? false : Math.abs(labelY - anchorY) > 1e-7,
        source: r.source ?? {},
        ...(kind === 'layer'
          ? { lithology_name: r.lithology_name, description: r.description, thickness_m: r.thickness_m, core_m: r.core_m, recovery_percent: r.recovery_percent, material_code: r.material_code, pattern_id: r.pattern_id }
          : {}),
        ...(kind === 'sample'
          ? { lane: layout.lanes[text(r.id)] ?? 0, midpoint_y: layout.y((top + bottom) / 2), plotted_midpoint_y: anchorY, length_m: r.length_m, core_m: r.core_m, recovery_percent: r.recovery_percent, assays: r.assays ?? {} }
          : {}),
        label_y: labelY,
      };
    });
  return {
    svg: full.svg,
    detailSvg: detail.svg,
    audit: {
      scale_px_per_m: full.scale,
      full_endpoint_m: full.endpoint,
      detail_endpoint_m: detail.hi,
      track_layout: {
        sample_lane_count: full.lane_count,
        sample_x: full.cols.sample,
        last_sample_lane_x: full.cols.sample + Math.max(0, full.lane_count - 1) * 16,
        sample_label_x: full.cols.sampleLabel,
        sample_list_bottom_y: listBottom(full.sampleY, full.sampleHeights),
        depth_top_y: full.y(0),
        depth_bottom_y: full.y(full.hi),
        detail_scale_px_per_m: detail.scale,
        detail_depth_bottom_y: detail.y(detail.hi),
        detail_sample_list_bottom_y: listBottom(detail.sampleY, detail.sampleHeights),
        assay_x: full.cols.assay,
        structure_x: full.cols.structure,
        turn_list_bottom_y: listBottom(full.turnY, full.turnHeights),
        canvas_width: full.width,
        integrated_footer: full.integrated_footer,
        basic_info_rows: integrated ? renderIntegratedBasicInfo(data, full.width, 58).rows : 0,
      },
      full: {
        layers: auditRecords(full.layers, full, 'layer'),
        samples: auditRecords(full.samples, full, 'sample'),
        turns: auditRecords(full.turns, full, 'turn'),
        structures: full.structures.map((r: any) => ({
          id: r.id,
          depth_m: r.depth_m,
          diameter_mm: r.diameter_mm,
          y: full.y(r.depth_m),
          source: r.source ?? {},
        })),
      },
      detail: {
        layers: auditRecords(detail.layers, detail, 'layer'),
        samples: auditRecords(detail.samples, detail, 'sample'),
        turns: auditRecords(detail.turns, detail, 'turn'),
        structures: detail.structures.map((r: any) => ({
          id: r.id,
          depth_m: r.depth_m,
          diameter_mm: r.diameter_mm,
          y: detail.y(r.depth_m),
          source: r.source ?? {},
        })),
        full_summary: '全孔汇总',
        intersect_summary: '详图相交数量',
      },
    },
  };
}
