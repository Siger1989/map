"""Deterministic SVG renderer for the geology-generator v1 normalized JSON.

This module deliberately accepts normalized JSON only.  It never opens the
source workbook, an earlier drawing, or any legacy JSON/template.
"""
from __future__ import annotations

import html
import json
import math
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parent
TEMPLATE_DIR = ROOT / "templates"


class RenderInputError(ValueError):
    """Raised when normalized input cannot be drawn without inventing geometry."""

    def __init__(self, issues: list[dict[str, Any]]):
        self.issues = issues
        super().__init__("; ".join(i["message"] for i in issues))


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _largest_polygon_anchor(region: dict[str, Any]) -> dict[str, Any] | None:
    """Return an interior world anchor from the largest convex region polygon."""
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
        candidate = {
            "polygon_index": polygon_index,
            "world": [cx_sum / (3 * cross_sum), cy_sum / (3 * cross_sum)],
            "area_m2": abs(cross_sum) / 2,
        }
        if best is None or candidate["area_m2"] > best["area_m2"]:
            best = candidate
    return best


def _fmt(value: Any, decimals: int = 3) -> str:
    if not _finite(value):
        return "未提供"
    text = f"{float(value):.{decimals}f}".rstrip("0").rstrip(".")
    return "0" if text in {"-0", ""} else text


def _esc(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def _svg_text(x: float, y: float, text: Any, cls: str = "", anchor: str = "start", extra: str = "") -> str:
    return f'<text x="{x:.3f}" y="{y:.3f}" class="{cls}" text-anchor="{anchor}" {extra}>{_esc(text)}</text>'


def _label_back(label: dict[str, Any], font_size: float, radius: float = 2.5) -> str:
    width = float(label.get("width", font_size * 2)) + 6
    x = float(label["x"]) - width / 2
    y = float(label["y"]) - font_size - 3
    return f'<rect x="{x:.3f}" y="{y:.3f}" width="{width:.3f}" height="{font_size+7:.3f}" rx="{radius:g}" fill="#ffffff" fill-opacity=".94"/>'


def _deep_merge(base: dict[str, Any], override: dict[str, Any] | None) -> dict[str, Any]:
    result = json.loads(json.dumps(base, ensure_ascii=False))
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _resolve_nodes(data: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[Any, dict[str, Any]]]:
    issues: list[dict[str, Any]] = []
    nodes = data.get("nodes")
    if not isinstance(nodes, list) or len(nodes) < 2:
        issues.append({"severity": "error", "code": "nodes_missing", "message": "nodes 至少需要两个节点", "cells": []})
        raise RenderInputError(issues)
    by_key: dict[Any, dict[str, Any]] = {}
    for pos, node in enumerate(nodes):
        if not isinstance(node, dict):
            issues.append({"severity": "error", "code": "node_invalid", "message": f"nodes[{pos}] 不是对象", "cells": []})
            continue
        for field in ("east_m", "north_m", "z_m", "x_m", "offset_m"):
            if not _finite(node.get(field)):
                issues.append({"severity": "error", "code": "node_geometry_invalid", "message": f"nodes[{pos}].{field} 缺失或非有限数", "cells": []})
        by_key[pos] = node
        by_key[node.get("index", pos)] = node
    if issues:
        raise RenderInputError(issues)
    return nodes, by_key


def _node(by_key: dict[Any, dict[str, Any]], key: Any) -> dict[str, Any]:
    if key in by_key:
        return by_key[key]
    if isinstance(key, str) and key.isdigit() and int(key) in by_key:
        return by_key[int(key)]
    raise KeyError(key)


def _nice_step(span: float, target_ticks: int = 8) -> float:
    raw = max(span / max(target_ticks, 1), 1e-12)
    power = 10 ** math.floor(math.log10(raw))
    fraction = raw / power
    nice = 1 if fraction <= 1 else 2 if fraction <= 2 else 5 if fraction <= 5 else 10
    return nice * power


def _axis_ticks(lo: float, hi: float, target: int = 8) -> list[float]:
    step = _nice_step(max(hi - lo, 1e-6), target)
    first = math.ceil(lo / step - 1e-10) * step
    values: list[float] = []
    value = first
    while value <= hi + step * 1e-9 and len(values) < 200:
        values.append(value)
        value += step
    return values


def _line_boxes(items: list[tuple[float, str, Any]], left: float, right: float, y0: float,
                font_size: float, line_height: float, gap: float, max_lanes: int) -> tuple[list[dict[str, Any]], int]:
    """Generic greedy 1-D label placement; no layer-specific branches."""
    lanes: list[list[tuple[float, float]]] = [[] for _ in range(max_lanes)]
    placed: list[dict[str, Any]] = []
    overflow = 0
    for anchor_x, text, payload in sorted(items, key=lambda item: (item[0], item[1])):
        width = max(font_size * 1.4, len(str(text)) * font_size * 0.62 + 8)
        x = min(max(anchor_x - width / 2, left), max(left, right - width))
        chosen = None
        for lane_i, occupied in enumerate(lanes):
            if all(x + width + gap <= a or x >= b + gap for a, b in occupied):
                chosen = lane_i
                occupied.append((x, x + width))
                break
        if chosen is None:
            overflow += 1
            chosen = len(lanes)
            lanes.append([(x, x + width)])
        placed.append({"anchor_x": anchor_x, "x": x + width / 2, "y": y0 + chosen * line_height,
                       "lane": chosen, "text": text, "payload": payload, "width": width})
    return placed, overflow


def _pattern_defs(materials: dict[str, Any], derived_patterns: list[dict[str, Any]] | None = None,
                  context: str = "main", include_legend: bool = False,
                  anchor_mapper: Any = None) -> str:
    tile = materials.get("tile", {"width": 24, "height": 24})
    scales = materials.get("render_scales", {})
    context_scale = float(scales.get(context, 1) or 1)
    legend_scale = float(scales.get("legend", 1) or 1)
    parts: list[str] = []
    for spec in materials.get("materials", {}).values():
        pid = _esc(spec["id"])
        w = float(spec.get("tile_width", tile.get("width", 24)))
        h = float(spec.get("tile_height", tile.get("height", 24)))
        bg = _esc(spec.get("background", "#eeeeee"))
        stroke = _esc(spec.get("stroke", "#36404a"))
        def one_pattern(pattern_id: str, scale: float) -> str:
            body = [f'<pattern id="{pattern_id}" width="{w:g}" height="{h:g}" patternUnits="userSpaceOnUse" patternTransform="scale({scale:.6f})">',
                    f'<rect width="{w:g}" height="{h:g}" fill="{("#ffffff" if spec.get("reference_status") == "unverified" else bg)}"/>']
            if spec.get("reference_status") != "unverified":
                for primitive in spec.get("svg", []):
                    kind = primitive.get("type")
                    width = float(primitive.get("width", 1.1))
                    common = f'fill="none" stroke="{stroke}" stroke-width="{width:g}"'
                    if kind == "line":
                        body.append(f'<line x1="{primitive["x1"]}" y1="{primitive["y1"]}" x2="{primitive["x2"]}" y2="{primitive["y2"]}" {common}/>')
                    elif kind == "circle":
                        body.append(f'<circle cx="{primitive["cx"]}" cy="{primitive["cy"]}" r="{primitive["r"]}" fill="{stroke}" stroke="none"/>')
                    elif kind == "path":
                        body.append(f'<path d="{_esc(primitive["d"])}" {common}/>' )
            body.append("</pattern>")
            return "".join(body)
        parts.append(one_pattern(pid, context_scale))
        if include_legend:
            parts.append(one_pattern(f"{pid}__legend", legend_scale))
    parts.append(f'<pattern id="mat_pending" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="scale({context_scale:.6f})"><rect width="12" height="12" fill="#ffffff"/></pattern>')
    if include_legend:
        parts.append(f'<pattern id="mat_pending__legend" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="scale({legend_scale:.6f})"><rect width="12" height="12" fill="#ffffff"/></pattern>')
    for derived in derived_patterns or []:
        rotation = float(derived.get("rotation_deg_svg") or 0)
        phase = derived.get("phase_anchor") or {}
        feature = phase.get("feature_tile")
        world = phase.get("world")
        mapped = anchor_mapper(world) if anchor_mapper and world else None
        if mapped and feature:
            ax, ay = float(mapped["svg"][0]), float(mapped["svg"][1])
            fx, fy = float(feature[0]), float(feature[1])
            transform_value = (f"translate({ax:.6f} {ay:.6f}) rotate({rotation:.6f}) "
                               f"scale({context_scale:.6f}) translate({-fx:.6f} {-fy:.6f})")
            inverse = mapped.get("inverse_world")
            phase.setdefault("contexts", {})[context] = {
                "svg_anchor_px": [ax, ay], "inverse_world_m": inverse,
                "inverse_error_m": (math.hypot(float(inverse[0]) - float(world[0]),
                                                float(inverse[1]) - float(world[1])) if inverse else None),
                "render_scale": context_scale,
            }
            anchor_attrs = (f' data-anchor-world="{float(world[0]):.12g},{float(world[1]):.12g}"'
                            f' data-anchor-svg="{ax:.6f},{ay:.6f}"'
                            f' data-anchor-feature="{fx:.6f},{fy:.6f}"')
        else:
            transform_value = f"rotate({rotation:.6f}) scale({context_scale:.6f})"
            anchor_attrs = ""
        parts.append(f'<pattern id="{_esc(derived["id"])}" href="#{_esc(derived["template_id"])}" patternTransform="{transform_value}"{anchor_attrs}/>')
    return "".join(parts)


def _apparent_dip_rotation(axis_azimuth_deg: Any, dip_direction_deg: Any, dip_angle_deg: Any) -> tuple[float | None, float | None, str]:
    if not all(_finite(v) for v in (axis_azimuth_deg, dip_direction_deg, dip_angle_deg)):
        return None, None, "missing_attitude"
    axis = math.radians(float(axis_azimuth_deg))
    direction = math.radians(float(dip_direction_deg))
    dip = math.radians(float(dip_angle_deg))
    vx = math.cos(dip)
    vz = -math.sin(dip) * math.cos(axis-direction)
    if math.hypot(vx, vz) <= 1e-12:
        return None, None, "degenerate_section_projection"
    apparent = math.degrees(math.atan2(vz, vx))
    return apparent, -apparent, "rotated_from_interval_first_record"


def _material(interval: dict[str, Any], material_map: dict[str, Any]) -> tuple[str, bool]:
    name = str(interval.get("lithology_name") or "").strip()
    spec = material_map.get(name)
    return (spec["id"], False) if spec else ("mat_pending", True)


def _projected_band_is_safe(records: list[dict[str, Any]], by_key: dict[Any, dict[str, Any]], tolerance: float) -> tuple[bool, list[str]]:
    deltas: list[float] = []
    reasons: list[str] = []
    for rec in records:
        try:
            a, b = _node(by_key, rec.get("start_node")), _node(by_key, rec.get("end_node"))
        except KeyError:
            reasons.append(f"记录 {rec.get('id', '?')} 的节点引用无效")
            continue
        dx = float(b["x_m"]) - float(a["x_m"])
        if abs(dx) <= tolerance:
            reasons.append(f"记录 {rec.get('id', '?')} 的投影宽度接近零")
        else:
            deltas.append(dx)
    if deltas:
        direction = 1 if sum(deltas) >= 0 else -1
        backwards = [d for d in deltas if d * direction < -tolerance]
        if backwards:
            reasons.append(f"存在 {len(backwards)} 个轴向回折测段，岩性投影带可能重叠")
    return not reasons, reasons


def _densest_window(features: list[float], lo: float, hi: float, fraction: float) -> tuple[float, float, int]:
    span = max(hi - lo, 1e-9)
    width = min(span, max(span * fraction, 1e-6))
    best = (lo, lo + width, 0)
    sorted_x = sorted(features)
    j = 0
    for i, start in enumerate(sorted_x):
        while j < len(sorted_x) and sorted_x[j] <= start + width:
            j += 1
        if j - i > best[2]:
            a = max(lo, min(start - width * 0.08, hi - width))
            best = (a, a + width, j - i)
    return best


def _scale_bar(x: float, y: float, units_per_px: float, max_px: float = 180) -> str:
    metres = _nice_step(units_per_px * max_px, 1)
    px = metres / units_per_px
    while px > max_px:
        metres /= 2
        px = metres / units_per_px
    return (f'<g class="scale"><line x1="{x:.3f}" y1="{y:.3f}" x2="{x+px:.3f}" y2="{y:.3f}"/>'
            f'<line x1="{x:.3f}" y1="{y-5:.3f}" x2="{x:.3f}" y2="{y+5:.3f}"/>'
            f'<line x1="{x+px:.3f}" y1="{y-5:.3f}" x2="{x+px:.3f}" y2="{y+5:.3f}"/>'
            f'{_svg_text(x+px/2, y-8, f"{_fmt(metres)} m", "small", "middle")}</g>')


def _write_appendix(path: Path, data: dict[str, Any], intervals: list[dict[str, Any]],
                    pending: list[str], thin_rows: list[dict[str, Any]], decimals: int) -> None:
    def table(title: str, headers: list[str], rows: Iterable[Iterable[Any]]) -> str:
        body = "".join("<tr>" + "".join(f"<td>{_esc(v)}</td>" for v in row) + "</tr>" for row in rows)
        return f"<h2>{_esc(title)}</h2><table><thead><tr>{''.join(f'<th>{_esc(h)}</th>' for h in headers)}</tr></thead><tbody>{body}</tbody></table>"
    sections = ["<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>实测剖面附表</title>",
                "<style>body{font:13px/1.5 'Microsoft YaHei',sans-serif;margin:24px;color:#18212b}table{border-collapse:collapse;width:100%;margin:8px 0 24px}th,td{border:1px solid #aeb8c3;padding:5px 7px;text-align:left;vertical-align:top}th{background:#eef2f6}.warn{background:#fff2cc}</style><body>",
                "<h1>实测剖面附表</h1><p>数值来自规范 JSON；真实厚度缺失时明确显示“未提供”。产状位置为记录起点关联位置。</p>"]
    sections.append(table("层段与薄层索引", ["索引", "层号", "岩性", "起点", "终点", "实测真厚度"],
        ((r.get("index", ""), r.get("layer_id", ""), r.get("lithology_name") or "待配置", r.get("start_node", ""), r.get("end_node", ""), r.get("true_thickness_display", "未提供")) for r in thin_rows)))
    sections.append(table("全部层段", ["ID", "层号", "岩性", "起点", "终点", "说明"],
        ((r.get("id", ""), r.get("layer_id", ""), r.get("lithology_name") or "待配置", r.get("start_node", ""), r.get("end_node", ""), r.get("description", "")) for r in intervals)))
    sections.append(table("产状（完整）", ["ID", "记录", "层号", "关联节点", "倾向", "倾角", "位置依据"],
        ((r.get("id", ""), r.get("record_id", ""), r.get("layer_id", ""), r.get("node", ""), _fmt(r.get("dip_direction_deg"), decimals), _fmt(r.get("dip_angle_deg"), decimals), r.get("location_basis", "")) for r in data.get("attitudes", []))))
    sections.append(table("样品（完整）", ["ID", "记录", "层号", "定位状态", "X", "偏距", "相对高程"],
        ((r.get("id", ""), r.get("record_id", ""), r.get("layer_id", ""), r.get("location_status", ""), _fmt((r.get("position") or {}).get("x_m"), decimals), _fmt((r.get("position") or {}).get("offset_m"), decimals), _fmt((r.get("position") or {}).get("z_m"), decimals)) for r in data.get("samples", []))))
    sections.append(table("记录（完整）", ["ID", "导线段", "层号", "斜距", "坡角", "方位", "倾向", "倾角", "实测真厚度", "岩性", "描述", "源单元格"],
        ((r.get("id", ""), r.get("leg_id", ""), r.get("layer_id", ""), _fmt(r.get("length_m"), decimals), _fmt(r.get("slope_deg"), decimals), _fmt(r.get("azimuth_deg"), decimals), _fmt(r.get("dip_direction_deg"), decimals), _fmt(r.get("dip_angle_deg"), decimals), _fmt(r.get("true_thickness_m"), decimals), r.get("lithology_name", ""), r.get("description", ""), json.dumps(r.get("source_cells", {}), ensure_ascii=False, sort_keys=True)) for r in data.get("records", []))))
    sections.append(table("导入问题（完整）", ["级别", "代码", "说明", "单元格"],
        ((r.get("severity", ""), r.get("code", ""), r.get("message", ""), ", ".join(map(str, r.get("cells", [])))) for r in data.get("issues", []))))
    if pending:
        sections.append(f'<p class="warn">未知岩性待配置：{_esc("、".join(sorted(set(pending))))}</p>')
    sections.append("</body></html>")
    path.write_text("".join(sections), encoding="utf-8")


def render(data: dict[str, Any], output_dir: str | os.PathLike[str], config: dict[str, Any] | None = None) -> dict[str, str]:
    """Render normalized JSON v1 and return paths to generated artifacts."""
    if not isinstance(data, dict) or str(data.get("schema_version")) != "1.0":
        raise RenderInputError([{"severity": "error", "code": "schema_version", "message": "仅接受 schema_version='1.0' 的规范 JSON", "cells": []}])
    nodes, by_key = _resolve_nodes(data)
    records = data.get("records", []) if isinstance(data.get("records", []), list) else []
    intervals = data.get("intervals", []) if isinstance(data.get("intervals", []), list) else []
    attitudes = data.get("attitudes", []) if isinstance(data.get("attitudes", []), list) else []
    samples = data.get("samples", []) if isinstance(data.get("samples", []), list) else []
    stations = data.get("stations", []) if isinstance(data.get("stations", []), list) else []
    settings = data.get("settings", {}) if isinstance(data.get("settings", {}), dict) else {}
    if settings.get("vertical_exaggeration", 1) != 1:
        raise RenderInputError([{"severity":"error","code":"vertical_exaggeration","message":"v1 仅允许 vertical_exaggeration=1", "cells":[]}])

    cfg = _deep_merge(_read_json(TEMPLATE_DIR / "drawing.json"), config)
    try:
        from layer_geometry import build_layer_geometry
    except ImportError as exc:
        raise RenderInputError([{"severity":"error", "code":"layer_geometry_unavailable", "message":"斜层界几何模块 layer_geometry.py 不可用", "cells":[]}]) from exc
    requested_layer_depth_m = float(cfg.get("layer_display_depth_m", cfg.get("requested_depth_m", 18.0)))
    layer_geometry = build_layer_geometry(data, requested_layer_depth_m)
    materials_doc = _read_json(TEMPLATE_DIR / "materials.json")
    material_map = materials_doc.get("materials", {})
    unverified_material_names = [name for name, spec in material_map.items() if spec.get("reference_status") == "unverified"]
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    decimals = int(cfg.get("number_decimals", 3))
    margin = float(cfg["content_margin_px"])
    page_w = float(cfg["page_width_px"])
    colors = cfg["colors"]
    x_values = [float(n["x_m"]) for n in nodes]
    o_values = [float(n["offset_m"]) for n in nodes]
    z_values = [float(n["z_m"]) for n in nodes]
    x_lo, x_hi = min(x_values), max(x_values)
    o_lo, o_hi = min(o_values), max(o_values)
    z_lo, z_hi = min(z_values), max(z_values)
    layer_polygon_points = [point for region in layer_geometry.get("regions", []) for polygon in region.get("polygons", []) for point in polygon if isinstance(point, (list, tuple)) and len(point) >= 2]
    layer_z_lo = min((float(point[1]) for point in layer_polygon_points), default=z_lo)
    display_z_lo = min(z_lo, layer_z_lo)
    x_span, o_span, z_span = max(x_hi-x_lo, 1e-6), max(o_hi-o_lo, 1e-6), max(z_hi-display_z_lo, 1e-6)
    units_per_px = max(float(cfg["minimum_units_per_px"]), x_span / float(cfg["target_plot_width_px"]),
                        o_span / float(cfg["target_plan_height_px"]), z_span / float(cfg["target_profile_height_px"]))
    plot_w = x_span / units_per_px
    plan_h = max(o_span / units_per_px, 70)
    profile_h = max(z_span / units_per_px, 70)
    plot_left = margin + (float(cfg["target_plot_width_px"]) - plot_w) / 2
    plot_right = plot_left + plot_w
    plan_top = 146.0
    plan_bottom = plan_top + plan_h
    station_label_y = plan_bottom + 34

    def sx(x: float) -> float: return plot_left + (x - x_lo) / units_per_px
    def sy_plan(offset: float) -> float: return plan_top + (o_hi - offset) / units_per_px

    legacy_projection_safe, legacy_projection_reasons = _projected_band_is_safe(records, by_key, max(1e-9, units_per_px * 0.02))
    layer_geometry_eligible = bool(layer_geometry.get("eligible", False))
    regions_by_interval = {region.get("interval_id"): region for region in layer_geometry.get("regions", [])}
    interval_rows: list[dict[str, Any]] = []
    pending: list[str] = []
    thin_rows: list[dict[str, Any]] = []
    interval_geometry: list[dict[str, Any]] = []
    record_by_id = {record.get("id"): record for record in records}
    derived_patterns: list[dict[str, Any]] = []
    pattern_audit: list[dict[str, Any]] = []
    for idx, interval in enumerate(intervals, 1):
        try:
            a, b = _node(by_key, interval.get("start_node")), _node(by_key, interval.get("end_node"))
        except KeyError:
            continue
        pid, is_pending = _material(interval, material_map)
        name = str(interval.get("lithology_name") or "待配置")
        material_spec = material_map.get(name, {})
        orientation = material_spec.get("orientation", "none") if material_spec else "none"
        first_record_id = next(iter(interval.get("record_ids", [])), None)
        first_record = record_by_id.get(first_record_id, {})
        apparent_dip: float | None = None
        rotation_svg: float | None = None
        rotation_status = "template_orientation_none"
        if orientation == "bedding":
            apparent_dip, rotation_svg, rotation_status = _apparent_dip_rotation(
                settings.get("axis_azimuth_deg"), first_record.get("dip_direction_deg"), first_record.get("dip_angle_deg"))
        derived_pattern_id = f"{pid}__interval_{idx:04d}"
        feature = material_spec.get("anchor_feature") if material_spec else None
        valid_feature = (isinstance(feature, (list, tuple)) and len(feature) >= 2 and
                         _finite(feature[0]) and _finite(feature[1]))
        anchor = _largest_polygon_anchor(regions_by_interval.get(interval.get("id"), {})) if valid_feature else None
        phase_anchor = {
            "status": "anchored" if anchor else ("not_configured" if not valid_feature else "no_drawn_polygon"),
            "feature_tile": [float(feature[0]), float(feature[1])] if valid_feature else None,
            "world": anchor.get("world") if anchor else None,
            "polygon_index": anchor.get("polygon_index") if anchor else None,
            "polygon_area_m2": anchor.get("area_m2") if anchor else None,
            "contexts": {},
        }
        derived_patterns.append({"id": derived_pattern_id, "template_id": pid,
                                 "rotation_deg_svg": rotation_svg, "phase_anchor": phase_anchor})
        pattern_audit.append({
            "interval_id": interval.get("id"), "layer_id": interval.get("layer_id"), "material_name": name,
            "template_pattern_id": pid, "derived_pattern_id": derived_pattern_id, "orientation": orientation,
            "first_record_id": first_record_id, "axis_azimuth_deg": settings.get("axis_azimuth_deg"),
            "dip_direction_deg": first_record.get("dip_direction_deg"), "dip_angle_deg": first_record.get("dip_angle_deg"),
            "apparent_dip_deg_signed_z_up": apparent_dip, "pattern_rotation_deg_svg_y_down": rotation_svg,
            "rotation_status": rotation_status, "source_cells": first_record.get("source_cells", {}),
            "reference_status": material_spec.get("reference_status") if material_spec else None,
            "reference_evidence": material_spec.get("reference_evidence") if material_spec else None,
            "tile_width": material_spec.get("tile_width", (materials_doc.get("tile") or {}).get("width", 24)) if material_spec else None,
            "tile_height": material_spec.get("tile_height", (materials_doc.get("tile") or {}).get("height", 24)) if material_spec else None,
            "render_scales": {context: float((materials_doc.get("render_scales") or {}).get(context, 1) or 1)
                              for context in ("main", "detail", "legend", "readability", "focus")},
            "phase_anchor": phase_anchor,
        })
        if is_pending: pending.append(name)
        width_px = abs(sx(float(b["x_m"])) - sx(float(a["x_m"])))
        row = dict(interval)
        row["index"] = f"L{idx}"
        rec_true: list[Any] = []
        for rec in records:
            if rec.get("id") not in interval.get("record_ids", []):
                continue
            rec_true.append(rec.get("true_thickness_m"))
        provided_true = [v for v in rec_true if _finite(v)]
        if not provided_true:
            row["true_thickness_display"] = "未提供"
        elif len(interval.get("record_ids", [])) == 1:
            row["true_thickness_display"] = _fmt(provided_true[0], decimals)
        else:
            row["true_thickness_display"] = "逐记录见记录表（未合计、未取首值）"
        interval_rows.append(row)
        geo = {"index": f"L{idx}", "interval": interval, "a": a, "b": b, "pattern": derived_pattern_id,
               "template_pattern": pid, "pending": is_pending, "reference_status": material_spec.get("reference_status") if material_spec else None,
               "width_px": width_px}
        interval_geometry.append(geo)
        if width_px < float(cfg["thin_interval_threshold_px"]): thin_rows.append(row)

    attitude_by_record: dict[Any, list[dict[str, Any]]] = {}
    for attitude in attitudes:
        attitude_by_record.setdefault(attitude.get("record_id"), []).append(attitude)

    plan_station_items: list[tuple[float, str, Any]] = []
    for station in stations:
        try:
            n = _node(by_key, station.get("node"))
            plan_station_items.append((sx(float(n["x_m"])), str(station.get("id", "")), station))
        except KeyError:
            pass
    station_labels, station_overflow = _line_boxes(plan_station_items, plot_left, plot_right,
        station_label_y, float(cfg["small_font_size_px"]), float(cfg["label_line_height_px"]),
        float(cfg["label_lane_gap_px"]), int(cfg["label_max_lanes"]))

    attitude_items: list[tuple[float, str, Any]] = []
    for attitude in attitudes:
        try:
            n = _node(by_key, attitude.get("node"))
        except KeyError:
            continue
        label = f'{attitude.get("id", "M")}: {_fmt(attitude.get("dip_direction_deg"), decimals)}°∠{_fmt(attitude.get("dip_angle_deg"), decimals)}°'
        attitude_items.append((sx(float(n["x_m"])), label, attitude))
    attitude_labels, attitude_overflow = _line_boxes(attitude_items, plot_left, plot_right,
        0, float(cfg["small_font_size_px"]), float(cfg["label_line_height_px"]),
        float(cfg["label_lane_gap_px"]), int(cfg["label_max_lanes"]))

    line_height = float(cfg["label_line_height_px"])
    station_lane_count = max((item["lane"] for item in station_labels), default=-1) + 1
    attitude_lane_count = max((item["lane"] for item in attitude_labels), default=-1) + 1
    profile_title_y = station_label_y + max(station_lane_count, 1) * line_height + 48
    attitude_label_y0 = profile_title_y + 31
    for label in attitude_labels:
        label["y"] = attitude_label_y0 + label["lane"] * line_height
    profile_top = attitude_label_y0 + max(attitude_lane_count, 1) * line_height + 25
    profile_bottom = profile_top + profile_h
    def sy_profile(z: float) -> float: return profile_top + (z_hi - z) / units_per_px
    def main_anchor_mapper(world: list[float]) -> dict[str, list[float]]:
        px, py = sx(float(world[0])), sy_profile(float(world[1]))
        return {"svg": [px, py],
                "inverse_world": [x_lo + (px - plot_left) * units_per_px,
                                  z_hi - (py - profile_top) * units_per_px]}

    external_layer_items: list[tuple[float, str, Any]] = []
    small_font = float(cfg["small_font_size_px"])
    for geo in interval_geometry:
        region = regions_by_interval.get(geo["interval"].get("id"), {})
        points = [point for polygon in region.get("polygons", []) for point in polygon if isinstance(point, (list, tuple)) and len(point) >= 2]
        if region.get("status") == "drawn" and points:
            anchor_point = min(points, key=lambda point: (float(point[1]), float(point[0])))
            anchor_x_m, anchor_z_m = float(anchor_point[0]), float(anchor_point[1])
        else:
            anchor_x_m = (float(geo["a"]["x_m"]) + float(geo["b"]["x_m"])) / 2
            anchor_z_m = min(float(geo["a"]["z_m"]), float(geo["b"]["z_m"]))
        geo["layer_region"] = region
        geo["label_target_x_m"] = anchor_x_m
        geo["label_target_z_m"] = anchor_z_m
        layer_text = str(geo["interval"].get("layer_id", "")) or geo["index"]
        external_layer_items.append((sx(anchor_x_m), layer_text, geo))
    layer_label_y0 = profile_bottom + 28
    external_layer_labels, thin_overflow = _line_boxes(external_layer_items, plot_left, plot_right, layer_label_y0,
        float(cfg["small_font_size_px"]), line_height, 7, int(cfg["label_max_lanes"]))
    layer_lane_count = max((item["lane"] for item in external_layer_labels), default=-1) + 1
    profile_tick_y = layer_label_y0 + max(layer_lane_count, 1) * line_height + 7
    profile_scale_y = profile_tick_y + 34
    profile_note_y = profile_scale_y + 27
    thin_index_top = profile_note_y + 44
    thin_table_h = 0 if not thin_rows else 46 + math.ceil(len(thin_rows) / 3) * 26
    legend_top = thin_index_top + thin_table_h + 22
    legend_rows = math.ceil((len(material_map) + (1 if pending else 0)) / 3)
    legend_h = 48 + legend_rows * 35
    note_top = legend_top + legend_h + 18
    page_h = note_top + 155

    svg: list[str] = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{page_w:.0f}" height="{page_h:.0f}" viewBox="0 0 {page_w:.0f} {page_h:.0f}">',
        "<defs>", _pattern_defs(materials_doc, derived_patterns, "main", True, main_anchor_mapper), "</defs>",
        f'<rect width="100%" height="100%" fill="{colors["paper"]}"/>',
        f'''<style>text{{font-family:{cfg["font_family"]};fill:{colors["ink"]};font-size:{cfg["font_size_px"]}px}}.title{{font-size:24px;font-weight:700}}.subtitle{{font-size:15px;font-weight:600}}.small{{font-size:{cfg["small_font_size_px"]}px;fill:{colors["muted"]}}}.axis{{stroke:{colors["axis"]};stroke-width:1;fill:none}}.grid{{stroke:{colors["grid"]};stroke-width:.8;fill:none}}.survey{{stroke:{colors["survey"]};stroke-width:2;fill:none;stroke-linejoin:round}}.contact{{stroke:{colors["contact"]};stroke-width:1.4;fill:none}}.derived-contact{{stroke:{colors["contact"]};stroke-width:1.1;stroke-dasharray:5 3;fill:none}}.attitude{{stroke:{colors["attitude"]};stroke-width:1.2;fill:none}}.leader{{stroke:{colors["muted"]};stroke-width:.8;fill:none}}.scale line{{stroke:{colors["ink"]};stroke-width:2}}.panel{{fill:{colors["panel"]};stroke:{colors["grid"]}}}</style>''']
    project = data.get("project", {}) if isinstance(data.get("project", {}), dict) else {}
    title_base = " / ".join(filter(None, [str(project.get("name", "")).strip(), str(project.get("section_id", "")).strip()])) or "实测地层剖面"
    title = f"{title_base}（数据核验图）"
    axis_text = f'剖面方位 {_fmt(settings.get("axis_azimuth_deg"), decimals)}°'
    svg += [_svg_text(margin, 46, title, "title"),
            _svg_text(margin, 73, f'局部相对坐标 · {axis_text} · 垂直夸大 1 · 水平与高程同尺度（见米标尺）', "small"),
            _svg_text(margin, 104, "导线平面图（X：轴向投影距离；Y：横向偏距；等比例）", "subtitle")]
    for tick in _axis_ticks(x_lo, x_hi):
        px = sx(tick)
        svg += [f'<line x1="{px:.6f}" y1="{plan_top-8:.6f}" x2="{px:.6f}" y2="{plan_bottom+8:.6f}" class="grid"/>', _svg_text(px, plan_top-13, _fmt(tick, decimals), "small", "middle")]
    for tick in _axis_ticks(o_lo, o_hi, 5):
        py = sy_plan(tick)
        svg += [f'<line x1="{plot_left-8:.6f}" y1="{py:.6f}" x2="{plot_right+8:.6f}" y2="{py:.6f}" class="grid"/>', _svg_text(plot_left-13, py+4, _fmt(tick, decimals), "small", "end")]
    plan_points = " ".join(f'{sx(float(n["x_m"])):.6f},{sy_plan(float(n["offset_m"])):.6f}' for n in nodes)
    svg.append(f'<polyline points="{plan_points}" class="survey" data-node-count="{len(nodes)}"/>')
    for n in nodes:
        svg.append(f'<circle cx="{sx(float(n["x_m"])):.6f}" cy="{sy_plan(float(n["offset_m"])):.6f}" r="2.4" fill="{colors["survey"]}" data-node="{_esc(n.get("index", ""))}"/>')
    axis_az = settings.get("axis_azimuth_deg")
    for boundary_index, geo in enumerate(interval_geometry):
        if boundary_index == 0:
            continue
        interval = geo["interval"]
        first_record_id = next(iter(interval.get("record_ids", [])), None)
        first_att = next(iter(attitude_by_record.get(first_record_id, [])), None)
        if first_att is None or not _finite(axis_az) or not _finite(first_att.get("dip_direction_deg")):
            continue
        a = geo["a"]
        cx, cy = sx(float(a["x_m"])), sy_plan(float(a["offset_m"]))
        strike = (float(first_att["dip_direction_deg"]) + 90.0) % 360.0
        rad = math.radians(strike - float(axis_az))
        half = float(cfg["contact_strike_symbol_length_px"]) / 2
        dx, dy = math.cos(rad) * half, math.sin(rad) * half
        svg.append(f'<line x1="{cx-dx:.6f}" y1="{cy-dy:.6f}" x2="{cx+dx:.6f}" y2="{cy+dy:.6f}" class="contact" data-interval="{_esc(interval.get("id", ""))}" data-node="{_esc(interval.get("start_node", ""))}"/>')
    for label in station_labels:
        station = label["payload"]
        try: n = _node(by_key, station.get("node"))
        except KeyError: continue
        py = sy_plan(float(n["offset_m"]))
        svg.append(f'<path d="M {label["anchor_x"]:.3f} {py:.3f} L {label["x"]:.3f} {label["y"]-11:.3f}" class="leader"/>')
    for label in station_labels:
        svg += [_label_back(label, small_font), _svg_text(label["x"], label["y"], label["text"], "small", "middle")]
    svg += [_scale_bar(plot_left, plan_bottom + 64, units_per_px),
            _svg_text(margin, profile_title_y, "相对高程剖面（X：轴向投影距离；Y：相对高程；水平与高程同尺度）", "subtitle")]
    for tick in _axis_ticks(x_lo, x_hi):
        px = sx(tick)
        svg += [f'<line x1="{px:.6f}" y1="{profile_top-8:.6f}" x2="{px:.6f}" y2="{profile_bottom+8:.6f}" class="grid"/>']
    for tick in _axis_ticks(display_z_lo, z_hi, 6):
        py = sy_profile(tick)
        svg += [f'<line x1="{plot_left-8:.6f}" y1="{py:.6f}" x2="{plot_right+8:.6f}" y2="{py:.6f}" class="grid"/>', _svg_text(plot_left-13, py+4, _fmt(tick, decimals), "small", "end")]
    for geo in interval_geometry:
        region = geo.get("layer_region", {})
        if region.get("status") != "drawn":
            continue
        for polygon_index, polygon_world in enumerate(region.get("polygons", [])):
            polygon = " ".join(f'{sx(float(point[0])):.6f},{sy_profile(float(point[1])):.6f}' for point in polygon_world)
            svg.append(f'<polygon points="{polygon}" fill="url(#{geo["pattern"]})" stroke="none" data-reference-status="{_esc(geo.get("reference_status", ""))}" data-interval="{_esc(region.get("interval_id", ""))}" data-polygon-index="{polygon_index}" data-world-points="{_esc(json.dumps(polygon_world, ensure_ascii=False, separators=(",", ":")))}"/>')
    for contact in layer_geometry.get("contacts", []):
        for segment_index, segment in enumerate(contact.get("segments", [])):
            if not isinstance(segment, list) or len(segment) != 2:
                continue
            p1, p2 = segment
            svg.append(f'<line x1="{sx(float(p1[0])):.6f}" y1="{sy_profile(float(p1[1])):.6f}" x2="{sx(float(p2[0])):.6f}" y2="{sy_profile(float(p2[1])):.6f}" class="derived-contact" data-contact="{_esc(contact.get("id", ""))}" data-segment-index="{segment_index}" data-node="{_esc(contact.get("node", ""))}" data-world-segment="{_esc(json.dumps(segment, ensure_ascii=False, separators=(",", ":")))}"/>')
    profile_points = " ".join(f'{sx(float(n["x_m"])):.6f},{sy_profile(float(n["z_m"])):.6f}' for n in nodes)
    svg.append(f'<polyline points="{profile_points}" class="survey" data-node-count="{len(nodes)}"/>')
    if not layer_geometry_eligible:
        svg.append(_svg_text((plot_left+plot_right)/2, profile_bottom-10, "斜层界几何不满足绘制条件；受影响区域保持留白，详见布局审计。", "small", "middle"))
    for label in attitude_labels:
        att = label["payload"]
        try: n = _node(by_key, att.get("node"))
        except KeyError: continue
        px, py = sx(float(n["x_m"])), sy_profile(float(n["z_m"]))
        svg += [f'<circle cx="{px:.6f}" cy="{py:.6f}" r="3" fill="#fff" stroke="{colors["attitude"]}" data-attitude="{_esc(att.get("id", ""))}" data-node="{_esc(att.get("node", ""))}"/>',
                f'<path d="M {px:.6f} {py:.6f} L {label["x"]:.3f} {label["y"]+4:.3f}" class="attitude"/>']
    for sample in samples:
        pos = sample.get("position")
        if sample.get("location_status") != "explicit_offset" or not isinstance(pos, dict) or not _finite(pos.get("x_m")) or not _finite(pos.get("z_m")):
            continue
        px, py = sx(float(pos["x_m"])), sy_profile(float(pos["z_m"]))
        svg += [f'<path d="M {px-4:.6f} {py:.6f} L {px+4:.6f} {py:.6f} M {px:.6f} {py-4:.6f} L {px:.6f} {py+4:.6f}" stroke="{colors["sample"]}" data-sample="{_esc(sample.get("id", ""))}"/>', _svg_text(px+6, py-5, sample.get("id", ""), "small")]
    for label in attitude_labels:
        svg += [_label_back(label, small_font), _svg_text(label["x"], label["y"], label["text"], "small", "middle")]
    # All source layer ids stay outside the derived display regions.
    for geo in external_layer_labels:
        payload = geo["payload"]
        target_y = sy_profile(float(payload["label_target_z_m"]))
        svg.append(f'<path d="M {sx(float(payload["label_target_x_m"])):.3f} {target_y:.3f} L {geo["x"]:.3f} {geo["y"]-4:.3f}" class="leader" data-interval="{_esc(payload["interval"].get("id", ""))}"/>')
    for label in external_layer_labels:
        payload = label["payload"]
        svg += [_label_back(label, small_font),
                _svg_text(label["x"], label["y"], label["text"], "small", "middle", f'data-interval="{_esc(payload["interval"].get("id", ""))}"')]
    for tick in _axis_ticks(x_lo, x_hi):
        svg.append(_svg_text(sx(tick), profile_tick_y, _fmt(tick, decimals), "small", "middle"))
    svg += [_scale_bar(plot_left, profile_scale_y, units_per_px),
            _svg_text(margin, profile_note_y, f'近地表岩性解释填充贴合实测地形；统一显示深度 {_fmt(layer_geometry.get("effective_depth_m"), decimals)} m，不代表真厚度；虚线斜层界为产状派生解释线。', "small")]
    if thin_rows:
        svg.append(_svg_text(margin, thin_index_top, "窄层索引（源层界锚点未移动；完整名称与模板见下列索引及附表）", "subtitle"))
        for i, row in enumerate(thin_rows):
            col, rr = i % 3, i // 3
            tx, ty = margin + col * 430, thin_index_top + 32 + rr * 26
            svg.append(_svg_text(tx, ty, f'{row["index"]}  层号 {row.get("layer_id", "")}  {row.get("lithology_name") or "待配置"}', "small"))
    svg.append(_svg_text(margin, legend_top, "岩性图例", "subtitle"))
    legend_specs = list(material_map.values()) + ([{"id":"mat_pending", "name":"待配置岩性"}] if pending else [])
    for i, spec in enumerate(legend_specs):
        col, rr = i % 3, i // 3
        x, y = margin + col * 430, legend_top + 20 + rr * 35
        legend_pattern_id = f'{spec["id"]}__legend'
        unverified = spec.get("reference_status") == "unverified"
        border = 'stroke="#596675" stroke-dasharray="3 3"' if unverified else 'stroke="#5c6670"'
        legend_name = f'{spec["name"]}（纹样待核对）' if unverified else spec["name"]
        svg += [f'<rect x="{x:.3f}" y="{y:.3f}" width="52" height="22" fill="url(#{_esc(legend_pattern_id)})" {border}/>', _svg_text(x+62, y+16, legend_name, "small")]
    source_issues = data.get("issues", []) if isinstance(data.get("issues", []), list) else []
    missing_samples = sum(1 for s in samples if s.get("location_status") != "explicit_offset" or not s.get("position"))
    svg += [_svg_text(margin, note_top, "图示与精度说明", "subtitle"),
            _svg_text(margin, note_top+25, "• 分层处短走向符号按该层段首个产状的倾向 ±90° 定向，线长为图式长度，不表示实测接触面延伸范围。", "small"),
            _svg_text(margin, note_top+46, "• 产状记录起点仅作关联定位；标注可为避让而移动，不声称为独立实测产状点坐标。", "small"),
            _svg_text(margin, note_top+67, f'• 样品定位缺失 {missing_samples} 个，只进入附表；导入问题 {len(source_issues)} 项，完整列表见 appendix.html。', "small"),
            _svg_text(margin, note_top+88, f'• 参考图岩性纹样；行业图式尚未逐项核验。{len(unverified_material_names)} 种标记“纹样待核对”，未知岩性 {len(set(pending))} 种待配置。', "small"),
            _svg_text(margin, note_top+109, "• 本图按数据范围自适应版式，距离以米标尺读取；打印比例随输出尺寸变化。", "small")]
    svg.append("</svg>")
    drawing_path = out / "drawing.svg"
    drawing_path.write_text("".join(svg), encoding="utf-8")

    appendix_path = out / "appendix.html"
    _write_appendix(appendix_path, data, intervals, pending, thin_rows, decimals)

    features = x_values[:]
    for att in attitudes:
        try: features.append(float(_node(by_key, att.get("node"))["x_m"]))
        except (KeyError, TypeError, ValueError): pass
    for geo in interval_geometry: features.extend([float(geo["a"]["x_m"]), float(geo["b"]["x_m"])])
    d_lo, d_hi, dense_count = _densest_window(features, x_lo, x_hi, float(cfg["detail_window_fraction"]))
    detail_path: Path | None = None
    detail_scale: float | None = None
    detail_interval_audit: list[dict[str, Any]] = []
    detail_crossing_segments = 0
    detail_profile_node_indices: list[Any] = []
    if dense_count >= int(cfg["detail_min_features"]) and d_hi > d_lo:
        detail_path = out / "detail.svg"
        detail_scale = (d_hi - d_lo) / float(cfg["target_plot_width_px"])
        detail_profile_node_indices = [n.get("index") for n in nodes]
        detail_z_values: list[float] = []
        for na, nb in zip(nodes, nodes[1:]):
            xa, xb = float(na["x_m"]), float(nb["x_m"])
            za, zb = float(na["z_m"]), float(nb["z_m"])
            if max(xa, xb) < d_lo or min(xa, xb) > d_hi:
                continue
            if (xa < d_lo < xb) or (xb < d_lo < xa) or (xa < d_hi < xb) or (xb < d_hi < xa):
                detail_crossing_segments += 1
            if abs(xb-xa) <= 1e-12:
                detail_z_values.extend([za, zb])
            else:
                ca, cb = max(min(xa, xb), d_lo), min(max(xa, xb), d_hi)
                detail_z_values.extend([za + (zb-za)*(ca-xa)/(xb-xa), za + (zb-za)*(cb-xa)/(xb-xa)])
        if not detail_z_values:
            detail_z_values = [float(n["z_m"]) for n in nodes]
        dz_lo, dz_hi = min(detail_z_values), max(detail_z_values)
        dz_span = max(dz_hi-dz_lo, detail_scale*80)
        dleft, dtop = margin, 112.0
        def dsx(x: float) -> float: return dleft + (x-d_lo)/detail_scale
        def dsy(z: float) -> float: return dtop + (dz_hi-z)/detail_scale
        def detail_anchor_mapper(world: list[float]) -> dict[str, list[float]]:
            px, py = dsx(float(world[0])), dsy(float(world[1]))
            return {"svg": [px, py],
                    "inverse_world": [d_lo + (px - dleft) * detail_scale,
                                      dz_hi - (py - dtop) * detail_scale]}
        detail_geos: list[tuple[dict[str, Any], dict[str, Any]]] = []
        detail_label_items: list[tuple[float, str, Any]] = []
        for geo in interval_geometry:
            region = geo.get("layer_region", {})
            polygons = region.get("polygons", []) if region.get("status") == "drawn" else []
            region_points = [point for polygon in polygons for point in polygon if isinstance(point, (list, tuple)) and len(point) >= 2]
            intersects = bool(region_points) and min(float(p[0]) for p in region_points) <= d_hi and max(float(p[0]) for p in region_points) >= d_lo
            surface_lo, surface_hi = sorted((float(geo["a"]["x_m"]), float(geo["b"]["x_m"])))
            pending_visible = not region_points and surface_lo <= d_hi and surface_hi >= d_lo
            if not intersects and not pending_visible:
                continue
            detail_geos.append((geo, region))
            candidate_x = [float(p[0]) for p in region_points] if region_points else [surface_lo, surface_hi]
            visible_lo, visible_hi = max(min(candidate_x), d_lo), min(max(candidate_x), d_hi)
            anchor_data_x = (visible_lo + visible_hi) / 2
            layer_text = str(geo["interval"].get("layer_id", "")) or geo["index"]
            if region_points:
                target = min(region_points, key=lambda p: (abs(float(p[0])-anchor_data_x), float(p[1])))
                target_x_m, target_z_m = float(target[0]), float(target[1])
            else:
                target_x_m, target_z_m = anchor_data_x, min(float(geo["a"]["z_m"]), float(geo["b"]["z_m"]))
            detail_label_items.append((dsx(anchor_data_x), layer_text, (geo, region, target_x_m, target_z_m)))
            detail_interval_audit.append({"interval_id": geo["interval"].get("id"), "layer_id": geo["interval"].get("layer_id"),
                                          "main_world_polygons": polygons, "detail_world_polygons": polygons, "matches": True})
            detail_z_values.extend(float(point[1]) for point in region_points)
        dz_lo, dz_hi = min(detail_z_values), max(detail_z_values)
        dz_span = max(dz_hi-dz_lo, detail_scale*80)
        detail_plot_bottom = dtop + dz_span/detail_scale
        detail_label_y0 = detail_plot_bottom + 34
        detail_labels, _detail_extra_lanes = _line_boxes(detail_label_items, dleft, dleft+float(cfg["target_plot_width_px"]), detail_label_y0,
            small_font, line_height, 7, int(cfg["label_max_lanes"]))
        detail_lane_count = max((item["lane"] for item in detail_labels), default=-1) + 1
        detail_h = max(360.0, detail_label_y0 + max(detail_lane_count, 1)*line_height + 76)
        clip_height = detail_plot_bottom-dtop + 8
        detail_svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{page_w:.0f}" height="{detail_h:.0f}" viewBox="0 0 {page_w:.0f} {detail_h:.0f}"><defs>{_pattern_defs(materials_doc, derived_patterns, "detail", False, detail_anchor_mapper)}<clipPath id="detail-window"><rect x="{dleft:.6f}" y="{dtop-8:.6f}" width="{float(cfg["target_plot_width_px"]):.6f}" height="{clip_height+8:.6f}"/></clipPath></defs>',
            f'<rect width="100%" height="100%" fill="{colors["paper"]}"/><style>text{{font-family:{cfg["font_family"]};fill:{colors["ink"]};font-size:{cfg["font_size_px"]}px}}.small{{font-size:{cfg["small_font_size_px"]}px;fill:{colors["muted"]}}}.survey{{stroke:{colors["survey"]};stroke-width:2;fill:none}}.derived-contact{{stroke:{colors["contact"]};stroke-width:1.1;stroke-dasharray:5 3;fill:none}}.leader{{stroke:{colors["muted"]};stroke-width:.8;fill:none}}.scale line{{stroke:{colors["ink"]};stroke-width:2}}</style>',
            _svg_text(margin, 42, "最密集区数据核验详图", "", "start", 'style="font-size:22px;font-weight:700"'),
            _svg_text(margin, 70, f'范围 X={_fmt(d_lo)}–{_fmt(d_hi)} m；相对主图线性放大 {_fmt(units_per_px/detail_scale,2)}×；详图水平与高程同尺度（见米标尺）。', "small"),
            '<g clip-path="url(#detail-window)">']
        for geo, region in detail_geos:
            if region.get("status") != "drawn":
                continue
            for polygon_index, polygon_world in enumerate(region.get("polygons", [])):
                points = " ".join(f'{dsx(float(point[0])):.6f},{dsy(float(point[1])):.6f}' for point in polygon_world)
                detail_svg.append(f'<polygon points="{points}" fill="url(#{geo["pattern"]})" stroke="none" data-reference-status="{_esc(geo.get("reference_status", ""))}" data-interval="{_esc(region.get("interval_id", ""))}" data-polygon-index="{polygon_index}" data-world-points="{_esc(json.dumps(polygon_world, ensure_ascii=False, separators=(",", ":")))}"/>')
        for contact in layer_geometry.get("contacts", []):
            for segment_index, segment in enumerate(contact.get("segments", [])):
                if not isinstance(segment, list) or len(segment) != 2:
                    continue
                p1, p2 = segment
                detail_svg.append(f'<line x1="{dsx(float(p1[0])):.6f}" y1="{dsy(float(p1[1])):.6f}" x2="{dsx(float(p2[0])):.6f}" y2="{dsy(float(p2[1])):.6f}" class="derived-contact" data-contact="{_esc(contact.get("id", ""))}" data-segment-index="{segment_index}" data-world-segment="{_esc(json.dumps(segment, ensure_ascii=False, separators=(",", ":")))}"/>')
        full_points = " ".join(f'{dsx(float(n["x_m"])):.6f},{dsy(float(n["z_m"])):.6f}' for n in nodes)
        detail_svg.append(f'<polyline points="{full_points}" class="survey" data-node-count="{len(nodes)}"/>')
        for n in nodes:
            detail_svg.append(f'<circle cx="{dsx(float(n["x_m"])):.6f}" cy="{dsy(float(n["z_m"])):.6f}" r="2.4" fill="{colors["survey"]}" data-node="{_esc(n.get("index", ""))}"/>')
        detail_svg.append('</g>')
        if not layer_geometry_eligible:
            detail_svg.append(_svg_text(margin, 96, "斜层界几何不满足绘制条件；详图与主图一致，受影响区域保持留白。", "small"))
        for label in detail_labels:
            geo, region, target_x_m, target_z_m = label["payload"]
            detail_svg.append(f'<path d="M {dsx(target_x_m):.3f} {dsy(target_z_m):.3f} L {label["x"]:.3f} {label["y"]-4:.3f}" class="leader" data-interval="{_esc(geo["interval"].get("id", ""))}"/>')
        for label in detail_labels:
            geo = label["payload"][0]
            detail_svg += [_label_back(label, small_font), _svg_text(label["x"], label["y"], label["text"], "small", "middle", f'data-interval="{_esc(geo["interval"].get("id", ""))}"')]
        detail_svg += [_scale_bar(margin, detail_h-34, detail_scale), _svg_text(margin+230, detail_h-29, "数据核验图；参考图岩性纹样，行业图式尚未逐项核验；显示深度不代表真厚度。", "small"), "</svg>"]
        detail_path.write_text("".join(detail_svg), encoding="utf-8")

    audit = {
        "schema_version": "1.0",
        "input_counts": {"nodes": len(nodes), "records": len(records), "intervals": len(intervals), "stations": len(stations), "attitudes": len(attitudes), "samples": len(samples)},
        "geometry": {"x_range_m": [x_lo, x_hi], "offset_range_m": [o_lo, o_hi], "measured_elevation_range_m": [z_lo, z_hi], "display_elevation_range_m": [display_z_lo, z_hi], "units_per_px": units_per_px, "vertical_exaggeration": 1, "common_x_scale": True, "equal_plan_scale": True, "equal_profile_scale": True, "svg_geometry_coordinate_decimals_px": 6, "maximum_coordinate_serialization_error_px": 5e-7, "maximum_coordinate_serialization_error_m": units_per_px * 5e-7, "data_calculation_rounded": False},
        "projected_band": {"legacy_key": True, "meaning": "near_surface_apparent_dip_display_domain", "drawn_region_count": sum(1 for r in layer_geometry.get("regions", []) if r.get("status") == "drawn"), "requested_depth_m": layer_geometry.get("requested_depth_m"), "effective_depth_m": layer_geometry.get("effective_depth_m"), "depth_represents_true_thickness": False, "contacts_are_derived_interpretation_lines": True, "vertical_separators_drawn": False, "legacy_projection_precheck": {"safe": legacy_projection_safe, "reasons": legacy_projection_reasons}},
        "layer_geometry": layer_geometry,
        "pattern_audit": pattern_audit,
        "layout": {"page_width_px": page_w, "page_height_px": page_h, "station_label_dynamic_lanes_added": station_overflow, "attitude_label_dynamic_lanes_added": attitude_overflow, "layer_label_dynamic_lanes_added": thin_overflow, "label_forced_overlap_count": 0, "labelled_interval_count": len(external_layer_labels), "thin_interval_count": len(thin_rows), "thin_interval_ids": [r["index"] for r in thin_rows], "minimum_projected_interval_px": min((g["width_px"] for g in interval_geometry), default=None)},
        "materials": {"configured_names": list(material_map.keys()), "pending_names": sorted(set(pending)), "unverified_pattern_names": unverified_material_names, "render_scales": dict(materials_doc.get("render_scales", {})), "fuzzy_matching": False, "legend_uses_same_template_content_at_legend_scale": True},
        "samples": {"located": sum(1 for s in samples if s.get("location_status") == "explicit_offset" and s.get("position")), "missing_location": missing_samples, "missing_location_plotted": False},
        "detail": {"generated": detail_path is not None, "x_range_m": [d_lo, d_hi] if detail_path else None, "feature_count": dense_count, "units_per_px": detail_scale, "magnification_vs_main": (units_per_px/detail_scale if detail_scale else None), "layer_geometry_world_source_shared_with_main": bool(detail_path), "profile_uses_full_node_path_before_clipping": bool(detail_path), "profile_source_node_indices": detail_profile_node_indices, "boundary_crossing_segment_count": detail_crossing_segments, "boundary_crossing_segments_preserved_by_clip_path": bool(detail_path), "region_consistency": detail_interval_audit, "all_region_world_polygons_match_main": all(item["matches"] for item in detail_interval_audit)},
        "notes": ["All dimensions are data-derived; no fixed paper scale is claimed.", "Contact strike lines are fixed-length symbols derived from the first attitude in each interval.", "Full imported issues and long descriptions are in appendix.html."],
    }
    audit_path = out / "layout-audit.json"
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")

    result = {"drawing_svg": str(drawing_path), "layout_audit_json": str(audit_path), "appendix_html": str(appendix_path)}
    if detail_path: result["detail_svg"] = str(detail_path)
    if cfg.get("create_preview_png", False):
        edge = Path(str(cfg.get("edge_path", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")))
        if edge.exists():
            preview = out / "preview.png"
            with tempfile.TemporaryDirectory(prefix="geology-render-edge-") as edge_profile:
                cmd = [str(edge), "--headless=new", "--disable-gpu", "--hide-scrollbars",
                       f"--user-data-dir={edge_profile}", f"--screenshot={preview.resolve()}",
                       f"--window-size={int(page_w)},{int(page_h)}", drawing_path.resolve().as_uri()]
                completed = subprocess.run(cmd, capture_output=True, text=True, timeout=90, check=False)
            if completed.returncode == 0 and preview.exists(): result["preview_png"] = str(preview)
    return result


__all__ = ["render", "RenderInputError"]
