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
    items = sample.get("analysis_items")
    if not items:
        configured = sample.get("_analysis_items")
        items = configured or [{"code": code, "name": code, "unit": units.get(code, ""), "show": True}
                               for code in ("Au", "Pb", "Zn")]
    assays = sample.get("assays") or {}
    raw_values = sample.get("assay_raw") or {}
    lines = []
    for item in sorted((row for row in items if row.get("show", True)), key=lambda row: row.get("order", 0)):
        code = str(item.get("code") or "")
        name = str(item.get("name") or code)
        value = assays.get(code)
        raw = raw_values.get(code)
        unit = item.get("unit") or units.get(code) or ""
        if raw is not None and str(raw).strip():
            rendered = str(raw)
        elif value is None:
            # Blank workbook cells stay visually blank; they are not numeric zero.
            rendered = "" if sample.get("_integrated") else "未提供"
        else:
            # A measured zero is a real value and must not be rendered as missing.
            rendered = _f(value, 4)
        suffix = f"（{unit}）" if unit and (not rendered or rendered == "未提供") else (f" {unit}" if unit else "")
        lines.append(f"{name}：{rendered}{suffix}")
    return lines


def _analysis_items(data: dict[str, Any]) -> list[dict[str, Any]]:
    configured = data.get("project", {}).get("analysis_items") or data.get("analysis_items")
    if configured:
        return sorted(configured, key=lambda row: row.get("order", 0))
    units = data.get("project", {}).get("analysis_units", {})
    return [{"code": code, "name": code, "unit": units.get(code, ""), "order": i, "show": True}
            for i, code in enumerate(("Au", "Pb", "Zn"))]


def _display_value(value: Any, *, digits: int = 3) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, float):
        return f"{value:.{digits}f}".rstrip("0").rstrip(".")
    if isinstance(value, dict):
        return "；".join(f"{key}={_display_value(item, digits=digits)}" for key, item in value.items())
    if isinstance(value, (list, tuple)):
        return "；".join(_display_value(item, digits=digits) for item in value)
    return str(value)


def _rate_note(record: dict[str, Any]) -> str:
    value = record.get("recovery_original_percent")
    return f"　原始录入采取率 {_display_value(value)}%" if value is not None else ""


def _rate_display(record: dict[str, Any]) -> str:
    label = "计算采取率" if "recovery_original_percent" in record else "采取率"
    return f"{label} {_f(record.get('recovery_percent'))}%{_rate_note(record)}"


def _appendix_model(data: dict[str, Any]) -> dict[str, Any]:
    """Prepare explicit, source-preserving metadata panels without inferring units."""
    measurements = data.get("depth_measurements") or {}
    title = data.get("title_block") or {}
    basic = data.get("basic_info") or {}
    return {
        "analysis_items": _analysis_items(data),
        "measurements": measurements,
        "title": title,
        "basic": basic,
    }


def _basic_info_display_fields(data: dict[str, Any]) -> dict[str, Any]:
    basic = data.get("basic_info") or {}
    fields = dict(basic.get("fields") or {})
    for label, value in (basic.get("summary") or {}).items():
        fields.setdefault(str(label), value)
    return fields


def _measurement_columns() -> list[tuple[str, str]]:
    return [("序号", "sequence"), ("记录孔深 (m)", "recorded_depth_m"),
            ("校测孔深 (m)", "checked_depth_m"), ("误差 (m)", "error_m"),
            ("误差率 (%)", "error_percent"), ("测量孔深 (m)", "measurement_depth_m"),
            ("测量天顶角 (deg)", "zenith_deg"), ("实测方位角 (deg)", "azimuth_deg"),
            ("测量方法", "method"), ("仪器", "instrument")]


def _field_text(label: str, value: Any) -> str:
    if isinstance(value, dict):
        source = value.get("value")
        return _display_value(source)
    return _display_value(value)


def _measurement_value(record: dict[str, Any], key: str) -> Any:
    value = record.get(key)
    if key == "source" and isinstance(value, dict):
        cells = value.get("cells") or {}
        location = ", ".join(str(item) for item in cells.values())
        sheet_row = "!".join(str(part) for part in (value.get("sheet"), value.get("row")) if part not in (None, ""))
        return f"{sheet_row} {location}".strip()
    return value


def _title_rows(fields: dict[str, Any], width: float) -> list[dict[str, Any]]:
    if not fields:
        return []
    def scale_value(value: Any) -> str:
        text = _field_text("比例尺分母", value)
        if not text:
            return ""
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return f"1:{_display_value(value)}"
        return text
    rows: list[dict[str, Any]] = []
    full_width = width - 78.0
    for label in ("项目/单位", "图名"):
        value = fields.get(label, "")
        lines = _wrap_text(_field_text(label, value), full_width, 9.5)
        rows.append({"kind": "full", "items": [(label, value, _field_text(label, value))],
                     "height": max(26.0, len(lines) * 11.0 + 15.0)})
    pairs = [("拟编", "顺序号"), ("审核", "图号"), ("制图", "比例尺分母"),
             ("项目负责", "日期"), ("单位负责", "资料来源")]
    for left, right in pairs:
        items = []
        for label in (left, right):
            value = fields.get(label, "")
            rendered = scale_value(value) if label == "比例尺分母" else _field_text(label, value)
            items.append(("比例尺" if label == "比例尺分母" else label, value, rendered))
        value_width = width / 2.0 - 82.0
        line_count = max((len(_wrap_text(rendered, value_width, 9.2)) for _label, _value, rendered in items), default=1)
        rows.append({"kind": "paired", "items": items, "height": max(26.0, line_count * 11.0 + 15.0)})
    known = {"项目/单位", "图名", "拟编", "顺序号", "审核", "图号", "制图", "比例尺分母", "项目负责", "日期", "单位负责", "资料来源"}
    extras = [(str(label), value) for label, value in fields.items() if str(label) not in known]
    for offset in range(0, len(extras), 2):
        items = [(label, value, _field_text(label, value)) for label, value in extras[offset:offset + 2]]
        value_width = width / 2.0 - 82.0
        line_count = max((len(_wrap_text(rendered, value_width, 9.2)) for _label, _value, rendered in items), default=1)
        rows.append({"kind": "paired", "items": items, "height": max(26.0, line_count * 11.0 + 15.0)})
    return rows


def _basic_info_heights(fields: dict[str, Any], width: float) -> list[float]:
    if not fields:
        return []
    cell_width = max(160.0, (width - 70.0) / 3.0)
    entries = list(fields.items())
    heights = []
    for start in range(0, len(entries), 3):
        rows = entries[start:start + 3]
        line_count = max((len(_wrap_text(f"{label}：{_field_text(label, value)}", cell_width - 20, 10.5)) for label, value in rows), default=1)
        heights.append(max(20.0, line_count * 13.0 + 10.0))
    return heights


def _metadata_geometry(data: dict[str, Any], width: float) -> dict[str, float]:
    # Keep a readable left table and reserve a separate right-hand drawing block.
    left_width = max(1320.0, min(1650.0, width * 0.58))
    title_width = 760.0
    gap = 48.0
    title_x = 35.0 + left_width + gap
    canvas_width = max(width, title_x + title_width + 35.0)
    model = _appendix_model(data)
    records = model["measurements"].get("records") or []
    left_inner = left_width - 24.0
    columns = _measurement_columns()
    cell_width = left_inner / len(columns)
    header_height = max(30.0, max((len(_wrap_text(label, cell_width - 8.0, 8.5)) for label, _key in columns), default=1) * 10.0 + 10.0)
    row_heights = []
    for record in records:
        wrapped_lengths = [len(_wrap_text(_display_value(_measurement_value(record, key)), cell_width - 8.0, 9.2))
                               for _label, key in columns]
        row_heights.append(max(26.0, max(wrapped_lengths, default=1) * 10.5 + 10.0))
    summary = model["measurements"].get("summary") or {}
    signature = model["measurements"].get("signatures") or {}
    summary_text = "　".join(f"{key}：{_field_text(str(key), value)}" for key, value in summary.items())
    signature_text = "　".join(f"{key}：{_field_text(str(key), value)}" for key, value in signature.items())
    summary_lines = len(_wrap_text(summary_text, left_inner, 9.5)) if summary_text else 0
    signature_lines = len(_wrap_text(signature_text, left_inner, 9.5)) if signature_text else 0
    measurements_height = (44.0 + header_height + sum(row_heights) + summary_lines * 12.0 + signature_lines * 12.0 + 16.0) if records or summary or signature else 0.0
    basic_height = (22.0 + sum(_basic_info_heights(model["basic"].get("fields") or {}, canvas_width)) + 10.0
                    if model["basic"].get("fields") else 0.0)
    title_rows = _title_rows(model["title"].get("fields") or {}, title_width)
    title_height = 16.0 + sum(row["height"] for row in title_rows) + 8.0 if title_rows else 0.0
    return {"left_x": 35.0, "left_width": left_width, "title_x": title_x,
            "title_width": title_width, "canvas_width": canvas_width,
            "measurements_height": measurements_height, "measurements_header_height": header_height,
            "basic_height": basic_height,
            "title_height": title_height,
            "height": max(measurements_height, title_height)}


def _metadata_height(data: dict[str, Any], width: float) -> float:
    return _metadata_geometry(data, width)["height"]


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
    base_scale = max(9.0, scale_floor) if not detail else max(25.0, scale_floor)
    basic_fields = _basic_info_display_fields(data)
    plot_top = TOP
    layers = _visible(data["layers"], 0.0, hi)
    samples = sorted(_visible(data["samples"], 0.0, hi),
                     key=lambda row: (sum(_clip_interval(row, 0.0, hi)) / 2.0,
                                      float(row["top_m"]), float(row["bottom_m"]), str(row["id"])))
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
    basic_row_heights = _basic_info_heights(basic_fields, width)
    basic_rows = len(basic_row_heights)
    plot_top = TOP + (sum(basic_row_heights) + 44.0 if basic_rows else 0.0)

    # Prepare real sample label heights before selecting the shared depth scale.
    # This prevents vertically packed assay labels from drifting far below their
    # depth intervals and leaving the borehole column visually empty.
    sample_text_lines = []
    sample_assay_lines = []
    sample_heights = []
    for row in samples:
        lo_m, hi_m = float(row["top_m"]), float(row["bottom_m"])
        content = f"样品 {row['id']}　{_f(lo_m)}–{_f(hi_m)} m　样长 {_f(row.get('length_m'))} m　岩心长 {_f(row.get('core_m'))} m　{_rate_display(row)}"
        wrapped = _wrap_text(content, 390.0, 11.5)
        assay_wrapped = []
        assay_row = {**row, "analysis_items": _analysis_items(data),
                     "_integrated": bool(data.get("project", {}).get("analysis_items") or data.get("analysis_items"))}
        for assay_line in _analysis_lines(assay_row, data["project"].get("analysis_units", {})):
            assay_wrapped.extend(_wrap_text(assay_line, 245.0, 10.5))
        sample_text_lines.append(wrapped)
        sample_assay_lines.append(assay_wrapped)
        sample_heights.append(max(44.0, len(wrapped) * 15.0 + 10.0, len(assay_wrapped) * 15.0 + 12.0))

    sample_mid_depths = [sum(_clip_interval(row, 0.0, hi)) / 2.0 for row in samples]
    scale = base_scale
    if sample_mid_depths and sample_mid_depths[0] > 1e-6:
        first_fit = (sample_heights[0] / 2.0 + 7.0) / sample_mid_depths[0]
        if math.isfinite(first_fit):
            scale = max(scale, first_fit)
    for idx in range(1, len(samples)):
        depth_gap = sample_mid_depths[idx] - sample_mid_depths[idx - 1]
        # Coincident/nearly coincident samples retain the existing leader packing;
        # dividing by their depth difference would create an unbounded scale.
        if depth_gap <= 1e-6:
            continue
        required = ((sample_heights[idx - 1] + sample_heights[idx]) / 2.0 + 4.0) / depth_gap
        if math.isfinite(required):
            scale = max(scale, required)
    y = lambda depth: depth_y(depth, plot_top, scale)

    label_top = y(0.0) + 7.0
    depth_height = y(hi) - y(0.0)
    turn_lines = []
    turn_heights = []
    for turn in turns:
        row = (f'{turn["id"]}　{_f(turn.get("top_m"))}–{_f(turn.get("bottom_m"))} m　'
               f'进尺 {_f(turn.get("advance_m"))} m　岩心 {_f(turn.get("core_m"))} m　'
               f'{_rate_display(turn)}')
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
                  f'{_rate_display(row)}　花纹 {row.get("material_code") or "待配置"}')
        param_lines = _wrap_text(params, columns["description_width"], 10.5)
        description_lines.append(wrapped)
        description_param_lines.append(param_lines)
        description_heights.append(max(39.0, len(wrapped) * 15.0 + len(param_lines) * 13.0 + 14.0))
    description_label_y = _place_labels(layers, layer_mids, description_heights, lower=label_top)

    sample_mids = [y(depth) for depth in sample_mid_depths]
    sample_label_y = _place_labels(samples, sample_mids, sample_heights, lower=label_top, gap=4.0)

    structure_mids = [y(float(row["depth_m"])) for row in structures]
    structure_label_y = _place_labels(structures, structure_mids, [20.0] * len(structures), lower=label_top)
    structure_label_width = max((_text_width(f"{_f(row['depth_m'])} m　孔径 {_f(row['diameter_mm'], 2)} mm", 11.5) for row in structures), default=0.0)
    width = max(width, columns["structure_labels"] + structure_label_width + 24.0)
    metadata_geometry = _metadata_geometry(data, width)
    width = max(width, metadata_geometry["canvas_width"])
    metadata_geometry = _metadata_geometry(data, width)

    label_bottom = max(
        [y(hi), turn_bottom, label_top]
        + [center + height / 2 for center, height in zip(description_label_y, description_heights)]
        + [center + height / 2 for center, height in zip(sample_label_y, sample_heights)]
        + [center + 10.0 for center in structure_label_y]
    )
    footer_y = label_bottom + 56.0
    geometry_footer_height = 54.0
    metadata = _appendix_model(data)
    has_metadata = bool(metadata["basic"]) or bool(metadata["measurements"].get("records")) or bool(metadata["title"].get("fields"))
    metadata_top = footer_y + geometry_footer_height + 18.0 if has_metadata else None
    metadata_height = metadata_geometry["height"] if has_metadata else 0.0
    height = (metadata_top + metadata_height + 28.0) if has_metadata else footer_y + geometry_footer_height
    return {
        "endpoint": endpoint, "hi": hi, "scale": scale, "y": y, "width": width,
        "height": height, "depth_height": depth_height, "turn_bottom": turn_bottom,
        "plot_top": plot_top, "basic_rows": basic_rows, "basic_row_heights": basic_row_heights,
        "metadata_top": metadata_top, "metadata_height": metadata_height,
        "metadata_geometry": metadata_geometry,
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


def _draw_basic_info(data: dict[str, Any], layout: dict[str, Any], width: float) -> tuple[list[str], dict[str, Any]]:
    fields = _basic_info_display_fields(data)
    if not fields:
        return [], {"present": False}
    x, y0 = 35.0, 96.0
    full_width = width - 70.0
    cell_width = full_width / 3.0
    row_heights = layout["basic_row_heights"]
    out = [_text(x, 110.0, "基本信息", 11.5, weight="bold")]
    row_bounds = []
    entries = list(fields.items())
    cursor = y0 + 19.0
    for row_index, start in enumerate(range(0, len(entries), 3)):
        row_height = row_heights[row_index]
        rows = entries[start:start + 3]
        for column, (label, value) in enumerate(rows):
            cell_x = x + column * cell_width
            value_lines = _wrap_text(f"{label}：{_field_text(label, value)}", cell_width - 18.0, 10.5)
            for line_index, line in enumerate(value_lines):
                out.append(_text(cell_x + 6, cursor + 12.0 + line_index * 13.0, line, 10.5))
        out.append(f'<line class="fine" x1="{x:.2f}" y1="{cursor+row_height:.2f}" x2="{x+full_width:.2f}" y2="{cursor+row_height:.2f}"/>')
        row_bounds.append({"x": x, "y": cursor, "width": full_width, "height": row_height})
        cursor += row_height
    bounds = {"x": x, "y": y0, "width": full_width, "height": cursor - y0}
    return out, {"present": True, "bounds": bounds, "row_bounds": row_bounds, "fields": list(fields)}


def _draw_metadata(data: dict[str, Any], layout: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    if layout["metadata_top"] is None:
        return [], {"present": False}
    model = _appendix_model(data)
    geometry = layout["metadata_geometry"]
    top = layout["metadata_top"]
    x, left_width = geometry["left_x"], geometry["left_width"]
    title_x, title_width = geometry["title_x"], geometry["title_width"]
    out: list[str] = []
    panel_audit: dict[str, Any] = {"present": True, "panels": []}
    measurements = model["measurements"]
    records = measurements.get("records") or []
    summary = measurements.get("summary") or {}
    signatures = measurements.get("signatures") or {}
    if records or summary or signatures:
        panel_y = top
        out.append(f'<rect x="{x:.2f}" y="{panel_y:.2f}" width="{left_width:.2f}" height="{geometry["measurements_height"]:.2f}" fill="white" stroke="#333" stroke-width="1"/>')
        out.append(_text(x + 8, panel_y + 15, "孔深校正与弯曲度测量（与原始层/回次记录分列）", 11.5, weight="bold"))
        columns = _measurement_columns()
        cell_width = (left_width - 24.0) / len(columns)
        table_x = x + 8.0
        group_y = panel_y + 22.0
        group_width = cell_width * 5.0
        out.append(f'<rect x="{table_x:.2f}" y="{group_y:.2f}" width="{group_width:.2f}" height="18.00" fill="#e8e8e8" stroke="#aaa" stroke-width=".45"/>')
        out.append(f'<rect x="{table_x+group_width:.2f}" y="{group_y:.2f}" width="{group_width:.2f}" height="18.00" fill="#e8e8e8" stroke="#aaa" stroke-width=".45"/>')
        out.append(_text(table_x + group_width / 2, group_y + 13, "孔深校正", 9.5, anchor="middle", weight="bold"))
        out.append(_text(table_x + group_width * 1.5, group_y + 13, "弯曲度测量", 9.5, anchor="middle", weight="bold"))
        header_y = group_y + 18.0
        header_height = geometry["measurements_header_height"]
        for column, (label, _key) in enumerate(columns):
            cell_x = table_x + column * cell_width
            out.append(f'<rect x="{cell_x:.2f}" y="{header_y:.2f}" width="{cell_width:.2f}" height="{header_height:.2f}" fill="#f4f4f4" stroke="#aaa" stroke-width=".45"/>')
            for line_index, line in enumerate(_wrap_text(label, cell_width - 8.0, 8.5)):
                out.append(_text(cell_x + 4.0, header_y + 11.0 + line_index * 10.0, line, 8.5, weight="bold"))
        row_y = header_y + header_height
        row_audit = []
        for index, record in enumerate(records):
            field_rows = []
            cell_values = []
            row_height = 26.0
            for column, (label, key) in enumerate(columns):
                cell_x = table_x + column * cell_width
                value = _display_value(_measurement_value(record, key))
                value_lines = _wrap_text(value, cell_width - 8.0, 9.2)
                row_height = max(row_height, len(value_lines) * 10.5 + 10.0)
                cell_values.append((column, label, key, cell_x, value_lines))
            for column, label, key, cell_x, value_lines in cell_values:
                fill = "#f0f0f0" if column % 2 == 0 else "#fafafa"
                out.append(f'<rect x="{cell_x:.2f}" y="{row_y:.2f}" width="{cell_width:.2f}" height="{row_height:.2f}" fill="{fill}" stroke="#aaa" stroke-width=".45"/>')
                for line_index, line in enumerate(value_lines):
                    out.append(_text(cell_x + 4.0, row_y + 14.0 + line_index * 10.5, line, 9.2))
                field_rows.append({"label": label, "key": key, "bounds": {"x": cell_x, "y": row_y, "width": cell_width, "height": row_height}})
            row_audit.append({"record_index": index, "bounds": {"x": table_x, "y": row_y, "width": left_width - 16.0, "height": row_height}, "fields": field_rows})
            row_y += row_height
        meta_items = [(str(key), value) for key, value in summary.items()]
        if meta_items:
            line = "　".join(f"{label}：{_field_text(label, value)}" for label, value in meta_items)
            for line_index, wrapped in enumerate(_wrap_text(line, left_width - 20.0, 9.5)):
                out.append(_text(x + 8, row_y + 12 + line_index * 12, wrapped, 9.5))
            row_y += max(18.0, len(_wrap_text(line, left_width - 20.0, 9.5)) * 12.0)
        signature_items = [(str(key), value) for key, value in signatures.items()]
        if signature_items:
            line = "　".join(f"{label}：{_field_text(label, value)}" for label, value in signature_items)
            for line_index, wrapped in enumerate(_wrap_text(line, left_width - 20.0, 9.5)):
                out.append(_text(x + 8, row_y + 12 + line_index * 12, wrapped, 9.5))
            row_y += max(18.0, len(_wrap_text(line, left_width - 20.0, 9.5)) * 12.0)
        panel_audit["panels"].append({"kind": "depth_measurements", "bounds": {"x": x, "y": panel_y, "width": left_width, "height": geometry["measurements_height"]}, "rows": row_audit, "summary_fields": list(summary), "signature_fields": list(signatures), "source_records": [record.get("source", {}) for record in records], "derived_flags": [record.get("derived") for record in records]})

    title_fields = model["title"].get("fields") or {}
    title_source = model["title"].get("source_cells") or {}
    if title_fields:
        panel_y = top
        rows = _title_rows(title_fields, title_width)
        out.append(f'<rect x="{title_x:.2f}" y="{panel_y:.2f}" width="{title_width:.2f}" height="{geometry["title_height"]:.2f}" fill="white" stroke="#333" stroke-width="1"/>')
        row_bounds = []
        row_y = panel_y
        for row in rows:
            row_height = row["height"]
            out.append(f'<rect x="{title_x:.2f}" y="{row_y:.2f}" width="{title_width:.2f}" height="{row_height:.2f}" fill="#fafafa" stroke="#aaa" stroke-width=".45"/>')
            if row["kind"] == "full":
                label, _value, display = row["items"][0]
                out.append(_text(title_x + 5, row_y + 14, label, 9.5, weight="bold"))
                for line_index, line in enumerate(_wrap_text(display, title_width - 88.0, 9.5)):
                    out.append(_text(title_x + 80, row_y + 14 + line_index * 11.0, line, 9.5))
            else:
                for side, (label, _value, display) in enumerate(row["items"]):
                    cell_x = title_x + side * (title_width / 2.0)
                    out.append(_text(cell_x + 5, row_y + 14, label, 9.2, weight="bold"))
                    for line_index, line in enumerate(_wrap_text(display, title_width / 2.0 - 86.0, 9.2)):
                        out.append(_text(cell_x + 82, row_y + 14 + line_index * 11.0, line, 9.2))
            row_bounds.append({"x": title_x, "y": row_y, "width": title_width, "height": row_height})
            row_y += row_height
        panel_audit["panels"].append({"kind": "title_block", "bounds": {"x": title_x, "y": panel_y, "width": title_width, "height": geometry["title_height"]}, "rows": row_bounds, "fields": list(title_fields), "source_cells": title_source})
    audited_bounds = []
    for panel in panel_audit["panels"]:
        audited_bounds.append({"kind": panel["kind"], **panel["bounds"]})
        for row in panel.get("rows", []):
            if "bounds" in row:
                audited_bounds.append({"kind": f'{panel["kind"]}_row', **row["bounds"]})
            for field in row.get("fields", []):
                if "bounds" in field:
                    audited_bounds.append({"kind": f'{panel["kind"]}_field', **field["bounds"]})
    panel_audit["bounds"] = audited_bounds
    panel_audit["within_canvas"] = all(
        box["x"] >= 0 and box["y"] >= 0
        and box["x"] + box["width"] <= layout["width"] + 1e-6
        and box["y"] + box["height"] <= layout["height"] + 1e-6
        for box in audited_bounds
    )
    return out, panel_audit


def render_drill_svg(data: dict[str, Any], *, detail: bool = False) -> tuple[str, dict[str, Any]]:
    """Render all records in the selected full-depth or 0–45 m view."""
    integrated_source=data.get("source") or {}
    if (data.get("schema_version")=="drill-integrated-1.0"
            and integrated_source.get("template_version") in {"v2","v3"}):
        from drill_reference_renderer import render_reference_drill_svg
        return render_reference_drill_svg(data, detail=detail)
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
    basic_svg, basic_audit = _draw_basic_info(data, layout, width)
    out.extend(basic_svg)

    headings = [
        (cols["axis"], "孔深 (m)"), (cols["turn"], "回次记录（独立列表）"),
        (cols["layer"], "分层区间"), (cols["lith"], "岩性柱"),
        (cols["description"], "岩性描述与段参数"),
        (cols["sample"], f'样品区间（{layout["lane_count"]} 轨）'),
        (cols["sample_labels"], "样品明细（引线对应样品）"),
        (cols["assay"], "分析项目结果"),
        (cols["structure"], "孔径点"),
        (cols["structure_labels"], "深度与孔径"),
    ]
    for x, label in headings:
        out.append(_text(x, layout["plot_top"] - 18, label, 12, weight="bold"))

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
            "label_height": layout["sample_heights"][idx],
            "label_top_y": label_y - layout["sample_heights"][idx] / 2.0,
            "label_bottom_y": label_y + layout["sample_heights"][idx] / 2.0,
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
    if layout["metadata_top"] is not None:
        out.append(_text(35, footer + 38, "图面比例为参考像素比例，实际打印尺寸需另行核验；不保证90 mm打印精度。", 9.5))
    metadata_svg, metadata_audit = _draw_metadata(data, layout)
    out.extend(metadata_svg)
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
        "basic_info": basic_audit,
        "metadata": metadata_audit,
        "metadata_viewport_extended": bool(layout["metadata_top"] is not None),
        "canvas_bounds": {"viewBox": [0.0, 0.0, width, height],
                          "metadata_within_canvas": metadata_audit.get("within_canvas", True),
                          "basic_info_within_canvas": (not basic_audit.get("present") or
                              (basic_audit["bounds"]["x"] >= 0 and basic_audit["bounds"]["y"] >= 0 and
                               basic_audit["bounds"]["x"] + basic_audit["bounds"]["width"] <= width + 1e-6 and
                               basic_audit["bounds"]["y"] + basic_audit["bounds"]["height"] <= height + 1e-6))},
        "detail_crop_is_not_geologic_boundary": bool(crop),
        "svg_image_elements": 0,
        "source_values_rounded_for_display_only": True,
        "pending_patterns": [row["id"] for row in data["layers"] if not row.get("material_code")],
    }
    return "".join(out), audit
