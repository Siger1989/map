import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSection } from '../modules/industry/renderSection.ts';
import { buildLayerGeometry } from '../modules/industry/layerGeometry.ts';
import { boxesOverlap } from '../modules/industry/sectionSvg.ts';
import {
  materialsDocument,
  sectionDefs,
  materialTemplate,
} from '../modules/industry/patterns.ts';
import pcSection from './fixtures/industry/pc-section-example.json' with { type: 'json' };
import pcSectionAlt from './fixtures/industry/pc-section-alt.json' with { type: 'json' };

// Values below are the exact first seven nodes and the first three intervals of
// PC importer output generated/pm01-canonical/normalized.json (PM01).
const pm01 = {
  schema_version: '1.0',
  project: { section_id: 'PM01' },
  settings: { axis_azimuth_deg: 83.50058502519266 },
  nodes: [
    {
      index: 0,
      east_m: 0,
      north_m: 0,
      z_m: 0,
      x_m: 0,
      offset_m: 0,
      chainage_m: 0,
      slant_chainage_m: 0,
    },
    {
      index: 1,
      east_m: 41.175306904288405,
      north_m: 13.37866821163808,
      z_m: -3.027430960495038,
      x_m: 42.42504619138735,
      offset_m: 8.631924318371016,
      chainage_m: 43.294279781276366,
      slant_chainage_m: 43.4,
    },
    {
      index: 2,
      east_m: 65.06176611083036,
      north_m: 30.104147009197483,
      z_m: -4.555640882788998,
      x_m: 68.05119567122254,
      offset_m: 22.546127036117557,
      chainage_m: 72.45426219610992,
      slant_chainage_m: 72.6,
    },
    {
      index: 3,
      east_m: 66.6009715679132,
      north_m: 34.84133430479167,
      z_m: -4.9914195965272885,
      x_m: 70.11672543991357,
      offset_m: 27.07864109426496,
      chainage_m: 77.43523568656865,
      slant_chainage_m: 77.6,
    },
    {
      index: 4,
      east_m: 75.83620431041028,
      north_m: 63.26445807835681,
      z_m: -7.6060918789570335,
      x_m: 82.50990405205971,
      offset_m: 54.273725443149345,
      chainage_m: 107.32107662932101,
      slant_chainage_m: 107.6,
    },
    {
      index: 5,
      east_m: 77.9860117960815,
      north_m: 65.34050303526573,
      z_m: -7.867559107200008,
      x_m: 84.88088864934272,
      offset_m: 56.09308437640075,
      chainage_m: 110.30966072359625,
      slant_chainage_m: 110.6,
    },
    {
      index: 6,
      east_m: 94.12719384568504,
      north_m: 75.43149019884347,
      z_m: -9.92443463604474,
      x_m: 103.53263414796905,
      offset_m: 70.40537465131177,
      chainage_m: 133.81985559856145,
      slant_chainage_m: 134.2,
    },
  ],
  records: [
    {
      id: 'R0001',
      dip_direction_deg: 323,
      dip_angle_deg: 22,
      lithology_name: '泥岩',
      description: '泥岩',
    },
    {
      id: 'R0004',
      dip_direction_deg: 286,
      dip_angle_deg: 12,
      lithology_name: '粉砂质泥岩',
      description: '粉砂质泥岩',
    },
    {
      id: 'R0006',
      dip_direction_deg: 293,
      dip_angle_deg: 15,
      lithology_name: '泥岩',
      description: '泥岩',
    },
  ],
  intervals: [
    {
      id: 'I0001',
      layer_id: 'C0',
      start_node: 0,
      end_node: 3,
      record_ids: ['R0001', 'R0002', 'R0003'],
      lithology_name: '泥岩',
      description: '泥岩',
    },
    {
      id: 'I0002',
      layer_id: 'C1',
      start_node: 3,
      end_node: 5,
      record_ids: ['R0004', 'R0005'],
      lithology_name: '粉砂质泥岩',
      description: '粉砂质泥岩',
    },
    {
      id: 'I0003',
      layer_id: 'C2',
      start_node: 5,
      end_node: 6,
      record_ids: ['R0006'],
      lithology_name: '泥岩',
      description: '泥岩',
    },
  ],
  stations: [
    { id: 'T0', node: 0 },
    { id: 'T1', node: 1 },
    { id: 'T2', node: 2 },
    { id: 'T3', node: 3 },
    { id: 'T4', node: 4 },
    { id: 'T5', node: 5 },
    { id: 'T6', node: 6 },
  ],
  attitudes: [
    {
      id: 'A0001',
      record_id: 'R0001',
      layer_id: 'C0',
      node: 0,
      dip_direction_deg: 323,
      dip_angle_deg: 22,
    },
    {
      id: 'A0002',
      record_id: 'R0004',
      layer_id: 'C1',
      node: 3,
      dip_direction_deg: 286,
      dip_angle_deg: 12,
    },
    {
      id: 'A0003',
      record_id: 'R0006',
      layer_id: 'C2',
      node: 5,
      dip_direction_deg: 293,
      dip_angle_deg: 15,
    },
  ],
  samples: Array.from({ length: 14 }, (_, i) => ({
    id: `PM01-${i}`,
    location_status: 'missing',
    position: null,
    source_cells: { sample_offset_m: `测段!N${i + 2}` },
  })),
};

test('PC PM01 normalized geometry preserves exact real-world contact anchor and projection', () => {
  const geometry = buildLayerGeometry(pm01, 7);
  const contact = geometry.contacts[0];
  assert.equal(contact.id, 'LC0001');
  assert.equal(contact.anchor_x_m, 70.11672543991357);
  assert.equal(contact.anchor_z_m, -4.9914195965272885);
  assert.ok(
    Math.abs(contact.apparent_dip_deg_signed - 11.110222344244344) < 1e-10,
  );
  assert.ok(Math.abs(contact.a - 0.19269703938269647) < 1e-12);
  assert.ok(Math.abs(contact.b + 0.9812582998442069) < 1e-12);
  assert.ok(Math.abs(contact.c + 18.409157310578163) < 1e-10);
  assert.equal(contact.status, 'drawn');
  assert.ok(
    contact.segments.some(
      (s) =>
        Math.abs(s[0][0] - 70.11672543991357) < 1e-10 &&
        Math.abs(s[0][1] + 4.9914195965272885) < 1e-10,
    ),
  );
  const out = renderSection(pm01);
  assert.equal(
    out.audit.nodes[3].profile_anchor[0],
    110 + 70.11672543991357 * out.audit.scale_px_per_m,
  );
  assert.equal(out.audit.missing_sample_count, 14);
  assert.match(out.svg, /未定位样品 14 条/);
  assert.match(out.svg, /产状计算的推算界面，不是实测矿界/);
  assert.match(out.detailSvg, /aria-label="实测剖面矢量图"/);
  assert.ok(out.detailSvg.includes('PM01'));
});

test('fixed section templates keep source tile/scale, solid circles, and blank pending symbols', () => {
  const defs = sectionDefs('main');
  const materials = Object.values(materialsDocument.materials);
  const verified = materials.filter((m) => m.reference_status === 'verified');
  const unverified = materials.filter(
    (m) => m.reference_status === 'unverified',
  );
  assert.ok(verified.length > 0 && unverified.length > 0);
  for (const m of verified) {
    const block = defs.slice(
      defs.indexOf(`id="${m.id}"`),
      defs.indexOf('</pattern>', defs.indexOf(`id="${m.id}"`)) + 10,
    );
    assert.ok(
      block.includes(`width="${m.tile_width ?? materialsDocument.tile.width}"`),
    );
    assert.ok(
      block.includes(
        `height="${m.tile_height ?? materialsDocument.tile.height}"`,
      ),
    );
    assert.match(block, /patternTransform="scale\(0\.5\)"/);
  }
  const circleMaterial = verified.find((m) =>
    m.svg.some((p) => p.type === 'circle'),
  );
  assert.ok(circleMaterial);
  const circleBlock = defs.slice(
    defs.indexOf(`id="${circleMaterial.id}"`),
    defs.indexOf('</pattern>', defs.indexOf(`id="${circleMaterial.id}"`)) + 10,
  );
  assert.match(circleBlock, /fill="#111111" stroke="none"/);
  for (const m of unverified) {
    const block = defs.slice(
      defs.indexOf(`id="${m.id}"`),
      defs.indexOf('</pattern>', defs.indexOf(`id="${m.id}"`)) + 10,
    );
    assert.doesNotMatch(block, /<(?:line|circle|path)\b/);
    assert.ok(block.includes('fill="#ffffff"'));
    assert.equal(materialTemplate(m.name), m.id);
  }
  assert.equal(materialTemplate('不在批准表的岩性'), 'mat_pending');
  assert.equal(materialTemplate('不在批准表的岩性'), 'mat_pending');
});

test('full PC normalized PM01 matches 43-record/26-interval survey and clipped geometry expectations', () => {
  assert.equal(pcSection.records.length, 43);
  assert.equal(pcSection.intervals.length, 26);
  assert.equal(pcSection.stations.length, 20);
  assert.equal(pcSection.samples.length, 14);
  const g = buildLayerGeometry(pcSection, 7);
  assert.ok(Math.abs(g.effective_depth_m - 3.3943406026757206) < 1e-10);
  assert.equal(g.contacts[0].status, 'drawn');
  assert.equal(g.contacts[0].reason, '');
  assert.equal(g.contacts[0].anchor_x_m, 70.11672543991357);
  const expectedPolygon = [
    [0, 0],
    [42.42504619138735, -3.027430960495038],
    [42.42504619138735, -6.421771563170759],
    [0, -3.3943406026757206],
  ];
  g.regions[0].polygons[0]
    .flat()
    .forEach((v, i) =>
      assert.ok(Math.abs(v - expectedPolygon.flat()[i]) < 1e-10),
    );
  const rendered = renderSection(pcSection);
  assert.equal(rendered.audit.nodes.length, 44);
  assert.equal(rendered.audit.stations.length, 20);
  assert.equal(rendered.audit.intervals.length, 26);
  assert.equal(rendered.audit.missing_sample_count, 14);
  assert.equal(rendered.audit.geometry.effective_depth_m, g.effective_depth_m);
  const verifiedNames = new Set(
    rendered.audit.pattern_audit
      .filter((p) => p.reference_status === 'verified')
      .map((p) => p.material_name),
  );
  const unverifiedNames = new Set(
    rendered.audit.pattern_audit
      .filter((p) => p.reference_status === 'unverified')
      .map((p) => p.material_name),
  );
  assert.equal(verifiedNames.size, 13);
  assert.equal(unverifiedNames.size, 3);
  assert.ok(
    rendered.audit.pattern_audit
      .filter((p) => p.reference_status === 'unverified')
      .every((p) => p.template_pattern_id !== 'mat_pending'),
  );
  assert.ok(rendered.svg.length > 10000);
  const labels = rendered.audit.label_audit;
  assert.deepEqual(
    labels.plotted_ids.stations,
    pcSection.stations.map((s) => String(s.id)),
  );
  assert.deepEqual(
    labels.plotted_ids.intervals,
    pcSection.intervals.map((i) => i.layer_id),
  );
  assert.deepEqual(
    labels.plotted_ids.attitudes,
    pcSection.attitudes.map((a) => a.id),
  );
  assert.match(rendered.svg, /东坐标 E \(m\)/);
  assert.match(rendered.svg, /剖面轴向距离 x \(m\)/);
  assertNoTextBoxOverlaps(labels.text_boxes);
});

test('PC alternate normalized T1 explicit offset retains its measured map position', () => {
  const t1 = pcSectionAlt.samples.find((s) => s.id === 'T1');
  assert.ok(t1);
  assert.equal(t1.location_status, 'explicit_offset');
  const rendered = renderSection(pcSectionAlt);
  assert.equal(rendered.audit.missing_sample_count, 0);
  const audit = rendered.audit.samples.find((s) => s.id === 'T1');
  assert.deepEqual(audit.position, t1.position);
  const anchor = audit.anchor_svg;
  assert.ok(anchor);
  assert.ok(rendered.svg.includes(`M${anchor[0]},${anchor[1]}l-7,-11h14z`));
  assert.deepEqual(rendered.audit.label_audit.plotted_ids.samples, ['T1']);
  assertNoTextBoxOverlaps(rendered.audit.label_audit.text_boxes);
});

function assertNoTextBoxOverlaps(boxes) {
  const collisions = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i], boxes[j]))
        collisions.push([boxes[i].id, boxes[j].id]);
    }
  }
  assert.deepEqual(
    collisions,
    [],
    `overlapping text boxes: ${JSON.stringify(collisions)}`,
  );
}

test('explicit-offset sample uses its finite normalized coordinate as the exact plotted anchor', () => {
  const sample = {
    id: 'T1',
    record_id: 'R0001',
    location_status: 'explicit_offset',
    position: { x_m: 42.42504619138735, z_m: -3.027430960495038 },
    source_cells: { sample_offset_m: '测段!N2' },
  };
  const out = renderSection({ ...pm01, samples: [sample] });
  assert.equal(out.audit.missing_sample_count, 0);
  assert.deepEqual(out.audit.samples[0].position, sample.position);
  const anchor = out.audit.nodes[1].profile_anchor;
  assert.ok(out.svg.includes(`M${anchor[0]},${anchor[1]}l-7,-11h14z`));
  assert.match(out.svg, /T1：已定位（显式偏距）/);
});

test('renderers escape untrusted text and reject excessive input without truncating', () => {
  const out = renderSection({
    ...pm01,
    project: { section_id: '<svg/onload="x">' },
  });
  assert.match(out.svg, /&lt;svg\/onload=&quot;x&quot;&gt;/);
  assert.doesNotMatch(out.svg, /<svg\/onload=/);
  assert.throws(
    () => renderSection({ ...pm01, nodes: Array(20001).fill(pm01.nodes[0]) }),
    /超过安全上限/,
  );
});
