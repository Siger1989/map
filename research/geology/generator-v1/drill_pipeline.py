"""End-to-end drill workbook generation. Business data comes only from input_path."""
from __future__ import annotations
import hashlib, html, json, math, re
from pathlib import Path
from typing import Any

from drill_importer import load_drill_workbook
from drill_renderer import render_drill_svg
from importer import GeometryInputError

ROOT=Path(__file__).resolve().parent
LOG_ROOT=ROOT/'logs'

def _sha(path:Path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def _json(path:Path,obj): path.write_text(json.dumps(obj,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')

def _appendix(data):
    def esc(value):
        return html.escape('' if value is None else str(value), quote=True)
    def display(value):
        if value is None: return ''
        if isinstance(value, bool): return '是' if value else '否'
        if isinstance(value, float): return f'{value:.6f}'.rstrip('0').rstrip('.')
        if isinstance(value, dict): return '；'.join(f'{key}={display(item)}' for key,item in value.items())
        if isinstance(value, (list,tuple)): return '；'.join(display(item) for item in value)
        return str(value)
    def source_values(row):
        source=row.get('source',{}) or {}; cells=source.get('cells',{}) or {}
        return [source.get('sheet',''),source.get('row',''),', '.join(str(value) for value in cells.values())]
    def table(title, headers, rows):
        th=''.join(f'<th>{esc(value)}</th>' for value in headers)
        body=''.join('<tr>'+''.join(f'<td>{esc(value)}</td>' for value in row)+'</tr>' for row in rows)
        return f'<h2>{esc(title)}</h2><table><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table>'
    def record_table(title, rows, columns, assay_codes=()):
        headers=[label for label,_ in columns]+['来源表','来源行','来源单元格']
        body=[]
        for row in rows:
            values=[]
            for label,key in columns:
                if key.startswith('assay:'):
                    code=key[6:]
                    raw=(row.get('assay_raw') or {}).get(code)
                    value=raw if raw is not None and str(raw).strip() else (row.get('assays') or {}).get(code)
                    if value is None and not data.get('project',{}).get('analysis_items') and code in {'Au','Pb','Zn'}:
                        value='未提供'
                else:
                    value=row.get(key)
                values.append(display(value))
            body.append(values+source_values(row))
        return table(title,headers,body)

    project=data.get('project',{})
    units=project.get('analysis_units',{}) or {}
    configured_items=project.get('analysis_items') or data.get('analysis_items') or []
    integrated=bool(configured_items or data.get('basic_info') or data.get('depth_measurements') or data.get('title_block'))
    auto_recovery=(data.get('source') or {}).get('template_version')=='v3'
    original_rate_cols=[('原始录入采取率 (%)','recovery_original_percent')] if integrated and not auto_recovery else []
    items=configured_items or [
        {'code':code,'name':code,'unit':units.get(code,''),'order':order,'show':True}
        for order,code in enumerate(('Au','Pb','Zn'))]
    items=sorted(items,key=lambda item:item.get('order',0))
    if integrated:
        project_rows=[(key,value,(project.get('source_cells') or {}).get(key,''))
                      for key,value in (project.get('basic_info') or {}).items()]
        project_rows += [('项目名称',project.get('name',''),(project.get('source_cells') or {}).get('项目名称','')),
                         ('钻孔编号',project.get('hole_id',data['meta'].get('hole_id','')),(project.get('source_cells') or {}).get('钻孔编号','')),
                         ('孔深基准',data['meta'].get('depth_basis',''),(project.get('source_cells') or {}).get('孔深基准','')),
                         ('终孔深度 (m)',data['meta'].get('endpoint_m',''),(project.get('source_cells') or {}).get('终孔深度_m',''))]
    else:
        project_rows=[('项目名称',project.get('name',''),'项目名称'),('钻孔编号',project.get('hole_id',data['meta'].get('hole_id','')),'钻孔编号'),('孔深基准',data['meta']['depth_basis'],'孔深基准'),('终孔深度 (m)',data['meta']['endpoint_m'],'终孔深度_m'),('长度单位','m','长度单位')]
        project_rows += [(f'{element}单位',units.get(element) or '未提供',f'{element}单位') for element in ('Au','Pb','Zn')]
    project_html=table('项目参数',['参数','值','来源单元格'],project_rows)
    sections=[]
    basic=data.get('basic_info') or {}
    basic_fields=basic.get('fields') or {}
    if basic_fields:
        rows=[(label,display(value),(basic.get('source_cells') or {}).get(label,'')) for label,value in basic_fields.items()]
        sections.append(table('钻孔基本信息（保留输入标签和值）',['字段','原值','来源单元格'],rows))
    basic_summary=basic.get('summary') or {}
    if basic_summary:
        rows=[(label,display(value.get('value') if isinstance(value,dict) else value),
               display(value.get('formula','') if isinstance(value,dict) else ''),
               display(value.get('source','') if isinstance(value,dict) else '')) for label,value in basic_summary.items()]
        sections.append(table('基本信息统计/公式缓存',['统计项','缓存值','公式','来源'],rows))
    item_rows=[]
    for item in items:
        item_rows.append([item.get('code'),item.get('name'),item.get('unit'),item.get('order'),
                          item.get('detection_limit'),item.get('method'),item.get('show'),
                          item.get('notes'),item.get('source')])
    if integrated:
        sections.append(table('分析项目定义（含不在图面显示的项目）',
                              ['代码','项目名称','单位','顺序','检出限原文','方法','图面显示','备注','来源'],item_rows))
    sample_cols=[('样品编号','id'),('顶深 (m)','top_m'),('底深 (m)','bottom_m'),('样长 (m)','length_m'),('岩心长 (m)','core_m'),('采取率 (%)','recovery_percent')]
    sample_cols += [(f'{item.get("name") or item.get("code")} ({item.get("unit") or "单位未提供"})',f'assay:{item.get("code")}') for item in items]
    sample_cols += original_rate_cols
    record_sections=[
        record_table('分层数据',data['layers'],[('层号','id'),('顶深 (m)','top_m'),('底深 (m)','bottom_m'),('段长 (m)','thickness_m'),('岩心长 (m)','core_m'),('采取率 (%)','recovery_percent')]+original_rate_cols+[('岩性名称','lithology_name'),('岩性描述','description'),('花纹代码','material_code')]),
        record_table('回次数据',data['turns'],[('回次号','id'),('顶深 (m)','top_m'),('底深 (m)','bottom_m'),('进尺 (m)','advance_m'),('岩心长 (m)','core_m'),('采取率 (%)','recovery_percent')]+original_rate_cols),
        record_table('样品数据（空白、0与检出限原文分别保留）',data['samples'],sample_cols),
        record_table('孔径数据',data['structures'],[('孔深 (m)','depth_m'),('孔径 (mm)','diameter_mm')])]
    assay_records=[dict(record, sample_id=sample['id']) for sample in data['samples'] for record in sample.get('assay_records',[])]
    if assay_records:
        rows=[]
        keys=['sample_id','code','result_raw','value']+([] if auto_recovery else ['flag'])+['unit','detection_limit','method','test_date','report_number','notes']
        labels=['样品编号','项目代码','原始结果','数值结果']+([] if auto_recovery else ['标记'])+['单位','检出限','方法','检测日期','报告编号','备注']
        for record in assay_records:
            rows.append([record.get(key) for key in keys]+source_values(record))
        sections.append(table('逐项分析原始记录',labels+['来源表','来源行','来源单元格'],rows))
    depth=data.get('depth_measurements') or {}
    depth_records=depth.get('records') or []
    if depth_records:
        fields=[('序号','sequence'),('原记录孔深_m','recorded_depth_m'),('校正孔深_m','checked_depth_m'),('误差_m','error_m'),('误差_pct','error_percent'),('测量位置孔深_m','measurement_depth_m'),('测量天顶角_deg','zenith_deg'),('实测方位角_deg','azimuth_deg'),('测量方法','method'),('仪器','instrument'),('推导标记','derived')]
        rows=[[record.get(key) for _label,key in fields]+source_values(record) for record in depth_records]
        sections.append(table('孔深校正与弯曲度测量（不覆盖原始孔深）',[label for label,_ in fields]+['来源表','来源行','来源单元格'],rows))
    depth_summary=depth.get('summary') or {}
    if depth_summary:
        rows=[]
        for label,value in depth_summary.items():
            if isinstance(value,dict): rows.append([label,value.get('value'),value.get('formula'),value.get('source')])
            else: rows.append([label,value,'',''])
        sections.append(table('孔深/弯曲度汇总',['统计项','缓存值','公式','来源'],rows))
    signatures=depth.get('signatures') or {}
    if signatures:
        sections.append(table('测量签名/日期',['角色','原值','来源'],[[label,display(value.get('value') if isinstance(value,dict) else value),display(value.get('source') if isinstance(value,dict) else '')] for label,value in signatures.items()]))
    title=data.get('title_block') or {}
    title_fields=title.get('fields') or {}
    if title_fields:
        sections.append(table('图签字段',['字段','值','来源单元格'],[[label,display(value),(title.get('source_cells') or {}).get(label,'')] for label,value in title_fields.items()]))
    title_settings=title.get('settings') or []
    if title_settings or title.get('settings_summary'):
        rows=[[item.get(key) for key in ('layout_item','width_mm','height_mm','order','description','source')] for item in title_settings]
        sections.append(table('图签/元素尺寸参考设置（毫米值为模板原值，打印尺寸须另行核验）',
                              ['元素','宽_mm','高_mm','顺序','说明','来源'],rows))
        if title.get('settings_summary'):
            sections.append(table('图签设置汇总',['字段','值'],[[key,display(value)] for key,value in title['settings_summary'].items()]))
    intro=(f'深度基准：{html.escape(str(data["meta"]["depth_basis"]))}；原始孔深与校正孔深分列。显示位数不改变规范数据源值。层段长仅为沿孔长度，不代表真厚度。图面比例不代表90 mm打印精度。'
           if integrated else f'深度基准：{html.escape(str(data["meta"]["depth_basis"]))}；所有深度为沿孔深。显示位数不改变规范数据源值。层段长仅为沿孔长度，不代表真厚度。')
    return ('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>钻孔数字附表</title><style>body{font-family:Microsoft YaHei,sans-serif;margin:24px}table{border-collapse:collapse;width:100%;margin:12px 0 28px;font-size:12px}td,th{border:1px solid #888;padding:5px;text-align:left;vertical-align:top}th{background:#eee}td{overflow-wrap:anywhere}</style>'
      f'<h1>{html.escape(str(data["meta"]["hole_id"]))} 钻孔完整数字附表</h1><p>{intro}</p>'
      +project_html+''.join(sections)+''.join(record_sections)+'</html>')

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
    browser=_find_browser(); logs=LOG_ROOT; logs.mkdir(parents=True,exist_ok=True)
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
    code_files=['drill_importer.py','drill_renderer.py','drill_pipeline.py']
    if (ROOT/'drill_integrated_importer.py').is_file(): code_files.append('drill_integrated_importer.py')
    if (ROOT/'drill_reference_renderer.py').is_file(): code_files.append('drill_reference_renderer.py')
    project=data.get('project',{})
    business_inputs={'project':project,
      'sheets':{'分层':len(data['layers']),'回次':len(data['turns']),'样品':len(data['samples']),'孔径':len(data['structures'])},
      'source_records':[{'sheet':x.get('source',{}).get('sheet'),'row':x.get('source',{}).get('row'),'cells':x.get('source',{}).get('cells',{})} for kind in ('layers','turns','samples','structures') for x in data[kind]]}
    integrated_meta={key:data.get(key) for key in ('analysis_items','basic_info','depth_measurements','title_block') if data.get(key) is not None}
    if project.get('analysis_items') is not None: integrated_meta['project_analysis_items']=project['analysis_items']
    if integrated_meta:
      business_inputs['integrated_metadata']=integrated_meta
      business_inputs['assay_source_records']=[{'sample_id':sample.get('id'),'records':sample.get('assay_records',[])} for sample in data['samples'] if sample.get('assay_records')]
      business_inputs['depth_measurement_sources']=[{'source':record.get('source',{}),'sequence':record.get('sequence')} for record in (data.get('depth_measurements',{}).get('records') or [])]
    manifest={'drawing_type':'drill','input':data['source'],'schema_version':data.get('schema_version','drill-1.0'),
      'code_sha256':{name:_sha(ROOT/name) for name in code_files},
      'template_sha256':_sha(ROOT/'templates'/'drill-patterns.json'),
      'business_inputs':business_inputs,
      'files':{name:{'bytes':(out/name).stat().st_size,'sha256':_sha(out/name)} for name in generated},
      'counts':data['summary'],'complete_vector_preserved':True,'raster_full_depth_preserved':True,
      'complete_hd_viewBox_preserved':hd_meta['viewBox_preserved'],'complete_hd_scale_factor':hd_meta['planned_scale_factor'],
      'complete_hd_dimension_check':hd_dimensions}
    _json(out/'manifest.json',manifest)
    return {'drawing_type':'drill','summary':data['summary'],'issues':data['issues'],'source':data['source'],'files':files,'manifest':str(out/'manifest.json')}
