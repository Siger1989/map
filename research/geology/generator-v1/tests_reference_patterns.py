"""Evidence-bound regression checks for the PM01 reference pattern templates."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import tempfile
import unittest
from pathlib import Path

from importer import load_workbook_data
from renderer import _material, _pattern_defs, render


ROOT = Path(__file__).resolve().parent
MATERIALS = ROOT / "templates" / "materials.json"
BACKUP = ROOT / "outputs" / "before-reference-patterns-20261006" / "materials.json"
CANONICAL = ROOT / "outputs" / "geology-template-v1" / "PM01规范输入.xlsx"
BEFORE_LAYOUT = ROOT / "outputs" / "before-readability-20261006" / "layout-audit.json"
LOG = ROOT / "logs" / "reference-pattern-tests.json"

EXACT_LEGEND = {"泥岩", "粉砂质泥岩", "凝灰质泥岩", "泥晶灰岩"}
LAYER_PAIRED = {
    "含粉砂泥岩", "含生物碎屑凝灰岩", "煤层", "碳质泥岩与煤线互层",
    "玄武质火山碎屑岩", "泥质粉砂岩", "凝灰岩", "沉凝灰岩", "泥化沉凝灰岩",
}
UNVERIFIED = {"含火山碎屑粉砂质泥岩", "泥化凝灰岩", "硅化凝灰岩"}


def canonical_json_sha(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def line_primitives(spec: dict) -> list[dict]:
    return [item for item in spec["svg"] if item["type"] == "line"]


def circle_primitives(spec: dict) -> list[dict]:
    return [item for item in spec["svg"] if item["type"] == "circle"]


class ReferencePatternTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.current = json.loads(MATERIALS.read_text(encoding="utf-8"))
        cls.backup = json.loads(BACKUP.read_text(encoding="utf-8"))
        cls.materials = cls.current["materials"]
        cls.data = load_workbook_data(CANONICAL)

    def test_source_names_are_unchanged_and_mapping_matches_actual_intervals(self) -> None:
        self.assertEqual(set(self.materials), set(self.backup["materials"]))
        self.assertEqual(len(self.materials), 16)
        actual: dict[str, list[str]] = {}
        for interval in self.data["intervals"]:
            actual.setdefault(interval["lithology_name"], []).append(interval["layer_id"])
        self.assertEqual(set(actual), set(self.materials))
        for name, spec in self.materials.items():
            self.assertEqual(spec["name"], name)
            self.assertEqual(spec["reference_evidence"]["layer_ids"], actual[name])

    def test_reference_status_and_evidence_are_complete(self) -> None:
        verified = {name for name, spec in self.materials.items() if spec["reference_status"] == "verified"}
        pending = {name for name, spec in self.materials.items() if spec["reference_status"] == "unverified"}
        self.assertEqual(verified, EXACT_LEGEND | LAYER_PAIRED)
        self.assertEqual(pending, UNVERIFIED)
        for name, spec in self.materials.items():
            evidence = spec["reference_evidence"]
            self.assertTrue(evidence["path"], name)
            self.assertTrue(evidence["layer_ids"], name)
            self.assertTrue(evidence["motif"].strip(), name)
            expected = "exact_legend" if name in EXACT_LEGEND else "layer_pairing" if name in LAYER_PAIRED else "unverified"
            self.assertEqual(evidence["match_type"], expected)
            if name in EXACT_LEGEND:
                self.assertEqual(evidence["legend_name"], name)
            if name == "煤层":
                self.assertEqual(evidence["legend_name"], "煤线")

    def test_context_scales_and_independent_tiles(self) -> None:
        self.assertEqual(self.current["render_scales"], {
            "main": 0.5, "detail": 0.85, "legend": 0.7, "focus": 1.0, "readability": 1.0,
        })
        tile_pairs = set()
        for name in EXACT_LEGEND | LAYER_PAIRED:
            spec = self.materials[name]
            self.assertGreater(float(spec["tile_width"]), 0)
            self.assertGreater(float(spec["tile_height"]), 0)
            tile_pairs.add((spec["tile_width"], spec["tile_height"]))
        self.assertGreater(len(tile_pairs), 3)
        defs = _pattern_defs(self.current, context="main", include_legend=True)
        self.assertIn('patternTransform="scale(0.500000)"', defs)
        self.assertIn('patternTransform="scale(0.700000)"', defs)

    def test_verified_patterns_are_black_on_white_and_every_primitive_has_width(self) -> None:
        for name in EXACT_LEGEND | LAYER_PAIRED:
            spec = self.materials[name]
            self.assertEqual(spec["background"].lower(), "#ffffff", name)
            self.assertIn(spec["stroke"].lower(), {"#000000", "#111111"}, name)
            self.assertEqual(spec["orientation"], "bedding", name)
            self.assertTrue(spec["svg"], name)
            for primitive in spec["svg"]:
                self.assertIn(primitive["type"], {"line", "circle", "path"})
                self.assertIn("width", primitive, f"{name}: {primitive}")
                self.assertGreater(float(primitive["width"]), 0)
                self.assertLessEqual(float(primitive["width"]), 2.5)

    def test_four_exact_legend_motifs_are_dense_but_not_full_width_substitutes(self) -> None:
        mud = self.materials["泥岩"]
        silty = self.materials["粉砂质泥岩"]
        tuff_mud = self.materials["凝灰质泥岩"]
        limestone = self.materials["泥晶灰岩"]
        self.assertGreater(len(line_primitives(silty)), len(line_primitives(mud)))
        for spec in (mud, silty, tuff_mud):
            max_length = max(abs(float(line["x2"]) - float(line["x1"])) for line in line_primitives(spec))
            self.assertLess(max_length, float(spec["tile_width"]) * 0.6)
        tuff_circles = circle_primitives(tuff_mud)
        self.assertGreaterEqual(len(tuff_circles), 6)
        xs: dict[float, list[float]] = {}
        for dot in tuff_circles:
            xs.setdefault(float(dot["cx"]), []).append(float(dot["cy"]))
        self.assertTrue(all(any(math.isclose(b - a, 2.0) for a, b in zip(sorted(ys), sorted(ys)[1:])) for ys in xs.values()))
        limestone_paths = [item["d"] for item in limestone["svg"] if item["type"] == "path"]
        self.assertTrue(any(" v" in path and " h" in path for path in limestone_paths))
        self.assertTrue(any(" l" in path for path in limestone_paths))

    def test_layer_paired_motifs_match_reviewed_visible_components(self) -> None:
        c5 = self.materials["含生物碎屑凝灰岩"]
        self.assertTrue(line_primitives(c5))
        self.assertGreaterEqual(len(circle_primitives(c5)), 6)
        self.assertTrue(any(item["type"] == "path" and "q" in item["d"] for item in c5["svg"]))
        coal = self.materials["煤层"]
        self.assertNotEqual(coal["background"].lower(), "#000000")
        coal_lines = line_primitives(coal)
        self.assertTrue(coal_lines)
        self.assertTrue(all(float(item["width"]) >= 2 for item in coal_lines))
        self.assertTrue(all(float(item["x1"]) == 0 and float(item["x2"]) == coal["tile_width"] for item in coal_lines))
        interbed = self.materials["碳质泥岩与煤线互层"]
        widths = [float(item["width"]) for item in line_primitives(interbed)]
        self.assertGreater(max(widths), min(widths) * 4)
        coarse = [item for item in line_primitives(interbed) if float(item["width"]) >= 2]
        self.assertTrue(coarse)
        self.assertTrue(all(float(item["x1"]) == 0 and float(item["x2"]) == interbed["tile_width"] for item in coarse))
        self.assertTrue(any(item["type"] == "path" and "q" in item["d"] for item in interbed["svg"]))
        basalt = self.materials["玄武质火山碎屑岩"]
        self.assertGreaterEqual(len(circle_primitives(basalt)), 8)
        self.assertTrue(all(float(dot["r"]) == 0.8 for dot in circle_primitives(basalt)))
        basalt_x = sorted({float(dot["cx"]) for dot in circle_primitives(basalt)})
        basalt_y = sorted({float(dot["cy"]) for dot in circle_primitives(basalt)})
        self.assertGreaterEqual(max(b - a for a, b in zip(basalt_x, basalt_x[1:])), 2.5)
        self.assertGreaterEqual(max(b - a for a, b in zip(basalt_y, basalt_y[1:])), 2.5)
        self.assertTrue(any(item["type"] == "path" and "h" in item["d"] and "v" in item["d"] for item in basalt["svg"]))
        tuff = self.materials["凝灰岩"]
        self.assertGreater(len(circle_primitives(tuff)), len(line_primitives(tuff)))
        self.assertEqual(self.materials["沉凝灰岩"]["svg"], self.materials["泥化沉凝灰岩"]["svg"])
        self.assertEqual(
            (self.materials["沉凝灰岩"]["tile_width"], self.materials["沉凝灰岩"]["tile_height"]),
            (self.materials["泥化沉凝灰岩"]["tile_width"], self.materials["泥化沉凝灰岩"]["tile_height"]),
        )

    def test_coal_anchor_features_are_midpoints_of_existing_coarse_lines(self) -> None:
        expected = {"煤层": [12, 7], "碳质泥岩与煤线互层": [15, 11]}
        for name, anchor in expected.items():
            spec = self.materials[name]
            self.assertEqual(spec["anchor_feature"], anchor)
            x, y = map(float, anchor)
            coarse = [item for item in line_primitives(spec) if float(item["width"]) >= 2]
            self.assertTrue(any(
                math.isclose(float(line["y1"]), y)
                and math.isclose(float(line["y2"]), y)
                and float(line["x1"]) <= x <= float(line["x2"])
                and math.isclose(x, (float(line["x1"]) + float(line["x2"])) / 2)
                for line in coarse
            ), f"{name} anchor is not the midpoint of an existing coarse line")
        for name, spec in self.materials.items():
            if name not in expected:
                self.assertNotIn("anchor_feature", spec)

    def test_reference_dot_clusters_are_dark_enough_at_main_scale(self) -> None:
        dotted = [
            spec for spec in self.materials.values()
            if spec["reference_status"] == "verified" and circle_primitives(spec)
        ]
        self.assertTrue(dotted)
        for spec in dotted:
            self.assertTrue(all(float(dot["r"]) == 0.8 for dot in circle_primitives(spec)), spec["name"])

    def test_unverified_materials_are_explicit_blank_pending_templates(self) -> None:
        defs = _pattern_defs(self.current, context="main")
        for name in UNVERIFIED:
            spec = self.materials[name]
            self.assertEqual(spec["background"].lower(), "#ffffff")
            self.assertEqual(spec["svg"], [])
            start = defs.index(f'<pattern id="{spec["id"]}"')
            end = defs.index("</pattern>", start)
            body = defs[start:end]
            self.assertIn('fill="#ffffff"', body)
            self.assertNotIn("<line", body)
            self.assertNotIn("<circle", body)
            self.assertNotIn("<path", body)

    def test_unknown_name_is_pending_without_fuzzy_classification(self) -> None:
        interval = copy.deepcopy(self.data["intervals"][0])
        interval["lithology_name"] = "泥岩测试未知后缀"
        pattern, pending = _material(interval, self.materials)
        self.assertEqual(pattern, "mat_pending")
        self.assertTrue(pending)

    def test_material_changes_do_not_change_source_data_or_world_geometry(self) -> None:
        before_data_hash = canonical_json_sha(self.data)
        expected_geometry = json.loads(BEFORE_LAYOUT.read_text(encoding="utf-8"))["layer_geometry"]
        with tempfile.TemporaryDirectory(prefix="reference-patterns-") as directory:
            rendered = render(self.data, directory, {"create_preview_png": False})
            layout = json.loads(Path(rendered["layout_audit_json"]).read_text(encoding="utf-8"))
        self.assertEqual(canonical_json_sha(self.data), before_data_hash)
        self.assertEqual(layout["layer_geometry"], expected_geometry)
        self.assertFalse(layout["materials"]["fuzzy_matching"])


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ReferencePatternTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    report = {
        "suite": "reference-patterns", "tests_run": result.testsRun,
        "passed": result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped),
        "failures": [str(test) for test, _ in result.failures],
        "errors": [str(test) for test, _ in result.errors],
        "skipped": [str(test) for test, _ in result.skipped],
        "successful": result.wasSuccessful(),
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    raise SystemExit(0 if result.wasSuccessful() else 1)
