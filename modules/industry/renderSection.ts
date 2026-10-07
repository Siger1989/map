import { buildLayerGeometry } from './layerGeometry.ts';
import { renderSectionAppendix } from './sectionAppendix.ts';
import {
  assertBounded,
  esc,
  fmt,
  materialSpec,
  materialTemplate,
  materialsDocument,
  num,
  sectionDefs,
  text,
} from './patterns.ts';
import {
  boxesOverlap,
  hasLocatedPosition,
  layoutCallouts,
  layerIdCallouts,
  measuredTextBox,
  path,
  polygonCentroid,
  ticks,
  profileAxesSvg,
  xmlText,
  type LabelBox,
  type Point,
} from './sectionSvg.ts';

type RenderLayout = {
  svg: string;
  scale: number;
  profileAnchor: (x: number, z: number) => Point;
  planAnchor: (east: number, north: number) => Point;
  patterns: any[];
  geometry: Record<string, any>;
  intervalRows: any[];
  width: number;
  height: number;
  sampleIsPlotted: (sample: any) => boolean;
  textBoxes: LabelBox[];
  plottedIds: {
    stations: string[];
    intervals: string[];
    samples: string[];
    attitudes: string[];
  };
};

function renderLayout(
  data: Record<string, any>,
  detail: boolean,
): RenderLayout {
  const nodes = data.nodes || [],
    intervals = data.intervals || [],
    records = data.records || [],
    stations = data.stations || [],
    samples = data.samples || [],
    attitudes = data.attitudes || [];
  if (nodes.length < 2) throw new Error('剖面数据至少需要两个测点');
  if (nodes.length > 20000 || intervals.length > 20000)
    throw new Error('剖面记录数超过安全上限，未截断');
  for (const n of nodes)
    if (
      ![n.east_m, n.north_m, n.x_m, n.z_m].every(
        (v: any) => typeof v === 'number' && Number.isFinite(v),
      )
    )
      throw new Error(`节点 ${n.index ?? '?'} 的实测坐标不是有限值`);
  const geometry = buildLayerGeometry(
    data,
    num(data.settings?.display_depth_m, 7),
  );
  const profileX = nodes.map((n: any) => num(n.x_m)),
    profileZ = nodes.map((n: any) => num(n.z_m));
  const minX = Math.min(...profileX),
    maxX = Math.max(...profileX),
    spanX = maxX - minX;
  if (spanX <= 0 || spanX > 1e7)
    throw new Error('剖面轴向投影范围无效，不能保持真实比例');
  const east = nodes.map((n: any) => num(n.east_m)),
    north = nodes.map((n: any) => num(n.north_m));
  const minE = Math.min(...east),
    maxE = Math.max(...east),
    minN = Math.min(...north),
    maxN = Math.max(...north);
  const spanE = Math.max(maxE - minE, 1e-9),
    spanN = Math.max(maxN - minN, 1e-9);
  const width = detail ? 2760 : 1960,
    margin = 110,
    panelW = width - margin * 2;
  const maxPlanH = detail ? 640 : 470,
    planTop = 144,
    planScale = Math.min(panelW / spanE, (maxPlanH - 70) / spanN),
    planH = Math.max(200, Math.min(maxPlanH, spanN * planScale + 70));
  const planCx = margin + panelW / 2,
    planCy = planTop + planH / 2;
  const planAnchor = (e: number, n: number): Point => [
    planCx + (e - (minE + maxE) / 2) * planScale,
    planCy - (n - (minN + maxN) / 2) * planScale,
  ];
  const profileScale = panelW / spanX;
  const zTop = Math.max(...profileZ),
    zBottom = Math.min(...profileZ) - Math.max(geometry.effective_depth_m, 0);
  const sampleIsPlotted = (sample: any) =>
    hasLocatedPosition(sample) &&
    sample.position.x_m >= minX - 1e-9 &&
    sample.position.x_m <= maxX + 1e-9 &&
    sample.position.z_m >= zBottom - 1e-9 &&
    sample.position.z_m <= zTop + 1e-9;
  const profileTop = planTop + planH + 220,
    profileBottom = profileTop + (zTop - zBottom) * profileScale;
  const profileAnchor = (x: number, z: number): Point => [
    margin + (x - minX) * profileScale,
    profileTop + (zTop - z) * profileScale,
  ];
  const materialRows = intervals.map((it: any) => ({
    interval: it,
    region: geometry.regions.find((r: any) => r.interval_id === it.id),
  }));
  const recordById = new Map(records.map((r: any) => [r.id, r]));
  const patternAudit: any[] = [];
  const context = detail ? 'detail' : 'main';
  const derivedDefs = materialRows
    .map(({ interval, region }: any, i: number) => {
      const spec = materialSpec(interval.lithology_name),
        template = materialTemplate(interval.lithology_name);
      const firstId = (interval.record_ids || [])[0],
        rec = recordById.get(firstId) as any;
      let rotation: number | null = null,
        rotationStatus = 'template_orientation_none';
      if (spec?.orientation === 'bedding') {
        const axis = data.settings?.axis_azimuth_deg,
          dir = rec?.dip_direction_deg,
          dip = rec?.dip_angle_deg;
        if (
          [axis, dir, dip].every(
            (v: any) => typeof v === 'number' && Number.isFinite(v),
          )
        ) {
          const rad = Math.PI / 180,
            vx = Math.cos(dip * rad),
            vz = -Math.sin(dip * rad) * Math.cos((axis - dir) * rad);
          if (Math.hypot(vx, vz) > 1e-12) {
            rotation = (-Math.atan2(vz, vx) * 180) / Math.PI;
            rotationStatus = 'rotated_from_interval_first_record';
          } else rotationStatus = 'degenerate_section_projection';
        } else rotationStatus = 'missing_attitude';
      }
      const candidates: ({ point: Point; area: number } | null)[] = (
        region?.polygons || []
      ).map((poly: number[][]) => polygonCentroid(poly as Point[]));
      const anchor = candidates
        .filter(Boolean)
        .sort((a: any, b: any) => b.area - a.area)[0]?.point as
        | Point
        | undefined;
      const feature = spec?.anchor_feature;
      const scale = num(materialsDocument.render_scales?.[context], 1) || 1;
      const transform =
        rotation === null
          ? `scale(${scale})`
          : anchor && feature && feature.length >= 2
            ? `translate(${profileAnchor(anchor[0], anchor[1]).join(' ')}) rotate(${rotation}) scale(${scale}) translate(${-feature[0]} ${-feature[1]})`
            : `rotate(${rotation}) scale(${scale})`;
      patternAudit.push({
        interval_id: interval.id,
        layer_id: interval.layer_id,
        material_name: interval.lithology_name || null,
        template_pattern_id: template,
        derived_pattern_id: `section-${context}-${i}`,
        orientation: spec?.orientation || 'none',
        first_record_id: firstId || null,
        axis_azimuth_deg: data.settings?.axis_azimuth_deg ?? null,
        dip_direction_deg: rec?.dip_direction_deg ?? null,
        dip_angle_deg: rec?.dip_angle_deg ?? null,
        pattern_rotation_deg_svg_y_down: rotation,
        rotation_status: rotationStatus,
        reference_status: spec?.reference_status || 'pending',
        tile_width: spec?.tile_width ?? materialsDocument.tile.width,
        tile_height: spec?.tile_height ?? materialsDocument.tile.height,
        render_scale: scale,
        phase_anchor_world: anchor || null,
        phase_anchor_svg: anchor ? profileAnchor(...anchor) : null,
        phase_feature_tile: feature || null,
      });
      return `<pattern id="section-${context}-${i}" href="#${esc(template)}" patternTransform="${transform}"/>`;
    })
    .join('');
  const profPath = path(nodes.map((n: any) => profileAnchor(n.x_m, n.z_m)));
  const planPath = path(nodes.map((n: any) => planAnchor(n.east_m, n.north_m)));
  const appendix = renderSectionAppendix({
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
  });
  const viewBottom = appendix.height;
  const labelBoxes: LabelBox[] = [...appendix.textBoxes];
  const plottedIds = {
    stations: [] as string[],
    intervals: [] as string[],
    samples: [] as string[],
    attitudes: [] as string[],
  };
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.ceil(viewBottom)}" viewBox="0 0 ${width} ${Math.ceil(viewBottom)}" role="img" aria-label="实测剖面矢量图"><defs>${sectionDefs(context)}${derivedDefs}</defs><style>text{font-family:Arial,'Microsoft YaHei',sans-serif;fill:#202124}.frame{fill:#fff;stroke:#aaa}.terrain{fill:none;stroke:#111;stroke-width:2}.survey{fill:none;stroke:#111;stroke-width:1.7}.estimated{fill:none;stroke:#a54825;stroke-width:1.35;stroke-dasharray:6 4}.leader{fill:none;stroke:#666;stroke-width:.7}.grid{stroke:#e4e7eb;stroke-width:.65}.tag{paint-order:stroke;stroke:#fff;stroke-width:4;stroke-linejoin:round}</style><rect width="100%" height="100%" fill="#fff"/>${xmlText(margin, 38, data.project?.section_id || data.project?.name || '实测剖面', 21, 'start', 'bold')}${xmlText(margin, 62, `剖面方位 ${fmt(data.settings?.axis_azimuth_deg, 3)}°；平面标尺 ${fmt(planScale, 3)} px/m；剖面标尺 ${fmt(profileScale, 3)} px/m；坐标轴以 m 标注`, 11)}<rect class="frame" x="${margin}" y="${planTop}" width="${panelW}" height="${planH}"/><text x="${margin}" y="${planTop - 16}" font-size="14" font-weight="bold">测线平面导线（东坐标 / 北坐标，等比例）</text><path class="survey" d="${planPath}"/>`,
  ];
  const eastTicks = ticks(minE, maxE, 7),
    northTicks = ticks(minN, maxN, 5);
  for (const e of eastTicks) {
    const [x] = planAnchor(e, (minN + maxN) / 2);
    pieces.push(
      `<line class="grid" x1="${x}" y1="${planTop + 8}" x2="${x}" y2="${planTop + planH - 8}"/><line x1="${x}" y1="${planTop + planH - 5}" x2="${x}" y2="${planTop + planH + 2}" stroke="#333"/>`,
    );
    pieces.push(xmlText(x, planTop + planH + 17, fmt(e, 2), 10, 'middle'));
  }
  for (const n of northTicks) {
    const [, y] = planAnchor((minE + maxE) / 2, n);
    pieces.push(
      `<line class="grid" x1="${margin + 8}" y1="${y}" x2="${margin + panelW - 8}" y2="${y}"/><line x1="${margin - 4}" y1="${y}" x2="${margin + 3}" y2="${y}" stroke="#333"/>`,
    );
    pieces.push(xmlText(margin - 8, y + 3, fmt(n, 2), 10, 'end'));
  }
  pieces.push(
    xmlText(
      margin + panelW / 2,
      planTop + planH + 34,
      '东坐标 E (m)',
      10,
      'middle',
    ),
  );
  pieces.push(xmlText(margin + 2, planTop + 13, '北坐标 N (m)', 9));
  const mapBar = eastTicks.length > 1 ? eastTicks[1] - eastTicks[0] : spanE,
    mapBarX = margin + panelW - 28 - mapBar * planScale,
    mapBarY = planTop + planH - 18;
  pieces.push(
    `<path d="M${mapBarX},${mapBarY}h${mapBar * planScale}" stroke="#111" stroke-width="3"/>${xmlText(mapBarX + (mapBar * planScale) / 2, mapBarY - 5, `${fmt(mapBar, 2)} m`, 10, 'middle')}`,
  );
  // Only surveyed stations receive station labels; intermediate geometry nodes remain unlabeled.
  const stationItems = stations
    .map((s: any) => {
      const n = nodes[s.node],
        point = n ? planAnchor(n.east_m, n.north_m) : null;
      return n && point ? { id: text(s.id), point, node: s.node } : null;
    })
    .filter(Boolean) as { id: string; point: Point; node: number }[];
  const stationLabels = layoutCallouts(
    stationItems,
    {
      left: margin + 5,
      top: planTop + 5,
      right: margin + panelW - 5,
      bottom: planTop + planH - 5,
    },
    [],
    12,
  );
  for (const s of stations) {
    const n = nodes[s.node];
    if (!n) continue;
    const [x, y] = planAnchor(n.east_m, n.north_m);
    pieces.push(`<circle cx="${x}" cy="${y}" r="3.2" fill="#111"/>`);
  }
  for (const label of stationLabels) {
    const [x, y] = label.point;
    pieces.push(
      `<path class="leader" d="M${x},${y}L${label.x},${label.y - 4}"/>`,
    );
    pieces.push(
      `<text class="tag" x="${label.x}" y="${label.y}" font-size="12">${esc(label.id)}</text>`,
    );
    labelBoxes.push(label.box);
    plottedIds.stations.push(label.id);
  }
  pieces.push(
    `<rect class="frame" x="${margin}" y="${profileTop}" width="${panelW}" height="${profileBottom - profileTop}"/><text x="${margin}" y="${profileTop - 17}" font-size="14" font-weight="bold">地形剖面与近地表层区（完全保留实测地形和轴向比例）</text>`,
  );
  pieces.push(
    profileAxesSvg({
      minX,
      maxX,
      zBottom,
      zTop,
      margin,
      panelW,
      profileTop,
      profileBottom,
      anchor: profileAnchor,
    }),
  );
  const layerTags = layerIdCallouts({
    materialRows,
    nodes,
    profileAnchor,
    profileTop,
    panelW,
    margin,
  });
  pieces.push(layerTags.svg);
  labelBoxes.push(...layerTags.boxes);
  plottedIds.intervals.push(...layerTags.ids);
  for (const [i, { interval, region }] of materialRows.entries())
    for (const polygon of region?.polygons || []) {
      pieces.push(
        `<path d="${path(
          (polygon as number[][]).map((p: any) => profileAnchor(p[0], p[1])),
          true,
        )}" fill="url(#section-${context}-${i})" stroke="#666" stroke-width=".55"><title>${esc(interval.lithology_name || '岩性待定')}；${esc(interval.description || '')}</title></path>`,
      );
    }
  pieces.push(`<path class="terrain" d="${profPath}"/>`);
  const sampleItems = samples.filter(sampleIsPlotted).map((s: any) => ({
    id: text(s.id),
    point: profileAnchor(s.position.x_m, s.position.z_m),
  }));
  const sampleTags = layoutCallouts(
    sampleItems,
    {
      left: margin + 4,
      top: profileTop + 4,
      right: margin + panelW - 4,
      bottom: profileBottom - 4,
    },
    labelBoxes,
    11,
  );
  for (const label of sampleTags) {
    pieces.push(
      `<path class="leader" d="M${label.point[0]},${label.point[1]}L${label.x},${label.y - 3}"/>`,
    );
    pieces.push(
      `<text class="tag" x="${label.x}" y="${label.y}" font-size="11" font-weight="bold">${esc(label.id)}</text>`,
    );
    labelBoxes.push(label.box);
    plottedIds.samples.push(label.id);
  }
  const attitudeItems = attitudes
    .map((a: any) => {
      const n = nodes[a.node];
      return n ? { id: text(a.id), point: profileAnchor(n.x_m, n.z_m) } : null;
    })
    .filter(Boolean) as { id: string; point: Point }[];
  for (const item of attitudeItems)
    pieces.push(
      `<circle cx="${item.point[0]}" cy="${item.point[1]}" r="3" fill="#145b86"/>`,
    );
  const attitudeTags = layoutCallouts(
    attitudeItems,
    {
      left: margin + 4,
      top: profileTop + 4,
      right: margin + panelW - 4,
      bottom: profileBottom - 4,
    },
    labelBoxes,
    10,
  );
  for (const label of attitudeTags) {
    pieces.push(
      `<path class="leader" d="M${label.point[0]},${label.point[1]}L${label.x},${label.y - 3}"/>`,
    );
    pieces.push(
      `<text class="tag" x="${label.x}" y="${label.y}" font-size="10" font-weight="bold">${esc(label.id)}</text>`,
    );
    labelBoxes.push(label.box);
    plottedIds.attitudes.push(label.id);
  }
  const contactAudit: any[] = [];
  for (const c of geometry.contacts) {
    for (const segment of c.segments || [])
      pieces.push(
        `<path class="estimated" d="${path(segment.map((p: any) => profileAnchor(p[0], p[1])))}"/>`,
      );
    contactAudit.push({ ...c, interpretation: '产状推算界面，不是实测矿界' });
  }
  pieces.push(appendix.svg);
  const intervalAudit = appendix.intervalRows;
  pieces.push('</svg>');
  return {
    svg: pieces.join(''),
    scale: profileScale,
    profileAnchor,
    planAnchor,
    patterns: patternAudit,
    geometry,
    intervalRows: intervalAudit,
    width,
    height: viewBottom,
    sampleIsPlotted,
    textBoxes: labelBoxes,
    plottedIds,
  };
}

export function renderSection(data: Record<string, any>): {
  svg: string;
  detailSvg: string;
  audit: Record<string, unknown>;
} {
  assertBounded(data);
  const main = renderLayout(data, false),
    detail = renderLayout(data, true);
  const allNodes = data.nodes || [];
  return {
    svg: main.svg,
    detailSvg: detail.svg,
    audit: {
      geometry: main.geometry,
      scale_px_per_m: main.scale,
      detail_scale_px_per_m: detail.scale,
      extent: {
        x_min: Math.min(...allNodes.map((n: any) => n.x_m)),
        x_max: Math.max(...allNodes.map((n: any) => n.x_m)),
        z_top: Math.max(...allNodes.map((n: any) => n.z_m)),
        z_bottom:
          Math.min(...allNodes.map((n: any) => n.z_m)) -
          main.geometry.effective_depth_m,
      },
      nodes: allNodes.map((n: any) => ({
        ...n,
        index: n.index,
        east_m: n.east_m,
        north_m: n.north_m,
        x_m: n.x_m,
        z_m: n.z_m,
        plan_anchor: main.planAnchor(n.east_m, n.north_m),
        profile_anchor: main.profileAnchor(n.x_m, n.z_m),
      })),
      intervals: main.intervalRows,
      records: data.records || [],
      issues: data.issues || [],
      contacts: main.geometry.contacts.map((c: any) => ({
        ...c,
        interpretation: '产状推算界面，不是实测矿界',
      })),
      samples: (data.samples || []).map((s: any) => ({
        id: s.id,
        record_id: s.record_id ?? null,
        location_status: s.location_status || 'missing',
        plotted: main.sampleIsPlotted(s),
        position: s.position || null,
        anchor_svg: main.sampleIsPlotted(s)
          ? main.profileAnchor(s.position.x_m, s.position.z_m)
          : null,
        source_cells: s.source_cells || {},
      })),
      missing_sample_count: (data.samples || []).filter(
        (s: any) => !main.sampleIsPlotted(s),
      ).length,
      stations: (data.stations || []).map((s: any) => ({
        ...s,
        id: s.id,
        node: s.node,
      })),
      attitudes: data.attitudes || [],
      label_audit: { text_boxes: main.textBoxes, plotted_ids: main.plottedIds },
      pattern_audit: main.patterns,
      detail_pattern_audit: detail.patterns,
      plan_bounds: {
        east: [
          Math.min(...allNodes.map((n: any) => n.east_m)),
          Math.max(...allNodes.map((n: any) => n.east_m)),
        ],
        north: [
          Math.min(...allNodes.map((n: any) => n.north_m)),
          Math.max(...allNodes.map((n: any) => n.north_m)),
        ],
        scale_px_per_m: Math.min(
          (main.width - 220) /
            Math.max(
              1e-9,
              Math.max(...allNodes.map((n: any) => n.east_m)) -
                Math.min(...allNodes.map((n: any) => n.east_m)),
            ),
          470 /
            Math.max(
              1e-9,
              Math.max(...allNodes.map((n: any) => n.north_m)) -
                Math.min(...allNodes.map((n: any) => n.north_m)),
            ),
        ),
      },
    },
  };
}
