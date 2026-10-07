"""Independent tests for apparent-dip near-surface layer geometry.

The expected line direction, half-plane membership, polygon convexity and area
partition checks are derived in this file instead of calling implementation
helpers from layer_geometry.py.
"""
from __future__ import annotations

import copy
import json
import math
import re
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from importer import load_workbook_data
from layer_geometry import build_layer_geometry
from renderer import render


ROOT = Path(__file__).resolve().parent
CANONICAL_PM01 = ROOT / "outputs" / "geology-template-v1" / "PM01规范输入.xlsx"
RESULT_JSON = ROOT / "logs" / "layer-geometry-tests.json"
TOL = 1e-9


def synthetic_data(
    attitudes: list[tuple[float | None, float | None]],
    *,
    axis_deg: float = 0.0,
    width_m: float = 10.0,
    elevations: list[float] | None = None,
) -> dict[str, Any]:
    """Create one record and one interval per surface span."""
    count = len(attitudes)
    elevations = elevations or [0.0] * (count + 1)
    nodes = []
    for index in range(count + 1):
        x = index * width_m
        nodes.append({
            "index": index,
            "east_m": x,
            "north_m": 0.0,
            "z_m": float(elevations[index]),
            "x_m": x,
            "offset_m": 0.0,
            "chainage_m": x,
            "slant_chainage_m": x,
        })
    records, intervals, measured_attitudes = [], [], []
    for index, (direction, dip) in enumerate(attitudes):
        record_id = f"R{index + 1:04d}"
        layer_id = f"L{index + 1}"
        source_cells = {"dip_direction_deg": f"I{index + 2}", "dip_angle_deg": f"J{index + 2}"}
        records.append({
            "id": record_id,
            "leg_id": f"{index}-{index + 1}",
            "layer_id": layer_id,
            "length_m": width_m,
            "slope_deg": 0.0,
            "azimuth_deg": axis_deg,
            "dip_direction_deg": direction,
            "dip_angle_deg": dip,
            "lithology_name": "泥岩" if index % 2 == 0 else "凝灰岩",
            "description": f"合成层{index + 1}",
            "start_node": index,
            "end_node": index + 1,
            "raw": {},
            "source_cells": source_cells,
            "computed": {"horizontal_m": width_m, "vertical_m": 0.0, "east_delta_m": width_m, "north_delta_m": 0.0},
            "true_thickness_m": None,
        })
        intervals.append({
            "id": f"I{index + 1:04d}",
            "layer_id": layer_id,
            "start_node": index,
            "end_node": index + 1,
            "record_ids": [record_id],
            "lithology_name": records[-1]["lithology_name"],
            "description": records[-1]["description"],
            "source_cells": {},
        })
        if direction is not None and dip is not None:
            measured_attitudes.append({
                "id": f"A{index + 1:04d}",
                "record_id": record_id,
                "layer_id": layer_id,
                "node": index,
                "dip_direction_deg": direction,
                "dip_angle_deg": dip,
                "location_basis": "record_start_association",
            })
    return {
        "schema_version": "1.0",
        "source": {"filename": "synthetic.xlsx", "sha256": "test", "adapter": "test", "sheet": "测段"},
        "project": {"name": "合成测试", "section_id": "T-LAYER"},
        "settings": {"axis_azimuth_deg": axis_deg, "axis_method": "explicit", "coordinate_system": "local_relative", "vertical_exaggeration": 1},
        "records": records,
        "nodes": nodes,
        "intervals": intervals,
        "stations": [],
        "attitudes": measured_attitudes,
        "samples": [],
        "issues": [],
        "summary": {},
    }


def expected_direction(axis_deg: float, dip_direction_deg: float, dip_angle_deg: float) -> tuple[float, float]:
    """Contract direction: (cos δ, -sin δ cos(A-D))."""
    axis = math.radians(axis_deg)
    direction = math.radians(dip_direction_deg)
    dip = math.radians(dip_angle_deg)
    return math.cos(dip), -math.sin(dip) * math.cos(axis - direction)


def polygon_signed_area(polygon: list[list[float]] | list[tuple[float, float]]) -> float:
    return 0.5 * sum(
        float(x1) * float(y2) - float(x2) * float(y1)
        for (x1, y1), (x2, y2) in zip(polygon, polygon[1:] + polygon[:1])
    )


def polygon_area(polygon: list[list[float]] | list[tuple[float, float]]) -> float:
    return abs(polygon_signed_area(polygon))


def is_convex(polygon: list[list[float]], tolerance: float = TOL) -> bool:
    if len(polygon) < 3:
        return False
    signs = []
    for index in range(len(polygon)):
        x1, y1 = polygon[index - 1]
        x2, y2 = polygon[index]
        x3, y3 = polygon[(index + 1) % len(polygon)]
        cross = (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2)
        if abs(cross) > tolerance:
            signs.append(math.copysign(1.0, cross))
    return bool(signs) and all(sign == signs[0] for sign in signs)


def clip_convex(subject: list[list[float]], clipper: list[list[float]]) -> list[list[float]]:
    """Independent convex intersection used only to detect overlap in tests."""
    output = [list(point) for point in subject]
    orientation = 1.0 if polygon_signed_area(clipper) >= 0 else -1.0
    for edge_index in range(len(clipper)):
        ax, ay = clipper[edge_index]
        bx, by = clipper[(edge_index + 1) % len(clipper)]

        def side(point: list[float]) -> float:
            return orientation * ((bx - ax) * (point[1] - ay) - (by - ay) * (point[0] - ax))

        incoming = output
        output = []
        if not incoming:
            break
        previous = incoming[-1]
        previous_side = side(previous)
        for current in incoming:
            current_side = side(current)
            previous_inside, current_inside = previous_side >= -TOL, current_side >= -TOL
            if current_inside != previous_inside:
                denominator = previous_side - current_side
                ratio = previous_side / denominator if abs(denominator) > 1e-15 else 0.0
                output.append([
                    previous[0] + ratio * (current[0] - previous[0]),
                    previous[1] + ratio * (current[1] - previous[1]),
                ])
            if current_inside:
                output.append(list(current))
            previous, previous_side = current, current_side
    return output


def terrain_z(nodes: list[dict[str, Any]], x: float) -> float:
    for left, right in zip(nodes, nodes[1:]):
        x1, x2 = float(left["x_m"]), float(right["x_m"])
        if min(x1, x2) - TOL <= x <= max(x1, x2) + TOL:
            if abs(x2 - x1) <= TOL:
                return max(float(left["z_m"]), float(right["z_m"]))
            ratio = (x - x1) / (x2 - x1)
            return float(left["z_m"]) + ratio * (float(right["z_m"]) - float(left["z_m"]))
    raise AssertionError(f"x={x} is outside terrain domain")


def point_on_polygon_boundary(point: tuple[float, float], polygons: Iterable[list[list[float]]]) -> bool:
    px, py = point
    for polygon in polygons:
        for (x1, y1), (x2, y2) in zip(polygon, polygon[1:] + polygon[:1]):
            cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
            if abs(cross) > 1e-7:
                continue
            dot = (px - x1) * (px - x2) + (py - y1) * (py - y2)
            if dot <= 1e-7:
                return True
    return False


class LayerGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pm01 = load_workbook_data(CANONICAL_PM01)

    def assert_contact_formula(self, axis: float, direction: float, dip: float, expected_angle: float) -> None:
        data = synthetic_data([(0.0, 10.0), (direction, dip)], axis_deg=axis)
        geometry = build_layer_geometry(data, 8.0)
        self.assertEqual(len(geometry["contacts"]), 1)
        contact = geometry["contacts"][0]
        dx, dz = expected_direction(axis, direction, dip)
        norm = math.hypot(dx, dz)
        self.assertGreater(norm, 1e-12)
        dx, dz = dx / norm, dz / norm
        # A line normal (a,b) is perpendicular to the independently derived direction.
        self.assertAlmostEqual(contact["a"] * dx + contact["b"] * dz, 0.0, places=10)
        self.assertAlmostEqual(contact["a"] ** 2 + contact["b"] ** 2, 1.0, places=10)
        self.assertAlmostEqual(contact["a"] * contact["anchor_x_m"] + contact["b"] * contact["anchor_z_m"] + contact["c"], 0.0, places=10)
        self.assertAlmostEqual(contact["apparent_dip_deg_signed"], expected_angle, places=9)

    def test_apparent_dip_direction_cases(self) -> None:
        cases = [
            (0.0, 0.0, 45.0, -45.0, "dip direction follows section"),
            (0.0, 180.0, 45.0, 45.0, "dip direction opposes section"),
            (0.0, 90.0, 45.0, 0.0, "section follows strike"),
            (25.0, 83.0, 0.0, 0.0, "horizontal bed"),
            (0.0, 0.0, 90.0, -90.0, "vertical bed across strike"),
        ]
        for axis, direction, dip, expected, label in cases:
            with self.subTest(label=label):
                self.assert_contact_formula(axis, direction, dip, expected)

    def test_vertical_bed_along_strike_is_explicitly_degenerate(self) -> None:
        data = synthetic_data([(0.0, 10.0), (90.0, 90.0)], axis_deg=0.0)
        geometry = build_layer_geometry(data, 8.0)
        self.assertFalse(geometry["eligible"])
        contact = next(contact for contact in geometry["contacts"] if contact.get("node") == 1)
        self.assertEqual(contact["status"], "pending")
        self.assertEqual(contact["reason"], "vertical_dip_parallel_to_strike_degenerate")
        self.assertEqual(contact["segments"], [])
        self.assertIsNone(contact["a"])
        self.assertIsNone(contact["b"])
        self.assertIsNone(contact["c"])
        text = json.dumps(geometry.get("issues", []), ensure_ascii=False).lower()
        self.assertTrue("退化" in text or "degenerate" in text or "along_strike" in text)

    def test_contacts_keep_exact_source_anchors_and_basis(self) -> None:
        geometry = build_layer_geometry(self.pm01, 12.0)
        records = {record["id"]: record for record in self.pm01["records"]}
        intervals = {interval["start_node"]: interval for interval in self.pm01["intervals"][1:]}
        self.assertEqual(len(geometry["contacts"]), len(self.pm01["intervals"]) - 1)
        for contact in geometry["contacts"]:
            node = self.pm01["nodes"][contact["node"]]
            interval = intervals[contact["node"]]
            first_record = records[interval["record_ids"][0]]
            self.assertEqual(contact["anchor_x_m"], node["x_m"])
            self.assertEqual(contact["anchor_z_m"], node["z_m"])
            self.assertEqual(contact["record_id"], first_record["id"])
            self.assertEqual(contact["basis"], "following_interval_first_record_attitude")
            self.assertEqual(contact["dip_direction_deg"], first_record["dip_direction_deg"])
            self.assertEqual(contact["dip_angle_deg"], first_record["dip_angle_deg"])

    def test_pm01_c12_uses_source_300_11(self) -> None:
        geometry = build_layer_geometry(self.pm01, 12.0)
        interval = next(item for item in self.pm01["intervals"] if item["layer_id"] == "C12")
        contact = next(item for item in geometry["contacts"] if item["node"] == interval["start_node"])
        self.assertEqual((contact["record_id"], contact["dip_direction_deg"], contact["dip_angle_deg"]), ("R0020", 300.0, 11.0))
        record = next(item for item in self.pm01["records"] if item["id"] == "R0020")
        self.assertEqual(contact["source_cells"]["dip_direction_deg"], record["source_cells"]["dip_direction_deg"])
        self.assertEqual(contact["source_cells"]["dip_angle_deg"], record["source_cells"]["dip_angle_deg"])

    def test_shared_contact_is_boundary_of_both_adjacent_regions(self) -> None:
        data = synthetic_data([(0.0, 30.0), (0.0, 30.0), (0.0, 30.0)], axis_deg=0.0)
        geometry = build_layer_geometry(data, 5.0)
        regions = {region["interval_id"]: region for region in geometry["regions"]}
        for contact_index, contact in enumerate(geometry["contacts"], start=1):
            left = regions[f"I{contact_index:04d}"]
            right = regions[f"I{contact_index + 1:04d}"]
            self.assertEqual(left["status"], "drawn")
            self.assertEqual(right["status"], "drawn")
            self.assertTrue(contact["segments"])
            for segment in contact["segments"]:
                midpoint = ((segment[0][0] + segment[1][0]) / 2, (segment[0][1] + segment[1][1]) / 2)
                self.assertTrue(point_on_polygon_boundary(midpoint, left["polygons"]), (contact["id"], "left", midpoint))
                self.assertTrue(point_on_polygon_boundary(midpoint, right["polygons"]), (contact["id"], "right", midpoint))

    def test_nonparallel_contacts_shorten_before_first_display_intersection(self) -> None:
        # Contacts anchor at x=10 and x=20. Slopes -1 and +1 meet at x=15,z=-5.
        data = synthetic_data([(0.0, 10.0), (0.0, 45.0), (180.0, 45.0)], axis_deg=0.0)
        geometry = build_layer_geometry(data, 10.0)
        self.assertAlmostEqual(geometry["effective_depth_m"], 4.0, places=8)
        self.assertLess(geometry["effective_depth_m"], geometry["requested_depth_m"])
        text = json.dumps(geometry.get("issues", []), ensure_ascii=False).lower()
        self.assertTrue("交" in text or "intersect" in text)

    def test_missing_attitude_stays_pending_without_vertical_fallback(self) -> None:
        data = synthetic_data([(0.0, 20.0), (None, None), (0.0, 20.0)], axis_deg=0.0)
        geometry = build_layer_geometry(data, 6.0)
        contact = next(contact for contact in geometry["contacts"] if contact.get("node") == 1)
        self.assertEqual(contact["status"], "pending")
        self.assertEqual(contact["reason"], "missing_attitude")
        self.assertEqual(contact["segments"], [])
        self.assertIsNone(contact["a"])
        self.assertIsNone(contact["b"])
        self.assertIsNone(contact["c"])
        affected = [region for region in geometry["regions"] if region["interval_id"] in {"I0001", "I0002"}]
        self.assertTrue(affected)
        self.assertTrue(all(region["status"] == "pending" and not region["polygons"] for region in affected))

    def test_lithology_name_change_does_not_move_geometry(self) -> None:
        data = synthetic_data([(0.0, 25.0), (30.0, 35.0), (60.0, 20.0)], axis_deg=0.0)
        original = build_layer_geometry(data, 5.0)
        changed_data = copy.deepcopy(data)
        for index, interval in enumerate(changed_data["intervals"]):
            interval["lithology_name"] = f"图案名-{index}"
        for index, record in enumerate(changed_data["records"]):
            record["lithology_name"] = f"图案名-{index}"
        changed = build_layer_geometry(changed_data, 5.0)
        self.assertEqual(original["contacts"], changed["contacts"])
        original_regions = [{key: region.get(key) for key in ("interval_id", "source_node_indices", "polygons", "status", "reason")} for region in original["regions"]]
        changed_regions = [{key: region.get(key) for key in ("interval_id", "source_node_indices", "polygons", "status", "reason")} for region in changed["regions"]]
        self.assertEqual(original_regions, changed_regions)

    def assert_regions_valid(self, data: dict[str, Any], geometry: dict[str, Any], *, require_complete_partition: bool) -> dict[str, float]:
        nodes = data["nodes"]
        depth = float(geometry["effective_depth_m"])
        contacts = geometry["contacts"]
        polygons: list[tuple[str, list[list[float]]]] = []
        total_area = 0.0
        for region in geometry["regions"]:
            if region["status"] != "drawn":
                continue
            indices = region["source_node_indices"]
            self.assertTrue(indices)
            start_node, end_node = nodes[indices[0]], nodes[indices[-1]]
            mid_x = (float(start_node["x_m"]) + float(end_node["x_m"])) / 2
            mid_z = terrain_z(nodes, mid_x)
            relevant_contacts = [contact for contact in contacts if contact["node"] in {indices[0], indices[-1]}]
            for polygon in region["polygons"]:
                self.assertTrue(is_convex(polygon), (region["interval_id"], polygon))
                area = polygon_area(polygon)
                self.assertGreater(area, TOL)
                total_area += area
                polygons.append((region["interval_id"], polygon))
                for x, z in polygon:
                    top = terrain_z(nodes, float(x))
                    self.assertLessEqual(float(z), top + 2e-8, (region["interval_id"], x, z, top))
                    self.assertGreaterEqual(float(z), top - depth - 2e-8, (region["interval_id"], x, z, top - depth))
                for contact in relevant_contacts:
                    reference = contact["a"] * mid_x + contact["b"] * mid_z + contact["c"]
                    self.assertGreater(abs(reference), TOL, (region["interval_id"], contact["id"], "ambiguous reference side"))
                    for x, z in polygon:
                        value = contact["a"] * x + contact["b"] * z + contact["c"]
                        self.assertGreaterEqual(value * reference, -2e-7, (region["interval_id"], contact["id"], x, z))
        max_overlap = 0.0
        for first in range(len(polygons)):
            for second in range(first + 1, len(polygons)):
                if polygons[first][0] == polygons[second][0]:
                    continue
                overlap = polygon_area(clip_convex(polygons[first][1], polygons[second][1]))
                max_overlap = max(max_overlap, overlap)
                self.assertLessEqual(overlap, 2e-7, (polygons[first][0], polygons[second][0], overlap))
        if require_complete_partition:
            expected_area = sum(abs(float(right["x_m"]) - float(left["x_m"])) * depth for left, right in zip(nodes, nodes[1:]))
            self.assertAlmostEqual(total_area, expected_area, delta=max(2e-6, expected_area * 1e-9))
        return {"total_area": total_area, "max_overlap": max_overlap}

    def test_synthetic_regions_are_convex_in_domain_and_correct_halfplanes(self) -> None:
        data = synthetic_data([(10.0, 12.0), (15.0, 18.0), (20.0, 10.0)], axis_deg=0.0, elevations=[0.0, -1.0, -0.5, -2.0])
        geometry = build_layer_geometry(data, 4.0)
        self.assertTrue(all(region["status"] == "drawn" for region in geometry["regions"]), geometry["issues"])
        self.assert_regions_valid(data, geometry, require_complete_partition=True)

    def test_pm01_regions_partition_without_overlap_or_holes(self) -> None:
        geometry = build_layer_geometry(self.pm01, 12.0)
        self.assertTrue(geometry["eligible"], geometry["issues"])
        self.assertTrue(all(region["status"] == "drawn" for region in geometry["regions"]), geometry["issues"])
        metrics = self.assert_regions_valid(self.pm01, geometry, require_complete_partition=True)
        self.assertGreater(metrics["total_area"], 0.0)
        crossed_source_span = False
        for region in geometry["regions"][1:-1]:
            indices = region["source_node_indices"]
            source_x = [float(self.pm01["nodes"][index]["x_m"]) for index in indices]
            polygon_x = [float(point[0]) for polygon in region["polygons"] for point in polygon]
            if min(polygon_x) < min(source_x) - 1e-8 or max(polygon_x) > max(source_x) + 1e-8:
                crossed_source_span = True
                break
        self.assertTrue(crossed_source_span, "all regions were still vertically cut to their source surface X spans")

    def test_renderer_main_and_detail_reuse_identical_world_geometry(self) -> None:
        with tempfile.TemporaryDirectory(prefix="layer-render-test-") as directory:
            paths = render(self.pm01, directory, {"create_preview_png": False, "layer_display_depth_m": 18.0})
            audit = json.loads(Path(paths["layout_audit_json"]).read_text(encoding="utf-8"))
            direct = build_layer_geometry(self.pm01, 18.0)
            self.assertEqual(audit["layer_geometry"], direct)
            self.assertFalse(audit["projected_band"]["vertical_separators_drawn"])
            self.assertTrue(audit["detail"]["generated"])
            self.assertTrue(audit["detail"]["layer_geometry_world_source_shared_with_main"])
            self.assertTrue(audit["detail"]["all_region_world_polygons_match_main"])
            self.assertEqual(audit["detail"]["profile_source_node_indices"], [node["index"] for node in self.pm01["nodes"]])
            main_svg = Path(paths["drawing_svg"]).read_text(encoding="utf-8")
            detail_svg = Path(paths["detail_svg"]).read_text(encoding="utf-8")
            main_polygons = set(re.findall(r'data-world-points="([^"]+)"', main_svg))
            detail_polygons = set(re.findall(r'data-world-points="([^"]+)"', detail_svg))
            main_contacts = set(re.findall(r'data-world-segment="([^"]+)"', main_svg))
            detail_contacts = set(re.findall(r'data-world-segment="([^"]+)"', detail_svg))
            self.assertTrue(detail_polygons)
            self.assertTrue(detail_contacts)
            self.assertTrue(detail_polygons.issubset(main_polygons))
            self.assertTrue(detail_contacts.issubset(main_contacts))

    def test_renderer_pending_contact_leaves_blank_without_vertical_substitute(self) -> None:
        data = synthetic_data([(0.0, 20.0), (None, None), (0.0, 20.0)], axis_deg=0.0)
        with tempfile.TemporaryDirectory(prefix="layer-pending-render-test-") as directory:
            paths = render(data, directory, {"create_preview_png": False, "layer_display_depth_m": 6.0})
            audit = json.loads(Path(paths["layout_audit_json"]).read_text(encoding="utf-8"))
            svg = Path(paths["drawing_svg"]).read_text(encoding="utf-8")
            regions = {region["interval_id"]: region for region in audit["layer_geometry"]["regions"]}
            self.assertEqual(regions["I0001"]["status"], "pending")
            self.assertEqual(regions["I0002"]["status"], "pending")
            self.assertNotRegex(svg, r'<polygon\b[^>]*data-interval="I0001"')
            self.assertNotRegex(svg, r'<polygon\b[^>]*data-interval="I0002"')
            pending_contact = next(contact for contact in audit["layer_geometry"]["contacts"] if contact["node"] == 1)
            self.assertEqual(pending_contact["status"], "pending")
            self.assertEqual(pending_contact["segments"], [])
            self.assertNotRegex(svg, rf'<line\b[^>]*data-contact="{re.escape(pending_contact["id"])}"')
            self.assertFalse(audit["projected_band"]["vertical_separators_drawn"])


def run_and_record() -> int:
    started = datetime.now(timezone.utc).isoformat()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(LayerGeometryTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    RESULT_JSON.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "schema_version": "1.0",
        "started_at_utc": started,
        "finished_at_utc": datetime.now(timezone.utc).isoformat(),
        "tests_run": result.testsRun,
        "passed": result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped),
        "failed": len(result.failures),
        "errors": len(result.errors),
        "skipped": len(result.skipped),
        "status": "pass" if result.wasSuccessful() else "fail",
        "failures": [{"test": str(test), "traceback": text} for test, text in result.failures],
        "error_details": [{"test": str(test), "traceback": text} for test, text in result.errors],
    }
    RESULT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(RESULT_JSON), "tests": result.testsRun, "status": report["status"]}, ensure_ascii=False))
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(run_and_record())
