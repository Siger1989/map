#!/usr/bin/env python3
"""Render a traceable ZK0003 drill-log demo from the independent extracted JSON."""
from __future__ import annotations

import hashlib
import html
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "zk0003-data.json"
SCALE = 9.0                 # Full figure units per along-hole meter
DETAIL_SCALE = 25.0         # Detail figure units per along-hole meter
TOP = 170.0
BOTTOM_DEPTH = 382.79
WIDTH = 2680.0


def esc(s):
    return html.escape(str(s), quote=True)


def n(v, digits=2):
    if isinstance(v, dict):
        v = v.get("value")
    if v is None:
        return ""
    return f"{float(v):.{digits}f}"


def y(depth, scale=SCALE, top=TOP):
    return top + float(depth) * scale


def text(x, yy, value, size=13, anchor="start", weight="normal", cls=""):
    width = sum(size * (0.98 if ord(ch) > 255 else 0.56) for ch in str(value))
    left = x - width if anchor == "end" else (x - width / 2 if anchor == "middle" else x)
    bbox = f"{left:.2f},{yy-size:.2f},{width:.2f},{size*1.25:.2f}"
    return (f'<text x="{x}" y="{yy:.2f}" font-size="{size}" text-anchor="{anchor}" '
            f'font-weight="{weight}" class="{cls}" data-layout-kind="text" data-bbox="{bbox}">{esc(value)}</text>')


def line(x1, y1, x2, y2, cls="rule"):
    return f'<line x1="{x1}" y1="{y1:.2f}" x2="{x2}" y2="{y2:.2f}" class="{cls}"/>'


def text_bbox(x, baseline, value, size, anchor="start"):
    width = sum(size * (0.98 if ord(ch) > 255 else 0.56) for ch in str(value))
    left = x - width if anchor == "end" else (x - width / 2 if anchor == "middle" else x)
    return [round(left, 2), round(baseline - size, 2), round(width, 2), round(size * 1.25, 2)]


def wrap_text(value, max_chars):
    value = str(value or "")
    if not value:
        return [""]
    return [value[i:i + max_chars] for i in range(0, len(value), max_chars)]


def desc_positions(layers, scale=SCALE, top=TOP, lo=0.0, hi=BOTTOM_DEPTH):
    """Place complete wrapped descriptions in ordered rows with non-overlapping boxes."""
    ordered = sorted(layers, key=lambda z: (z["top_m"] + z["bottom_m"]) / 2)
    visible = [z for z in ordered if z["bottom_m"] >= lo and z["top_m"] <= hi]
    anchors = [y((max(lo,z["top_m"]) + min(hi,z["bottom_m"])) / 2, scale, top) for z in visible]
    wrapped = {z["id"]: wrap_text(z.get("description", ""), 36) for z in visible}
    heights = [max(38.0, len(wrapped[z["id"]]) * 16.0 + 22.0) for z in visible]
    placed = anchors[:]
    for i in range(1, len(placed)):
        placed[i] = max(placed[i], placed[i - 1] + (heights[i - 1] + heights[i]) / 2 + 6)
    lower, upper = y(lo, scale, top) + 10, y(hi, scale, top) - 16
    if placed and placed[-1] + heights[-1] / 2 > upper:
        shift = placed[-1] + heights[-1] / 2 - upper
        placed = [p - shift for p in placed]
        for i in range(len(placed) - 2, -1, -1):
            placed[i] = min(placed[i], placed[i + 1] - (heights[i] + heights[i + 1]) / 2 - 6)
    if placed and placed[0] - heights[0] / 2 < lower:
        placed[0] = lower + heights[0] / 2
        for i in range(1, len(placed)):
            placed[i] = max(placed[i], placed[i - 1] + (heights[i - 1] + heights[i]) / 2 + 6)
    return {z["id"]: {"anchor_y": a, "label_y": p, "lines": wrapped[z["id"]], "height": h}
            for z, a, p, h in zip(visible, anchors, placed, heights)}


def sample_positions(samples, lo, hi, scale=SCALE, top=TOP):
    visible = [s for s in samples if float(s["bottom_m"]) >= lo and float(s["top_m"]) <= hi]
    if not visible:
        return {}
    anchors = [y((float(s["top_m"]) + float(s["bottom_m"])) / 2, scale, top) for s in visible]
    placed = anchors[:]
    gap = 22.05
    for i in range(1, len(placed)):
        placed[i] = max(placed[i], placed[i - 1] + gap)
    lower, upper = y(lo, scale, top) + 10, y(hi, scale, top) - 8
    if placed[-1] > upper:
        shift = placed[-1] - upper
        placed = [p - shift for p in placed]
        for i in range(len(placed) - 2, -1, -1):
            placed[i] = min(placed[i], placed[i + 1] - gap)
    if placed[0] < lower:
        placed[0] = lower
        for i in range(1, len(placed)):
            placed[i] = max(placed[i], placed[i - 1] + gap)
    return {s["id"]: {"anchor_y": a, "label_y": p, "moved": a != p}
            for s, a, p in zip(visible, anchors, placed)}


def load_patterns():
    path = ROOT / "reference-patterns.json"
    if not path.exists():
        return {}, {}, "missing"
    raw = path.read_bytes()
    config = json.loads(raw.decode("utf-8-sig"))
    defs, layer_map = [], {}
    for layer_id, pattern_id in config.get("layer_patterns", {}).items():
        pattern = config.get("patterns", {}).get(pattern_id, {})
        if pattern.get("reference_status") != "visual_match":
            continue
        width, height = int(pattern.get("tile_width", 0)), int(pattern.get("tile_height", 0))
        fragment = pattern.get("svg_fragment", "")
        if not (1 <= width <= 100 and 1 <= height <= 100):
            continue
        try:
            wrapper = ET.fromstring(f"<svg>{fragment}</svg>")
        except ET.ParseError:
            continue
        allowed_tags = {"g", "path", "circle", "ellipse"}
        allowed_attrs = {"fill", "stroke", "stroke-width", "d", "cx", "cy", "r", "rx", "ry", "transform"}
        safe = True
        for node in wrapper.iter():
            if node is wrapper:
                continue
            if node.tag not in allowed_tags or any(a not in allowed_attrs for a in node.attrib):
                safe = False
                break
            if "transform" in node.attrib and not re.fullmatch(r"(?:translate|rotate|scale)\([0-9., +\-]+\)", node.attrib["transform"]):
                safe = False
                break
            if any("url(" in str(v).lower() or "javascript:" in str(v).lower() for v in node.attrib.values()):
                safe = False
                break
        if not safe:
            continue
        safe_fragment = "".join(ET.tostring(ch, encoding="unicode") for ch in wrapper)
        pid = f"confirmed-layer-{layer_id}"
        defs.append(f'<pattern id="{pid}" width="{width}" height="{height}" patternUnits="userSpaceOnUse">{safe_fragment}</pattern>')
        layer_map[str(layer_id)] = {"pattern_id": pattern_id, "svg_id": pid, "label": pattern.get("label", ""), "source_image": pattern.get("source_image"), "reference_status": pattern.get("reference_status")}
    return layer_map, defs, hashlib.sha256(raw).hexdigest()


def make_svg(data, detail=False):
    pattern_map, pattern_defs, _ = load_patterns()
    lo, hi = (0.0, 45.0) if detail else (0.0, BOTTOM_DEPTH)
    scale = DETAIL_SCALE if detail else SCALE
    top0 = TOP
    yy = lambda d: y(d, scale, top0)
    view_top, view_bottom = yy(lo), yy(hi)
    footer_y = view_bottom + 80
    view_h = footer_y + 85
    title = "ZK0003钻孔柱状示图·底稿数据" + ("（0–45 m局部）" if detail else "")
    # All geometry uses this figure's own linear along-hole scale; the local view has no depth compression.
    cols = {"axis": 55, "turn": 135, "turn_end": 590, "layer": 625, "lith": 840,
            "desc": 950, "sample": 1480, "samplelist": 1545, "assay": 2200, "structure": 2420}
    body_top = view_top
    body_bottom = view_bottom
    turns = [t for t in data["turns"] if float(t["bottom_m"]) >= lo and float(t["top_m"]) <= hi]
    out = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{int(WIDTH)}" height="{math.ceil(view_h)}" viewBox="0 0 {WIDTH} {view_h:.2f}" role="img" aria-labelledby="ttl">
<title id="ttl">{esc(title)}</title><defs><style>
text{{font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif;fill:#111}} .rule{{stroke:#444;stroke-width:.7}} .major{{stroke:#111;stroke-width:1.2}} .fine{{stroke:#999;stroke-width:.55}} .leader{{stroke:#555;stroke-width:.65;fill:none}} .sample-range{{stroke:#111;stroke-width:2;fill:none}} .boundary{{stroke:#222;stroke-width:1}}
</style>{''.join(pattern_defs)}</defs><rect x="0" y="0" width="{WIDTH}" height="{view_h:.2f}" fill="white"/>''']
    out += [text(35, 35, title, 25, weight="bold"),
            text(35, 59, f"未校正孔深 382.79 m　·　本图 {len(turns)} 回次 / 全孔131回次、23层、97样", 14),
            text(35, 80, "纵轴为沿孔测量深度；回次独立排列。原图1:100与图签1:500冲突，图中不标打印比例。", 12)]
    # Headings and column separators
    headings = [(cols["axis"], "孔深(m)"), (cols["turn"], "回次记录（独立列表）"),
                (cols["layer"], "分层段"), (cols["lith"], "岩性柱"), (cols["desc"], "岩性描述"),
                (cols["sample"], "样品区间"), (cols["samplelist"], "样品明细（引线对应区间）"),
                (cols["assay"], "Au / Pb / Zn"), (cols["structure"], "孔径结构")]
    for x, label in headings:
        out.append(text(x, TOP - 22, label, 13, weight="bold"))
    # Depth axis with exact terminal tick. Figure headers are above the viewBox crop.
    axisx = cols["axis"] + 35
    out.append(line(axisx, body_top, axisx, body_bottom, "major"))
    tick = int(lo // 5 * 5)
    while tick <= hi:
        if tick >= lo:
            py = yy(tick)
            out += [line(axisx - (8 if tick % 10 == 0 else 4), py, axisx + 5, py, "major" if tick % 10 == 0 else "fine"),
                    text(axisx - 12, py + 4, f"{tick:.0f}", 11, "end")]
        tick += 5
    if hi == BOTTOM_DEPTH:
        out += [line(axisx - 8, yy(BOTTOM_DEPTH), axisx + 5, yy(BOTTOM_DEPTH), "major"),
                text(axisx - 12, yy(BOTTOM_DEPTH) + 4, "382.79", 11, "end")]
    # Equal-height independent turn rows; a detail shows only turns intersecting its depth range.
    turn_step = (body_bottom - body_top) / max(1, len(turns))
    for i, t in enumerate(turns):
        row_top = body_top + i * turn_step
        center = row_top + turn_step / 2
        row = f"{int(t['id']):03d}  {n(t['top_m'])}–{n(t['bottom_m'])}  进尺{n(t['advance_m'])}  芯{n(t['core_m'])}  采取率{n(t['recovery_percent'])}%"
        out.append(text(cols["turn"], center + 4, row, 12))
        out.append(line(cols["turn"] - 7, row_top + turn_step, cols["turn_end"], row_top + turn_step, "fine"))
    # Layer-depth labels live in their own column; description rows wrap and avoid each other.
    descpos = desc_positions(data["layers"], scale, top0, lo, hi)
    for layer in data["layers"]:
        top, bottom = float(layer["top_m"]), float(layer["bottom_m"])
        if bottom < lo or top > hi:
            continue
        yt, yb = yy(max(top, lo)), yy(min(bottom, hi))
        out += [f'<rect x="{cols["lith"]}" y="{yt:.2f}" width="74" height="{max(0,yb-yt):.2f}" fill="url(#{pattern_map.get(str(layer["id"]),{}).get("svg_id", "")})"/>' if str(layer["id"]) in pattern_map else
                f'<rect x="{cols["lith"]}" y="{yt:.2f}" width="74" height="{max(0,yb-yt):.2f}" fill="white"/>',
                line(cols["lith"], yt, cols["lith"], yb, "boundary"),
                line(cols["lith"] + 74, yt, cols["lith"] + 74, yb, "boundary")]
        if top >= lo:
            out.append(line(cols["layer"], yy(top), cols["lith"] + 78, yy(top), "boundary"))
        if bottom <= hi:
            out.append(line(cols["layer"], yy(bottom), cols["lith"] + 78, yy(bottom), "boundary"))
        mid = yy((max(top, lo) + min(bottom, hi)) / 2)
        out.append(line(cols["layer"] + 5, mid, cols["lith"] - 8, mid, "leader"))
        out.append(text(cols["layer"], mid - 3, f"L{layer['id']} {n(top)}–{n(bottom)} m", 11.5))
        lp = descpos[layer["id"]]
        start = lp["label_y"] - lp["height"] / 2 + 13
        out.append(f'<path d="M {cols["lith"]+76} {mid:.2f} L {cols["desc"]-14} {mid:.2f} L {cols["desc"]-14} {lp["label_y"]:.2f}" class="leader"/>')
        for li, segment in enumerate(lp["lines"]):
            out.append(text(cols["desc"], start + li * 16, f"L{layer['id']} {segment}" if li == 0 else segment, 11.5))
        out.append(text(cols["desc"], start + len(lp["lines"]) * 16, f"段长{n(layer.get('thickness_m'))}m  芯长{n(layer.get('core_m'))}m  采取率{n(layer.get('recovery_percent'))}%", 10.5))
    # Hollow sample intervals; labels use a monotonic minimum-gap placement from true midpoints.
    visible_samples = [s for s in data["samples"] if float(s["bottom_m"]) >= lo and float(s["top_m"]) <= hi]
    if visible_samples:
        sample_labels = sample_positions(data["samples"], lo, hi, scale, top0)
        for i, s in enumerate(visible_samples):
            st, sb = float(s["top_m"]), float(s["bottom_m"])
            actual_y = yy((st + sb) / 2)
            yt, yb = yy(max(st, lo)), yy(min(sb, hi))
            out.append(line(cols["sample"] + 24, yt, cols["sample"] + 24, yb, "sample-range"))
            out.append(line(cols["sample"] + 18, yt, cols["sample"] + 30, yt, "sample-range"))
            out.append(line(cols["sample"] + 18, yb, cols["sample"] + 30, yb, "sample-range"))
            label_y = sample_labels[s["id"]]["label_y"]
            elbow = cols["samplelist"] - 20
            out.append(f'<path d="M {cols["sample"]+30} {actual_y:.2f} L {elbow} {actual_y:.2f} L {elbow} {label_y:.2f} L {cols["samplelist"]-8} {label_y:.2f}" class="leader"/>')
            lab = (f"{s['id']}  {n(st)}–{n(sb)} m  样长{n(s.get('length_m'))}  芯长{n(s.get('core_m'))}  采取率{n(s.get('recovery_percent'))}%")
            out.append(text(cols["samplelist"], label_y + 4, lab, 11.5))
    out.append(text(cols["assay"], body_top + 18, "分析数据未提供", 10.5))
    # Diameter is shown only at its measured depth as a point mark, with ample right margin.
    for st in data["structures"]:
        d = float(st["depth_m"])
        if lo <= d <= hi:
            py = yy(d)
            out += [f'<circle cx="{cols["structure"]}" cy="{py:.2f}" r="4" fill="white" stroke="#111" stroke-width="1.2" data-bbox="{cols["structure"]-4:.2f},{py-4:.2f},8,8"/>',
                    line(cols["structure"] + 5, py, cols["structure"] + 22, py, "major"),
                    text(cols["structure"] + 28, py + 4, f"{n(d)}m  φ{st['diameter_mm']}mm", 11.5)]
    out += [line(35, footer_y - 24, WIDTH - 35, footer_y - 24, "major"),
            text(35, footer_y, "孔深基准：未校正底稿382.79m；原图383.01m、精细校正表383.011m，差异保留。", 12),
            text(35, footer_y + 20, "第1/4/5层为参考图花纹候选匹配；其余20层待确认并留白。Au/Pb/Zn分析值未提供。", 12),
            text(35, footer_y + 40, "样品空心区间表示采样位置，不表示矿层；纹样中的线条、点和椭圆仅为图案，不表示实测层界。孔径仅标示终孔φ75mm。", 12),
            text(35, footer_y + 60, "回次采取率为底稿记录值；分层段长=底深−顶深，分层和样品采取率=芯长/区间长度×100%，计算值显示两位小数。", 12)]
    # A 10 m along-hole scale bar communicates the current drawing geometry without claiming a print ratio.
    bar_x, bar_y, bar_w = WIDTH - scale * 10 - 50, footer_y + 30, scale * 10
    out += [line(bar_x, bar_y, bar_x + bar_w, bar_y, "major"),
            line(bar_x, bar_y - 5, bar_x, bar_y + 5, "major"),
            line(bar_x + bar_w, bar_y - 5, bar_x + bar_w, bar_y + 5, "major"),
            text(bar_x, bar_y + 18, "10 m沿孔距", 11)]
    if detail:
        continued = [z for z in data["layers"] if float(z["top_m"]) < hi < float(z["bottom_m"])]
        for z in continued:
            out.append(text(cols["desc"], body_bottom + 36, f"第{z['id']}层延续至{n(z['bottom_m'])}m（此处为视窗截断）", 11.5))
            out.append(f'<path d="M {cols["lith"]-4} {body_bottom-12:.2f} l 8 -4 l 8 4 l 8 -4" class="major" data-bbox="{cols["lith"]-4},{body_bottom-16},32,8"/>')
    out.append("</svg>")
    return "\n".join(out)


def table_html(data):
    def table(title, rows, headers):
        body = "".join("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in r) + "</tr>" for r in rows)
        return f"<h2>{esc(title)}</h2><table><thead><tr>{''.join(f'<th>{esc(h)}</th>' for h in headers)}</tr></thead><tbody>{body}</tbody></table>"
    turns = [[t["id"], n(t["top_m"]), n(t["bottom_m"]), n(t["advance_m"]), n(t["core_m"]), n(t["recovery_percent"]),
              f"{t.get('source',{}).get('sheet','')}!{t.get('source',{}).get('row','')}"] for t in data["turns"]]
    pattern_map, _, _ = load_patterns()
    layers = [[l["id"], n(l["top_m"]), n(l["bottom_m"]), n(l["thickness_m"]), n(l["core_m"]), n(l["recovery_percent"]), l.get("description", ""), f"参考图匹配：{pattern_map[str(l['id'])]['label']}" if str(l["id"]) in pattern_map else "待确认（留白）", f"{l.get('source',{}).get('sheet','')}!{l.get('source',{}).get('row','')}"] for l in data["layers"]]
    samples = [[s["id"], n(s["top_m"]), n(s["bottom_m"]), n(s["length_m"]), n(s["core_m"]), n(s["recovery_percent"]), "", f"{s.get('source',{}).get('sheet','')}!{s.get('source',{}).get('row','')}"] for s in data["samples"]]
    issues = "".join(
        f"<li><strong>{esc(i.get('topic',''))}</strong>：{esc(i.get('note',''))} "
        f"<span>来源数值：{esc(i.get('source_values', i.get('values_m', i.get('values', []))))}</span></li>"
        for i in data.get("issues", [])
    )
    return f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ZK0003示图数据附表</title><style>
body{{font-family:"Microsoft YaHei",sans-serif;margin:24px;color:#111}}h1{{font-size:24px}}table{{border-collapse:collapse;width:100%;margin-bottom:28px;font-size:13px}}th,td{{border:1px solid #999;padding:5px 7px;text-align:left}}thead{{position:sticky;top:0;background:#eee}}td:nth-child(1){{white-space:nowrap}}.note{{background:#f5f5f5;padding:12px}}@media print{{thead{{position:static}}}}
</style><h1>ZK0003钻孔示图·完整数字附表</h1><p class="note">深度基准：未校正底稿382.79m。所有表格保留原编号及字段来源行。表格数值显示两位小数，几何位置按原始数值计算。</p>
<p>回次 {len(turns)} 条；分层 {len(layers)} 条（基本数据摘要51层）；样品 {len(samples)} 个唯一编号。Au/Pb/Zn分析数据全孔均未提供。</p>
<p>回次采取率为底稿记录值。分层段长=底深−顶深；分层和样品采取率=芯长/区间长度×100%，属于计算值。以下比例均仅显示两位小数，源数值与区间几何未舍入。参考纹样中的线条、点和椭圆表示图案，不表示实测层界。</p>
{table('回次记录（独立列表）', turns, ['回次','顶深m','底深m','进尺m','岩心长m','采取率%','源单元格'])}
{table('分层数据', layers, ['层号','顶深m','底深m','段长m','岩心长m','采取率%','原始描述','花纹状态','源单元格'])}
{table('样品明细（按孔深排列，保留原编号）', samples, ['样号','顶深m','底深m','样长m','岩矿芯长m','采取率%','分析结果（全孔未提供）','源单元格'])}
<h2>孔径结构</h2><table><thead><tr><th>孔深m</th><th>直径mm</th><th>来源</th></tr></thead><tbody>{''.join(f"<tr><td>{n(s['depth_m'])}</td><td>{esc(s['diameter_mm'])}</td><td>{esc(s.get('source',{}).get('sheet',''))}!{esc(s.get('source',{}).get('row',''))}</td></tr>" for s in data['structures'])}</tbody></table>
<h2>来源冲突与缺失</h2><ul>{issues}</ul></html>'''


def main():
    raw = DATA_PATH.read_bytes()
    data = json.loads(raw.decode("utf-8-sig"))
    assert (len(data["turns"]), len(data["layers"]), len(data["samples"])) == (131, 23, 97)
    assert data["meta"]["depth_basis"] == "uncorrected_template"
    assert float(data["meta"]["endpoint_m"]) == BOTTOM_DEPTH
    (ROOT / "ZK0003-完整示图.svg").write_text(make_svg(data), encoding="utf-8")
    (ROOT / "ZK0003-0至45米详图.svg").write_text(make_svg(data, True), encoding="utf-8")
    (ROOT / "drawing-data.html").write_text(table_html(data), encoding="utf-8")
    pattern_map, _, pattern_hash = load_patterns()
    def view_layout(lo, hi, scale, top0):
        yy = lambda d: y(d, scale, top0)
        turns = [t for t in data["turns"] if float(t["bottom_m"]) >= lo and float(t["top_m"]) <= hi]
        turn_step = (yy(hi) - yy(lo)) / max(1, len(turns))
        turn_records = []
        for i, z in enumerate(turns):
            baseline = yy(lo) + (i + .5) * turn_step + 4
            row = f"{int(z['id']):03d}  {n(z['top_m'])}–{n(z['bottom_m'])}  进尺{n(z['advance_m'])}  芯{n(z['core_m'])}  采取率{n(z['recovery_percent'])}%"
            turn_records.append({"id": z["id"], "top_m": z["top_m"], "bottom_m": z["bottom_m"], "row_y": baseline, "label_bbox": text_bbox(135, baseline, row, 12), "label_moved_from_depth": True, "source": z["source"]})
        dp = desc_positions(data["layers"], scale, top0, lo, hi)
        layer_records = []
        for z in data["layers"]:
            if z["bottom_m"] < lo or z["top_m"] > hi:
                continue
            mid = yy((max(lo, z["top_m"]) + min(hi, z["bottom_m"])) / 2)
            pos = dp[z["id"]]
            start = pos["label_y"] - pos["height"] / 2 + 13
            labels = [f"L{z['id']} {pos['lines'][0]}"] + pos["lines"][1:] + [f"段长{n(z.get('thickness_m'))}m  芯长{n(z.get('core_m'))}m  采取率{n(z.get('recovery_percent'))}%"]
            label_bboxes = [text_bbox(950, start + i * 16, txt, 11.5 if i < len(labels)-1 else 10.5) for i, txt in enumerate(labels)]
            layer_records.append({"id": z["id"], "top_m": z["top_m"], "bottom_m": z["bottom_m"], "top_y": yy(z["top_m"]), "bottom_y": yy(z["bottom_m"]), "label_anchor_y": pos["anchor_y"], "label_y": pos["label_y"], "label_moved": pos["label_y"] != pos["anchor_y"], "label_bboxes": label_bboxes, "source": z["source"], "pattern_id": pattern_map.get(str(z["id"]), {}).get("pattern_id"), "pattern_confirmed": str(z["id"]) in pattern_map})
        sample_pos = sample_positions(data["samples"], lo, hi, scale, top0)
        sample_records = []
        for z in data["samples"]:
            if z["id"] not in sample_pos:
                continue
            pos = sample_pos[z["id"]]
            label = f"{z['id']}  {n(z['top_m'])}–{n(z['bottom_m'])} m  样长{n(z.get('length_m'))}  芯长{n(z.get('core_m'))}  采取率{n(z.get('recovery_percent'))}%"
            sample_records.append({"id": z["id"], "top_m": z["top_m"], "bottom_m": z["bottom_m"], "top_y": yy(z["top_m"]), "bottom_y": yy(z["bottom_m"]), "label_anchor_y": pos["anchor_y"], "label_y": pos["label_y"], "label_moved": pos["moved"], "label_bbox": text_bbox(1545, pos["label_y"] + 4, label, 11.5), "source": z["source"]})
        structures = [{"depth_m": z["depth_m"], "diameter_mm": z["diameter_mm"], "y": yy(z["depth_m"]), "source": z["source"]} for z in data["structures"] if lo <= float(z["depth_m"]) <= hi]
        return {"scale_units_per_meter": scale, "view_depth_m": [lo, hi], "viewBox": [0, 0, WIDTH, yy(hi) + 165], "turns": turn_records, "layers": layer_records, "samples": sample_records, "structures": structures}

    full_layout = view_layout(0, BOTTOM_DEPTH, SCALE, TOP)
    detail_layout = view_layout(0, 45, DETAIL_SCALE, TOP)
    audit = {
        "input": DATA_PATH.name,
        "input_sha256": hashlib.sha256(raw).hexdigest(),
        "depth_basis": data["meta"]["depth_basis"],
        "endpoint_m": BOTTOM_DEPTH,
        "counts": {k: len(data[k]) for k in ("turns", "layers", "samples", "structures")},
        "turns_are_equal_height_independent_list": True,
        "turns_do_not_define_depth_boundaries": True,
        "geometry": {"full": full_layout, "detail": detail_layout, "full_endpoint_y": y(BOTTOM_DEPTH)},
        "patterns": {"file_sha256": pattern_hash, "confirmed_layer_patterns": pattern_map, "pending_layer_ids": [z["id"] for z in data["layers"] if str(z["id"]) not in pattern_map]},
        "assay_fields": data["assay_elements"],
        "assays_missing": data["all_analysis_missing"],
        "source_data_rounded_or_rewritten": False,
        "numeric_labels_display_decimals": 2,
        "svg_image_elements": 0,
        "svg_label_bbox_attribute": "data-bbox (approximate text box from font metrics; each text element carries its own value)",
    }
    (ROOT / "layout-audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "input_sha256": audit["input_sha256"], "counts": audit["counts"], "outputs": ["ZK0003-完整示图.svg", "ZK0003-0至45米详图.svg", "drawing-data.html", "layout-audit.json"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
