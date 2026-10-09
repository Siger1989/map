import sys
import unittest
import math
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "research" / "geology" / "generator-v1"))

from drill_reference_renderer import BODY_TOP, HEADER_HEIGHT, HEADER_TOP, LEFT, render_reference_drill_svg  # noqa: E402
from tests.test_drill_template_render import integrated_fixture  # noqa: E402


class DrillReferenceRenderTest(unittest.TestCase):
    def test_three_visible_elements_use_fixed_reference_grid_and_depth_scale(self):
        data = integrated_fixture()
        data["project"]["analysis_items"][1]["show"] = True
        svg, audit = render_reference_drill_svg(data)
        root = ElementTree.fromstring(svg)
        layout = audit["fixed_reference_layout"]
        self.assertEqual((layout["table_x"], layout["header_y"], layout["header_height"], layout["body_top"]),
                         (LEFT, HEADER_TOP, HEADER_HEIGHT, BODY_TOP))
        self.assertEqual(layout["analysis_count"], 3)
        self.assertEqual(layout["table_width"], 1998)
        self.assertAlmostEqual(audit["scale_units_per_meter"], 80 / 3)
        self.assertEqual(audit["view_depth_m"], [0.0, 10.0])
        self.assertEqual(float(root.attrib["width"]), 2054)
        self.assertEqual(float(root.attrib["height"]), math.ceil(audit["viewBox"][3]))
        self.assertEqual([row["key"] for row in layout["columns"] if row["key"].startswith("analysis:")],
                         ["analysis:Cu", "analysis:Pb", "analysis:Zn"])
        header_text="".join((node.text or "") for node in root.iter() if node.tag.endswith("text"))
        self.assertIn("Cu", header_text)
        self.assertNotIn("铜", header_text)
        self.assertIn("（%）", svg)
        self.assertNotIn('rotate="-90', svg)
        self.assertTrue(audit["metadata"]["within_canvas"])
        panels = {panel["kind"]: panel for panel in audit["metadata"]["panels"]}
        self.assertEqual(panels["depth_measurements"]["header_height"], 64)
        self.assertEqual(panels["bending_measurements"]["header_height"], 32)
        self.assertEqual(len(panels["title_block"]["rows"]), 7)
        self.assertEqual(panels["title_block"]["bounds"]["height"], 224)
        self.assertEqual(panels["title_block"]["rows"][0]["values"], ["测试单位"])
        self.assertEqual(panels["title_block"]["rows"][1]["values"], ["钻孔柱状图"])
        self.assertAlmostEqual(panels["depth_measurements"]["bounds"]["width"], 1998 * .365)
        self.assertAlmostEqual(panels["bending_measurements"]["bounds"]["width"], 1998 * .31)
        self.assertAlmostEqual(panels["title_block"]["bounds"]["width"], 1998 * .243)

    def test_six_visible_items_expand_only_horizontal_grid_and_hidden_items_are_omitted(self):
        data = integrated_fixture()
        items = []
        for index in range(6):
            items.append({"code": f"E{index + 1}", "name": f"元素{index + 1}", "order": index, "show": True})
        items.append({"code": "HIDE", "name": "隐藏项", "order": 7, "show": False})
        data["project"]["analysis_items"] = items
        svg, audit = render_reference_drill_svg(data)
        self.assertEqual(audit["fixed_reference_layout"]["analysis_count"], 6)
        self.assertEqual(audit["fixed_reference_layout"]["table_width"], 2160)
        self.assertNotIn("隐藏项", svg)
        self.assertEqual(audit["scale_units_per_meter"], 80 / 3)

    def test_long_sample_id_stays_inside_sample_rail_and_long_angle_header_fits(self):
        data = integrated_fixture()
        data["samples"][0]["id"] = "SIM-S002"
        svg, audit = render_reference_drill_svg(data)
        root = ElementTree.fromstring(svg)
        ns = {"svg": "http://www.w3.org/2000/svg"}
        sample_label = next(node for node in root.findall(".//svg:text", ns) if node.attrib.get("class","").endswith("sample-rail-label"))
        self.assertEqual(sample_label.attrib.get("textLength"), "25")
        sample_col = next(column for column in audit["fixed_reference_layout"]["columns"] if column["key"] == "columnar")
        self.assertEqual(float(sample_label.attrib["x"]), sample_col["x"]+134)
        self.assertGreaterEqual(float(sample_label.attrib["x"]), sample_col["x"]+126+5+3)
        self.assertLessEqual(float(sample_label.attrib["x"])+float(sample_label.attrib["textLength"]), sample_col["x"]+sample_col["width"]-2)
        segment_height=audit["samples"][0]["bottom_y"]-audit["samples"][0]["top_y"]
        font=float(sample_label.attrib["font-size"])
        self.assertLessEqual(font,segment_height*.65+1e-6)
        self.assertAlmostEqual(float(sample_label.attrib["y"]),audit["samples"][0]["label_y"]+font*.32,places=2)
        data["samples"][0]["id"]="S1"
        short_svg,_=render_reference_drill_svg(data)
        short_root=ElementTree.fromstring(short_svg)
        short_label=next(node for node in short_root.findall(".//svg:text",ns) if node.attrib.get("class","").endswith("sample-rail-label"))
        self.assertNotIn("textLength",short_label.attrib)
        angle = next(node for node in root.findall(".//svg:text", ns) if node.text == "标志面与岩芯轴的夹角")
        self.assertLessEqual(float(angle.attrib["font-size"]), ((158-8)/len(angle.text))*.9 + 1e-6)

    def test_scale_precedence_and_missing_scale_default_are_audited(self):
        data = integrated_fixture()
        basic = data["basic_info"]
        title = data["title_block"]
        basic["fields"]["比例尺分母"] = 250
        title["fields"]["比例尺分母"] = 500
        _, audit = render_reference_drill_svg(data)
        self.assertEqual(audit["scale_denominator"], 250)
        self.assertEqual(audit["scale_source"]["source"], "basic_info")
        basic["fields"].pop("比例尺分母")
        _, audit = render_reference_drill_svg(data)
        self.assertEqual(audit["scale_denominator"], 500)
        self.assertEqual(audit["scale_source"]["source"], "title_block")
        title["fields"].pop("比例尺分母")
        _, audit = render_reference_drill_svg(data)
        self.assertEqual(audit["scale_denominator"], 100)
        self.assertTrue(audit["scale_source"]["defaulted"])

    def test_bottom_tables_use_checked_depth_and_convert_percent_to_per_mille(self):
        data = integrated_fixture()
        record = data["depth_measurements"]["records"][0]
        record.update({"recorded_depth_m": 30.01, "checked_depth_m": 30.022, "error_m": 0.022,
                       "error_percent": 0.0733, "measurement_depth_m": 30.0,
                       "azimuth_deg": 123.4, "zenith_deg": 15.0})
        data["basic_info"]["fields"]["倾角_deg"] = -75
        svg, audit = render_reference_drill_svg(data)
        panels = {panel["kind"]: panel for panel in audit["metadata"]["panels"]}
        depth_row = panels["depth_measurements"]["rows"][0]
        bend_row = panels["bending_measurements"]["rows"][0]
        self.assertAlmostEqual(depth_row["values"][4], 0.733)
        self.assertEqual(bend_row["values"], [1, 30.022, 123.4, 75.0, 15.0])
        self.assertIn("误差率（‰）", svg)
        self.assertIn("校正孔深（米）", svg)
        self.assertIn("钻孔倾角：-75°", svg)
        # The top metadata keeps the user's negative dip; the bottom dip is derived from zenith.
        self.assertEqual(bend_row["tilt_derived"], True)
        self.assertEqual(bend_row["source"], record["source"])

    def test_detail_keeps_same_fixed_scale_and_clips_only_to_45m(self):
        data = integrated_fixture()
        data["meta"]["endpoint_m"] = 300
        data["layers"][0].update({"bottom_m": 300, "thickness_m": 300})
        data["turns"][0].update({"bottom_m": 300, "advance_m": 300})
        main_svg, main_audit = render_reference_drill_svg(data)
        detail_svg, detail_audit = render_reference_drill_svg(data, detail=True)
        self.assertEqual(main_audit["scale_units_per_meter"], detail_audit["scale_units_per_meter"])
        self.assertEqual(main_audit["view_depth_m"], [0.0, 300.0])
        self.assertEqual(detail_audit["view_depth_m"], [0.0, 45.0])
        self.assertTrue(detail_audit["detail_crop_is_not_geologic_boundary"])
        self.assertEqual(detail_audit["layers"][0]["plotted_bottom_m"], 45.0)
        self.assertIn('viewBox="0 0', main_svg)
        self.assertIn('viewBox="0 0', detail_svg)

    def test_sample_rail_uses_true_contiguous_segment_heights_and_stable_alternation(self):
        data = integrated_fixture()
        data["meta"]["endpoint_m"] = 60
        data["layers"][0].update({"bottom_m": 60, "thickness_m": 60})
        data["turns"][0].update({"bottom_m": 60, "advance_m": 60})
        data["samples"] = []
        for index, (top, length) in enumerate(((1.0, .5), (1.5, 1.5), (3.0, 3.0)), 1):
            data["samples"].append({"id": f"S{index}", "top_m": top, "bottom_m": top+length,
                "length_m": length, "core_m": None, "recovery_percent": None,
                "assays": {}, "assay_raw": {}, "source": {"row": index+5}})
        main_svg, main_audit = render_reference_drill_svg(data)
        detail_svg, detail_audit = render_reference_drill_svg(data, detail=True)
        main_rows=main_audit["samples"];detail_rows=detail_audit["samples"]
        heights=[row["bottom_y"]-row["top_y"] for row in main_rows]
        self.assertAlmostEqual(heights[0]/heights[0], 1)
        self.assertAlmostEqual(heights[1]/heights[0], 3)
        self.assertAlmostEqual(heights[2]/heights[0], 6)
        self.assertAlmostEqual(main_rows[0]["bottom_y"],main_rows[1]["top_y"])
        self.assertAlmostEqual(main_rows[1]["bottom_y"],main_rows[2]["top_y"])
        self.assertEqual([row["segment_fill"] for row in main_rows],["#fff","#111","#fff"])
        self.assertEqual([row["segment_fill"] for row in detail_rows],["#fff","#111","#fff"])
        self.assertEqual([row["full_hole_order"] for row in main_rows],[0,1,2])
        self.assertEqual([row["full_hole_order"] for row in detail_rows],[0,1,2])
        root=ElementTree.fromstring(main_svg);detail_root=ElementTree.fromstring(detail_svg)
        ns={"svg":"http://www.w3.org/2000/svg"}
        sample_x=next(c["x"] for c in main_audit["fixed_reference_layout"]["columns"] if c["key"]=="columnar")+126
        sample_rects=[r for r in root.findall(".//svg:rect",ns) if float(r.attrib.get("x",-1))==sample_x and float(r.attrib.get("width",-1))==5]
        detail_rects=[r for r in detail_root.findall(".//svg:rect",ns) if float(r.attrib.get("x",-1))==sample_x and float(r.attrib.get("width",-1))==5]
        self.assertEqual([r.attrib["fill"] for r in sample_rects],["#fff","#111","#fff"])
        self.assertEqual(sample_rects[0].attrib["stroke"],"#111")
        self.assertEqual(sample_rects[2].attrib["stroke"],"#111")
        self.assertEqual([r.attrib["fill"] for r in detail_rects],["#fff","#111","#fff"])


if __name__ == "__main__":
    unittest.main()
