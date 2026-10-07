"""Independent review of serialized SVG geometry; no renderer imports."""
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

root = Path(__file__).resolve().parent
out = root / 'generated' / 'pm01-canonical'
data = json.loads((out / 'normalized.json').read_text(encoding='utf-8'))
audit = json.loads((out / 'layout-audit.json').read_text(encoding='utf-8'))
cfg = json.loads((root / 'templates' / 'drawing.json').read_text(encoding='utf-8'))
ns = {'s': 'http://www.w3.org/2000/svg'}
main = ET.parse(out / 'drawing.svg').getroot()
detail = ET.parse(out / 'detail.svg').getroot()
nodes = data['nodes']
by_index = {n['index']: n for n in nodes}
intervals = {i['id']: i for i in data['intervals']}
def points(el):
    return [tuple(map(float, p.split(','))) for p in el.attrib['points'].split()]

main_lines = main.findall('.//s:polyline[@class="survey"]', ns)
detail_line = detail.find('.//s:polyline[@class="survey"]', ns)
assert len(main_lines) == 2 and detail_line is not None
main_profile = points(main_lines[1])
detail_profile = points(detail_line)
assert len(main_profile) == len(detail_profile) == len(nodes)
assert [p[0] for p in points(main_lines[0])] == [p[0] for p in main_profile]
dscale = audit['detail']['units_per_px']
dlo, dhi = audit['detail']['x_range_m']
y_origin = detail_profile[0][1] + nodes[0]['z_m'] / dscale
max_residual = 0.0
for n, (x, y) in zip(nodes, detail_profile):
    expected = (cfg['content_margin_px'] + (n['x_m'] - dlo) / dscale,
                y_origin - n['z_m'] / dscale)
    max_residual = max(max_residual, abs(x-expected[0]), abs(y-expected[1]))
assert max_residual < 1.1e-6

main_polygons = {p.attrib['data-interval']: p for p in main.findall('.//s:polygon', ns) if 'data-interval' in p.attrib}
reviewed = []
for polygon in detail.findall('.//s:polygon', ns):
    if 'data-interval' not in polygon.attrib:
        continue
    iid = polygon.attrib['data-interval']
    interval = intervals[iid]
    expected_seq = list(range(interval['start_node'], interval['end_node']+1))
    seq = list(map(int, polygon.attrib['data-node-sequence'].split(',')))
    assert seq == expected_seq
    main_actual = points(main_polygons[iid])
    main_top = [(main_profile[i][0], main_profile[i][1] + cfg['profile_band_gap_px']) for i in seq]
    main_expected = main_top + [(x, y + cfg['profile_band_width_px']) for x, y in reversed(main_top)]
    assert len(main_actual) == len(main_expected)
    assert max(abs(a-b) for pt, ex in zip(main_actual, main_expected) for a, b in zip(pt, ex)) < 1.1e-6
    actual = points(polygon)
    top = [(detail_profile[i][0], detail_profile[i][1] + cfg['profile_band_gap_px']) for i in seq]
    expected_points = top + [(x, y + cfg['profile_band_width_px']) for x, y in reversed(top)]
    assert len(actual) == len(expected_points)
    error = max(abs(a-b) for pt, ex in zip(actual, expected_points) for a, b in zip(pt, ex))
    assert error < 1.1e-6
    reviewed.append({'interval_id': iid, 'layer_id': interval['layer_id'], 'node_sequence': seq, 'max_polygon_error_px': error})

clipped_group = detail.find('.//s:g[@clip-path="url(#detail-window)"]', ns)
assert clipped_group is not None and detail_line in list(clipped_group)
rect = detail.find('.//s:clipPath[@id="detail-window"]/s:rect', ns)
assert rect is not None
assert abs(float(rect.attrib['x']) - cfg['content_margin_px']) < 1e-6
assert abs(float(rect.attrib['width']) - (dhi-dlo)/dscale) < 1e-3
crossing_segments = sum(any(min(a['x_m'], b['x_m']) < edge < max(a['x_m'], b['x_m']) for edge in (dlo,dhi)) for a,b in zip(nodes,nodes[1:]))
assert crossing_segments == 2
text = ''.join(detail.itertext())
assert all(i['layer_id'] in text for i in reviewed)
result = {'passed': True, 'full_profile_node_count': len(detail_profile), 'clipped_boundary_crossing_segments': crossing_segments,
          'reviewed_intervals': reviewed, 'max_profile_residual_px': max_residual,
          'note': 'Arithmetic serialization check only; not a field survey accuracy or standards compliance certificate.'}
(root / 'logs' / 'parent-detail-geometry-audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')
print(json.dumps({'passed': True, 'nodes': len(detail_profile), 'intervals': len(reviewed), 'crossing_segments': crossing_segments}))
