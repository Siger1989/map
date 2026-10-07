"""Independent numerical and SVG review of apparent-dip lithology regions."""
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'generated' / 'pm01-canonical'
data = json.loads((OUT/'normalized.json').read_text(encoding='utf-8'))
audit = json.loads((OUT/'layout-audit.json').read_text(encoding='utf-8'))
geo = audit['layer_geometry']
nodes = data['nodes']
by_node = {n['index']: n for n in nodes}
records = {r['id']: r for r in data['records']}
intervals = {i['id']: i for i in data['intervals']}
A = math.radians(data['settings']['axis_azimuth_deg'])

def area(poly):
    return 0.5 * sum(p[0]*q[1]-q[0]*p[1] for p,q in zip(poly,poly[1:]+poly[:1]))

def cross(a,b,c):
    return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])

def intersect(subject, clipping):
    result = subject[:]
    sign = 1 if area(clipping)>0 else -1
    for a,b in zip(clipping,clipping[1:]+clipping[:1]):
        previous=result
        result=[]
        if not previous: break
        p=previous[-1]; vp=sign*cross(a,b,p)
        for q in previous:
            vq=sign*cross(a,b,q)
            if (vp>=0)!=(vq>=0):
                t=vp/(vp-vq)
                result.append([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])])
            if vq>=0: result.append(q)
            p,vp=q,vq
    return result

def surface(x):
    for p,q in zip(nodes,nodes[1:]):
        if p['x_m']-1e-8 <= x <= q['x_m']+1e-8:
            return p['z_m']+(q['z_m']-p['z_m'])*(x-p['x_m'])/(q['x_m']-p['x_m'])
    raise AssertionError(('outside source range',x))

assert geo['eligible'] and geo['effective_depth_m']>0
max_plane_error=0.0
for c in geo['contacts']:
    n=by_node[c['node']]; r=records[c['record_id']]
    assert c['anchor_x_m']==n['x_m'] and c['anchor_z_m']==n['z_m']
    assert c['dip_direction_deg']==r['dip_direction_deg'] and c['dip_angle_deg']==r['dip_angle_deg']
    t=math.radians(r['dip_angle_deg']); d=math.radians(r['dip_direction_deg'])
    direction=(math.cos(t),-math.sin(t)*math.cos(A-d))
    expected_angle=math.degrees(math.atan2(direction[1],direction[0]))
    assert abs(expected_angle-c['apparent_dip_deg_signed'])<1e-9
    a,b,k=c['a'],c['b'],c['c']
    assert abs(a*a+b*b-1)<1e-10
    assert abs(a*n['x_m']+b*n['z_m']+k)<1e-9
    assert abs(a*direction[0]+b*direction[1])<1e-10
    for segment in c['segments']:
        for x,z in segment:
            max_plane_error=max(max_plane_error,abs(a*x+b*z+k))
assert max_plane_error<1e-7

polygons=[]
for region in geo['regions']:
    assert region['status']=='drawn',region
    expected=intervals[region['interval_id']]
    assert region['source_node_indices']==list(range(expected['start_node'],expected['end_node']+1))
    for index,poly in enumerate(region['polygons']):
        assert len(poly)>=3 and abs(area(poly))>1e-12
        for x,z in poly:
            depth=surface(x)-z
            assert -1e-7<=depth<=geo['effective_depth_m']+1e-7,(region['interval_id'],depth)
        polygons.append((region['interval_id'],index,poly))
area_sum=sum(abs(area(p)) for _,_,p in polygons)
expected_area=geo['effective_depth_m']*(nodes[-1]['x_m']-nodes[0]['x_m'])
assert abs(area_sum-expected_area)<max(1e-6,expected_area*1e-9)
overlap=0.0
for j,(_,_,p) in enumerate(polygons):
    for _,_,q in polygons[j+1:]:
        result=intersect(p,q)
        if len(result)>=3:overlap+=abs(area(result))
assert overlap<1e-6

ns={'s':'http://www.w3.org/2000/svg'}
svg_results={}
poly_map={(iid,str(index)):poly for iid,index,poly in polygons}
for filename in ['drawing.svg','detail.svg']:
    svg=ET.parse(OUT/filename).getroot()
    lines=svg.findall('.//s:polyline[@class="survey"]',ns)
    profile=lines[-1]
    xy=[tuple(map(float,p.split(','))) for p in profile.attrib['points'].split()]
    assert len(xy)==len(nodes)
    # Derive mapping from the unchanged measured endpoints, independently of renderer layout constants.
    px_per_m=(xy[-1][0]-xy[0][0])/(nodes[-1]['x_m']-nodes[0]['x_m'])
    ox=xy[0][0]-nodes[0]['x_m']*px_per_m
    oy=xy[0][1]+nodes[0]['z_m']*px_per_m
    residual=max(max(abs(x-(ox+n['x_m']*px_per_m)),abs(y-(oy-n['z_m']*px_per_m))) for (x,y),n in zip(xy,nodes))
    seen=[]
    for p in svg.findall('.//s:polygon[@data-polygon-index]',ns):
        key=(p.attrib['data-interval'],p.attrib['data-polygon-index'])
        expected=poly_map[key]
        actual=[tuple(map(float,t.split(','))) for t in p.attrib['points'].split()]
        assert len(actual)==len(expected)
        for (x,y),(wx,wz) in zip(actual,expected):
            residual=max(residual,abs(x-(ox+wx*px_per_m)),abs(y-(oy-wz*px_per_m)))
        seen.append(key)
    assert seen and len(seen)==len(set(seen))
    assert residual<2e-5,(filename,residual)
    svg_results[filename]={'source_nodes':len(xy),'polygons':len(seen),'max_residual_px':residual}

result={'passed':True,'contact_count':len(geo['contacts']),'region_count':len(geo['regions']),
        'polygon_count':len(polygons),'requested_display_depth_m':geo['requested_depth_m'],
        'effective_display_depth_m':geo['effective_depth_m'],'max_plane_residual_m':max_plane_error,
        'partition_area_m2':area_sum,'expected_area_m2':expected_area,'total_pairwise_overlap_area_m2':overlap,
        'svg':svg_results,'limitations':'Contact attitude uses explicit adjacent-record assumption. Display depth is not geological thickness. No formal standards certification.'}
(ROOT/'logs'/'parent-sloped-geometry-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
