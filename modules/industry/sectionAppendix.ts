import { fmt, materialTemplate, text } from './patterns.ts';
import { measuredTextBox, wrap, xmlText, type LabelBox } from './sectionSvg.ts';

export function renderSectionAppendix(args: {
  margin: number;
  width: number;
  profileBottom: number;
  panelW: number;
  materialRows: any[];
  records: any[];
  nodes: any[];
  stations: any[];
  samples: any[];
  attitudes: any[];
  sampleIsPlotted: (sample: any) => boolean;
  profileAnchor: (x: number, z: number) => [number, number];
}): {
  svg: string;
  height: number;
  textBoxes: LabelBox[];
  intervalRows: any[];
  placedStations: any[];
  sampleAudit: any[];
} {
  const {
    margin,
    width,
    profileBottom,
    panelW,
    materialRows,
    records,
    nodes,
    stations,
    samples,
    attitudes,
    sampleIsPlotted,
    profileAnchor,
  } = args;
  const recordById = new Map(records.map((r) => [r.id, r]));
  const layerLimit = Math.max(45, Math.floor((panelW - 250) / 13));
  const sampleLimit = Math.max(30, Math.floor((panelW - 24) / 11));
  const layerLines = materialRows.map(({ interval }) =>
    wrap(
      `${text(interval.layer_id) || '层号未提供'} / ${text(interval.id)} / ${text(interval.lithology_name) || '岩性待定'} / ${text(interval.description) || '描述未提供'}`,
      layerLimit,
    ),
  );
  const sampleLines = samples.map((s) =>
    wrap(
      `${text(s.id)}：${sampleIsPlotted(s) ? '已定位（显式偏距）' : '未定位或超出范围'}；来源 ${JSON.stringify(s.source_cells || {})}`,
      sampleLimit,
    ),
  );
  const stationLines = stations.map((s) => {
    const n = nodes[s.node];
    return `测站 ${s.id}（节点 ${s.node}）：E ${fmt(n?.east_m, 3)} m，N ${fmt(n?.north_m, 3)} m，链距 ${fmt(n?.chainage_m, 3)} m`;
  });
  const attitudeLines = attitudes.map(
    (a) =>
      `${a.id} / ${a.record_id}：节点 ${a.node}，倾向 ${fmt(a.dip_direction_deg, 3)}°，倾角 ${fmt(a.dip_angle_deg, 3)}°；该产状用于界面推算`,
  );
  const start = profileBottom + 54;
  let y = start + 24;
  const layerBaselines = layerLines.map((lines) => {
    const row = lines.map((_, i) => y + 12 + i * 20);
    y += Math.max(30, lines.length * 20) + 13;
    return row;
  });
  y += 10;
  const sampleHeading = y;
  y += 24;
  const missingSummary = y;
  y += 20;
  const sampleBaselines = sampleLines.map((lines) => {
    const row = lines.map((_, i) => y + 11 + i * 17);
    y += Math.max(17, lines.length * 17) + 5;
    return row;
  });
  y += 12;
  const stationHeading = y;
  y += 24;
  const stationBaselines = stationLines.map(() => {
    const baseline = y + 11;
    y += 18;
    return baseline;
  });
  y += 12;
  const attitudeHeading = y;
  y += 24;
  const attitudeBaselines = attitudeLines.map(() => {
    const baseline = y + 11;
    y += 18;
    return baseline;
  });
  y += 12;
  const noteY = y;
  y += 30;

  const out: string[] = [];
  const textBoxes: LabelBox[] = [];
  const intervalRows: any[] = [];
  const layerTitleY = profileBottom + 48;
  out.push(
    xmlText(
      margin,
      layerTitleY,
      '层段目录（原层号、数据记录与完整描述）',
      13,
      'start',
      'bold',
    ),
  );
  materialRows.forEach(({ interval, region }, idx) => {
    layerLines[idx].forEach((line, j) => {
      const baseline = layerBaselines[idx][j];
      out.push(xmlText(margin + 4, baseline, line, 11));
      textBoxes.push(
        measuredTextBox(`layer-${idx}-${j}`, line, margin + 4, baseline, 11),
      );
    });
    const firstRecord = interval.record_ids
      ?.map((id: string) => recordById.get(id))
      .find(Boolean) as any;
    intervalRows.push({
      interval_id: interval.id,
      layer_id: interval.layer_id,
      top_node: interval.start_node,
      bottom_node: interval.end_node,
      lithology_name: interval.lithology_name,
      description: interval.description,
      record_ids: interval.record_ids,
      source_cells: interval.source_cells || {},
      first_record: firstRecord
        ? {
            id: firstRecord.id,
            dip_direction_deg: firstRecord.dip_direction_deg ?? null,
            dip_angle_deg: firstRecord.dip_angle_deg ?? null,
          }
        : null,
      region_status: region?.status || 'pending',
      reason: region?.reason || '',
    });
  });
  out.push(
    xmlText(
      margin,
      sampleHeading,
      '样品与产状标注（缺失位置保留为未定位，精确值见本区列表）',
      13,
      'start',
      'bold',
    ),
  );
  const missing = samples.filter((s) => !sampleIsPlotted(s));
  out.push(
    xmlText(
      margin,
      missingSummary,
      `未定位样品 ${missing.length} 条（保留原编号与来源，未画到地图位置）`,
      10,
      'start',
      'bold',
    ),
  );
  samples.forEach((s, idx) => {
    if (sampleIsPlotted(s)) {
      const [x, sy] = profileAnchor(s.position.x_m, s.position.z_m);
      out.push(`<path d="M${x},${sy}l-7,-11h14z" fill="#a22"/>`);
    }
    sampleLines[idx].forEach((line, j) => {
      const baseline = sampleBaselines[idx][j];
      out.push(xmlText(margin, baseline, line, 10));
      textBoxes.push(
        measuredTextBox(`sample-${idx}-${j}`, line, margin, baseline, 10),
      );
    });
  });
  out.push(
    xmlText(margin, stationHeading, '测站坐标目录', 12, 'start', 'bold'),
  );
  const placedStations = stations.map((s) => {
    const n = nodes[s.node];
    return {
      id: s.id,
      node: s.node,
      east_m: n?.east_m ?? null,
      north_m: n?.north_m ?? null,
      x_m: n?.x_m ?? null,
      z_m: n?.z_m ?? null,
    };
  });
  stationLines.forEach((line, idx) => {
    const baseline = stationBaselines[idx];
    out.push(xmlText(margin, baseline, line, 10));
    textBoxes.push(
      measuredTextBox(`station-${idx}`, line, margin, baseline, 10),
    );
  });
  out.push(
    xmlText(
      margin,
      attitudeHeading,
      '产状索引（图中 A 编号对应下列精确值）',
      12,
      'start',
      'bold',
    ),
  );
  const sampleAudit = samples.map((s) => ({
    id: s.id,
    record_id: s.record_id ?? null,
    location_status: s.location_status || 'missing',
    position: s.position || null,
    source_cells: s.source_cells || {},
  }));
  attitudeLines.forEach((line, idx) => {
    const baseline = attitudeBaselines[idx];
    out.push(xmlText(margin, baseline, line, 10));
    textBoxes.push(
      measuredTextBox(`attitude-${idx}`, line, margin, baseline, 10),
    );
  });
  const note =
    '说明：棕红色虚线为根据相邻测段产状计算的推算界面，不是实测矿界；缺产状、投影退化或拓扑不明确处留白。图案为项目模板，未宣称行业标准认证。';
  out.push(xmlText(margin, noteY, note, 10));
  textBoxes.push(measuredTextBox('note', note, margin, noteY, 10));
  return {
    svg: out.join(''),
    height: Math.ceil(y + 24),
    textBoxes,
    intervalRows,
    placedStations,
    sampleAudit,
  };
}
