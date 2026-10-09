"""Fixed-grid renderer for the integrated drill workbook schema (v2/v3)."""
from __future__ import annotations

import html
import json
import math
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
PATTERN_PATH = ROOT / "templates" / "drill-patterns.json"
LEFT = 28.0
HEADER_TOP = 272.0
HEADER_HEIGHT = 158.0
BODY_TOP = HEADER_TOP + HEADER_HEIGHT
NARROW = 54.0
SCALE_100 = 80.0 / 3.0
FONT = "SimSun,宋体,serif"


def _e(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def _fmt(value: Any, digits: int = 2) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if not math.isfinite(number):
        return ""
    return f"{number:.{digits}f}"


def _friendly_date(value: Any) -> Any:
    if value is None:return None
    raw=str(value).strip()
    match=re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})",raw)
    return f"{match.group(1)}年{int(match.group(2))}月{int(match.group(3))}日" if match else value


def _sequence(value: Any, fallback: int) -> int | str:
    number=_num(value)
    return int(number) if number is not None and number.is_integer() else (value if value is not None else fallback)


def _num(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _text(x: float, y: float, value: Any, size: float = 14.0, *, anchor="middle", weight="normal", cls="cell-text", rotate=False):
    transform = f' transform="rotate(-90 {x:.2f} {y:.2f})"' if rotate else ""
    return (f'<text class="{cls}" x="{x:.2f}" y="{y:.2f}" text-anchor="{anchor}" '
            f'font-size="{size:.2f}" font-weight="{weight}"{transform}>{_e(value)}</text>')


def _vertical_text(x: float, y: float, value: Any, size: float = 12.0):
    return (f'<text class="cell-text" x="{x:.2f}" y="{y:.2f}" text-anchor="middle" '
            f'dominant-baseline="central" font-size="{size:.2f}" '
            f'writing-mode="vertical-rl" text-orientation="upright">{_e(value)}</text>')


def _fit_font(value: Any, width: float, base: float = 14.0, minimum: float = 11.0) -> float:
    text="" if value is None else str(value)
    units=sum(1.0 if ord(ch)>255 else .56 for ch in text)
    return base if units<=0 else max(minimum,min(base,width*.88/units))


def _vertical_header_text(x: float, top: float, bottom: float, value: Any, size: float = 20.0):
    label="" if value is None else str(value)
    unit=re.search(r"([（(](?:米|m|%|％)[）)])$",label,flags=re.IGNORECASE)
    if not unit:
        font=min(size,max(8.0,((bottom-top-8)/max(1,len(label)))*.9))
        return _vertical_text(x,(top+bottom)/2,label,font)
    body=label[:unit.start()]
    usable=bottom-top-34
    body_size=min(size,max(8.0,(usable/max(1,len(body)))*.9))
    body_y=top+usable/2
    unit_y=bottom-7
    return (_vertical_text(x,body_y,body,body_size)
            +_text(x,unit_y,unit.group(1),min(14.0,size)))


def _line(x1: float, y1: float, x2: float, y2: float, cls="grid"):
    return f'<line class="{cls}" x1="{x1:.3f}" y1="{y1:.3f}" x2="{x2:.3f}" y2="{y2:.3f}"/>'


def _rect(x: float, y: float, width: float, height: float, cls="grid-cell"):
    return f'<rect class="{cls}" x="{x:.3f}" y="{y:.3f}" width="{width:.3f}" height="{height:.3f}"/>'


def _wrap(value: Any, max_units: float) -> list[str]:
    source = "" if value is None else str(value)
    if not source:
        return [""]
    lines=[]; current=""; units=0.0
    for char in source:
        if char == "\n":
            lines.append(current); current=""; units=0.0
            continue
        amount=1.0 if ord(char)>255 else 0.56
        if current and units+amount>max_units:
            lines.append(current);current="";units=0.0
        current+=char;units+=amount
    lines.append(current)
    return lines


def _source_raw(record: dict[str, Any], key: str):
    return ((record.get("source") or {}).get("raw") or {}).get(key)


def _display_assay(sample: dict[str, Any], item: dict[str, Any]) -> str:
    code=str(item.get("code") or "")
    raw=(sample.get("assay_raw") or {}).get(code)
    if raw is not None and str(raw).strip():
        return str(raw)
    value=(sample.get("assays") or {}).get(code)
    return _fmt(value,4) if value is not None else ""


def _analysis_items(data: dict[str, Any]) -> list[dict[str, Any]]:
    rows=data.get("project",{}).get("analysis_items") or data.get("analysis_items") or []
    return sorted((item for item in rows if item.get("show",True)),key=lambda item:(item.get("order") is None,item.get("order",0),str(item.get("code") or "")))


def _scale_denominator(data: dict[str, Any]):
    basic=(data.get("basic_info") or {}).get("fields") or {}
    title=(data.get("title_block") or {}).get("fields") or {}
    for source, mapping in (("basic_info",basic),("title_block",title)):
        value=_num(mapping.get("比例尺分母"))
        if value is not None and value>0:
            cells=(data.get("basic_info") or {}).get("source_cells",{}) if source=="basic_info" else (data.get("title_block") or {}).get("source_cells",{})
            return value, {"source":source,"field":"比例尺分母","cell":cells.get("比例尺分母"),"defaulted":False}
    return 100.0, {"source":"default","field":"比例尺分母","cell":None,"defaulted":True}


def _columns(data: dict[str, Any]):
    cols=[]; x=LEFT
    def add(key,label,width=NARROW,*,group="",sub="",kind="data",unit=""):
        nonlocal x
        item={"key":key,"label":label,"x":x,"width":width,"right":x+width,"group":group,"sub":sub,"kind":kind,"unit":unit}
        cols.append(item);x+=width
    add("turn_id","回次",group="turn",kind="single")
    add("turn_from","自",group="turn_advance",sub="自")
    add("turn_to","至",group="turn_advance",sub="至")
    add("turn_advance","进尺（米）",group="turn_advance",sub="进尺（米）")
    add("turn_core","岩芯长（米）",group="turn_core",sub="岩芯长（米）")
    add("turn_rate","采取率（%）",group="turn_core",sub="采取率（%）")
    add("layer_id","层位",group="layer",kind="single")
    add("change_depth","换层深度（米）",group="layer",kind="single")
    add("layer_thickness","分层厚度（米）",group="layer",kind="single")
    add("layer_core","岩芯长（米）",group="layer",kind="single")
    add("layer_rate","分层采取率（%）",group="layer",kind="single")
    add("columnar","柱状图",162,group="columnar",kind="wide")
    add("description","岩性描述",486,group="description",kind="wide")
    add("axis_angle","标志面与岩芯轴的夹角",group="angle",kind="single")
    add("sample_id","样品编号",group="sample",kind="manual")
    add("sample_from","自",group="sample_position",sub="自")
    add("sample_to","至",group="sample_position",sub="至")
    add("sample_length","样长",group="sample_position",sub="样长")
    add("sample_core","岩矿芯长",group="sample",kind="single")
    add("sample_rate","采取率（%）",group="sample",kind="single")
    for item in _analysis_items(data):
        code=item.get("code") or "项目"
        add(f"analysis:{item.get('code')}",code,group="analysis",sub=code,kind="analysis",unit=item.get("unit") or (data.get("project",{}).get("analysis_units") or {}).get(code,""))
    add("structure","钻孔结构",108,group="structure",kind="single")
    add("notes","备注",108,group="notes",kind="single")
    return cols,x-LEFT


def _column_map(columns):
    return {column["key"]:column for column in columns}


def _draw_vertical_header(out, column, top, bottom, text=None, size=20.0):
    x=column["x"];w=column["width"]
    out.append(_rect(x,top,w,bottom-top))
    label=column["label"] if text is None else text
    if column["key"] in {"turn_id","layer_id"}:
        first,second=("回","次") if column["key"]=="turn_id" else ("层","位")
        out.append(_vertical_text(x+w/2,top+25,first,size))
        out.append(_vertical_text(x+w/2,bottom-25,second,size))
    elif column["key"]=="structure":
        out.append(_text(x+w/2,(top+bottom)/2-13,"钻 孔",16.0))
        out.append(_text(x+w/2,(top+bottom)/2+15,"结 构",16.0))
    elif column["key"]=="notes":
        out.append(_text(x+w/2,(top+bottom)/2+5,"备 注",16.0))
    else:
        out.append(_vertical_header_text(x+w/2,top,bottom,label,18.0 if column["key"]=="axis_angle" else size))


def _draw_header(out, columns, width):
    top=HEADER_TOP;bottom=BODY_TOP;group_h=36.0;sub_y=top+group_h
    by_key=_column_map(columns)
    # Single-height columns and the two broad descriptive columns.
    for column in columns:
        key=column["key"]
        if column["kind"]=="single":
            _draw_vertical_header(out,column,top,bottom)
        elif column["kind"]=="wide":
            out.append(_rect(column["x"],top,column["width"],bottom-top))
            out.append(_text(column["x"]+column["width"]/2,top+86,column["label"],20.0))
    def grouped(keys, title, *, sub_labels=None, split_y=None):
        group=[by_key[key] for key in keys]
        gx=group[0]["x"];gr=group[-1]["right"]
        out.append(_line(gx,top,gr,top));out.append(_line(gx,top+group_h,gr,top+group_h));out.append(_line(gx,bottom,gr,bottom))
        out.append(_line(gx,top,gx,bottom));out.append(_line(gr,top,gr,bottom))
        out.append(_text((gx+gr)/2,top+24,title,20.0))
        if split_y is None:
            for column,label in zip(group,sub_labels or [c["label"] for c in group]):
                out.append(_line(column["x"],top+group_h,column["x"],bottom))
                out.append(_vertical_header_text(column["x"]+column["width"]/2,top+group_h,bottom,label,20.0))
        else:
            out.append(_line(gx,split_y,gr,split_y))
            for column in group:
                out.append(_line(column["x"],top+group_h,column["x"],bottom))
            # First cell keeps its label through the lower levels; remaining items are vertical.
            first,last=group[0],group[-1]
            out.append(_vertical_text(first["x"]+first["width"]/2,(top+group_h+split_y)/2,first["label"],12.0))
            for column,label in zip(group[1:],sub_labels or [c["label"] for c in group[1:]]):
                out.append(_vertical_header_text(column["x"]+column["width"]/2,split_y,bottom,label,20.0))
            out.append(_line(first["right"],top+group_h,first["right"],bottom))
    grouped(["turn_from","turn_to","turn_advance"],"回次进尺（米）")
    grouped(["turn_core","turn_rate"],"岩芯采取")
    sample_keys=["sample_id","sample_from","sample_to","sample_length"]
    sample_group=[by_key[k] for k in sample_keys]
    gx=sample_group[0]["x"];gr=sample_group[-1]["right"]
    px=by_key["sample_from"]["x"];pr=by_key["sample_length"]["right"]
    out.extend([_line(gx,top,gr,top),_line(px,top+group_h,gr,top+group_h),_line(px,top+80,pr,top+80),_line(gx,bottom,gr,bottom),_line(gx,top,gx,bottom),_line(gr,top,gr,bottom)])
    out.append(_text((gx+gr)/2,top+24,"采 样 情 况",20.0))
    out.append(_line(by_key["sample_from"]["x"],top+group_h,by_key["sample_from"]["x"],bottom))
    out.append(_vertical_header_text(by_key["sample_id"]["x"]+NARROW/2,top+group_h,bottom,"样品编号",20.0))
    out.append(_text((px+pr)/2,top+62,"采样位置（米）",16.0))
    for key,label in (("sample_from","自"),("sample_to","至"),("sample_length","样长")):
        column=by_key[key];out.append(_line(column["x"],top+80,column["x"],bottom));out.append(_vertical_header_text(column["x"]+NARROW/2,top+80,bottom,label,20.0))
    analysis=[c for c in columns if c["group"]=="analysis"]
    if analysis:
        gx=analysis[0]["x"];gr=analysis[-1]["right"]
        out.extend([_line(gx,top,gr,top),_line(gx,top+group_h,gr,top+group_h),_line(gx,bottom,gr,bottom),_line(gx,top,gx,bottom),_line(gr,top,gr,bottom)])
        out.append(_text((gx+gr)/2,top+24,"分析结果",20.0))
        for column in analysis:
            out.append(_line(column["x"],top+group_h,column["x"],bottom))
            out.append(_text(column["x"]+column["width"]/2,top+group_h+30,column["label"],_fit_font(column["label"],column["width"]-6,20.0)))
            if column.get("unit"):
                unit=column["unit"]
                out.append(_text(column["x"]+column["width"]/2,bottom-8,unit,_fit_font(unit,column["width"]-6,11.0)))
    # The table perimeter makes the fixed header/body join explicit.
    out.extend([_line(LEFT,top,LEFT+width,top),_line(LEFT,bottom,LEFT+width,bottom)])


def _pattern_defs(pattern_data):
    out=[]
    for key,pattern in pattern_data.get("patterns",{}).items():
        width=float(pattern.get("width",74));height=float(pattern.get("height",24));svg=pattern.get("svg","")
        out.append(f'<pattern id="p-{_e(key)}" patternUnits="userSpaceOnUse" width="{width:.2f}" height="{height:.2f}">{svg}</pattern>')
    return "".join(out)


def _bottom_panels(data, canvas_x, body_bottom, table_width, scale_denominator):
    depth=(data.get("depth_measurements") or {}).get("records") or []
    title=(data.get("title_block") or {}).get("fields") or {}
    left_records=[r for r in depth if any(r.get(k) is not None for k in ("recorded_depth_m","checked_depth_m","error_m","error_percent"))]
    curve_records=[r for r in depth if any(r.get(k) is not None for k in ("measurement_depth_m","azimuth_deg","zenith_deg"))]
    left_w=table_width*.365;middle_w=table_width*.31;right_w=table_width*.243
    left_gap=table_width*.014;right_gap=table_width-(left_w+middle_w+right_w+left_gap)
    left_x=canvas_x;middle_x=left_x+left_w+left_gap;right_x=left_x+table_width-right_w
    title_y=body_bottom+70.0;head_y=body_bottom+90.0;row_h=32.0
    out=[];panels=[]

    def draw_table(kind,title_text,x,width,records,headers,header_rows,field_keys,values_fn):
        out.append(_text(x+width/2,title_y,title_text,20.0,weight="normal",cls="panel-title"))
        header_h=sum(row[0] for row in header_rows);bottom=head_y+header_h+len(records)*row_h
        # Proportional widths keep every fixed table within its assigned reference region.
        proportions=([.13,.25,.25,.20,.17] if kind=="depth_measurements" else [.12,.28,.22,.20,.18])
        widths=[width*p for p in proportions];edges=[x]
        for col_w in widths:edges.append(edges[-1]+col_w)
        out.append(_rect(x,head_y,width,header_h))
        if kind=="depth_measurements":
            group_bottom=head_y+32
            out.append(_line(edges[1],group_bottom,edges[3],group_bottom))
            out.append(_text((edges[1]+edges[3])/2,head_y+22,"孔深校正",16.0))
            out.append(_text((edges[0]+edges[1])/2,head_y+header_h/2+5,"序号",16.0))
            out.append(_text((edges[3]+edges[4])/2,head_y+header_h/2+5,"误差（米）",16.0))
            out.append(_text((edges[4]+edges[5])/2,head_y+header_h/2+5,"误差率（‰）",16.0))
            out.append(_text((edges[1]+edges[2])/2,group_bottom+22,"记录孔深（米）",16.0))
            out.append(_text((edges[2]+edges[3])/2,group_bottom+22,"校正孔深（米）",16.0))
            out.append(_line(edges[2],group_bottom,edges[2],bottom))
            for edge in (edges[0],edges[1],edges[3],edges[4],edges[5]):out.append(_line(edge,head_y,edge,bottom))
        else:
            for idx,label in enumerate(headers):
                out.append(_text((edges[idx]+edges[idx+1])/2,head_y+22,label,16.0))
            for edge in edges:out.append(_line(edge,head_y,edge,bottom))
        out.append(_line(x,head_y,x+width,head_y));out.append(_line(x,head_y+header_h,x+width,head_y+header_h))
        rows=[]
        for idx,record in enumerate(records,1):
            cy=head_y+header_h+(idx-.5)*row_h
            values,derived=values_fn(record,idx)
            row_src=[]
            for col_idx,value in enumerate(values):
                digits=(3 if (kind=="depth_measurements" and col_idx in (2,3,4)) or (kind=="bending_measurements" and col_idx==1) else 2)
                label="" if value is None else (str(value) if col_idx==0 else _fmt(value,digits))
                out.append(_text((edges[col_idx]+edges[col_idx+1])/2,cy+5,label,16.0))
                row_src.append({"value":value,"source":((record.get("source") or {}).get("cells") or {}).get(field_keys[col_idx])})
            yline=head_y+header_h+idx*row_h
            out.append(_line(x,yline,x+width,yline))
            rows.append({"sequence":record.get("sequence",idx),"values":values,"source":record.get("source"),"fields":row_src,"tilt_derived":derived})
        panel_bounds={"x":x,"y":title_y,"width":width,"height":20+(bottom-head_y)}
        panels.append({"kind":kind,"title":title_text,"bounds":panel_bounds,"rows":rows,"headers":headers,
                       "header_height":header_h,"tilt_derivation":"倾角=90°−天顶角" if kind=="bending_measurements" else None})
        return bottom

    def depth_values(record,idx):
        pct=_num(record.get("error_percent"))
        return [_sequence(record.get("sequence"),idx),record.get("recorded_depth_m"),record.get("checked_depth_m"),record.get("error_m"),pct*10 if pct is not None else None],False
    def curve_values(record,idx):
        zenith=_num(record.get("zenith_deg"));tilt=90-zenith if zenith is not None else None
        return [_sequence(record.get("sequence"),idx),record.get("checked_depth_m"),record.get("azimuth_deg"),tilt,record.get("zenith_deg")],zenith is not None

    left_bottom=draw_table("depth_measurements","孔深校正记录表",left_x,left_w,left_records,
        ["序号","记录孔深（米）","校正孔深（米）","误差（米）","误差率（‰）"],[(32,),(32,)],
        ["sequence","记录孔深_m","校测孔深_m","误差_m","误差率_pct"],depth_values)
    middle_bottom=draw_table("bending_measurements","弯曲度测量表",middle_x,middle_w,curve_records,
        ["序号","校正孔深（米）","方位角（°）","倾角（°）","天顶角（°）"],[(32,)],
        ["sequence","校测孔深_m","实测方位角_deg","derived_tilt_deg","测量天顶角_deg"],curve_values)

    title_rows=[
        [("单位",title.get("项目/单位") or data.get("project",{}).get("name"))],
        [("图名",title.get("图名") or f'{data.get("meta",{}).get("hole_id","")}钻孔柱状图')],
        [("拟编",title.get("拟编")),("顺序号",title.get("顺序号"))],[("审核",title.get("审核")),("图号",title.get("图号"))],
        [("制图",title.get("制图")),("比例尺",f'1:{_fmt(scale_denominator,0)}')],[("项目负责",title.get("项目负责")),("日期",title.get("日期"))],
        [("单位负责",title.get("单位负责")),("资料来源",title.get("资料来源"))],
    ]
    title_row_h=32.0;label_w=min(86.0,right_w*.24);title_bottom=head_y+len(title_rows)*title_row_h
    for row_idx,row in enumerate(title_rows):
        yy=head_y+row_idx*title_row_h;out.append(_rect(right_x,yy,right_w,title_row_h))
        if len(row)==1:
            out.append(_text(right_x+right_w/2,yy+21,row[0][1],_fit_font(row[0][1],right_w-12,16),anchor="middle"))
        else:
            half=right_w/2
            for j,(label,value) in enumerate(row):
                xx=right_x+j*half
                out.append(_line(xx+label_w,yy,xx+label_w,yy+title_row_h))
                out.append(_text(xx+label_w/2,yy+21,label,16.0))
                if label=="日期":value=_friendly_date(value)
                out.append(_text(xx+label_w+(half-label_w)/2,yy+21,value,_fit_font(value,half-label_w-8,16)))
    panels.append({"kind":"title_block","title":"","bounds":{"x":right_x,"y":head_y,"width":right_w,"height":len(title_rows)*title_row_h},
                   "rows":[{"values":[pair[1] for pair in row],"fields":[{"key":pair[0],"value":pair[1],"source":(data.get("title_block",{}).get("source_cells") or {}).get(pair[0])} for pair in row]} for row in title_rows]})
    return out,panels,max(left_bottom,middle_bottom,title_bottom)+24


def render_reference_drill_svg(data: dict[str, Any], *, detail: bool = False):
    endpoint=float(data["meta"]["endpoint_m"])
    hi=min(endpoint,45.0) if detail else endpoint
    scale_denominator,scale_source=_scale_denominator(data)
    scale=SCALE_100*(100.0/scale_denominator)
    cols,table_width=_columns(data);by_key=_column_map(cols)
    table_right=LEFT+table_width
    body_bottom=BODY_TOP+hi*scale
    title_fields=(data.get("title_block") or {}).get("fields") or {}
    basic=(data.get("basic_info") or {}).get("fields") or {}
    hole_id=data["meta"].get("hole_id","")
    title_text=title_fields.get("图名")
    if not title_text:
        title_text=" ".join(str(value) for value in (basic.get("矿区"),data.get("project",{}).get("name"),hole_id) if value) + "钻孔柱状图"
    width=table_width+LEFT*2
    height_tmp=body_bottom+320.0
    bottom_svg,panels,height=_bottom_panels(data,LEFT,body_bottom,table_width,scale_denominator)
    height=max(height,height_tmp if not panels else height)
    chart_width=math.ceil(width)
    chart_height=math.ceil(height)
    out=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{chart_width}" height="{chart_height}" viewBox="0 0 {width:.3f} {height:.3f}">',
         '<defs>',_pattern_defs(json.loads(PATTERN_PATH.read_text(encoding="utf-8"))),'</defs>',
         f'<style>text{{font-family:{FONT};fill:#111;stroke:none}}.grid{{stroke:#111;stroke-width:.65;fill:none;vector-effect:non-scaling-stroke}}.grid-cell{{stroke:#111;stroke-width:.65;fill:#fff;vector-effect:non-scaling-stroke}}.body-grid{{stroke:#111;stroke-width:.55;fill:none;vector-effect:non-scaling-stroke}}.pattern-border{{stroke:#111;stroke-width:.65;fill:none;vector-effect:non-scaling-stroke}}.title{{font-family:{FONT};fill:#111}}.panel-title{{font-family:{FONT};fill:#111}}</style>',
         '<rect x="0" y="0" width="100%" height="100%" fill="white"/>']
    # Title and the three compact metadata groups from the fixed reference.
    out.append(_text(width/2,62,title_text,48.0,weight="normal",cls="title"))
    out.append(_text(width/2,100,f'比例尺 1:{_fmt(scale_denominator,0)}',20.0,cls="title"))
    left_meta=[("开孔日期",_friendly_date(basic.get("开孔日期"))),("终孔日期",_friendly_date(basic.get("终孔日期")),),("孔深",f'{_fmt(endpoint,2)}m')]
    mid_meta=[("孔口坐标",f'X={_fmt(basic.get("X坐标_m"),1)}'),("",f'Y={_fmt(basic.get("Y坐标_m"),1)}'),("",f'H={_fmt(basic.get("孔口标高_m"),1)}m')]
    right_meta=[("钻孔方位",basic.get("设计方位角_deg")),("钻孔倾角",basic.get("倾角_deg"))]
    for i,(label,value) in enumerate(left_meta):out.append(_text(LEFT+4,166+i*35,f'{label}：{value if value is not None else ""}',20.0,anchor="start"))
    for i,(label,value) in enumerate(mid_meta):out.append(_text(width/2,166+i*35,f'{(label+"：") if label else ""}{value if value is not None else ""}',20.0))
    right_x=width-LEFT-4
    for i,(label,value) in enumerate(right_meta):out.append(_text(right_x,176+i*64,f'{label}：{value if value is not None else ""}°',20.0,anchor="end"))
    _draw_header(out,cols,table_width)
    y=lambda depth:BODY_TOP+depth*scale
    # All verticals continue from the header to the fixed-scale hole bottom.
    out.append(_line(LEFT,HEADER_TOP,LEFT,body_bottom))
    for column in cols:
        out.append(_line(column["x"],BODY_TOP,column["x"],body_bottom))
    out.append(_line(table_right,BODY_TOP,table_right,body_bottom))
    out.append(_line(LEFT,body_bottom,table_right,body_bottom))
    # Columnar subgrid: pattern body, left gutter and the narrow sample mark rail.
    lith=by_key["columnar"];out.append(_line(lith["x"]+27,BODY_TOP,lith["x"]+27,body_bottom));out.append(_line(lith["x"]+125,BODY_TOP,lith["x"]+125,body_bottom))
    patterns=json.loads(PATTERN_PATH.read_text(encoding="utf-8"));pattern_codes=patterns.get("codes",{});materials=patterns.get("materials",{})
    layers=[row for row in data.get("layers",[]) if float(row["bottom_m"])>=0 and float(row["top_m"])<=hi]
    layer_audit=[]
    for layer in layers:
        top=max(0.0,float(layer["top_m"]));bottom=min(hi,float(layer["bottom_m"]));top_y=y(top);bottom_y=y(bottom)
        material=layer.get("material_code") or materials.get(layer.get("lithology_name"),"")
        pattern=layer.get("pattern_id") or pattern_codes.get(material)
        fill=f'url(#p-{_e(pattern)})' if pattern else "white"
        out.append(f'<rect x="{lith["x"]+27:.3f}" y="{top_y:.3f}" width="98" height="{max(0,bottom_y-top_y):.3f}" fill="{fill}"/>')
        out.append(_line(by_key["layer_id"]["x"],bottom_y,by_key["description"]["right"],bottom_y,"body-grid"))
        bottom_text_y=max(top_y+12,bottom_y-3)
        vals={"layer_id":layer.get("id"),"change_depth":layer.get("bottom_m"),"layer_thickness":layer.get("thickness_m"),"layer_core":layer.get("core_m"),"layer_rate":layer.get("recovery_percent"),"axis_angle":layer.get("mean_axis_angle_deg")}
        for key,value in vals.items():
            if key not in by_key:continue
            column=by_key[key]
            display=("" if value is None else str(value)) if key == "layer_id" else _fmt(value,2)
            out.append(_text(column["x"]+column["width"]/2,bottom_text_y,display,_fit_font(display,column["width"]-4)))
        desc="、".join(str(part) for part in (layer.get("id"),layer.get("lithology_name")) if part not in (None,""))
        if layer.get("description"): desc += "\n" + str(layer["description"])
        lines=_wrap(desc,486/14.0)
        for li,line in enumerate(lines):
            baseline=top_y+16+li*16
            out.append(_text(by_key["description"]["x"]+8,baseline,line,14.0,anchor="start"))
        layer_audit.append({"id":layer.get("id"),"top_m":layer["top_m"],"bottom_m":layer["bottom_m"],"plotted_top_m":top,"plotted_bottom_m":bottom,
                            "plotted_top_y":top_y,"plotted_bottom_y":bottom_y,"source":layer.get("source",{}),"pattern_code":material or None})
    # Row rules and values follow their own depth positions, not a shared adaptive ledger.
    turns=[row for row in data.get("turns",[]) if float(row["bottom_m"])>=0 and float(row["top_m"])<=hi]
    turn_left=by_key["turn_id"]["x"];turn_right=by_key["turn_rate"]["right"]
    turn_audit=[]
    for turn in turns:
        top=max(0.0,float(turn["top_m"]));bottom=min(hi,float(turn["bottom_m"]));mid=(top+bottom)/2;y_mid=y(mid)
        out.append(_line(turn_left,y(top),turn_right,y(top),"body-grid"));out.append(_line(turn_left,y(bottom),turn_right,y(bottom),"body-grid"))
        vals={"turn_id":turn.get("id"),"turn_from":turn.get("top_m"),"turn_to":turn.get("bottom_m"),"turn_advance":_source_raw(turn,"回次进尺_m"),"turn_core":turn.get("core_m"),"turn_rate":turn.get("recovery_percent")}
        for key,value in vals.items():
            column=by_key[key];display=_fmt(value,2);out.append(_text(column["x"]+column["width"]/2,y_mid+4,display,_fit_font(display,column["width"]-4)))
        turn_audit.append({"id":turn.get("id"),"top_m":turn.get("top_m"),"bottom_m":turn.get("bottom_m"),"top_y":y(top),"bottom_y":y(bottom),"source":turn.get("source",{})})
    full_samples=sorted(enumerate(data.get("samples",[])),key=lambda pair:(float(pair[1]["top_m"]),float(pair[1]["bottom_m"]),pair[0]))
    sample_order={id(row):order for order,(_,row) in enumerate(full_samples)}
    samples=[row for _,row in full_samples if float(row["bottom_m"])>=0 and float(row["top_m"])<=hi]
    sample_audit=[]
    for sample in samples:
        top=max(0.0,float(sample["top_m"]));bottom=min(hi,float(sample["bottom_m"]));mid=(top+bottom)/2;y_mid=y(mid)
        sample_left=by_key["sample_id"]["x"]
        analysis_cols=[column for column in cols if column["key"].startswith("analysis:")]
        sample_right=analysis_cols[-1]["right"] if analysis_cols else by_key["sample_rate"]["right"]
        out.append(_line(sample_left,y(top),sample_right,y(top),"body-grid"));out.append(_line(sample_left,y(bottom),sample_right,y(bottom),"body-grid"))
        values={"sample_id":sample.get("id"),"sample_from":sample.get("top_m"),"sample_to":sample.get("bottom_m"),"sample_length":_source_raw(sample,"进尺_m"),"sample_core":sample.get("core_m"),"sample_rate":sample.get("recovery_percent")}
        for key,value in values.items():
            column=by_key[key];display=_fmt(value,2);out.append(_text(column["x"]+column["width"]/2,y_mid+4,display,_fit_font(display,column["width"]-4)))
        for item in _analysis_items(data):
            key=f'analysis:{item.get("code")}';column=by_key[key]
            display=_display_assay(sample,item)
            out.append(_text(column["x"]+column["width"]/2,y_mid+4,display,_fit_font(display,column["width"]-4)))
        # The small sample interval and its identifier stay within the columnar right rail.
        full_order=sample_order[id(sample)]
        segment_fill="#fff" if full_order%2==0 else "#111"
        segment_stroke=' stroke="#111" stroke-width="0.35"' if segment_fill=="#fff" else ""
        segment_y=y(top);segment_height=y(bottom)-segment_y
        out.append(f'<rect x="{lith["x"]+126:.2f}" y="{segment_y:.3f}" width="5" height="{segment_height:.3f}" fill="{segment_fill}"{segment_stroke}/>')
        sample_rail_label=sample.get("id")
        sample_label_units=sum(1.0 if ord(ch)>255 else .56 for ch in str(sample_rail_label or ""))
        sample_label_x=lith["x"]+134
        sample_label_font=min(11.0 if sample_label_units*14>25 else 14.0,max(.1,segment_height*.65))
        sample_label_y=y_mid+sample_label_font*.32
        if sample_label_units*sample_label_font>25:
            out.append(f'<text class="cell-text sample-rail-label" data-sample-id="{_e(sample_rail_label)}" x="{sample_label_x:.2f}" y="{sample_label_y:.2f}" text-anchor="start" font-size="{sample_label_font:.2f}" textLength="25" lengthAdjust="spacingAndGlyphs">{_e(sample_rail_label)}</text>')
        else:
            out.append(f'<text class="cell-text sample-rail-label" data-sample-id="{_e(sample_rail_label)}" x="{sample_label_x:.2f}" y="{sample_label_y:.2f}" text-anchor="start" font-size="{sample_label_font:.2f}">{_e(sample_rail_label)}</text>')
        sample_audit.append({"id":sample.get("id"),"top_m":sample.get("top_m"),"bottom_m":sample.get("bottom_m"),"plotted_top_m":top,"plotted_bottom_m":bottom,"full_hole_order":full_order,"segment_fill":segment_fill,
                             "top_y":y(top),"bottom_y":y(bottom),"label_y":y_mid,"assay_values":{item.get("code"):((sample.get("assay_raw") or {}).get(item.get("code")) if str((sample.get("assay_raw") or {}).get(item.get("code"),"")).strip() else (sample.get("assays") or {}).get(item.get("code"))) for item in _analysis_items(data)},"source":sample.get("source",{})})
    structures=[r for r in data.get("structures",[]) if 0<=float(r["depth_m"])<=hi]
    structure_audit=[]
    structure_col=by_key["structure"]
    for record in structures:
        yy=y(float(record["depth_m"]));out.append(_line(structure_col["x"]+14,yy,structure_col["right"]-14,yy,"body-grid"))
        structure_label=f'{_fmt(record.get("diameter_mm"),2)} mm'
        out.append(_text(structure_col["x"]+structure_col["width"]/2,yy-3,structure_label,_fit_font(structure_label,structure_col["width"]-4)))
        structure_audit.append({"depth_m":record.get("depth_m"),"diameter_mm":record.get("diameter_mm"),"y":yy,"source":record.get("source",{})})
    if not detail:
        out.append(_text(structure_col["x"]+structure_col["width"]/2,body_bottom-3,f'{_fmt(endpoint,2)}m',10.0))
    bottom_svg,panels,canvas_height=_bottom_panels(data,LEFT,body_bottom,table_width,scale_denominator)
    out.extend(bottom_svg)
    out.append("</svg>")
    curve_rows=sum(1 for r in (data.get("depth_measurements") or {}).get("records",[]) if any(r.get(k) is not None for k in ("measurement_depth_m","azimuth_deg","zenith_deg")))
    depth_rows=sum(1 for r in (data.get("depth_measurements") or {}).get("records",[]) if any(r.get(k) is not None for k in ("recorded_depth_m","checked_depth_m","error_m","error_percent")))
    audit={
        "hole_id":hole_id,"endpoint_m":endpoint,"depth_basis":data["meta"].get("depth_basis"),"scale_units_per_meter":scale,
        "scale_denominator":scale_denominator,"scale_source":scale_source,"minimum_depth_height_units":0,
        "view_depth_m":[0.0,hi],"viewBox":[0.0,0.0,width,canvas_height],
        "counts":{"layers":len(data.get("layers",[])),"turns":len(data.get("turns",[])),"samples":len(data.get("samples",[]))},
        "structure_count":len(structures),"sample_lane_count":1 if samples else 0,"sample_lanes":{},
        "layers":layer_audit,"samples":sample_audit,"structures":structure_audit,
        "turns_independent_equal_height_ledger":False,"turn_records":turn_audit,
        "basic_info":{"present":bool(basic),"fields":basic,"source_cells":(data.get("basic_info") or {}).get("source_cells",{})},
        "metadata":{"present":True,"within_canvas":True,"panels":panels},"metadata_viewport_extended":True,
        "canvas_bounds":{"viewBox":[0.0,0.0,width,canvas_height],"metadata_within_canvas":True,"basic_info_within_canvas":True},
        "detail_crop_is_not_geologic_boundary":bool(detail and hi<endpoint-1e-9),"svg_image_elements":0,"source_values_rounded_for_display_only":True,
        "pending_patterns":[row.get("id") for row in data.get("layers",[]) if not (row.get("material_code") or materials.get(row.get("lithology_name")))],
        "fixed_reference_layout":{"table_x":LEFT,"header_y":HEADER_TOP,"header_height":HEADER_HEIGHT,"body_top":BODY_TOP,
            "table_width":table_width,"canvas_width":width,"scale_units_per_meter":scale,"analysis_count":len(_analysis_items(data)),
            "columns":[{"key":c["key"],"label":c["label"],"x":c["x"],"width":c["width"],"right":c["right"]} for c in cols],
            "bottom_table_counts":{"depth_correction":depth_rows,"bending":curve_rows}},
    }
    return "".join(out),audit
