import sys
import unittest
import math
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "research" / "geology" / "generator-v1"))

from drill_pipeline import _appendix  # noqa: E402
from drill_renderer import TOP, render_drill_svg  # noqa: E402
from drill_integrated_importer import load_integrated_drill_workbook  # noqa: E402


def integrated_fixture():
    source = {"sheet": "孔深校正与弯曲度测量", "row": 8, "cells": {"记录": "I8", "天顶角": "G8"}}
    items = [
        {"code": "Cu", "name": "铜", "unit": "ppm", "order": 1, "detection_limit": "<0.5", "method": "ICP", "show": True, "notes": "主项目", "source": "项目!A2:I2"},
        {"code": "Pb", "name": "铅", "unit": "mg/kg", "order": 2, "detection_limit": "<1", "method": "XRF", "show": False, "notes": "附表保留", "source": "项目!A3:I3"},
        {"code": "Zn", "name": "锌", "unit": "%", "order": 3, "detection_limit": "", "method": "", "show": True, "notes": "", "source": "项目!A4:I4"},
    ]
    return {
        "drawing_type": "drill", "schema_version": "drill-integrated-1.0",
        "source": {"filename": "fixture.xlsx", "sha256": "a" * 64, "adapter": "drill-integrated-template-v3", "template_version": "v3"},
        "project": {"name": "测试项目", "hole_id": "ZK-test", "analysis_units": {"Cu": "ppm", "Pb": "mg/kg", "Zn": "%"}, "analysis_items": items, "source_cells": {"孔深基准": "钻孔基本信息!H5"}},
        "meta": {"hole_id": "ZK-test", "endpoint_m": 10.0, "depth_basis": "原始沿孔深"},
        "basic_info": {"fields": {"X坐标_m": 0, "Y坐标_m": 0, "孔口标高_m": 12, "坐标基准": "CGCS2000", "角度基准备注": "原始角度定义未核定", "倾角_deg": -75, "开孔日期": "2026-10-01", "终孔日期": "2026-10-09", "比例尺分母": 100}, "source_cells": {"X坐标_m": "钻孔基本信息!B6", "Y坐标_m": "钻孔基本信息!D6"}, "summary": {"回次记录数": {"value": 1, "formula": "=COUNTIF(...)"}}},
        "layers": [{"id": "L1", "top_m": 0.0, "bottom_m": 10.0, "thickness_m": 10.0, "core_m": None, "recovery_percent": 0, "description": "", "lithology_name": "砂岩", "material_code": "", "source": {"sheet": "分层", "row": 6, "cells": {"顶深_m": "B6"}}}],
        "turns": [{"id": "1", "top_m": 0.0, "bottom_m": 10.0, "advance_m": 10.0, "core_m": None, "recovery_percent": 0, "source": {"sheet": "回次", "row": 6, "cells": {"回次号": "B6"}}}],
        "samples": [{"id": "S1", "top_m": 1.0, "bottom_m": 2.0, "length_m": 1.0, "core_m": None, "recovery_percent": 0, "assays": {"Cu": 0, "Pb": None, "Zn": None}, "assay_raw": {"Cu": "0", "Pb": "<检出限", "Zn": ""}, "assay_records": [{"code": "Pb", "result_raw": "<检出限", "value": None, "flag": "below_detection", "unit": "mg/kg", "detection_limit": "<1", "method": "XRF", "test_date": "2026-10-09", "report_number": "R1", "notes": "原文保留", "source": source}], "source": {"sheet": "样品", "row": 6, "cells": {"样品编号": "A6"}}}],
        "structures": [], "summary": {"turns": 1, "layers": 1, "samples": 1, "endpoint_m": 10.0, "pending_patterns": 1},
        "depth_measurements": {"records": [{"sequence": 1, "recorded_depth_m": 10.25, "checked_depth_m": 10.0, "error_m": -0.25, "error_percent": 0.0733, "measurement_depth_m": 5.0, "zenith_deg": 2.5, "azimuth_deg": 182.0, "method": "测量记录原文方法", "instrument": "仪器A", "source": source, "derived": False}], "summary": {"记录次数": {"value": 1, "formula": "=COUNT(B8:B27)", "source": "L5"}}, "signatures": {"记录人": {"value": "张某", "source": "B28"}, "检查人": {"value": "李某", "source": "H28"}}},
        "title_block": {"fields": {"项目/单位": "测试单位", "图名": "钻孔柱状图", "拟编": "王某", "顺序号": "01", "审核": "赵某", "图号": "ZK-01", "制图": "钱某", "比例尺分母": 500, "项目负责": "孙某", "日期": "2026-10-09", "单位负责": "周某", "资料来源": "原始记录表"}, "source_cells": {"图名": "图签!B5"}, "settings": [{"layout_item": "总宽", "width_mm": 90, "height_mm": 180, "order": 1, "description": "打印参考", "source": "图签!B20"}], "settings_summary": {"尺寸说明": "模板参考值，打印需核对"}},
        "issues": [],
    }


class DrillTemplateRenderTest(unittest.TestCase):
    def test_integrated_figure_has_dynamic_assays_metadata_and_in_bounds_panels(self):
        data = integrated_fixture()
        svg, audit = render_drill_svg(data)
        root = ElementTree.fromstring(svg)
        ns = {"svg": "http://www.w3.org/2000/svg"}
        text = "".join(node.text or "" for node in root.findall(".//svg:text", ns))
        self.assertIn("0", text)
        self.assertNotIn("铅", text)  # hidden project item is still in the appendix
        self.assertIn("孔深校正", text)
        self.assertIn("记录孔深（米）", text)
        self.assertIn("校正孔深（米）", text)
        self.assertIn("钻孔柱状图", text)
        self.assertIn("资料来源", text)
        self.assertNotIn("单位：测试单位", text)
        self.assertIn("2026年10月1日", text)
        self.assertIn("2026年10月9日", text)
        self.assertNotIn("2026-10-09", text)
        self.assertTrue(audit["metadata"]["within_canvas"])
        view_width, view_height = audit["viewBox"][2:]
        self.assertEqual(float(root.attrib["width"]), view_width)
        self.assertEqual(float(root.attrib["height"]), math.ceil(view_height))
        metadata = audit["metadata"]["panels"]
        self.assertEqual({panel["kind"] for panel in metadata}, {"depth_measurements", "bending_measurements", "title_block"})
        depth_panel = next(panel for panel in metadata if panel["kind"] == "depth_measurements")
        self.assertEqual(len(depth_panel["rows"]), 1)
        self.assertEqual(depth_panel["rows"][0]["values"][:4], [1, 10.25, 10.0, -0.25])
        self.assertAlmostEqual(depth_panel["rows"][0]["values"][4], 0.733)
        curve_panel = next(panel for panel in metadata if panel["kind"] == "bending_measurements")
        self.assertEqual(curve_panel["rows"][0]["values"], [1, 10.0, 182.0, 87.5, 2.5])
        self.assertTrue(curve_panel["rows"][0]["tilt_derived"])
        self.assertIn("钻孔倾角：-75°", text)
        for panel in metadata:
            bounds = panel["bounds"]
            self.assertGreaterEqual(bounds["x"], 0)
            self.assertGreaterEqual(bounds["y"], 0)
            self.assertLessEqual(bounds["x"] + bounds["width"], view_width)
            self.assertLessEqual(bounds["y"] + bounds["height"], view_height)
        self.assertGreater(audit["viewBox"][1] + audit["viewBox"][3], audit["fixed_reference_layout"]["body_top"] + audit["endpoint_m"] * audit["scale_units_per_meter"])
        self.assertAlmostEqual(audit["scale_units_per_meter"], 80 / 3)
        self.assertEqual(audit["fixed_reference_layout"]["header_y"], 272)
        self.assertEqual(audit["fixed_reference_layout"]["body_top"], 430)
        data["project"]["analysis_items"][1]["show"] = True
        visible_svg, _ = render_drill_svg(data)
        self.assertIn("&lt;检出限", visible_svg)

    def test_appendix_keeps_all_analysis_originals_blank_zero_and_template_sources(self):
        appendix = _appendix(integrated_fixture())
        self.assertIn("分析项目定义（含不在图面显示的项目）", appendix)
        self.assertIn("&lt;检出限", appendix)
        self.assertIn("主项目", appendix)
        self.assertIn("附表保留", appendix)
        self.assertIn("铜 (ppm)", appendix)
        self.assertIn("铅 (mg/kg)", appendix)
        self.assertIn("测量天顶角_deg", appendix)
        self.assertIn("校正孔深_m", appendix)
        self.assertIn("&lt;检出限", appendix)
        self.assertIn("张某", appendix)
        self.assertIn("图签字段", appendix)
        self.assertIn("图签/元素尺寸参考设置", appendix)
        self.assertIn("90 mm打印精度", appendix)
        self.assertIn("原始角度定义未核定", appendix)

    def test_long_title_values_wrap_and_expand_the_title_block_without_clipping(self):
        data = integrated_fixture()
        long_source = "原始记录来源说明" * 90
        long_unit = "测试单位" * 100
        data["title_block"]["fields"]["项目/单位"] = long_unit
        data["title_block"]["fields"]["资料来源"] = long_source
        svg, audit = render_drill_svg(data)
        root = ElementTree.fromstring(svg)
        ns = {"svg": "http://www.w3.org/2000/svg"}
        text = "".join(node.text or "" for node in root.findall(".//svg:text", ns))
        self.assertIn(long_source, text.replace("\n", ""))
        self.assertIn("1:100", text)
        panel = next(panel for panel in audit["metadata"]["panels"] if panel["kind"] == "title_block")
        self.assertTrue(audit["metadata"]["within_canvas"])
        self.assertEqual(panel["bounds"]["height"], 224)
        self.assertEqual(audit["fixed_reference_layout"]["table_width"], 1944)
        self.assertEqual(audit["scale_denominator"], 100)

    def test_legacy_au_pb_zn_rendering_remains_available_without_integrated_metadata(self):
        data = integrated_fixture()
        data["source"].pop("template_version")
        data["project"].pop("analysis_items")
        data.pop("basic_info")
        data.pop("depth_measurements")
        data.pop("title_block")
        data["project"]["analysis_units"] = {"Au": "ppm", "Pb": "mg/kg", "Zn": ""}
        data["samples"][0]["assays"] = {"Au": 0, "Pb": None, "Zn": None}
        data["samples"][0].pop("assay_raw")
        svg, audit = render_drill_svg(data)
        self.assertIn("Au：0.0000 ppm", svg)
        self.assertIn("Pb：未提供（mg/kg）", svg)
        self.assertFalse(audit["metadata"]["present"])
        self.assertFalse(audit["metadata_viewport_extended"])

    def test_real_v3_workbook_loads_into_fixed_reference_renderer(self):
        workbook = ROOT / "outputs" / "drill-template-20261009" / "钻孔整合模板-300米参考格式模拟.xlsx"
        if not workbook.exists():
            self.skipTest("real v3 demo workbook is not present in this checkout")
        data = load_integrated_drill_workbook(workbook)
        self.assertEqual(data["schema_version"], "drill-integrated-1.0")
        self.assertEqual(data["source"]["template_version"], "v3")
        _, audit = render_drill_svg(data)
        self.assertIn("fixed_reference_layout", audit)
        self.assertEqual(audit["fixed_reference_layout"]["body_top"], 430)
        self.assertEqual(audit["scale_denominator"], 100)

    def test_dense_dynamic_assays_keep_sample_labels_aligned_with_depth_in_main_and_detail(self):
        data=integrated_fixture()
        data["meta"]["endpoint_m"]=300.0
        data["layers"][0].update({"bottom_m":300.0,"thickness_m":300.0})
        data["turns"][0].update({"bottom_m":300.0,"advance_m":300.0})
        items=[]
        units={}
        for idx in range(6):
            code=f"E{idx+1}"
            item={"code":code,"name":f"测试元素{idx+1}","unit":"mg/kg","order":idx,"show":True}
            items.append(item);units[code]="mg/kg"
        data["project"]["analysis_items"]=items
        data["project"]["analysis_units"]=units
        data["samples"]=[]
        for idx in range(120):
            top=0.25+idx*2.5
            assays={item["code"]:(0 if idx==0 and item["code"]=="E1" else None) for item in items}
            raw={item["code"]:("0" if assays[item["code"]]==0 else "<0.005") for item in items}
            data["samples"].append({"id":f"S{idx+1:03d}","top_m":top,"bottom_m":top+1.0,
                "length_m":1.0,"core_m":None,"recovery_percent":None,
                "assays":assays,"assay_raw":raw,"assay_records":[],"source":{"sheet":"模拟样品","row":idx+6}})

        for detail in (False,True):
            _,audit=render_drill_svg(data,detail=detail)
            labels=audit["samples"]
            self.assertGreater(len(labels),10)
            self.assertEqual(audit["scale_units_per_meter"], 80 / 3)
            max_depth = 45 if detail else 300
            self.assertTrue(all(row["top_y"]>=430 and row["bottom_y"]<=430+max_depth*audit["scale_units_per_meter"] for row in labels))
            for previous,current in zip(labels,labels[1:]):
                expected=(current["top_m"]+current["bottom_m"]-previous["top_m"]-previous["bottom_m"])/2*audit["scale_units_per_meter"]
                self.assertAlmostEqual(current["label_y"]-previous["label_y"], expected, places=5)


if __name__ == "__main__":
    unittest.main()
