"""End-to-end drill workbook generation. Business data comes only from input_path."""
from __future__ import annotations
import hashlib, html, json, math, re
from pathlib import Path
from typing import Any

from drill_importer import load_drill_workbook
from drill_renderer import render_drill_svg
from importer import GeometryInputError

ROOT=Path(__file__).resolve().parent

def _sha(path:Path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def _json(path:Path,obj): path.write_text(json.dumps(obj,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')

def _appendix(data):
    def esc(x): return html.escape(str(x if x is not None else '未提供'))
    def src(row):
        s=row.get('source',{}); cells=s.get('cells',{})
        return s.get('sheet',''),s.get('row',''),', '.join(cells.values()) or '未提供'
    def records(title, rows, columns):
        headers=[label for label,_ in columns]+['来源表','来源行','来源单元格']
        th=''.join(f'<th>{esc(x)}</th>' for x in headers)
        body=[]
        for row in rows:
            values=[]
            for label,key in columns:
                value=row.get('assays',{}).get(key) if key in ('Au','Pb','Zn') else row.get(key)
                if key in ('Au','Pb','Zn') and value is None: value='未提供'
                elif isinstance(value,dict): value='；'.join(f'{k}={v if v is not None else "未提供"}' for k,v in value.items())
                values.append(value)
            body.append('<tr>'+''.join(f'<td>{esc(v)}</td>' for v in values+list(src(row)))+'</tr>')
        return f'<h2>{esc(title)}</h2><table><thead><tr>{th}</tr></thead><tbody>{"".join(body)}</tbody></table>'
    units=data['project']['analysis_units']
    sample_cols=[('样品编号','id'),('顶深 (m)','top_m'),('底深 (m)','bottom_m'),('样长 (m)','length_m'),('岩心长 (m)','core_m'),('采取率 (%)','recovery_percent')]
    sample_cols += [(f'{el} ({units[el] or "单位未提供"})',el) for el in ('Au','Pb','Zn')]
    project_rows=[('项目名称',data['project']['name'],'项目名称'),('钻孔编号',data['project']['hole_id'],'钻孔编号'),('孔深基准',data['meta']['depth_basis'],'孔深基准'),('终孔深度 (m)',data['meta']['endpoint_m'],'终孔深度_m'),('长度单位','m','长度单位')]
    project_rows += [(f'{el}单位',units[el] or '未提供',f'{el}单位') for el in ('Au','Pb','Zn')]
    project_html='<h2>项目参数</h2><table><thead><tr><th>参数</th><th>值</th><th>来源单元格</th></tr></thead><tbody>'+''.join(f'<tr><td>{esc(k)}</td><td>{esc(v)}</td><td>{esc(data["project"]["source_cells"].get(src_key,"未提供"))}</td></tr>' for k,v,src_key in project_rows)+'</tbody></table>'
    return ('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>钻孔数字附表</title><style>body{font-family:Microsoft YaHei,sans-serif;margin:24px}table{border-collapse:collapse;width:100%;margin:12px 0 28px;font-size:12px}td,th{border:1px solid #888;padding:5px;text-align:left;vertical-align:top}th{background:#eee}td{overflow-wrap:anywhere}</style>'
      f'<h1>{esc(data["meta"]["hole_id"])} 钻孔完整数字附表</h1><p>深度基准：{esc(data["meta"]["depth_basis"])}；所有深度为沿孔深。显示位数不改变规范数据源值。层段长仅为沿孔长度，不代表真厚度。</p>'
      +project_html
      +records('分层数据',data['layers'],[('层号','id'),('顶深 (m)','top_m'),('底深 (m)','bottom_m'),('段长 (m)','thickness_m'),('岩心长 (m)','core_m'),('采取率 (%)','recovery_percent'),('岩性名称','lithology_name'),('岩性描述','description'),('花纹代码','material_code')])
      +records('回次数据',data['turns'],[('回次号','id'),('顶深 (m)','top_m'),('底深 (m)','bottom_m'),('进尺 (m)','advance_m'),('岩心长 (m)','core_m'),('采取率 (%)','recovery_percent')])
      +records('样品数据',data['samples'],sample_cols)
      +records('孔径数据',data['structures'],[('孔深 (m)','depth_m'),('孔径 (mm)','diameter_mm')])+'</html>')

def _report(data, files):
    labels={'drawing_svg':'完整矢量图 SVG','preview':'PNG预览','complete_hd':'完整高清 PNG','detail_svg':'局部详图 SVG','detail':'局部详图 PNG','normalized':'规范化数据 JSON','appendix':'完整数字附表','layout_audit':'版式审计 JSON','manifest':'生成清单 JSON','report':'本报告'}
    links=''.join(f'<li><a href="{html.escape(Path(v).name)}">{html.escape(labels.get(k,k))}</a></li>' for k,v in files.items())
    issues=data.get('issues',[])
    issue_html=''.join(f'<tr><td>{html.escape(i.get("severity",""))}</td><td>{html.escape(i.get("code",""))}</td><td>{html.escape(i.get("message",""))}</td><td>{html.escape(", ".join(i.get("cells",[])))}</td></tr>' for i in issues)
    if not issue_html: issue_html='<tr><td colspan="4">无导入提示</td></tr>'
    return (f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>钻孔生成报告</title><h1>{html.escape(data["meta"]["hole_id"])} 钻孔图生成报告</h1>'
      f'<p>本报告用于核对导入字段、沿孔深几何和来源追溯，不表示正式行业图式已全部核验。</p><p>终孔深度 {data["meta"]["endpoint_m"]} m；分层 {len(data["layers"])}；回次 {len(data["turns"])}；样品 {len(data["samples"])}；待配置花纹 {data["summary"]["pending_patterns"]}；深度基准 {html.escape(data["meta"]["depth_basis"])}</p><ul>{links}</ul><h2>导入提示/待核对内容</h2><table><thead><tr><th>级别</th><th>代码</th><th>内容</th><th>来源单元格</th></tr></thead><tbody>{issue_html}</tbody></table></html>')


def _raster_view(source:Path,dest:Path,max_edge=11000,max_pixels=64_000_000):
    raw=source.read_text(encoding='utf-8')
    m=re.search(r'<svg\b[^>]*>',raw)
    if not m: raise RuntimeError('SVG 缺少根画布尺寸')
    root=m.group(0)
    wm=re.search(r'\bwidth="([0-9.]+)(?:px)?"',root); hm=re.search(r'\bheight="([0-9.]+)(?:px)?"',root)
    if not wm or not hm: raise RuntimeError('SVG 缺少可用的根画布宽高')
    w,h=float(wm.group(1)),float(hm.group(1))
    if not math.isfinite(w) or not math.isfinite(h) or w<=0 or h<=0: raise RuntimeError('SVG 根画布宽高无效')
    factor=min(1.0,max_edge/max(w,h),(max_pixels/(w*h))**0.5)
    nw,nh=max(1,math.floor(w*factor)),max(1,math.floor(h*factor))
    root=root[:wm.start(1)]+str(nw)+root[wm.end(1):]
    hm=re.search(r'\bheight="([0-9.]+)(?:px)?"',root)
    root=root[:hm.start(1)]+str(nh)+root[hm.end(1):]
    raw=raw[:m.start()]+root+raw[m.end():]
    dest.write_text(raw,encoding='utf-8')
    return {'vector_native_size':[w,h],'raster_view_size':[nw,nh],'viewBox_preserved':True}

def _hd_raster_view(source:Path,dest:Path,max_edge=12000,max_pixels=64_000_000,max_factor=4):
    """Prepare a larger CSS-size SVG for one-pixel-per-output-pixel HD rasterization."""
    raw=source.read_text(encoding='utf-8')
    match=re.search(r'<svg\b[^>]*>',raw)
    if not match: raise RuntimeError('SVG 缺少根画布尺寸')
    root=match.group(0)
    wm=re.search(r'\bwidth="([0-9.]+)(?:px)?"',root); hm=re.search(r'\bheight="([0-9.]+)(?:px)?"',root)
    if not wm or not hm: raise RuntimeError('SVG 缺少可用的根画布宽高')
    w,h=float(wm.group(1)),float(hm.group(1))
    if not math.isfinite(w) or not math.isfinite(h) or w<=0 or h<=0: raise RuntimeError('SVG 根画布宽高无效')
    if max_edge<1 or max_pixels<1 or max_factor<1: raise ValueError('HD 栅格化限制无效')
    view=re.search(r'\bviewBox="([^"]+)"',root)
    if not view: raise RuntimeError('SVG 缺少 viewBox，无法证明高清图保留全画布')
    factor=min(float(max_factor),max_edge/max(w,h),math.sqrt(max_pixels/(w*h)))
    if not math.isfinite(factor) or factor<=0: raise RuntimeError('HD SVG 缩放因子无效')
    nw,nh=max(1,math.floor(w*factor)),max(1,math.floor(h*factor))
    root=root[:wm.start(1)]+str(nw)+root[wm.end(1):]
    hm=re.search(r'\bheight="([0-9.]+)(?:px)?"',root)
    root=root[:hm.start(1)]+str(nh)+root[hm.end(1):]
    scaled=raw[:match.start()]+root+raw[match.end():]
    dest.write_text(scaled,encoding='utf-8')
    preserved=re.search(r'\bviewBox="([^"]+)"',root)
    if not preserved or preserved.group(1)!=view.group(1): raise RuntimeError('HD SVG viewBox 被意外修改')
    return {'vector_native_size':[w,h],'hd_raster_view_size':[nw,nh],
      'requested_max_factor':max_factor,'planned_scale_factor':factor,
      'actual_scale_x':nw/w,'actual_scale_y':nh/h,'viewBox':view.group(1),
      'viewBox_preserved':True,'pixel_limit':max_pixels,'edge_limit':max_edge}

def _hd_dimension_check(meta, raster, preview):
    expected=meta['hd_raster_view_size']
    actual=[raster.get('png_width_px'),raster.get('png_height_px')]
    native=meta['vector_native_size']
    ratio_error=abs(actual[0]/actual[1]-native[0]/native[1]) if all(actual) else math.inf
    preview_size=[preview.get('png_width_px'),preview.get('png_height_px')]
    increased=all(actual) and all(preview_size) and (actual[0]>preview_size[0] or actual[1]>preview_size[1])
    passed=(meta['viewBox_preserved'] and actual==expected and actual[0]<=meta['edge_limit']
      and actual[1]<=meta['edge_limit'] and actual[0]*actual[1]<=meta['pixel_limit']
      and ratio_error<=max(1/native[0],1/native[1]))
    if not passed: raise RuntimeError(f'完整高清图尺寸关系校验失败：矢量 {native[0]}×{native[1]}，预期栅格视图 {expected[0]}×{expected[1]}，实际 PNG {actual[0]}×{actual[1]}')
    return {'passed':True,'full_viewBox_preserved':True,'native_size':native,
      'hd_view_size':expected,'png_size':actual,'preview_png_size':preview_size,'aspect_ratio_error':ratio_error,
      'png_exceeds_preview_resolution':bool(increased)}

def run_drill_pipeline(input_path:str|Path,output_dir:str|Path)->dict[str,Any]:
    inp=Path(input_path).resolve(); out=Path(output_dir).resolve(); out.mkdir(parents=True,exist_ok=True)
    data=load_drill_workbook(inp)
    _json(out/'normalized.json',data)
    svg,audit=render_drill_svg(data); (out/'drawing.svg').write_text(svg,encoding='utf-8')
    detail_svg,detail_audit=render_drill_svg(data,detail=True); (out/'detail.svg').write_text(detail_svg,encoding='utf-8')
    raster_meta=_raster_view(out/'drawing.svg',out/'.raster-view.svg')
    hd_meta=_hd_raster_view(out/'drawing.svg',out/'.hd-raster-view.svg')
    from pipeline import _find_browser,_rasterize
    browser=_find_browser(); logs=ROOT/'logs'; logs.mkdir(exist_ok=True)
    preview=_rasterize(out/'.raster-view.svg',out/'preview.png',browser,logs/f'drill-{out.name}-preview.log',scale=1)
    hd=_rasterize(out/'.hd-raster-view.svg',out/'complete-hd.png',browser,logs/f'drill-{out.name}-complete-hd.log',scale=1)
    hd_dimensions=_hd_dimension_check(hd_meta,hd,preview)
    detail_meta=_raster_view(out/'detail.svg',out/'.detail-raster-view.svg')
    detail=_rasterize(out/'.detail-raster-view.svg',out/'detail.png',browser,logs/f'drill-{out.name}-detail.log',scale=1)
    (out/'appendix.html').write_text(_appendix(data),encoding='utf-8')
    files={k:p.name for k,p in [('drawing_svg',out/'drawing.svg'),('preview',out/'preview.png'),('complete_hd',out/'complete-hd.png'),('detail_svg',out/'detail.svg'),('detail',out/'detail.png'),('normalized',out/'normalized.json'),('appendix',out/'appendix.html'),('report',out/'report.html'),('layout_audit',out/'layout-audit.json')]}
    files['manifest']='manifest.json'
    (out/'report.html').write_text(_report(data,files),encoding='utf-8')
    layout={'main':audit,'detail':detail_audit,'raster':{'main':raster_meta,'complete_hd_vector':hd_meta,'detail':detail_meta,'preview':preview,'complete_hd':hd,'complete_hd_dimensions':hd_dimensions,'detail_png':detail}}
    _json(out/'layout-audit.json',layout)
    generated=['normalized.json','drawing.svg','preview.png','complete-hd.png','detail.svg','detail.png','appendix.html','report.html','layout-audit.json']
    manifest={'drawing_type':'drill','input':data['source'],'schema_version':'drill-1.0',
      'code_sha256':{name:_sha(ROOT/name) for name in ('drill_importer.py','drill_renderer.py','drill_pipeline.py')},
      'template_sha256':_sha(ROOT/'templates'/'drill-patterns.json'),
      'business_inputs':{'project':data['project'],'sheets':{'分层':len(data['layers']),'回次':len(data['turns']),'样品':len(data['samples']),'孔径':len(data['structures'])},'source_records':[{'sheet':x['source']['sheet'],'row':x['source']['row'],'cells':x['source']['cells']} for kind in ('layers','turns','samples','structures') for x in data[kind]]},
      'files':{name:{'bytes':(out/name).stat().st_size,'sha256':_sha(out/name)} for name in generated},
      'counts':data['summary'],'complete_vector_preserved':True,'raster_full_depth_preserved':True,
      'complete_hd_viewBox_preserved':hd_meta['viewBox_preserved'],'complete_hd_scale_factor':hd_meta['planned_scale_factor'],
      'complete_hd_dimension_check':hd_dimensions}
    _json(out/'manifest.json',manifest)
    return {'drawing_type':'drill','summary':data['summary'],'issues':data['issues'],'source':data['source'],'files':files,'manifest':str(out/'manifest.json')}
