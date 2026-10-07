"""Regression and integration checks for lithology readability outputs."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pipeline
import server
from importer import load_workbook_data
from layer_geometry import build_layer_geometry
from readability import render_readability
from renderer import render


ROOT = Path(__file__).resolve().parent
CANONICAL_XLSX = ROOT / "outputs" / "geology-template-v1" / "PM01规范输入.xlsx"
BEFORE = ROOT / "outputs" / "before-readability-20261006"
MATERIALS_PATH = ROOT / "templates" / "materials.json"
WEB_PATH = ROOT / "web" / "index.html"
TOL = 1e-12


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def semantic_data(data: dict) -> dict:
    """Exclude only source container identity; preserve every business value."""
    return {key: data.get(key) for key in (
        "schema_version", "project", "settings", "records", "nodes", "intervals",
        "stations", "attitudes", "samples", "issues", "summary",
    )}


def canonical_geometry_hash(geometry: dict) -> str:
    text = json.dumps(geometry, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def expected_focus_ids(data: dict, materials: dict) -> list[str]:
    selected = []
    for order, interval in enumerate(data["intervals"]):
        spec = materials.get(interval.get("lithology_name"), {})
        priority = spec.get("focus_priority", 0)
        if isinstance(priority, (int, float)) and not isinstance(priority, bool) and math.isfinite(priority) and priority > 0:
            selected.append((float(priority), order, interval["id"]))
    selected.sort(key=lambda item: (-item[0], item[1]))
    return [item[2] for item in selected]


class ReadabilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.input_sha = sha256(CANONICAL_XLSX)
        cls.data = load_workbook_data(CANONICAL_XLSX)
        cls.before_data = json.loads((BEFORE / "normalized.json").read_text(encoding="utf-8"))
        cls.before_layout = json.loads((BEFORE / "layout-audit.json").read_text(encoding="utf-8"))
        cls.materials_doc = json.loads(MATERIALS_PATH.read_text(encoding="utf-8"))
        cls.geometry = build_layer_geometry(cls.data, float(cls.before_layout["layer_geometry"]["requested_depth_m"]))
        cls.temp = tempfile.TemporaryDirectory(prefix="readability-tests-")
        cls.output = Path(cls.temp.name)
        cls.rendered = render(cls.data, cls.output / "renderer", {"create_preview_png": False})
        cls.layout = json.loads(Path(cls.rendered["layout_audit_json"]).read_text(encoding="utf-8"))
        cls.readability = render_readability(cls.data, cls.geometry, cls.materials_doc, cls.output / "readability")
        cls.readability_audit = json.loads(Path(cls.readability["readability_audit_json"]).read_text(encoding="utf-8"))
        cls.readability_svg = Path(cls.readability["readability_svg"]).read_text(encoding="utf-8")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp.cleanup()

    def test_source_data_and_world_geometry_match_before_snapshot_exactly(self) -> None:
        self.assertEqual(semantic_data(self.data), semantic_data(self.before_data))
        self.assertEqual(self.geometry, self.before_layout["layer_geometry"])
        self.assertEqual(self.layout["layer_geometry"], self.before_layout["layer_geometry"])
        self.assertEqual(self.layout["geometry"], self.before_layout["geometry"])
        self.assertEqual(sha256(CANONICAL_XLSX), self.input_sha)

    def test_every_interval_has_complete_readability_card(self) -> None:
        cards = self.readability_audit["interval_cards"]
        self.assertEqual(self.readability_audit["counts"]["intervals"], len(self.data["intervals"]))
        self.assertEqual([card["interval_id"] for card in cards], [interval["id"] for interval in self.data["intervals"]])
        records = {record["id"]: record for record in self.data["records"]}
        nodes = self.data["nodes"]
        sample_sizes = set()
        for card, interval in zip(cards, self.data["intervals"]):
            self.assertEqual(card["layer_id"], interval["layer_id"])
            self.assertEqual(card["material_name"], interval["lithology_name"])
            self.assertTrue(card["material_name"])
            self.assertEqual(card["record_ids"], interval["record_ids"])
            self.assertEqual(card["source_node_indices"], list(range(interval["start_node"], interval["end_node"] + 1)))
            expected_slant = sum(records[record_id]["length_m"] for record_id in interval["record_ids"])
            expected_projected = abs(nodes[interval["end_node"]]["x_m"] - nodes[interval["start_node"]]["x_m"])
            self.assertAlmostEqual(card["slant_length_m"], expected_slant, delta=TOL)
            self.assertAlmostEqual(card["projected_width_m"], expected_projected, delta=TOL)
            self.assertEqual(card["true_thickness_values"], [records[record_id]["true_thickness_m"] for record_id in interval["record_ids"]])
            self.assertEqual(card["description_full"], interval["description"])
            self.assertEqual(card["source_cells"], interval["source_cells"])
            self.assertTrue(card["material_configured"])
            sample_sizes.add(tuple(card["pattern_sample_size_px"]))
        self.assertEqual(len(sample_sizes), 1, "fixed readability swatches must use one shared screen size")
        width, height = next(iter(sample_sizes))
        self.assertGreater(width, 300)
        self.assertGreater(height, 60)

    def test_focus_selection_is_only_material_priority_and_preserves_approximate_text(self) -> None:
        materials = self.materials_doc["materials"]
        expected = expected_focus_ids(self.data, materials)
        panels = self.readability_audit["focus_panels"]
        self.assertEqual([panel["interval_id"] for panel in panels], expected)
        intervals = {interval["id"]: interval for interval in self.data["intervals"]}
        records = {record["id"]: record for record in self.data["records"]}
        self.assertTrue(panels)
        for panel in panels:
            interval = intervals[panel["interval_id"]]
            self.assertEqual(panel["focus_priority"], materials[interval["lithology_name"]]["focus_priority"])
            self.assertEqual(panel["material_name"], interval["lithology_name"])
            self.assertEqual(panel["description_full"], interval["description"])
            self.assertEqual(panel["record_ids"], interval["record_ids"])
            self.assertEqual(panel["description_source_cells"], interval["source_cells"]["description"])
            self.assertEqual(panel["true_thickness_values"], [records[rid]["true_thickness_m"] for rid in interval["record_ids"]])
            if "约" in panel["description_full"]:
                self.assertIn("约", panel["description_excerpt"])
            self.assertTrue(all(value is None for value in panel["true_thickness_values"]))
            self.assertGreater(panel["units_per_px"], 0)
            self.assertGreater(panel["magnification_vs_full_width"], 0)

        changed = copy.deepcopy(self.data)
        focused_names = {intervals[item]["lithology_name"] for item in expected}
        for index, interval in enumerate(changed["intervals"]):
            interval["layer_id"] = f"X-{index + 1}"
            if interval["lithology_name"] not in focused_names:
                interval["description"] = "煤层约999米；此文本不得触发重点层。"
        with tempfile.TemporaryDirectory(prefix="focus-config-only-") as directory:
            changed_output = render_readability(changed, self.geometry, self.materials_doc, directory)
            changed_audit = json.loads(Path(changed_output["readability_audit_json"]).read_text(encoding="utf-8"))
        self.assertEqual([panel["interval_id"] for panel in changed_audit["focus_panels"]], expected)

    def test_readability_reuses_canonical_world_geometry_without_boundary_changes(self) -> None:
        reference = self.readability_audit["geometry_reference"]
        self.assertEqual(reference["sha256_canonical_json"], canonical_geometry_hash(self.geometry))
        self.assertTrue(reference["world_coordinates_reused"])
        self.assertFalse(reference["boundary_positions_modified"])
        self.assertEqual(reference["effective_depth_m"], self.geometry["effective_depth_m"])
        self.assertEqual(self.readability_audit["counts"]["regions"], len(self.geometry["regions"]))
        self.assertEqual(self.readability_audit["counts"]["contacts"], len(self.geometry["contacts"]))
        self.assertIn("fixed screen size", " ".join(self.readability_audit["statements"]).lower())
        self.assertIn("not copied into true_thickness_m", " ".join(self.readability_audit["statements"]))

    def test_cards_and_focus_panels_do_not_overlap(self) -> None:
        cards = self.readability_audit["interval_cards"]
        card_y = [float(card["y_px"]) for card in cards]
        self.assertTrue(all(later - earlier >= 101.999 for earlier, later in zip(card_y, card_y[1:])))
        page_height = float(self.readability_audit["page"]["height_px"])
        self.assertLess(card_y[-1] + 102, page_height - 70)
        panel_rects = [tuple(map(float, match)) for match in re.findall(
            r'<rect x="[^"]+" y="([0-9.]+)" width="[^"]+" height="([0-9.]+)" rx="8" class="panel"/>',
            self.readability_svg,
        )]
        self.assertEqual(len(panel_rects), len(self.readability_audit["focus_panels"]))
        for (first_y, first_h), (second_y, _) in zip(panel_rects, panel_rects[1:]):
            self.assertGreaterEqual(second_y, first_y + first_h + 27.999)

    def test_coal_templates_use_reference_linework_and_readability_legend_uses_shared_templates(self) -> None:
        materials = self.materials_doc["materials"]
        coal = materials["煤层"]
        interbed = materials["碳质泥岩与煤线互层"]
        self.assertEqual(coal["background"].lower(), "#ffffff")
        self.assertEqual(coal["focus_priority"], 100)
        self.assertEqual(coal["orientation"], "bedding")
        coal_lines = [item for item in coal["svg"] if item.get("type") == "line"]
        self.assertTrue(coal_lines)
        self.assertTrue(all(float(item["width"]) >= 2 for item in coal_lines))
        self.assertTrue(all(float(item["x1"]) == 0 and float(item["x2"]) == coal["tile_width"] for item in coal_lines))
        self.assertEqual(interbed["background"].lower(), "#ffffff")
        widths = [float(item["width"]) for item in interbed["svg"] if item.get("type") == "line"]
        self.assertGreater(max(widths), min(widths) * 4)
        coarse = [item for item in interbed["svg"] if item.get("type") == "line" and float(item["width"]) >= 2]
        self.assertTrue(all(float(item["x1"]) == 0 and float(item["x2"]) == interbed["tile_width"] for item in coarse))
        self.assertTrue(any(item.get("type") == "path" and "q" in item.get("d", "") for item in interbed["svg"]))
        self.assertEqual(interbed["focus_priority"], 90)
        self.assertEqual(interbed["orientation"], "bedding")
        for spec in materials.values():
            self.assertIn(f'id="read_base_{spec["id"]}"', self.readability_svg)

    def test_renderer_pattern_rotation_uses_independent_apparent_dip_formula_and_base_legend(self) -> None:
        audit_rows = self.layout["pattern_audit"]
        self.assertEqual(len(audit_rows), len(self.data["intervals"]))
        records = {record["id"]: record for record in self.data["records"]}
        axis = math.radians(self.data["settings"]["axis_azimuth_deg"])
        main_svg = Path(self.rendered["drawing_svg"]).read_text(encoding="utf-8")
        detail_svg = Path(self.rendered["detail_svg"]).read_text(encoding="utf-8")
        signed_angles = []
        for row in audit_rows:
            spec = self.materials_doc["materials"][row["material_name"]]
            self.assertEqual(row["orientation"], spec["orientation"])
            self.assertEqual(row["template_pattern_id"], spec["id"])
            self.assertIn(f'fill="url(#{row["derived_pattern_id"]})"', main_svg)
            if spec["orientation"] == "bedding":
                record = records[row["first_record_id"]]
                dip = math.radians(record["dip_angle_deg"])
                expected = math.degrees(math.atan2(
                    -math.sin(dip) * math.cos(axis - math.radians(record["dip_direction_deg"])),
                    math.cos(dip),
                ))
                self.assertAlmostEqual(row["apparent_dip_deg_signed_z_up"], expected, delta=TOL)
                self.assertAlmostEqual(row["pattern_rotation_deg_svg_y_down"], -expected, delta=TOL)
                self.assertEqual(row["source_cells"], record["source_cells"])
                signed_angles.append(expected)
            else:
                self.assertIsNone(row["apparent_dip_deg_signed_z_up"])
                self.assertIsNone(row["pattern_rotation_deg_svg_y_down"])
            self.assertIn(f'href="#{row["template_pattern_id"]}"', main_svg)
        self.assertTrue(any(angle > 0 for angle in signed_angles))
        # PM01 happens to put every bedding-oriented interval on the same
        # apparent-dip side. Exercise the opposite sign with a temporary
        # 180-degree dip-direction reversal instead of weakening sign handling.
        bedding_row = next(row for row in audit_rows if row["orientation"] == "bedding")
        opposite = copy.deepcopy(self.data)
        opposite_record = next(record for record in opposite["records"] if record["id"] == bedding_row["first_record_id"])
        opposite_record["dip_direction_deg"] = (float(opposite_record["dip_direction_deg"]) + 180.0) % 360.0
        opposite_rendered = render(opposite, self.output / "renderer-opposite-sign", {"create_preview_png": False})
        opposite_layout = json.loads(Path(opposite_rendered["layout_audit_json"]).read_text(encoding="utf-8"))
        opposite_row = next(row for row in opposite_layout["pattern_audit"] if row["interval_id"] == bedding_row["interval_id"])
        self.assertLess(opposite_row["apparent_dip_deg_signed_z_up"], 0)
        self.assertGreater(opposite_row["pattern_rotation_deg_svg_y_down"], 0)
        for spec in self.materials_doc["materials"].values():
            self.assertRegex(main_svg, rf'<rect\b[^>]*fill="url\(#{re.escape(spec["id"])}__legend\)"')
        detail_derived = set(re.findall(r'fill="url\(#([^\)]+__interval_[^\)]+)\)"', detail_svg))
        self.assertTrue(detail_derived)
        self.assertTrue(detail_derived.issubset({row["derived_pattern_id"] for row in audit_rows}))

    def test_pipeline_manifest_and_report_include_readability_without_real_browser(self) -> None:
        png_bytes = bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
            "0000000d49444154789c6360000000020001e221bc330000000049454e44ae426082"
        )

        def fake_raster(svg: Path, png: Path, browser: Path, log_path: Path, scale: int = 1) -> dict:
            self.assertTrue(svg.is_file())
            png.write_bytes(png_bytes)
            log_path.parent.mkdir(parents=True, exist_ok=True)
            log_path.write_text("mock raster for unit integration test\n", encoding="utf-8")
            return {"css_width_px": 1, "css_height_px": 1, "requested_scale": scale, "scale": scale,
                    "png_width_px": scale, "png_height_px": scale, "browser": "mock"}

        with tempfile.TemporaryDirectory(prefix="pipeline-readability-") as directory:
            with patch.object(pipeline, "_find_browser", return_value=Path("mock-browser")), patch.object(pipeline, "_rasterize", side_effect=fake_raster):
                result = pipeline._run_pipeline_impl(CANONICAL_XLSX, directory)
            output = Path(directory)
            manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            code_names = [item["name"] for item in manifest["code"]]
            output_roles = {item["name"]: item["role"] for item in manifest["outputs"]}
            self.assertIn("readability.py", code_names)
            self.assertEqual(output_roles["readability.svg"], "readability_vector")
            self.assertEqual(output_roles["readability.png"], "readability_raster")
            self.assertEqual(output_roles["readability-audit.json"], "readability_audit")
            self.assertEqual(output_roles["complete-hd.png"], "complete_hd_raster")
            self.assertEqual(manifest["rasterization"]["complete_hd"]["scale"], 4)
            self.assertEqual(result["files"]["readability_vector"], "readability.svg")
            self.assertEqual(result["files"]["readability_raster"], "readability.png")
            self.assertEqual(result["files"]["readability_audit"], "readability-audit.json")
            report = (output / "report.html").read_text(encoding="utf-8")
            self.assertIn("岩性与重点层识读图（SVG）", report)
            self.assertIn("行业图式尚未完成核验", report)
            generated_layout = json.loads((output / "layout-audit.json").read_text(encoding="utf-8"))
            self.assertEqual(generated_layout["layer_geometry"], self.before_layout["layer_geometry"])
        self.assertEqual(sha256(CANONICAL_XLSX), self.input_sha)

    def test_server_whitelist_and_web_preview_expose_readability_with_limitations(self) -> None:
        self.assertIn("readability.svg", server.GENERATED_FILE_LABELS)
        self.assertIn("readability.png", server.GENERATED_FILE_LABELS)
        self.assertIn("readability-audit.json", server.GENERATED_FILE_LABELS)
        with tempfile.TemporaryDirectory(prefix="result-payload-") as directory:
            result_dir = Path(directory)
            (result_dir / "normalized.json").write_text(json.dumps(self.data, ensure_ascii=False), encoding="utf-8")
            (result_dir / "manifest.json").write_text("{}", encoding="utf-8")
            for name in ("readability.svg", "readability.png", "readability-audit.json"):
                (result_dir / name).write_bytes(b"x")
            payload = server._result_payload(result_dir, previous=False)
            self.assertTrue({"readability.svg", "readability.png", "readability-audit.json"}.issubset(payload["files"]))
        web = WEB_PATH.read_text(encoding="utf-8")
        self.assertIn("岩性与重点层识读图", web)
        self.assertIn("data.files?.['readability.png']", web)
        self.assertIn("不能用于比较地层厚度", web)
        self.assertIn("不表示正式行业符号已经核验", web)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ReadabilityTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    report = {
        "suite": "readability",
        "tests_run": result.testsRun,
        "passed": result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped),
        "failures": [str(test) for test, _ in result.failures],
        "errors": [str(test) for test, _ in result.errors],
        "skipped": [str(test) for test, _ in result.skipped],
        "successful": result.wasSuccessful(),
    }
    report_path = ROOT / "logs" / "readability-tests.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    raise SystemExit(0 if result.wasSuccessful() else 1)
