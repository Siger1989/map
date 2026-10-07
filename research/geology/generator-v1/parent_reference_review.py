"""Read-only parent review of source invariants and reference-pattern outputs."""
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'generated/pm01-canonical'
BEFORE = ROOT / 'outputs/before-reference-patterns-20261006'
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
data, old_data = read(OUT/'normalized.json'), read(BEFORE/'normalized.json')
audit, old_audit = read(OUT/'layout-audit.json'), read(BEFORE/'layout-audit.json')
materials = read(ROOT/'templates/materials.json')
old_materials = read(BEFORE/'materials.json')
business_keys = ['records','nodes','intervals','stations','attitudes','samples','settings','issues','summary']
assert all(data[k] == old_data[k] for k in business_keys)
assert audit['layer_geometry'] == old_audit['layer_geometry']
assert set(materials['materials']) == set(old_materials['materials'])
assert all(m['background'] == '#ffffff' for m in materials['materials'].values())
pending = [name for name, m in materials['materials'].items() if m['reference_status'] == 'unverified']
assert all(materials['materials'][name]['svg'] == [] for name in pending)
assert all(m.get('reference_evidence') for m in materials['materials'].values())
records = {r['id']: r for r in data['records']}
for row in audit['pattern_audit']:
    spec = materials['materials'][row['material_name']]
    assert row['reference_status'] == spec['reference_status']
    if row['orientation'] == 'bedding':
        r = records[row['first_record_id']]
        expected = math.degrees(math.atan(-math.tan(math.radians(r['dip_angle_deg'])) *
                                          math.cos(math.radians(data['settings']['axis_azimuth_deg']-r['dip_direction_deg']))))
        assert abs(row['pattern_rotation_deg_svg_y_down'] + expected) < 1e-10

svg_checks = {}
for name in ['drawing.svg', 'detail.svg']:
    current = ET.parse(OUT/name).getroot()
    previous = ET.parse(BEFORE/name).getroot()
    world = lambda tree: [(e.get('data-interval'),e.get('data-world-points')) for e in tree.iter() if e.get('data-world-points')]
    assert world(current) == world(previous)
    unknown = next(e for e in current.iter() if e.get('id') == 'mat_pending')
    assert len(list(unknown)) == 1 and list(unknown)[0].get('fill') == '#ffffff'
    for e in current.iter():
        if e.get('data-world-points'):
            assert e.get('stroke') == 'none'
    svg_checks[name] = {'world_polygons_unchanged': len(world(current)), 'no_fragment_borders': True}

assert sha(Path('D:/天气地图/地质资料/实测地层剖面登记表.xls')) == 'e27d49e7783f6c4414e0dd71477879f335362c9e1daec6489a529492cb2d3c6a'
assert sha(ROOT/'outputs/geology-template-v1/PM01规范输入.xlsx') == '07acff1d8ea193db09af240431c5c3a52ca100398b289adfb0122d134fdd698b'
result = {'passed': True, 'source_files_unchanged': True, 'business_data_unchanged': True,
          'world_geometry_unchanged': True, 'source_material_names_preserved': True,
          'verified_materials': len(materials['materials']) - len(pending),
          'unverified_materials': pending, 'svg_checks': svg_checks,
          'scope': 'Reference motif and data invariants reviewed; not formal standards certification.'}
(ROOT/'logs/parent-reference-patterns-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
