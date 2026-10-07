"""Generate a geology readability aid from normalized data and world geometry.

The output is an auxiliary data-review figure.  It reuses the passed
``layer_geometry`` polygons and contacts; it never moves boundaries, widens a
source interval, or interprets descriptive approximate thickness as measured
true thickness.
"""

from __future__ import annotations

import hashlib
import html
import json
import math
from pathlib import Path
from typing import Any, Iterable, Optional


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _esc(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def _fmt(value: Any, decimals: int = 3) -> str:
    if not _finite(value):
        return "未提供"
    text = f"{float(value):.{decimals}f}".rstrip("0").rstrip(".")
    return "0" if text in {"", "-0"} else text


def _text(x: float, y: float, value: Any, cls: str = "", anchor: str = "start") -> str:
    return f'<text x="{x:.3f}" y="{y:.3f}" class="{cls}" text-anchor="{anchor}">{_esc(value)}</text>'


def _wrap(text: str, width: int) -> list[str]:
    value = " ".join(str(text or "").split())
    return [value[i:i + width] for i in range(0, len(value), width)] or [""]


def _description_excerpt(description: str) -> str:
    """Select exact source sentences; never parse their approximate numbers."""
    text = str(description or "").strip()
    if not text:
        return "未提供岩性描述"
    sentences = [piece.strip() for piece in text.split("。") if piece.strip()]
    selected: list[str] = []
    if sentences:
        selected.append(sentences[0])
    for sentence in sentences[1:]:
        if "厚" in sentence or "煤线" in sentence:
            if sentence not in selected:
                selected.append(sentence)
    return "。".join(selected) + "。"


def _pattern_content(spec: dict[str, Any], width: float, height: float) -> str:
    stroke = _esc(spec.get("stroke", "#36404a"))
    unverified = spec.get("reference_status") == "unverified"
    pieces = [f'<rect width="{width:g}" height="{height:g}" fill="{("#ffffff" if unverified else _esc(spec.get("background", "#eeeeee")))}"/>']
    if unverified:
        return "".join(pieces)
    for primitive in spec.get("svg", []):
        kind = primitive.get("type")
        line_width = float(primitive.get("width", 1.1))
        common = f'fill="none" stroke="{stroke}" stroke-width="{line_width:g}"'
        if kind == "line":
            pieces.append(f'<line x1="{primitive["x1"]}" y1="{primitive["y1"]}" x2="{primitive["x2"]}" y2="{primitive["y2"]}" {common}/>')
        elif kind == "circle":
            pieces.append(f'<circle cx="{primitive["cx"]}" cy="{primitive["cy"]}" r="{primitive["r"]}" fill="{stroke}" stroke="none"/>')
        elif kind == "path":
            pieces.append(f'<path d="{_esc(primitive["d"])}" {common}/>')
    return "".join(pieces)


def _pattern_defs(materials_doc: dict[str, Any], intervals: list[dict[str, Any]],
                  records_by_id: dict[Any, dict[str, Any]], axis_deg: float,
                  region_by_id: dict[str, dict[str, Any]]) -> tuple[str, dict[str, str], list[dict[str, Any]]]:
    tile = materials_doc.get("tile") or {"width": 24, "height": 24}
    scales = materials_doc.get("render_scales") or {}
    readability_scale = float(scales.get("readability", 1) or 1)
    focus_scale = float(scales.get("focus", 1) or 1)
    materials = materials_doc.get("materials") or {}
    defs: list[str] = []
    base_ids: dict[str, str] = {}
    pattern_audit: list[dict[str, Any]] = []
    for name, spec in materials.items():
        pid = f'read_base_{spec.get("id", hashlib.sha256(name.encode()).hexdigest()[:12])}'
        base_ids[name] = pid
        width = float(spec.get("tile_width", tile.get("width", 24)))
        height = float(spec.get("tile_height", tile.get("height", 24)))
        defs.append(f'<pattern id="{_esc(pid)}" width="{width:g}" height="{height:g}" patternUnits="userSpaceOnUse" patternTransform="scale({readability_scale:.6f})">{_pattern_content(spec, width, height)}</pattern>')
    defs.append(f'<pattern id="read_pending" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="scale({readability_scale:.6f})"><rect width="14" height="14" fill="#ffffff"/></pattern>')
    defs.append(f'<pattern id="read_pending_focus" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="scale({focus_scale:.6f})"><rect width="14" height="14" fill="#ffffff"/></pattern>')

    interval_patterns: dict[str, str] = {}
    for index, interval in enumerate(intervals):
        interval_id = str(interval.get("id", f"I{index + 1}"))
        name = str(interval.get("lithology_name") or "").strip()
        spec = materials.get(name)
        record_ids = interval.get("record_ids") or []
        record = records_by_id.get(record_ids[0]) if record_ids else None
        apparent_angle: Optional[float] = None
        svg_rotation: Optional[float] = None
        if spec and spec.get("orientation") == "bedding" and record:
            dip_direction, dip_angle = record.get("dip_direction_deg"), record.get("dip_angle_deg")
            if _finite(dip_direction) and _finite(dip_angle):
                delta = math.radians(float(dip_angle))
                qx = math.cos(delta)
                qz = -math.sin(delta) * math.cos(math.radians(axis_deg - float(dip_direction)))
                if math.hypot(qx, qz) > 1e-12:
                    apparent_angle = math.degrees(math.atan2(qz, qx))
                    # World z is upward while SVG y is downward.
                    svg_rotation = -apparent_angle
        if not spec:
            interval_patterns[interval_id] = "read_pending_focus"
            pattern_audit.append({"interval_id": interval_id, "layer_id": interval.get("layer_id"),
                                  "material_name": name, "pattern_id": "read_pending_focus", "configured": False,
                                  "orientation": None, "apparent_angle_deg_world_z_up": None,
                                  "svg_rotation_deg_y_down": None, "reference_status": None,
                                  "reference_evidence": None, "render_scale": focus_scale})
            continue
        pid = f'read_interval_{index + 1:04d}'
        width = float(spec.get("tile_width", tile.get("width", 24)))
        height = float(spec.get("tile_height", tile.get("height", 24)))
        rotation = float(svg_rotation or 0)
        transform = f' patternTransform="rotate({rotation:.12g}) scale({focus_scale:.6f})"'
        defs.append(f'<pattern id="{pid}" width="{width:g}" height="{height:g}" patternUnits="userSpaceOnUse"{transform}>{_pattern_content(spec, width, height)}</pattern>')
        interval_patterns[interval_id] = pid
        feature = spec.get("anchor_feature")
        valid_feature = (isinstance(feature, (list, tuple)) and len(feature) >= 2 and
                         _finite(feature[0]) and _finite(feature[1]))
        anchor = _largest_polygon_anchor(region_by_id.get(interval_id, {})) if valid_feature else None
        phase_anchor = {"status": "anchored" if anchor else ("not_configured" if not valid_feature else "no_drawn_polygon"),
                        "feature_tile": [float(feature[0]), float(feature[1])] if valid_feature else None,
                        "world": anchor.get("world") if anchor else None,
                        "polygon_index": anchor.get("polygon_index") if anchor else None,
                        "polygon_area_m2": anchor.get("area_m2") if anchor else None,
                        "contexts": []}
        pattern_audit.append({"interval_id": interval_id, "layer_id": interval.get("layer_id"),
                              "material_name": name, "pattern_id": pid, "configured": True,
                              "orientation": spec.get("orientation", "none"),
                              "reference_status": spec.get("reference_status"),
                              "reference_evidence": spec.get("reference_evidence"),
                              "tile_width": width, "tile_height": height,
                              "render_scale": focus_scale,
                              "phase_anchor": phase_anchor,
                              "apparent_angle_deg_world_z_up": apparent_angle,
                              "svg_rotation_deg_y_down": svg_rotation,
                              "record_id": record.get("id") if record else None,
                              "source_cells": (record or {}).get("source_cells", {})})
    return "".join(defs), interval_patterns, pattern_audit


def _clip_axis(polygon: list[tuple[float, float]], axis: int, bound: float, keep_greater: bool) -> list[tuple[float, float]]:
    if not polygon:
        return []
    output: list[tuple[float, float]] = []
    previous = polygon[-1]
    previous_inside = previous[axis] >= bound if keep_greater else previous[axis] <= bound
    for current in polygon:
        current_inside = current[axis] >= bound if keep_greater else current[axis] <= bound
        if current_inside != previous_inside:
            denominator = current[axis] - previous[axis]
            if abs(denominator) > 1e-14:
                t = (bound - previous[axis]) / denominator
                output.append((previous[0] + t * (current[0] - previous[0]),
                               previous[1] + t * (current[1] - previous[1])))
        if current_inside:
            output.append(current)
        previous, previous_inside = current, current_inside
    return output


def _clip_polygon_rect(polygon: Iterable[Iterable[float]], bounds: tuple[float, float, float, float]) -> list[tuple[float, float]]:
    x_lo, x_hi, z_lo, z_hi = bounds
    result = [(float(point[0]), float(point[1])) for point in polygon]
    for axis, bound, keep_greater in ((0, x_lo, True), (0, x_hi, False), (1, z_lo, True), (1, z_hi, False)):
        result = _clip_axis(result, axis, bound, keep_greater)
    return result


def _signed_area(polygon: list[tuple[float, float]]) -> float:
    return sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(polygon, polygon[1:] + polygon[:1])) / 2


def _largest_polygon_anchor(region: dict[str, Any]) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    for polygon_index, polygon in enumerate(region.get("polygons") or []):
        points = [(float(p[0]), float(p[1])) for p in polygon
                  if isinstance(p, (list, tuple)) and len(p) >= 2 and _finite(p[0]) and _finite(p[1])]
        if len(points) < 3:
            continue
        cross_sum = 0.0
        cx_sum = 0.0
        cy_sum = 0.0
        for p, q in zip(points, points[1:] + points[:1]):
            cross = p[0] * q[1] - q[0] * p[1]
            cross_sum += cross
            cx_sum += (p[0] + q[0]) * cross
            cy_sum += (p[1] + q[1]) * cross
        if abs(cross_sum) <= 1e-12:
            continue
        candidate = {"polygon_index": polygon_index,
                     "world": [cx_sum / (3 * cross_sum), cy_sum / (3 * cross_sum)],
                     "area_m2": abs(cross_sum) / 2}
        if best is None or candidate["area_m2"] > best["area_m2"]:
            best = candidate
    return best


def _clip_segment_rect(segment: list[list[float]], bounds: tuple[float, float, float, float]) -> Optional[list[tuple[float, float]]]:
    x_lo, x_hi, z_lo, z_hi = bounds
    x1, z1 = map(float, segment[0])
    x2, z2 = map(float, segment[1])
    dx, dz = x2 - x1, z2 - z1
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x1 - x_lo), (dx, x_hi - x1), (-dz, z1 - z_lo), (dz, z_hi - z1)):
        if abs(p) <= 1e-14:
            if q < 0:
                return None
            continue
        r = q / p
        if p < 0:
            if r > t1:
                return None
            t0 = max(t0, r)
        else:
            if r < t0:
                return None
            t1 = min(t1, r)
    return [(x1 + t0 * dx, z1 + t0 * dz), (x1 + t1 * dx, z1 + t1 * dz)]


def _terrain_z(nodes: list[dict[str, Any]], x: float) -> Optional[float]:
    for left, right in zip(nodes, nodes[1:]):
        x1, x2 = float(left["x_m"]), float(right["x_m"])
        if min(x1, x2) - 1e-10 <= x <= max(x1, x2) + 1e-10 and abs(x2 - x1) > 1e-12:
            t = (x - x1) / (x2 - x1)
            return float(left["z_m"]) + t * (float(right["z_m"]) - float(left["z_m"]))
    return None


def _terrain_window(nodes: list[dict[str, Any]], x_lo: float, x_hi: float) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for x in (x_lo,):
        z = _terrain_z(nodes, x)
        if z is not None:
            points.append((x, z))
    points.extend((float(node["x_m"]), float(node["z_m"])) for node in nodes if x_lo < float(node["x_m"]) < x_hi)
    for x in (x_hi,):
        z = _terrain_z(nodes, x)
        if z is not None:
            points.append((x, z))
    return sorted(points)


def _nice_scale_length(target_metres: float) -> float:
    if target_metres <= 0:
        return 1.0
    power = 10 ** math.floor(math.log10(target_metres))
    fraction = target_metres / power
    value = 1 if fraction < 1.5 else 2 if fraction < 3.5 else 5 if fraction < 7.5 else 10
    return value * power


def _true_thickness_display(records: list[dict[str, Any]]) -> str:
    values = [record.get("true_thickness_m") for record in records if _finite(record.get("true_thickness_m"))]
    if not values:
        return "未提供"
    unique: list[float] = []
    for value in values:
        if not any(abs(float(value) - old) <= 1e-12 for old in unique):
            unique.append(float(value))
    return "、".join(f"{_fmt(value)} m" for value in unique)


def render_readability(data: dict[str, Any], geometry: dict[str, Any], materials_doc: dict[str, Any],
                       output_dir: str | Path, config: Optional[dict[str, Any]] = None) -> dict[str, str]:
    """Write ``readability.svg`` and ``readability-audit.json``.

    Focus panels are selected only by material ``focus_priority``.  Every panel
    maps x and z with one common pixels-per-metre value; different panels may
    use different magnifications and carry their own metre scale.
    """
    cfg = {"page_width_px": 1600, "margin_px": 56, "focus_plot_height_px": 380,
           "focus_panel_gap_px": 28, "card_height_px": 102}
    cfg.update(config or {})
    page_width = float(cfg["page_width_px"])
    margin = float(cfg["margin_px"])
    plot_height = float(cfg["focus_plot_height_px"])
    intervals = list(data.get("intervals") or [])
    records = list(data.get("records") or [])
    nodes = list(data.get("nodes") or [])
    regions = list(geometry.get("regions") or [])
    contacts = list(geometry.get("contacts") or [])
    materials = materials_doc.get("materials") or {}
    axis = float((data.get("settings") or {}).get("axis_azimuth_deg", 0.0))
    records_by_id = {record.get("id"): record for record in records}
    interval_by_id = {str(interval.get("id")): interval for interval in intervals}
    region_by_id = {str(region.get("interval_id")): region for region in regions}
    defs, interval_patterns, pattern_audit = _pattern_defs(materials_doc, intervals, records_by_id, axis, region_by_id)

    focus_intervals = []
    for order, interval in enumerate(intervals):
        spec = materials.get(str(interval.get("lithology_name") or "").strip()) or {}
        priority = spec.get("focus_priority", 0)
        if _finite(priority) and float(priority) > 0:
            focus_intervals.append((float(priority), order, interval, spec))
    focus_intervals.sort(key=lambda item: (-item[0], item[1]))

    focus_panels: list[dict[str, Any]] = []
    focus_panel_heights: list[float] = []
    x_all = [float(node["x_m"]) for node in nodes] or [0.0, 1.0]
    x_min, x_max = min(x_all), max(x_all)
    total_x_span = max(x_max - x_min, 1e-9)
    depth = float(geometry.get("effective_depth_m") or 0.0)
    focus_plot_width = page_width - 2 * margin - 150
    main_units_per_px = total_x_span / max(focus_plot_width, 1)

    for priority, order, interval, spec in focus_intervals:
        start, end = int(interval["start_node"]), int(interval["end_node"])
        source_x1, source_x2 = float(nodes[start]["x_m"]), float(nodes[end]["x_m"])
        source_width = abs(source_x2 - source_x1)
        target_span = max(source_width * 1.5, depth * 4.2, total_x_span * 0.012)
        center = (source_x1 + source_x2) / 2
        x_lo, x_hi = max(x_min, center - target_span / 2), min(x_max, center + target_span / 2)
        if x_hi - x_lo < target_span and x_lo <= x_min + 1e-12:
            x_hi = min(x_max, x_lo + target_span)
        if x_hi - x_lo < target_span and x_hi >= x_max - 1e-12:
            x_lo = max(x_min, x_hi - target_span)
        terrain = _terrain_window(nodes, x_lo, x_hi)
        terrain_z = [point[1] for point in terrain] or [0.0]
        z_hi = max(terrain_z) + max(depth * 0.08, 0.5)
        z_lo = min(terrain_z) - depth - max(depth * 0.08, 0.5)
        x_span, z_span = max(x_hi - x_lo, 1e-9), max(z_hi - z_lo, 1e-9)
        units_per_px = max(x_span / focus_plot_width, z_span / plot_height)
        draw_width, draw_height = x_span / units_per_px, z_span / units_per_px
        description = str(interval.get("description") or "")
        excerpt = _description_excerpt(description)
        description_lines = _wrap(excerpt, 74)
        target_boundary_nodes = [node_index for node_index in (start, end) if 0 < node_index < len(nodes) - 1]
        target_contact_ids = [contact.get("id") for contact in contacts if contact.get("node") in target_boundary_nodes]
        panel_height = 140 + plot_height + max(42, len(description_lines) * 22)
        focus_panel_heights.append(panel_height)
        focus_panels.append({
            "interval_id": str(interval.get("id")), "layer_id": interval.get("layer_id"),
            "material_name": interval.get("lithology_name"), "focus_priority": priority,
            "reference_status": spec.get("reference_status"), "reference_evidence": spec.get("reference_evidence"),
            "source_node_indices": list(range(start, end + 1)), "record_ids": list(interval.get("record_ids") or []),
            "description_full": description, "description_excerpt": excerpt,
            "description_source_cells": (interval.get("source_cells") or {}).get("description", []),
            "true_thickness_values": [records_by_id[rid].get("true_thickness_m") for rid in interval.get("record_ids", []) if rid in records_by_id],
            "x_window_m": [x_lo, x_hi], "z_window_m": [z_lo, z_hi], "units_per_px": units_per_px,
            "magnification_vs_full_width": main_units_per_px / units_per_px,
            "draw_size_px": [draw_width, draw_height], "description_lines": description_lines,
            "target_boundary_nodes": target_boundary_nodes, "target_contact_ids": target_contact_ids,
        })

    focus_top = 150.0
    focus_total = sum(focus_panel_heights) + max(0, len(focus_panel_heights) - 1) * float(cfg["focus_panel_gap_px"])
    cards_top = focus_top + focus_total + (66 if focus_panels else 28)
    card_height = float(cfg["card_height_px"])
    page_height = cards_top + 74 + len(intervals) * card_height + 90
    svg: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{page_width:.0f}" height="{page_height:.0f}" viewBox="0 0 {page_width:.0f} {page_height:.0f}">',
        f'<defs>{defs}</defs>',
        '<style>text{font-family:"Microsoft YaHei",sans-serif;fill:#182431}.title{font-size:27px;font-weight:700}.h2{font-size:20px;font-weight:700}.h3{font-size:17px;font-weight:700}.body{font-size:14px}.small{font-size:12px;fill:#536273}.tiny{font-size:11px;fill:#5f6d79}.panel{fill:#fff;stroke:#b9c4ce;stroke-width:1}.grid{stroke:#d9e0e6;stroke-width:1}.terrain{fill:none;stroke:#111;stroke-width:2}.contact{stroke:#b03a36;stroke-width:1.4;stroke-dasharray:6 3}.focuscontact{stroke:#ef8b00;stroke-width:3;fill:none}.scale{stroke:#17202a;stroke-width:1.3}.cardline{stroke:#cbd3da;stroke-width:1}</style>',
        _text(margin, 46, "岩性与重点层识读图 · 数据核验辅助图", "title"),
        _text(margin, 76, "行业图式尚未完成核验；本图只增强识读，不改变源节点、层界、投影宽度或真厚度字段。", "body"),
        _text(margin, 102, "每个局部窗横纵同尺度并有独立米标尺；不同窗口可有不同放大倍率，不能据样块或窗口大小比较厚度。", "small"),
    ]

    pattern_audit_by_interval = {str(item.get("interval_id")): item for item in pattern_audit}
    focus_scale = float((materials_doc.get("render_scales") or {}).get("focus", 1) or 1)
    tile = materials_doc.get("tile") or {"width": 24, "height": 24}
    y = focus_top
    for panel_index, (panel, panel_height) in enumerate(zip(focus_panels, focus_panel_heights), 1):
        interval = interval_by_id[panel["interval_id"]]
        bounds = (*panel["x_window_m"], *panel["z_window_m"])
        x_lo, x_hi, z_lo, z_hi = bounds
        units = panel["units_per_px"]
        plot_x = margin + 75
        plot_y = y + 78
        plot_w, plot_h = panel["draw_size_px"]
        sx = lambda x: plot_x + (x - x_lo) / units
        sy = lambda z: plot_y + (z_hi - z) / units
        panel_pattern_ids: dict[str, str] = {}
        panel_defs: list[str] = []
        for region in regions:
            region_id = str(region.get("interval_id"))
            if not any(len(_clip_polygon_rect(polygon, bounds)) >= 3
                       for polygon in (region.get("polygons") or [])):
                continue
            audit_item = pattern_audit_by_interval.get(region_id) or {}
            phase = audit_item.get("phase_anchor") or {}
            world = phase.get("world")
            feature = phase.get("feature_tile")
            region_interval = interval_by_id.get(region_id)
            spec = materials.get(str((region_interval or {}).get("lithology_name") or "").strip())
            if not (world and feature and spec):
                continue
            ax, ay = sx(float(world[0])), sy(float(world[1]))
            inverse = [x_lo + (ax - plot_x) * units, z_hi - (ay - plot_y) * units]
            rotation = float(audit_item.get("svg_rotation_deg_y_down") or 0)
            width = float(spec.get("tile_width", tile.get("width", 24)))
            height = float(spec.get("tile_height", tile.get("height", 24)))
            pid = f'read_panel_{panel_index:03d}_{_esc(audit_item.get("pattern_id", region_id))}'
            transform = (f'translate({ax:.6f} {ay:.6f}) rotate({rotation:.12g}) '
                         f'scale({focus_scale:.6f}) translate({-float(feature[0]):.6f} {-float(feature[1]):.6f})')
            panel_defs.append(
                f'<pattern id="{pid}" width="{width:g}" height="{height:g}" patternUnits="userSpaceOnUse" '
                f'patternTransform="{transform}" data-anchor-world="{float(world[0]):.12g},{float(world[1]):.12g}" '
                f'data-anchor-svg="{ax:.6f},{ay:.6f}" data-anchor-feature="{float(feature[0]):.6f},{float(feature[1]):.6f}">'
                f'{_pattern_content(spec, width, height)}</pattern>')
            panel_pattern_ids[region_id] = pid
            phase.setdefault("contexts", []).append({
                "context": "focus", "panel_index": panel_index,
                "svg_anchor_px": [ax, ay], "inverse_world_m": inverse,
                "inverse_error_m": math.hypot(inverse[0] - float(world[0]), inverse[1] - float(world[1])),
                "render_scale": focus_scale,
            })
        if panel_defs:
            svg.append(f'<defs>{"".join(panel_defs)}</defs>')
        svg.append(f'<rect x="{margin:.3f}" y="{y:.3f}" width="{page_width-2*margin:.3f}" height="{panel_height:.3f}" rx="8" class="panel"/>')
        status_suffix = "（纹样待核对）" if panel.get("reference_status") == "unverified" else ""
        svg.append(_text(margin + 18, y + 31, f'{panel["layer_id"]}  {panel["material_name"]}{status_suffix}', "h2"))
        true_records = [records_by_id[rid] for rid in interval.get("record_ids", []) if rid in records_by_id]
        svg.append(_text(page_width - margin - 18, y + 29,
                         f'实测真厚度：{_true_thickness_display(true_records)}', "small", "end"))
        svg.append(_text(page_width - margin - 18, y + 50,
                         f'相对全宽放大 {_fmt(panel["magnification_vs_full_width"], 2)}×；距离见米标尺', "tiny", "end"))
        svg.append(f'<rect x="{plot_x:.3f}" y="{plot_y:.3f}" width="{plot_w:.3f}" height="{plot_h:.3f}" fill="#f8fafb" stroke="#7f8d99"/>')
        for region in regions:
            region_interval = interval_by_id.get(str(region.get("interval_id")))
            if not region_interval:
                continue
            pid = panel_pattern_ids.get(str(region.get("interval_id")),
                                        interval_patterns.get(str(region.get("interval_id")), "read_pending"))
            clipped_parts: list[list[tuple[float, float]]] = []
            for polygon in region.get("polygons") or []:
                clipped = _clip_polygon_rect(polygon, bounds)
                if len(clipped) < 3:
                    continue
                # Normalize winding before mapping world z-up coordinates to
                # SVG y-down.  One compound path lets the rasterizer fill the
                # union without antialiasing shared edges as separate shapes.
                if _signed_area(clipped) < 0:
                    clipped = list(reversed(clipped))
                clipped_parts.append(clipped)
            if clipped_parts:
                path_data = " ".join(
                    "M " + " L ".join(f"{sx(px):.6f} {sy(pz):.6f}" for px, pz in part) + " Z"
                    for part in clipped_parts
                )
                svg.append(f'<path d="{path_data}" fill="url(#{_esc(pid)})" fill-opacity="1" fill-rule="nonzero" stroke="none"/>')
        for contact in contacts:
            for segment in contact.get("segments") or []:
                clipped = _clip_segment_rect(segment, bounds)
                if clipped:
                    svg.append(f'<line x1="{sx(clipped[0][0]):.6f}" y1="{sy(clipped[0][1]):.6f}" x2="{sx(clipped[1][0]):.6f}" y2="{sy(clipped[1][1]):.6f}" class="contact"/>')
                    if contact.get("id") in panel["target_contact_ids"]:
                        svg.append(f'<line x1="{sx(clipped[0][0]):.6f}" y1="{sy(clipped[0][1]):.6f}" x2="{sx(clipped[1][0]):.6f}" y2="{sy(clipped[1][1]):.6f}" class="focuscontact"/>')
        terrain = _terrain_window(nodes, x_lo, x_hi)
        if terrain:
            svg.append(f'<polyline points="{" ".join(f"{sx(px):.6f},{sy(pz):.6f}" for px,pz in terrain)}" class="terrain"/>')
        scale_m = _nice_scale_length((x_hi - x_lo) * 0.18)
        scale_px = scale_m / units
        scale_x, scale_y = plot_x + 16, plot_y + plot_h - 18
        svg.append(f'<g class="scale"><line x1="{scale_x:.3f}" y1="{scale_y:.3f}" x2="{scale_x+scale_px:.3f}" y2="{scale_y:.3f}"/><line x1="{scale_x:.3f}" y1="{scale_y-5:.3f}" x2="{scale_x:.3f}" y2="{scale_y+5:.3f}"/><line x1="{scale_x+scale_px:.3f}" y1="{scale_y-5:.3f}" x2="{scale_x+scale_px:.3f}" y2="{scale_y+5:.3f}"/></g>')
        svg.append(_text(scale_x + scale_px / 2, scale_y - 8, f"{_fmt(scale_m)} m", "small", "middle"))
        svg.append(_text(plot_x, plot_y + plot_h + 20,
                         "橙线为目标层的产状推算边界；显示深度仅作识读示意，不表示实测厚度。", "tiny"))
        desc_y = plot_y + plot_h + 45
        svg.append(_text(margin + 18, desc_y, "原始描述节选：", "small"))
        for line_index, line in enumerate(panel["description_lines"]):
            svg.append(_text(margin + 150, desc_y + line_index * 21, line, "body"))
        y += panel_height + float(cfg["focus_panel_gap_px"])

    svg.extend([
        _text(margin, cards_top, "全部连续层段识读表", "h2"),
        _text(page_width - margin, cards_top, f"共 {len(intervals)} 个层段（数量由当前数据动态读取）", "small", "end"),
        f'<rect x="{margin:.3f}" y="{cards_top+20:.3f}" width="{page_width-2*margin:.3f}" height="44" fill="#eaf0f5" stroke="#aeb9c4"/>',
        _text(margin + 16, cards_top + 48, "层号 / 岩性名称", "h3"),
        _text(margin + 430, cards_top + 48, "参考纹样大样（固定大小，不表示厚度）", "h3"),
        _text(margin + 910, cards_top + 48, "斜距", "h3"),
        _text(margin + 1120, cards_top + 48, "剖面投影宽度", "h3"),
        _text(margin + 1350, cards_top + 48, "实测真厚度", "h3", "end"),
    ])

    cards_audit: list[dict[str, Any]] = []
    row_y = cards_top + 64
    for index, interval in enumerate(intervals):
        interval_id = str(interval.get("id"))
        material_name = str(interval.get("lithology_name") or "").strip()
        spec = materials.get(material_name)
        record_ids = list(interval.get("record_ids") or [])
        interval_records = [records_by_id[rid] for rid in record_ids if rid in records_by_id]
        slant = sum(float(record.get("length_m", 0)) for record in interval_records if _finite(record.get("length_m")))
        start, end = int(interval["start_node"]), int(interval["end_node"])
        projected = abs(float(nodes[end]["x_m"]) - float(nodes[start]["x_m"]))
        fill_id = (f'read_base_{spec.get("id")}' if spec else "read_pending")
        unverified = bool(spec and spec.get("reference_status") == "unverified")
        background = "#fff" if index % 2 == 0 else "#f8fafc"
        svg.append(f'<rect x="{margin:.3f}" y="{row_y:.3f}" width="{page_width-2*margin:.3f}" height="{card_height:.3f}" fill="{background}" stroke="#cbd3da"/>')
        name_lines = _wrap(f'{interval.get("layer_id", "")}  {material_name or "待配置"}', 22)
        for line_index, line in enumerate(name_lines[:3]):
            svg.append(_text(margin + 16, row_y + 30 + line_index * 22, line, "body" if line_index else "h3"))
        sample_x, sample_y, sample_w, sample_h = margin + 430, row_y + 14, 360, card_height - 28
        sample_border = 'stroke="#596675" stroke-dasharray="4 3"' if unverified else 'stroke="#6f7d89"'
        svg.append(f'<rect x="{sample_x:.3f}" y="{sample_y:.3f}" width="{sample_w:.3f}" height="{sample_h:.3f}" fill="url(#{_esc(fill_id)})" {sample_border}/>')
        if not spec:
            svg.append(_text(sample_x + sample_w / 2, sample_y + sample_h / 2 + 5, "未配置参考纹样", "body", "middle"))
        elif unverified:
            svg.append(_text(sample_x + sample_w / 2, sample_y + sample_h / 2 + 5, "纹样待核对", "body", "middle"))
        svg.append(_text(margin + 910, row_y + 43, f"{_fmt(slant)} m", "body"))
        svg.append(_text(margin + 1120, row_y + 43, f"{_fmt(projected)} m", "body"))
        svg.append(_text(margin + 1350, row_y + 43, _true_thickness_display(interval_records), "body", "end"))
        svg.append(_text(margin + 910, row_y + 70, f"记录 {len(record_ids)} 条", "tiny"))
        svg.append(_text(margin + 1120, row_y + 70, "端点X差的绝对值", "tiny"))
        cards_audit.append({"row_index": index, "y_px": row_y, "interval_id": interval_id,
                            "layer_id": interval.get("layer_id"), "material_name": material_name,
                            "material_configured": bool(spec), "material_id": spec.get("id") if spec else None,
                            "reference_status": spec.get("reference_status") if spec else None,
                            "reference_evidence": spec.get("reference_evidence") if spec else None,
                            "tile_width": spec.get("tile_width", (materials_doc.get("tile") or {}).get("width", 24)) if spec else None,
                            "tile_height": spec.get("tile_height", (materials_doc.get("tile") or {}).get("height", 24)) if spec else None,
                            "render_scale": float((materials_doc.get("render_scales") or {}).get("readability", 1) or 1),
                            "pattern_sample_size_px": [sample_w, sample_h], "record_ids": record_ids,
                            "source_node_indices": list(range(start, end + 1)),
                            "slant_length_m": slant, "projected_width_m": projected,
                            "true_thickness_values": [record.get("true_thickness_m") for record in interval_records],
                            "description_full": interval.get("description", ""),
                            "source_cells": interval.get("source_cells", {})})
        row_y += card_height

    svg.extend([
        _text(margin, page_height - 48, "说明：大样块只用于识别参考纹样，大小、重复条数与线粗不表示实际层厚、煤线条数或煤线厚度。", "small"),
        _text(margin, page_height - 25, "本图为数据核验辅助图；行业标准图式与符号规范性尚未完成逐项核验。", "small"),
    ])

    geometry_json = json.dumps(geometry, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    audit = {
        "schema_version": "1.0", "artifact": "geology_readability_aid",
        "status": "data_review_only_industry_conventions_not_fully_verified",
        "page": {"width_px": page_width, "height_px": page_height},
        "counts": {"intervals": len(intervals), "focus_intervals": len(focus_panels),
                   "regions": len(regions), "contacts": len(contacts)},
        "geometry_reference": {"mode": geometry.get("mode"),
                               "requested_depth_m": geometry.get("requested_depth_m"),
                               "effective_depth_m": geometry.get("effective_depth_m"),
                               "eligible": geometry.get("eligible"),
                               "sha256_canonical_json": hashlib.sha256(geometry_json.encode("utf-8")).hexdigest(),
                               "world_coordinates_reused": True, "boundary_positions_modified": False},
        "focus_panels": [{key: value for key, value in panel.items() if key != "description_lines"}
                         for panel in focus_panels],
        "interval_cards": cards_audit, "pattern_audit": pattern_audit,
        "pattern_contexts": {context: float((materials_doc.get("render_scales") or {}).get(context, 1) or 1)
                             for context in ("readability", "focus")},
        "issues": ([{"severity": "warning", "code": "material_pending",
                     "message": f"岩性“{interval.get('lithology_name') or ''}”未配置参考纹样",
                     "interval_id": interval.get("id")} for interval in intervals
                    if str(interval.get("lithology_name") or "").strip() not in materials]),
        "statements": [
            "Focus selection is driven only by materials.focus_priority.",
            "Each focus window uses one equal x/z scale and its own metre scale; magnifications may differ.",
            "Pattern samples have fixed screen size and do not represent thickness.",
            "Approximate values remain source description text and are not copied into true_thickness_m.",
        ],
    }
    metadata = html.escape(json.dumps({"artifact": audit["artifact"], "counts": audit["counts"],
                                       "geometry_reference": audit["geometry_reference"]},
                                      ensure_ascii=False, sort_keys=True), quote=False)
    svg.insert(2, f'<metadata id="readability-metadata">{metadata}</metadata>')
    svg.append("</svg>")

    output = Path(output_dir).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    svg_path = output / "readability.svg"
    audit_path = output / "readability-audit.json"
    svg_path.write_text("".join(svg), encoding="utf-8")
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return {"readability_svg": str(svg_path), "readability_audit_json": str(audit_path)}


__all__ = ["render_readability"]
