"""Dynamic, traceable SVG renderer for validated drill-1.0 records."""
from __future__ import annotations

import html
import json
import math
import re
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent
PATTERN_PATH = ROOT / "templates" / "drill-patterns.json"
# Kept as the direct-call default for compatibility. render_drill_svg selects a
# scale from the current endpoint and records the selected value in its audit.
SCALE = 12.0
TOP = 126.0
MIN_DEPTH_HEIGHT = 700.0
MIN_LABEL_GAP = 22.0


def _e(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def _f(value: Any, digits: int = 2) -> str:
    """Display missing distinctly from numeric zero; source geometry stays raw."""
    if value is None:
        return "未提供"
    return f"{float(value):.{digits}f}"


def depth_y(depth: float, top: float = 110.0, scale: float = SCALE) -> float:
    return float(top) + float(depth) * float(scale)


def sample_lanes(samples: Iterable[dict[str, Any]]) -> tuple[dict[str, int], int]:
    """Greedy interval partition; overlapping sample intervals use distinct tracks."""
    ends: list[float] = []
    lanes: dict[str, int] = {}
    for sample in sorted(samples, key=lambda row: (float(row["top_m"]), float(row["bottom_m"]), str(row["id"]))):
        lane = next((idx for idx, end in enumerate(ends) if end <= float(sample["top_m"]) + 1e-9), len(ends))
        if lane == len(ends):
            ends.append(float(sample["bottom_m"]))
        else:
            ends[lane] = float(sample["bottom_m"])
        lanes[str(sample["id"])] = lane
    return lanes, len(ends)


def _intersects(record: dict[str, Any], lo: float, hi: float) -> bool:
    return float(record["bottom_m"]) >= lo and float(record["top_m"]) <= hi


def _visible(records: Iterable[dict[str, Any]], lo: float, hi: float) -> list[dict[str, Any]]:
    return [row for row in records if _intersects(row, lo, hi)]


def _clip_interval(record: dict[str, Any], lo: float, hi: float) -> tuple[float, float]:
    return max(lo, float(record["top_m"])), min(hi, float(record["bottom_m"]))


def _wrap_text(value: Any, width: float, font_size: float) -> list[str]:
    """Wrap by approximate glyph width without dropping source characters."""
    source = "" if value is None else str(value)
    if not source:
        return [""]
    max_units = max(1.0, width / font_size)
    lines: list[str] = []
    for paragraph in source.splitlines() or [""]:
        current = ""
        units = 0.0
        index = 0
        while index < len(paragraph):
            percentage = re.match(r"[+-]?\d+(?:\.\d+)?%", paragraph[index:])
            if percentage:
                token = percentage.group(0)
                token_units = sum(0.98 if ord(char) > 255 else 0.56 for char in token)
                if current and units + token_units > max_units:
                    lines.append(current)
                    current, units = "", 0.0
                current += token
                units += token_units
                index += len(token)
                continue
            char = paragraph[index]
            char_units = 0.98 if ord(char) > 255 else 0.56
            if current and units + char_units > max_units:
                lines.append(current)
                current, units = "", 0.0
            current += char
            units += char_units
            index += 1
        lines.append(current)
    return lines or [""]


def _place_labels(
    records: list[dict[str, Any]],
    anchors: list[float],
    heights: list[float],
    *,
    lower: float,
    gap: float = 3.0,
) -> list[float]:
    """Move label centers as little as possible while keeping ordered boxes apart."""
    if not records:
        return []
    placed = list(anchors)
    for idx in range(1, len(placed)):
        required = (heights[idx - 1] + heights[idx]) / 2 + gap
        placed[idx] = max(placed[idx], placed[idx - 1] + required)
    if placed[0] - heights[0] / 2 < lower:
        placed[0] = lower + heights[0] / 2
        for idx in range(1, len(placed)):
            required = (heights[idx - 1] + heights[idx]) / 2 + gap
            placed[idx] = max(placed[idx], placed[idx - 1] + required)
    return placed


def _text_width(value: str, size: float) -> float:
    return sum(size * (0.98 if ord(char) > 255 else 0.56) for char in value)


def _text(x: float, y: float, value: Any, size: float = 11.0, *, anchor: str = "start", weight: str = "normal", cls: str = "") -> str:
    return (f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size:.2f}" text-anchor="{anchor}" '
            f'font-weight="{weight}" class="{cls}">{_e(value)}</text>')


def _path(d: str, cls: str = "leader") -> str:
    return f'<path class="{cls}" d="{d}"/>'


def _analysis_lines(sample: dict[str, Any], units: dict[str, str]) -> list[str]:
    lines = []
    for element in ("Au", "Pb", "Zn"):
        value = (sample.get("assays") or {}).get(element)
        unit = units.get(element) or ""
        if value is None:
            lines.append(f"{element}：未提供" + (f"（{unit}）" if unit else ""))
        else:
            # A measured zero is a real value and must not be rendered as missing.
            lines.append(f"{element}：{_f(value, 4)}{(' ' + unit) if unit else ''}")
    return lines


def _audit_record(record: dict[str, Any], y: Any, lo: float, hi: float) -> dict[str, Any]:
    clipped_top, clipped_bottom = _clip_interval(record, lo, hi)
    return {
        "id": record["id"],
        "top_m": record["top_m"],
        "bottom_m": record["bottom_m"],
        "top_y": y(float(record["top_m"])),
        "bottom_y": y(float(record["bottom_m"])),
        "plotted_top_m": clipped_top,
        "plotted_bottom_m": clipped_bottom,
        "plotted_top_y": y(clipped_top),
        "plotted_bottom_y": y(clipped_bottom),
        "source": record.get("source", {}),
    }


def _layout(data: dict[str, Any], detail: bool) -> dict[str, Any]:
    endpoint = float(data["meta"]["endpoint_m"])
    hi = min(endpoint, 45.0) if detail else endpoint
    scale_floor = MIN_DEPTH_HEIGHT / max(endpoint if not detail else hi, 1e-9)
    scale = max(9.0, scale_floor) if not detail else max(25.0, scale_floor)
    y = lambda depth: depth_y(depth, TOP, scale)
    layers = _visible(data["layers"], 0.0, hi)
    samples = _visible(data["samples"], 0.0, hi)
    turns = _visible(data["turns"], 0.0, hi)
    structures = sorted((row for row in data["structures"] if 0 <= float(row["depth_m"]) <= hi),
                        key=lambda row: float(row["depth_m"]))
    lanes, lane_count = sample_lanes(samples)

    # Column widths stay fixed for readable records; interval tracks grow with
    # actual overlap lanes rather than clipping samples at a preset width.
    columns = {
        "axis": 70.0, "turn": 145.0, "turn_end": 565.0,
        "layer": 620.0, "lith": 805.0, "lith_width": 78.0,
        "description": 910.0, "description_width": 360.0,
    }
    columns["sample"] = columns["description"] + columns["description_width"] + 32.0
    columns["sample_labels"] = columns["sample"] + max(42.0, lane_count * 16.0) + 160.0
    columns["assay"] = columns["sample_labels"] + 405.0
    columns["structure"] = columns["assay"] + 260.0
    columns["structure_labels"] = columns["structure"] + 40.0
    width = columns["structure_labels"] + 275.0

    label_top = y(0.0) + 7.0
    depth_height = y(hi) - y(0.0)
    turn_lines = []
    turn_heights = []
    for turn in turns:
        row = (f'{turn["id"]}　{_f(turn.get("top_m"))}–{_f(turn.get("bottom_m"))} m　'
               f'进尺 {_f(turn.get("advance_m"))} m　岩心 {_f(turn.get("core_m"))} m　'
               f'采取率 {_f(turn.get("recovery_percent"))}%')
        wrapped = _wrap_text(row, 405.0, 10.5)
        turn_lines.append(wrapped)
        turn_heights.append(max(23.0, len(wrapped) * 14.0 + 6.0))
    turn_label_y = []
    turn_cursor = y(0.0)
    for row_height in turn_heights:
        turn_label_y.append(turn_cursor + row_height / 2.0)
        turn_cursor += row_height
    turn_bottom = turn_cursor

    layer_mids = [y(sum(_clip_interval(row, 0.0, hi)) / 2.0) for row in layers]
    layer_label_lines = [
        _wrap_text(f'L{row["id"]}　{_f(row["top_m"])}–{_f(row["bottom_m"])} m', 172.0, 10.5)
        for row in layers
    ]
    layer_heights = [max(22.0, len(lines) * 14.0 + 4.0) for lines in layer_label_lines]
    layer_label_y = _place_labels(layers, layer_mids, layer_heights, lower=label_top)
    description_lines = []
    description_param_lines = []
    description_heights = []
    for row in layers:
        name = str(row.get("lithology_name") or "岩性名称未提供")
        description = str(row.get("description") or "")
        content = f"{name}；{description}" if description else name
        wrapped = _wrap_text(content, columns["description_width"], 11.5)
        params = (f'段长 {_f(row.get("thickness_m"))} m　岩心长 {_f(row.get("core_m"))} m　'
                  f'采取率 {_f(row.get("recovery_percent"))}%　花纹 {row.get("material_code") or "待配置"}')
        param_lines = _wrap_text(params, columns["description_width"], 10.5)
        description_lines.append(wrapped)
        description_param_lines.append(param_lines)
        description_heights.append(max(39.0, len(wrapped) * 15.0 + len(param_lines) * 13.0 + 14.0))
    description_label_y = _place_labels(layers, layer_mids, description_heights, lower=label_top)

    sample_mids = [y(sum(_clip_interval(row, 0.0, hi)) / 2.0) for row in samples]
    sample_text_lines = []
    sample_assay_lines = []
    sample_heights = []
    for row in samples:
        lo_m, hi_m = float(row["top_m"]), float(row["bottom_m"])
        content = f"样品 {row['id']}　{_f(lo_m)}–{_f(hi_m)} m　样长 {_f(row.get('length_m'))} m　岩心长 {_f(row.get('core_m'))} m　采取率 {_f(row.get('recovery_percent'))}%"
        wrapped = _wrap_text(content, 390.0, 11.5)
        assay_wrapped = []
        for assay_line in _analysis_lines(row, data["project"].get("analysis_units", {})):
            assay_wrapped.extend(_wrap_text(assay_line, 245.0, 10.5))
        sample_text_lines.append(wrapped)
        sample_assay_lines.append(assay_wrapped)
        sample_heights.append(max(44.0, len(wrapped) * 15.0 + 10.0, len(assay_wrapped) * 15.0 + 12.0))
    sample_label_y = _place_labels(samples, sample_mids, sample_heights, lower=label_top, gap=4.0)

    structure_mids = [y(float(row["depth_m"])) for row in structures]
    structure_label_y = _place_labels(structures, structure_mids, [20.0] * len(structures), lower=label_top)
    structure_label_width = max((_text_width(f"{_f(row['depth_m'])} m　孔径 {_f(row['diameter_mm'], 2)} mm", 11.5) for row in structures), default=0.0)
    width = max(width, columns["structure_labels"] + structure_label_width + 24.0)

    label_bottom = max(
        [y(hi), turn_bottom, label_top]
        + [center + height / 2 for center, height in zip(description_label_y, description_heights)]
        + [center + height / 2 for center, height in zip(sample_label_y, sample_heights)]
        + [center + 10.0 for center in structure_label_y]
    )
    footer_y = label_bottom + 56.0
    height = footer_y + 54.0
    return {
        "endpoint": endpoint, "hi": hi, "scale": scale, "y": y, "width": width,
        "height": height, "depth_height": depth_height, "turn_bottom": turn_bottom,
        "turn_lines": turn_lines, "turn_heights": turn_heights, "turn_label_y": turn_label_y,
        "columns": columns, "layers": layers, "samples": samples, "turns": turns,
        "structures": structures, "lanes": lanes, "lane_count": lane_count,
        "layer_label_y": layer_label_y, "layer_mids": layer_mids,
        "layer_label_lines": layer_label_lines, "layer_heights": layer_heights,
        "description_lines": description_lines, "description_heights": description_heights,
        "description_param_lines": description_param_lines,
        "description_label_y": description_label_y, "sample_mids": sample_mids,
        "sample_text_lines": sample_text_lines, "sample_assay_lines": sample_assay_lines,
        "sample_heights": sample_heights,
        "sample_label_y": sample_label_y, "structure_label_y": structure_label_y,
        "footer_y": footer_y,
    }


def render_drill_svg(data: dict[str, Any], *, detail: bool = False) -> tuple[str, dict[str, Any]]:
    """Render all records in the selected full-depth or 0–45 m view."""
    layout = _layout(data, detail)
    endpoint, hi, scale = layout["endpoint"], layout["hi"], layout["scale"]
    y, width, height, cols = layout["y"], layout["width"], layout["height"], layout["columns"]
    layers, samples = layout["layers"], layout["samples"]
    turns, structures = layout["turns"], layout["structures"]
    patterns = json.loads(PATTERN_PATH.read_text(encoding="utf-8"))
    codes = patterns.get("codes", {})
    defs = "".join(
        f'<pattern id="p-{_e(code)}" width="{entry["width"]}" height="{entry["height"]}" patternUnits="userSpaceOnUse">{entry["svg"]}</pattern>'
        for code, entry in patterns.get("patterns", {}).items()
    )
    crop = bool(detail and hi < endpoint - 1e-9)
    full_description = "局部视窗内的层段按沿孔深线性显示；孔深轴与回次独立列表分列。"
    if detail:
        full_description = f"局部详图 0–{_f(hi)} m；仅显示与此深度范围相交的记录。"
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{math.ceil(width)}" height="{math.ceil(height)}" viewBox="0 0 {width:.2f} {height:.2f}" role="img" aria-labelledby="svg-title">',
        f'<title id="svg-title">{_e(data["meta"]["hole_id"])} 钻孔柱状图{"局部详图" if detail else ""}</title>',
        f'<defs>{defs}<style>text{{font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif;fill:#111}}.axis{{stroke:#111;stroke-width:1}}.fine{{stroke:#888;stroke-width:.6}}.boundary{{stroke:#222;stroke-width:1}}.leader{{stroke:#666;stroke-width:.72;fill:none}}.sample-range{{stroke:#111;stroke-width:2;fill:none}}.rail{{stroke:#333;stroke-width:.7}}</style></defs>',
        f'<rect x="0" y="0" width="{width:.2f}" height="{height:.2f}" fill="white"/>',
        _text(35, 30, f'{data["meta"]["hole_id"]} 钻孔柱状图', 23, weight="bold"),
        _text(35, 51, f'深度基准：{data["meta"]["depth_basis"]}　终孔深度：{_f(endpoint)} m　纵向比例：{_f(scale, 3)} 图面单位/m（沿孔深线性）', 12),
        _text(35, 70, "层段长=底深−顶深，仅为沿孔长度；花纹示意不表示层内实测界面，图件不代表行业图式已全部核定。", 11.5),
        _text(35, 87, full_description, 11.5),
    ]

    headings = [
        (cols["axis"], "孔深 (m)"), (cols["turn"], "回次记录（独立列表）"),
        (cols["layer"], "分层区间"), (cols["lith"], "岩性柱"),
        (cols["description"], "岩性描述与段参数"),
        (cols["sample"], f'样品区间（{layout["lane_count"]} 轨）'),
        (cols["sample_labels"], "样品明细（引线对应样品）"),
        (cols["assay"], "Au / Pb / Zn 分析值"),
        (cols["structure"], "孔径点"),
        (cols["structure_labels"], "深度与孔径"),
    ]
    for x, label in headings:
        out.append(_text(x, TOP - 18, label, 12, weight="bold"))

    # One global depth axis; ticks are separate from one interval label per layer.
    axis_x = cols["axis"] + 38.0
    out.append(f'<line class="axis" x1="{axis_x:.2f}" y1="{y(0):.2f}" x2="{axis_x:.2f}" y2="{y(hi):.2f}"/>')
    major_step = 10.0 if hi > 40.0 else (5.0 if hi > 15.0 else 1.0)
    tick = 0.0
    while tick <= hi + 1e-9:
        yy = y(tick)
        major = abs(tick / major_step - round(tick / major_step)) < 1e-8
        out.append(f'<line class="{"axis" if major else "fine"}" x1="{axis_x-(7 if major else 4):.2f}" y1="{yy:.2f}" x2="{axis_x+5:.2f}" y2="{yy:.2f}"/>')
        out.append(_text(axis_x - 12, yy + 4, f"{tick:g}", 10.5, anchor="end"))
        tick += major_step
    if abs((tick - major_step) - hi) > 1e-8:
        out.append(f'<line class="axis" x1="{axis_x-7:.2f}" y1="{y(hi):.2f}" x2="{axis_x+5:.2f}" y2="{y(hi):.2f}"/>')
        out.append(_text(axis_x - 12, y(hi) + 4, _f(hi), 10.5, anchor="end"))

    # Equal-height turn rows remain an independent ledger and never define depth geometry.
    for idx, turn in enumerate(turns):
        center = layout["turn_label_y"][idx]
        first = center - layout["turn_heights"][idx] / 2.0 + 11.0
        for line_idx, text in enumerate(layout["turn_lines"][idx]):
            out.append(_text(cols["turn"], first + line_idx * 14.0, text, 10.5))
        row_bottom = center + layout["turn_heights"][idx] / 2.0
        out.append(f'<line class="fine" x1="{cols["turn"]-8:.2f}" y1="{row_bottom:.2f}" x2="{cols["turn_end"]:.2f}" y2="{row_bottom:.2f}"/>')

    # Draw lithology fill independently from real interfaces. At a cropped edge,
    # suppress the rectangle edge and mark continuation instead of inventing a contact.
    lith_left, lith_right = cols["lith"], cols["lith"] + cols["lith_width"]
    out.append(f'<line class="rail" x1="{lith_left}" y1="{y(0):.2f}" x2="{lith_left}" y2="{y(hi):.2f}"/>')
    out.append(f'<line class="rail" x1="{lith_right}" y1="{y(0):.2f}" x2="{lith_right}" y2="{y(hi):.2f}"/>')
    boundaries: dict[float, list[dict[str, Any]]] = {}
    for layer in layers:
        top_m, bottom_m = _clip_interval(layer, 0.0, hi)
        top_y, bottom_y = y(top_m), y(bottom_m)
        code = layer.get("material_code") or ""
        pattern_id = codes.get(code)
        fill = f'url(#p-{_e(pattern_id)})' if pattern_id else "white"
        out.append(f'<rect x="{lith_left+0.5:.2f}" y="{top_y:.4f}" width="{cols["lith_width"]-1:.2f}" height="{max(0.0,bottom_y-top_y):.4f}" fill="{fill}"/>')
        raw_top, raw_bottom = float(layer["top_m"]), float(layer["bottom_m"])
        if 0 <= raw_top <= hi:
            boundaries.setdefault(raw_top, []).append(layer)
        if 0 <= raw_bottom <= hi and not (crop and abs(raw_bottom - hi) < 1e-9):
            boundaries.setdefault(raw_bottom, []).append(layer)
    for boundary_m in sorted(boundaries):
        yy = y(boundary_m)
        out.append(f'<line class="boundary" x1="{cols["layer"]:.2f}" y1="{yy:.3f}" x2="{lith_right+4:.2f}" y2="{yy:.3f}"/>')

    layer_audit = []
    for idx, layer in enumerate(layers):
        plotted_top, plotted_bottom = _clip_interval(layer, 0.0, hi)
        actual_mid = y((plotted_top + plotted_bottom) / 2.0)
        label_y = layout["layer_label_y"][idx]
        label_lines = layout["layer_label_lines"][idx]
        out.append(_path(f'M {cols["layer"]+8:.2f} {actual_mid:.2f} H {cols["layer"]+58:.2f} V {label_y:.2f}', "leader"))
        label_height = layout["layer_heights"][idx]
        label_first = label_y - label_height / 2.0 + 11.0
        for line_idx, text in enumerate(label_lines):
            out.append(_text(cols["layer"], label_first + line_idx * 14.0, text, 10.5))
        desc_y = layout["description_label_y"][idx]
        lines = layout["description_lines"][idx]
        block_height = layout["description_heights"][idx]
        first_baseline = desc_y - block_height / 2 + 12.0
        out.append(_path(f'M {lith_right+2:.2f} {actual_mid:.2f} H {cols["description"]-12:.2f} V {desc_y:.2f}', "leader"))
        for line_idx, text in enumerate(lines):
            out.append(_text(cols["description"], first_baseline + line_idx * 15.0, text, 11.5))
        params_y = first_baseline + len(lines) * 15.0
        param_lines = layout["description_param_lines"][idx]
        for line_idx, text in enumerate(param_lines):
            out.append(_text(cols["description"], params_y + line_idx * 13.0, text, 10.5))
        layer_audit.append({
            **_audit_record(layer, y, 0.0, hi),
            "label_anchor_y": actual_mid,
            "label_y": label_y,
            "description_anchor_y": actual_mid,
            "description_label_y": desc_y,
            "description_lines": lines,
            "description_param_lines": param_lines,
            "raw_description": layer.get("description", ""),
            "pattern_code": layer.get("material_code") or None,
        })

    # Sample interval tracks use true depth. Text is separately packed from each
    # interval midpoint and every elbow reaches the sample's own label row.
    lanes = layout["lanes"]
    sample_audit = []
    for idx, sample in enumerate(samples):
        top_m, bottom_m = float(sample["top_m"]), float(sample["bottom_m"])
        plotted_top, plotted_bottom = _clip_interval(sample, 0.0, hi)
        actual_mid_depth = (top_m + bottom_m) / 2.0
        plotted_mid = (plotted_top + plotted_bottom) / 2.0
        anchor_y, label_y = y(actual_mid_depth), layout["sample_label_y"][idx]
        plotted_anchor_y = y(plotted_mid)
        lane = lanes[str(sample["id"])]
        x = cols["sample"] + 18.0 + lane * 16.0
        top_y, bottom_y = y(plotted_top), y(plotted_bottom)
        marks = [f'M{x:.2f} {top_y:.3f} V {bottom_y:.3f}']
        if top_m >= 0.0 and top_m <= hi:
            marks.append(f'M{x-6:.2f} {top_y:.3f} H {x+6:.2f}')
        if bottom_m >= 0.0 and bottom_m <= hi:
            marks.append(f'M{x-6:.2f} {bottom_y:.3f} H {x+6:.2f}')
        out.append(f'<path class="sample-range" d="{" ".join(marks)}"/>')
        elbow_x = cols["sample_labels"] - 18.0
        out.append(_path(f'M {x+7:.2f} {plotted_anchor_y:.2f} H {elbow_x:.2f} V {label_y:.2f} H {cols["sample_labels"]-8:.2f}'))
        lines = layout["sample_text_lines"][idx]
        line_height = 15.0
        first_baseline = label_y - layout["sample_heights"][idx] / 2 + 11.5
        for line_idx, text in enumerate(lines):
            out.append(_text(cols["sample_labels"], first_baseline + line_idx * line_height, text, 11.5))
        assays = layout["sample_assay_lines"][idx]
        assay_start = label_y - len(assays) * 15.0 / 2.0 + 10.5
        for assay_idx, text in enumerate(assays):
            out.append(_text(cols["assay"], assay_start + assay_idx * 15.0, text, 10.5))
        sample_audit.append({
            **_audit_record(sample, y, 0.0, hi),
            "lane": lane,
            "midpoint_y": anchor_y,
            "plotted_midpoint_y": plotted_anchor_y,
            "label_anchor_y": anchor_y,
            "label_y": label_y,
            "label_moved": abs(label_y - anchor_y) > 1e-7,
            "analysis_y": assay_start,
        })

    # Drill diameter records are individual measured points, never a fabricated
    # interval. Nearby captions receive separate rows and a connector to that point.
    structure_audit = []
    for idx, structure in enumerate(structures):
        depth = float(structure["depth_m"])
        point_y = y(depth)
        label_y = layout["structure_label_y"][idx]
        marker_x = cols["structure"]
        out.append(f'<circle cx="{marker_x:.2f}" cy="{point_y:.3f}" r="3.5" fill="white" stroke="#111" stroke-width="1.2"/>')
        out.append(_path(f'M {marker_x+5:.2f} {point_y:.2f} H {cols["structure_labels"]-12:.2f} V {label_y:.2f} H {cols["structure_labels"]-5:.2f}'))
        out.append(_text(cols["structure_labels"], label_y + 4, f'{_f(depth)} m　孔径 {_f(structure["diameter_mm"], 2)} mm', 11.5))
        structure_audit.append({
            "depth_m": structure["depth_m"], "diameter_mm": structure["diameter_mm"],
            "y": point_y, "label_anchor_y": point_y, "label_y": label_y,
            "source": structure.get("source", {}),
        })

    if crop:
        crop_y = y(hi)
        zig_x = lith_right - 18.0
        out.append(f'<path d="M {zig_x:.2f} {crop_y-5:.2f} l 5 5 l 5 -5 l 5 5 l 5 -5" fill="none" stroke="#111" stroke-width="1.2"/>')
        out.append(_text(cols["description"], crop_y + 19, f'视窗在 {_f(hi)} m 截断，以下延续；截断线不是实测层界。', 10.5))

    turn_audit = []
    for idx, turn in enumerate(turns):
        row_y = layout["turn_label_y"][idx]
        turn_audit.append({
            "id": turn["id"], "top_m": turn["top_m"], "bottom_m": turn["bottom_m"],
            "top_y": y(float(turn["top_m"])), "bottom_y": y(float(turn["bottom_m"])),
            "ledger_y": row_y, "source": turn.get("source", {}),
        })

    footer = layout["footer_y"]
    out.append(f'<line class="axis" x1="35" y1="{footer-16:.2f}" x2="{width-35:.2f}" y2="{footer-16:.2f}"/>')
    counts = data["summary"]
    out.append(_text(35, footer + 4, f'分层 {counts.get("layers", len(data["layers"]))}　回次 {counts.get("turns", len(data["turns"]))}　样品 {counts.get("samples", len(data["samples"]))}　终孔 {_f(endpoint)} m', 11))
    out.append(_text(35, footer + 23, "深度/层界按输入原始数值线性定位；未提供值保持空缺。详图截断仅为视窗边缘，不增加地质界面。", 10.5))
    out.append("</svg>")

    audit = {
        "hole_id": data["meta"]["hole_id"],
        "endpoint_m": endpoint,
        "depth_basis": data["meta"]["depth_basis"],
        "scale_units_per_meter": scale,
        "minimum_depth_height_units": MIN_DEPTH_HEIGHT,
        "view_depth_m": [0.0, hi],
        "viewBox": [0.0, 0.0, width, height],
        "counts": {"layers": len(data["layers"]), "turns": len(data["turns"]), "samples": len(data["samples"])},
        "structure_count": len(data["structures"]),
        "sample_lane_count": layout["lane_count"],
        "sample_lanes": lanes,
        "layers": layer_audit,
        "samples": sample_audit,
        "structures": structure_audit,
        "turns_independent_equal_height_ledger": True,
        "turn_records": turn_audit,
        "detail_crop_is_not_geologic_boundary": bool(crop),
        "svg_image_elements": 0,
        "source_values_rounded_for_display_only": True,
        "pending_patterns": [row["id"] for row in data["layers"] if not row.get("material_code")],
    }
    return "".join(out), audit
