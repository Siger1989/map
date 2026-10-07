"""Derive near-surface layer regions from normalized traverse geometry.

This module uses only measured traverse nodes, the explicit section azimuth and
the first attitude of each following interval.  It does not read drawings and
does not infer true thickness or deep contacts.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Optional


EPS = 1e-10


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _issue(severity: str, code: str, message: str, cells: Iterable[str] = ()) -> dict[str, Any]:
    return {"severity": severity, "code": code, "message": message, "cells": [c for c in cells if c]}


def _line_value(line: dict[str, Any], point: tuple[float, float]) -> float:
    return line["a"] * point[0] + line["b"] * point[1] + line["c"]


def _terrain_z(nodes: list[dict[str, Any]], x: float) -> Optional[float]:
    """Interpolate z on a strictly monotonic-x terrain polyline."""
    for left, right in zip(nodes, nodes[1:]):
        x1, x2 = float(left["x_m"]), float(right["x_m"])
        if min(x1, x2) - EPS <= x <= max(x1, x2) + EPS:
            dx = x2 - x1
            if abs(dx) <= EPS:
                return None
            t = (x - x1) / dx
            return float(left["z_m"]) + t * (float(right["z_m"]) - float(left["z_m"]))
    return None


def _dedupe_points(points: Iterable[tuple[float, float]], tolerance: float = EPS) -> list[tuple[float, float]]:
    result: list[tuple[float, float]] = []
    for point in points:
        if not any(math.hypot(point[0] - old[0], point[1] - old[1]) <= tolerance for old in result):
            result.append(point)
    return result


def _line_polygon_segment(line: dict[str, Any], polygon: list[tuple[float, float]]) -> Optional[list[list[float]]]:
    """Clip an infinite normalized line to a convex polygon."""
    intersections: list[tuple[float, float]] = []
    for p, q in zip(polygon, polygon[1:] + polygon[:1]):
        fp, fq = _line_value(line, p), _line_value(line, q)
        if abs(fp) <= EPS:
            intersections.append(p)
        if fp * fq < -(EPS * EPS):
            t = fp / (fp - fq)
            intersections.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
        elif abs(fp) <= EPS and abs(fq) <= EPS:
            intersections.append(q)
    points = _dedupe_points(intersections)
    if len(points) < 2:
        return None
    best = max(((p, q) for i, p in enumerate(points) for q in points[i + 1:]),
               key=lambda pair: (pair[0][0] - pair[1][0]) ** 2 + (pair[0][1] - pair[1][1]) ** 2)
    return [[best[0][0], best[0][1]], [best[1][0], best[1][1]]]


def _clip_halfplane(polygon: list[tuple[float, float]], line: dict[str, Any], keep_sign: float) -> list[tuple[float, float]]:
    """Sutherland-Hodgman clipping without moving source boundaries."""
    if not polygon:
        return []
    output: list[tuple[float, float]] = []
    previous = polygon[-1]
    previous_value = keep_sign * _line_value(line, previous)
    previous_inside = previous_value >= -EPS
    for current in polygon:
        current_value = keep_sign * _line_value(line, current)
        current_inside = current_value >= -EPS
        if current_inside != previous_inside:
            denominator = previous_value - current_value
            if abs(denominator) > EPS:
                t = previous_value / denominator
                output.append((previous[0] + t * (current[0] - previous[0]),
                               previous[1] + t * (current[1] - previous[1])))
        if current_inside:
            output.append(current)
        previous, previous_value, previous_inside = current, current_value, current_inside
    return _dedupe_points(output)


def _polygon_area(polygon: list[tuple[float, float]]) -> float:
    return abs(sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(polygon, polygon[1:] + polygon[:1]))) / 2


def _domain_cells(nodes: list[dict[str, Any]], depth: float) -> list[list[tuple[float, float]]]:
    cells: list[list[tuple[float, float]]] = []
    for left, right in zip(nodes, nodes[1:]):
        x1, z1 = float(left["x_m"]), float(left["z_m"])
        x2, z2 = float(right["x_m"]), float(right["z_m"])
        cells.append([(x1, z1), (x2, z2), (x2, z2 - depth), (x1, z1 - depth)])
    return cells


def _contact_from_interval(interval: dict[str, Any], record: Optional[dict[str, Any]], node: dict[str, Any],
                           axis_deg: float, ordinal: int) -> dict[str, Any]:
    dip_direction = record.get("dip_direction_deg") if record else None
    dip_angle = record.get("dip_angle_deg") if record else None
    source = (record or {}).get("source_cells") or {}
    contact: dict[str, Any] = {
        "id": f"LC{ordinal:04d}", "node": interval.get("start_node"),
        "anchor_x_m": float(node["x_m"]), "anchor_z_m": float(node["z_m"]),
        "record_id": record.get("id") if record else None,
        "dip_direction_deg": dip_direction, "dip_angle_deg": dip_angle,
        "apparent_dip_deg_signed": None, "a": None, "b": None, "c": None,
        "basis": "following_interval_first_record_attitude",
        "source_cells": {"dip_direction_deg": source.get("dip_direction_deg"),
                         "dip_angle_deg": source.get("dip_angle_deg")},
        "segments": [], "status": "pending", "reason": "missing_attitude",
    }
    if not (_finite(dip_direction) and _finite(dip_angle)):
        return contact
    dip_direction, dip_angle = float(dip_direction), float(dip_angle)
    if not (0 <= dip_direction < 360 and 0 <= dip_angle <= 90):
        contact["reason"] = "invalid_attitude"
        return contact

    delta = math.radians(dip_angle)
    direction_delta = math.radians(axis_deg - dip_direction)
    # Stable projected direction.  Its slope is exactly
    # dz/dx = -tan(delta) * cos(A-D) whenever cos(delta) != 0.
    qx = math.cos(delta)
    qz = -math.sin(delta) * math.cos(direction_delta)
    norm = math.hypot(qx, qz)
    if norm <= EPS:
        contact["reason"] = "vertical_dip_parallel_to_strike_degenerate"
        return contact
    qx, qz = qx / norm, qz / norm
    a, b = qz, -qx  # (a,b) is a normalized normal; (qx,qz) follows the line.
    c = -(a * contact["anchor_x_m"] + b * contact["anchor_z_m"])
    contact.update({"apparent_dip_deg_signed": math.degrees(math.atan2(qz, qx)),
                    "a": a, "b": b, "c": c, "status": "eligible", "reason": ""})
    return contact


def _terrain_contact_problem(contact: dict[str, Any], nodes: list[dict[str, Any]]) -> Optional[str]:
    """Return why a boundary cannot unambiguously leave the outcrop anchor."""
    anchor_index = contact["node"]
    if not isinstance(anchor_index, int) or not 0 < anchor_index < len(nodes) - 1:
        return "invalid_internal_anchor"
    anchor = (float(nodes[anchor_index]["x_m"]), float(nodes[anchor_index]["z_m"]))
    before = (float(nodes[anchor_index - 1]["x_m"]), float(nodes[anchor_index - 1]["z_m"]))
    after = (float(nodes[anchor_index + 1]["x_m"]), float(nodes[anchor_index + 1]["z_m"]))
    f_before, f_after = _line_value(contact, before), _line_value(contact, after)
    if abs(f_before) <= EPS or abs(f_after) <= EPS or f_before * f_after >= 0:
        return "surface_tangent_or_coincident"

    intersections: list[tuple[float, float]] = [anchor]
    for p, q in zip(nodes, nodes[1:]):
        pxy, qxy = (float(p["x_m"]), float(p["z_m"])), (float(q["x_m"]), float(q["z_m"]))
        fp, fq = _line_value(contact, pxy), _line_value(contact, qxy)
        if abs(fp) <= EPS and abs(fq) <= EPS:
            return "surface_tangent_or_coincident"
        if fp * fq < -(EPS * EPS):
            t = fp / (fp - fq)
            intersections.append((pxy[0] + t * (qxy[0] - pxy[0]), pxy[1] + t * (qxy[1] - pxy[1])))
        elif abs(fp) <= EPS:
            intersections.append(pxy)
        elif abs(fq) <= EPS:
            intersections.append(qxy)
    if len(_dedupe_points(intersections)) > 1:
        return "surface_reintersection"
    return None


def _line_intersection(left: dict[str, Any], right: dict[str, Any]) -> Optional[tuple[float, float]]:
    determinant = left["a"] * right["b"] - right["a"] * left["b"]
    if abs(determinant) <= EPS:
        return None
    x = (left["b"] * right["c"] - left["c"] * right["b"]) / determinant
    z = (right["a"] * left["c"] - left["a"] * right["c"]) / determinant
    return x, z


def build_layer_geometry(data: dict[str, Any], requested_depth_m: float) -> dict[str, Any]:
    """Build shared apparent-dip contacts and clipped near-surface regions.

    Returned polygon points and contact segment points are ``[x_m, z_m]`` in
    world/data coordinates.  No screen-pixel minimum width or anchor movement is
    applied.
    """
    issues: list[dict[str, Any]] = []
    result: dict[str, Any] = {
        "mode": "apparent_dip_outcrop", "requested_depth_m": requested_depth_m,
        "effective_depth_m": 0.0, "contacts": [], "regions": [], "issues": issues,
        "eligible": False,
    }
    if not _finite(requested_depth_m) or float(requested_depth_m) <= 0:
        issues.append(_issue("error", "invalid_display_depth", "近地表显示深度必须是大于 0 的有限米值"))
        return result
    requested_depth = float(requested_depth_m)
    result["requested_depth_m"] = requested_depth

    nodes = data.get("nodes") or []
    intervals = data.get("intervals") or []
    records = data.get("records") or []
    axis = (data.get("settings") or {}).get("axis_azimuth_deg")
    if not _finite(axis) or len(nodes) < 2 or not intervals:
        issues.append(_issue("error", "layer_geometry_input_missing", "缺少剖面方位、节点或层段，不能构造近地表层区"))
        return result
    if any(not (_finite(node.get("x_m")) and _finite(node.get("z_m"))) for node in nodes):
        issues.append(_issue("error", "layer_geometry_node_invalid", "节点 X/相对高程必须是有限数"))
        return result

    dx_values = [float(right["x_m"]) - float(left["x_m"]) for left, right in zip(nodes, nodes[1:])]
    direction = 1 if dx_values[0] > EPS else -1 if dx_values[0] < -EPS else 0
    if direction == 0 or any(dx * direction <= EPS for dx in dx_values):
        issues.append(_issue("error", "nonmonotonic_projection",
                             "测线轴向投影存在回折、重叠或零宽测段，近地表层区不填充"))
        result["regions"] = [{"interval_id": interval.get("id"), "layer_id": interval.get("layer_id"),
                              "source_node_indices": list(range(int(interval.get("start_node", 0)),
                                                                int(interval.get("end_node", -1)) + 1)),
                              "polygons": [], "status": "pending", "reason": "nonmonotonic_projection"}
                             for interval in intervals]
        return result

    record_by_id = {record.get("id"): record for record in records}
    contacts: list[dict[str, Any]] = []
    for ordinal, interval in enumerate(intervals[1:], start=1):
        node_index = interval.get("start_node")
        record_ids = interval.get("record_ids") or []
        record = record_by_id.get(record_ids[0]) if record_ids else None
        if not isinstance(node_index, int) or not 0 <= node_index < len(nodes):
            contact = {"id": f"LC{ordinal:04d}", "node": node_index, "anchor_x_m": None,
                       "anchor_z_m": None, "record_id": record.get("id") if record else None,
                       "dip_direction_deg": None, "dip_angle_deg": None,
                       "apparent_dip_deg_signed": None, "a": None, "b": None, "c": None,
                       "basis": "following_interval_first_record_attitude", "source_cells": {},
                       "segments": [], "status": "pending", "reason": "invalid_internal_anchor"}
        else:
            contact = _contact_from_interval(interval, record, nodes[node_index], float(axis), ordinal)
        contacts.append(contact)
    result["contacts"] = contacts

    for contact in contacts:
        if contact["status"] != "eligible":
            issues.append(_issue("warning", "contact_pending",
                                 f"层界 {contact['id']} 缺少可用产状或投影退化，受影响层区留白",
                                 contact.get("source_cells", {}).values()))
            continue
        problem = _terrain_contact_problem(contact, nodes)
        if problem:
            contact.update({"status": "pending", "reason": problem, "segments": []})
            issues.append(_issue("warning", problem,
                                 f"层界 {contact['id']} 与地形相切、重合或再次相交，受影响层区留白",
                                 contact.get("source_cells", {}).values()))

    valid_contacts = [contact for contact in contacts if contact["status"] == "eligible"]
    first_intersection_depth: Optional[float] = None
    zero_depth_conflict = False
    for index, left in enumerate(valid_contacts):
        for right in valid_contacts[index + 1:]:
            point = _line_intersection(left, right)
            if point is None:
                continue
            terrain_z = _terrain_z(nodes, point[0])
            if terrain_z is None:
                continue
            depth = terrain_z - point[1]
            if abs(depth) <= EPS:
                zero_depth_conflict = True
            elif EPS < depth <= requested_depth + EPS:
                first_intersection_depth = depth if first_intersection_depth is None else min(first_intersection_depth, depth)
    if zero_depth_conflict:
        issues.append(_issue("error", "zero_depth_topology_conflict",
                             "两条层界在地表显示域发生零深度拓扑冲突，近地表层区不填充"))
        for contact in contacts:
            contact["segments"] = []
        result["regions"] = [{"interval_id": interval.get("id"), "layer_id": interval.get("layer_id"),
                              "source_node_indices": list(range(int(interval["start_node"]), int(interval["end_node"]) + 1)),
                              "polygons": [], "status": "pending", "reason": "zero_depth_topology_conflict"}
                             for interval in intervals]
        return result

    effective_depth = requested_depth
    if first_intersection_depth is not None:
        effective_depth = 0.8 * first_intersection_depth
        issues.append(_issue("warning", "display_depth_shortened_at_contact_intersection",
                             f"层界在请求显示域内相交；显示深度由 {requested_depth!r} m 缩短为 {effective_depth!r} m。该深度不是厚度"))
    result["effective_depth_m"] = effective_depth
    domain_cells = _domain_cells(nodes, effective_depth)

    # Every contact is clipped from the same world-coordinate display cells.
    for contact in contacts:
        if contact["status"] != "eligible":
            continue
        segments: list[list[list[float]]] = []
        for cell in domain_cells:
            segment = _line_polygon_segment(contact, cell)
            if segment and not any(all(math.hypot(segment[i][0] - old[i][0], segment[i][1] - old[i][1]) <= EPS
                                       for i in (0, 1)) for old in segments):
                segments.append(segment)
        contact["segments"] = segments
        contact["status"] = "drawn" if segments else "pending"
        contact["reason"] = "" if segments else "outside_effective_display_domain"

    contact_by_right_interval = {index + 1: contact for index, contact in enumerate(contacts)}
    regions: list[dict[str, Any]] = []
    for interval_index, interval in enumerate(intervals):
        start_node, end_node = int(interval["start_node"]), int(interval["end_node"])
        region = {"interval_id": interval.get("id"), "layer_id": interval.get("layer_id"),
                  "source_node_indices": list(range(start_node, end_node + 1)),
                  "polygons": [], "status": "drawn", "reason": ""}
        left_contact = contact_by_right_interval.get(interval_index)
        right_contact = contact_by_right_interval.get(interval_index + 1)
        affected = [contact for contact in (left_contact, right_contact)
                    if contact is not None and contact["status"] != "drawn"]
        if affected:
            region.update({"status": "pending", "reason": "adjacent_contact_pending"})
            regions.append(region)
            continue
        midpoint_x = (float(nodes[start_node]["x_m"]) + float(nodes[end_node]["x_m"])) / 2
        midpoint_z = _terrain_z(nodes, midpoint_x)
        if midpoint_z is None:
            region.update({"status": "pending", "reason": "surface_midpoint_unavailable"})
            regions.append(region)
            continue
        halfplanes: list[tuple[dict[str, Any], float]] = []
        topology_problem = False
        for contact in (left_contact, right_contact):
            if contact is None:
                continue
            value = _line_value(contact, (midpoint_x, midpoint_z))
            if abs(value) <= EPS:
                topology_problem = True
                break
            halfplanes.append((contact, 1.0 if value > 0 else -1.0))
        if topology_problem:
            region.update({"status": "pending", "reason": "boundary_touches_interval_surface_midpoint"})
            issues.append(_issue("warning", "boundary_touches_interval_surface_midpoint",
                                 f"层段 {interval.get('id')} 的层界与本层地表中点相切，留白待核对"))
            regions.append(region)
            continue
        polygons: list[list[list[float]]] = []
        # A dipping layer continues laterally beneath adjacent outcrop spans.
        # Clip every terrain-strip cell by this region's two shared contacts;
        # limiting cells to the source interval's surface X range would create
        # artificial vertical gaps at the source anchors.
        for cell_index in range(len(domain_cells)):
            polygon = list(domain_cells[cell_index])
            for contact, keep_sign in halfplanes:
                polygon = _clip_halfplane(polygon, contact, keep_sign)
                if len(polygon) < 3:
                    break
            if len(polygon) >= 3 and _polygon_area(polygon) > EPS:
                polygons.append([[point[0], point[1]] for point in polygon])
        if not polygons:
            region.update({"status": "pending", "reason": "empty_after_halfplane_clipping"})
            issues.append(_issue("warning", "empty_layer_region",
                                 f"层段 {interval.get('id')} 经共享层界裁剪后为空，留白待核对"))
        else:
            region["polygons"] = polygons
        regions.append(region)

    result["regions"] = regions
    result["eligible"] = any(region["status"] == "drawn" for region in regions)
    return result


__all__ = ["build_layer_geometry"]
