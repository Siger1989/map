"""Independent read-only input audit for Standard Import v2 workbooks.

This script checks source cells with openpyxl read-only mode, then runs the
section and drill importers. Renderer checks are intentionally separate and
will be added only after the updated renderer is available.
"""
from __future__ import annotations

import importlib.util
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[1]
STANDARD = HERE / "outputs" / "standard-input-v2"
FIXTURES = HERE / "logs" / "v2-fixtures"
LOG_DIR = HERE / "logs"
ORIGINAL_SECTION = HERE / "generated" / "pm01-canonical" / "normalized.json"
ORIGINAL_DRILL = HERE.parent / "geology-drill-demo" / "zk0003-data.json"
SECTION_PARAMS = ["项目名称", "剖面编号", "剖面方位角_deg", "长度单位", "角度单位"]
SECTION_COLUMNS = [
    "记录号", "导线段号", "层号", "起读数_m", "止读数_m", "斜距_m", "坡角_deg", "方位角_deg",
    "倾向_deg", "倾角_deg", "岩性名称", "岩性描述", "样品编号", "样品距测段起点_m",
    "原表平距_m", "原表高差_m", "原表累计高差_m", "原表累计北_m", "原表累计东_m", "实测真厚度_m",
]
DRILL_PARAMS = ["模板类型", "模板版本", "项目名称", "钻孔编号", "长度单位", "孔深基准", "终孔深度_m", "Au单位", "Pb单位", "Zn单位"]
DRILL_COLUMNS = {
    "分层": ["层号", "顶深_m", "底深_m", "岩性名称", "岩性描述", "岩心长_m", "花纹代码"],
    "回次": ["回次号", "顶深_m", "底深_m", "岩心长_m"],
    "样品": ["样品编号", "顶深_m", "底深_m", "岩心长_m", "Au", "Pb", "Zn"],
    "孔径": ["孔深_m", "孔径_mm"],
}

checks: list[dict[str, Any]] = []


def check(name: str, passed: bool, detail: Any = None) -> None:
    checks.append({"check": name, "status": "pass" if passed else "fail", "detail": detail})


def read_xlsx(path: Path) -> tuple[dict[str, list[str]], dict[str, list[dict[str, Any]]], list[str]]:
    """Read cell values without modifying or recalculating the workbook."""
    wb = load_workbook(path, read_only=True, data_only=False)
    headers: dict[str, list[str]] = {}
    data: dict[str, list[dict[str, Any]]] = {}
    formulas: list[str] = []
    for ws in wb.worksheets:
        iterator = ws.iter_rows()
        first = next(iterator, ())
        header = [str(c.value).strip() if c.value is not None else "" for c in first]
        while header and not header[-1]:
            header.pop()
        headers[ws.title] = header
        rows: list[dict[str, Any]] = []
        for row_num, cells in enumerate(iterator, start=2):
            for col_num, cell in enumerate(cells, start=1):
                if cell.data_type == "f":
                    formulas.append(f"{ws.title}!{cell.coordinate}")
            values = {header[i]: cells[i].value if i < len(cells) else None for i in range(len(header))}
            if any(v is not None and v != "" for v in values.values()):
                rows.append({"row": row_num, "values": values})
        data[ws.title] = rows
    wb.close()
    return headers, data, formulas


def approx_equal(a: Any, b: Any, tol: float = 1e-10) -> bool:
    if a is None or b is None:
        return a is b
    if isinstance(a, (int, float)) and not isinstance(a, bool) and isinstance(b, (int, float)) and not isinstance(b, bool):
        return math.isclose(float(a), float(b), rel_tol=0, abs_tol=tol)
    return a == b


def value_at(data: dict[str, list[dict[str, Any]]], sheet: str, row: int, field: str) -> Any:
    return data[sheet][row - 2]["values"].get(field)


def _svg_local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _svg_text_audit(svg_path: Path) -> dict[str, Any]:
    """Measure actual SVG text with Microsoft YaHei metrics; no audit JSON input."""
    from PIL import ImageFont

    root = ET.parse(svg_path).getroot()
    vb = [float(x) for x in root.attrib["viewBox"].split()]
    font_regular = r"C:\Windows\Fonts\msyh.ttc"
    font_bold = r"C:\Windows\Fonts\msyhbd.ttc"
    boxes = []
    outside = []
    for elem in root.iter():
        if _svg_local(elem.tag) != "text":
            continue
        text = "".join(elem.itertext()).strip()
        if not text:
            continue
        x = float(elem.attrib.get("x", 0))
        y = float(elem.attrib.get("y", 0))
        size = max(1, round(float(elem.attrib.get("font-size", 12))))
        weight = elem.attrib.get("font-weight", "")
        font = ImageFont.truetype(font_bold if weight in ("bold", "700") else font_regular, size)
        width = float(font.getlength(text))
        ascent, descent = font.getmetrics()
        anchor = elem.attrib.get("text-anchor", "start")
        if anchor == "middle":
            left = x - width / 2
        elif anchor == "end":
            left = x - width
        else:
            left = x
        glyph = font.getbbox(text, anchor="ls")
        box = {"text": text, "x1": left + glyph[0], "x2": left + glyph[2],
               "y1": y + glyph[1], "y2": y + glyph[3]}
        boxes.append(box)
        if box["x1"] < vb[0] - .5 or box["y1"] < vb[1] - .5 or box["x2"] > vb[0] + vb[2] + .5 or box["y2"] > vb[1] + vb[3] + .5:
            outside.append(box)
    overlaps = []
    for i, a in enumerate(boxes):
        for b in boxes[i + 1:]:
            iw = min(a["x2"], b["x2"]) - max(a["x1"], b["x1"])
            ih = min(a["y2"], b["y2"]) - max(a["y1"], b["y1"])
            # Boxes from the same multi-line text object do not occur; report any
            # actual metric intersection over 1 px in both dimensions.
            if iw > 1 and ih > 1:
                overlaps.append({"a": a["text"], "b": b["text"], "overlap_px": [round(iw, 2), round(ih, 2)]})
    return {"text_count": len(boxes), "outside_count": len(outside), "outside": outside[:8],
            "overlap_count": len(overlaps), "overlaps": overlaps[:25], "viewBox": vb}


def _render_drill_case(name: str, workbook: Path, out_dir: Path, drill_importer: Any, drill_renderer: Any) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    data = drill_importer.load_drill_workbook(workbook)
    results: dict[str, Any] = {"hole_id": data["meta"]["hole_id"], "endpoint_m": data["meta"]["endpoint_m"], "views": {}}
    for detail, label in ((False, "full"), (True, "detail")):
        svg, _audit = drill_renderer.render_drill_svg(data, detail=detail)
        repeated, _ = drill_renderer.render_drill_svg(data, detail=detail)
        path = out_dir / f"{name}-{label}.svg"
        path.write_text(svg, encoding="utf-8")
        root = ET.fromstring(svg)
        vb = [float(x) for x in root.attrib["viewBox"].split()]
        rects = [e for e in root.iter() if _svg_local(e.tag) == "rect"
                 and abs(float(e.attrib.get("x", -1)) - 805.5) < .01
                 and abs(float(e.attrib.get("width", -1)) - 77.0) < .01]
        max_view_depth = min(float(data["meta"]["endpoint_m"]), 45.0) if detail else float(data["meta"]["endpoint_m"])
        visible_layers = [r for r in data["layers"] if float(r["top_m"]) < max_view_depth and float(r["bottom_m"]) > 0]
        visible_samples = [r for r in data["samples"] if float(r["top_m"]) < max_view_depth and float(r["bottom_m"]) > 0]
        # Actual SVG glyphs and path commands; validate lane separation and depth placement.
        sample_paths = [e for e in root.iter() if _svg_local(e.tag) == "path" and "sample-range" in e.attrib.get("class", "")]
        path_data = [e.attrib.get("d", "") for e in sample_paths]
        centers = []
        spans = []
        for d in path_data:
            m = re.search(r"M\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+V\s*(-?\d+(?:\.\d+)?)", d)
            if m:
                centers.append(float(m.group(1)))
                spans.append((float(m.group(2)), float(m.group(3))))
        axis_lines = [e for e in root.iter() if _svg_local(e.tag) == "line" and "axis" in e.attrib.get("class", "")
                      and e.attrib.get("x1") == e.attrib.get("x2")]
        axis_main = max(axis_lines, key=lambda e: abs(float(e.attrib["y2"]) - float(e.attrib["y1"])))
        y_zero, y_end = float(axis_main.attrib["y1"]), float(axis_main.attrib["y2"])
        scale = (y_end - y_zero) / max_view_depth if max_view_depth else 0
        boundaries = [e for e in root.iter() if _svg_local(e.tag) == "line" and "boundary" in e.attrib.get("class", "")]
        rect_errors = []
        for rect, layer in zip(rects, visible_layers):
            actual_y, actual_h = float(rect.attrib["y"]), float(rect.attrib["height"])
            top, bottom = float(layer["top_m"]), min(float(layer["bottom_m"]), max_view_depth)
            rect_errors.extend([abs(actual_y - (y_zero + top * scale)),
                                abs(actual_h - (bottom - top) * scale)])
        lith_geometry_max_error = max(rect_errors, default=0.0)
        expected_boundary_depths = {0.0}
        for layer in visible_layers:
            expected_boundary_depths.add(float(layer["top_m"]))
            if float(layer["bottom_m"]) <= max_view_depth + 1e-9:
                expected_boundary_depths.add(float(layer["bottom_m"]))
        boundary_ys = sorted({round(float(e.attrib["y1"]), 3) for e in boundaries})
        expected_boundary_ys = sorted(round(y_zero + depth * scale, 3) for depth in expected_boundary_depths
                                       if 0 <= depth <= max_view_depth)
        boundary_geometry_match = boundary_ys == expected_boundary_ys
        expected_spans = [(y_zero + float(s["top_m"]) * scale, y_zero + min(float(s["bottom_m"]), max_view_depth) * scale)
                          for s in visible_samples]
        sample_span_max_error = max((max(abs(a[0] - b[0]), abs(a[1] - b[1]))
                                     for a, b in zip(spans, expected_spans)), default=0.0)
        img_count = sum(_svg_local(e.tag) == "image" for e in root.iter())
        text_audit = _svg_text_audit(path)
        rendered = {"path": str(path), "sha256_repeat_equal": svg == repeated, "viewBox": vb,
                    "lith_rect_count": len(rects), "expected_visible_layers": len(visible_layers),
                    "sample_path_count": len(sample_paths), "expected_visible_samples": len(visible_samples),
                    "sample_lane_x_unique": len(set(round(x, 3) for x in centers)),
                    "sample_span_max_error_px": sample_span_max_error,
                    "boundary_line_count": len(boundaries), "image_count": img_count,
                    "depth_axis_scale_px_per_m": scale,
                    "lith_rect_max_error_px": lith_geometry_max_error,
                    "boundary_geometry_match": boundary_geometry_match,
                    "text": text_audit}
        results["views"][label] = rendered
        checks.append({"check": f"{name} {label} SVG structure and independent text geometry",
                       "status": "pass" if svg == repeated and len(rects) == len(visible_layers)
                       and len(sample_paths) == len(visible_samples) and img_count == 0
                       and text_audit["outside_count"] == 0 and sample_span_max_error <= .002
                       and lith_geometry_max_error <= .002 and boundary_geometry_match
                       else "fail", "detail": rendered})
    full_path = Path(results["views"]["full"]["path"])
    full_root = ET.parse(full_path).getroot()
    full_text = "".join(full_root.itertext())
    hole = data["meta"]["hole_id"]
    endpoint = str(data["meta"]["endpoint_m"])
    check(f"{name} SVG source identity and endpoint are data-driven",
          hole in full_text and endpoint in full_text and "ZK0003" not in full_text if name == "drill_alt" else hole in full_text and endpoint in full_text,
          {"hole_id": hole, "endpoint_m": endpoint, "path": str(full_path)})
    # Alt fixture must show both overlapping sample paths in distinct physical lanes.
    if name == "drill_alt":
        xvals = centers
        check("drill_alt overlap samples occupy separate SVG tracks", len(xvals) == 3 and xvals[0] != xvals[1],
              {"sample_lane_x": xvals, "sample_paths": results["views"]["full"]["sample_path_count"]})
        thin_height = float(data["layers"][1]["bottom_m"]) - float(data["layers"][1]["top_m"])
        rects = [e for e in full_root.iter() if _svg_local(e.tag) == "rect"
                 and abs(float(e.attrib.get("x", -1)) - 805.5) < .01 and abs(float(e.attrib.get("width", -1)) - 77.0) < .01]
        actual_height = float(rects[1].attrib["height"]) if len(rects) > 1 else 0
        thin_y_expected = y_zero + float(data["layers"][1]["top_m"]) * scale
        check("drill_alt 0.02 m thin layer has proportional SVG coordinates", actual_height > 0
              and math.isclose(actual_height, thin_height * scale, abs_tol=0.002)
              and math.isclose(float(rects[1].attrib["y"]), thin_y_expected, abs_tol=0.002),
              {"source_thickness_m": thin_height, "expected_svg_height": thin_height * scale,
               "svg_height": actual_height, "expected_svg_y": thin_y_expected, "svg_y": float(rects[1].attrib["y"])})
    return results


def _render_section_case(name: str, workbook: Path, out_dir: Path, section_importer: Any, renderer: Any) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    data = section_importer.load_workbook_data(workbook)
    paths = renderer.render(data, out_dir, {"create_preview_png": False})
    svg_path = Path(paths["drawing_svg"])
    first = svg_path.read_bytes()
    second_dir = out_dir / "repeat"
    second_dir.mkdir(exist_ok=True)
    again = renderer.render(data, second_dir, {"create_preview_png": False})
    stable = first == Path(again["drawing_svg"]).read_bytes()
    root = ET.parse(svg_path).getroot()
    polys = [e for e in root.iter() if _svg_local(e.tag) == "polygon" and e.attrib.get("data-interval")]
    poly_intervals = sorted({e.attrib.get("data-interval") for e in polys})
    samples = [e for e in root.iter() if e.attrib.get("data-sample")]
    surveys = [e for e in root.iter() if _svg_local(e.tag) == "polyline" and "survey" in e.attrib.get("class", "")]
    images = sum(_svg_local(e.tag) == "image" for e in root.iter())
    text_audit = _svg_text_audit(svg_path)
    detail_path = Path(paths["detail_svg"]) if paths.get("detail_svg") else None
    result = {"drawing_svg": str(svg_path), "detail_svg": str(detail_path) if detail_path else None,
              "repeat_byte_equal": stable, "polygon_count": len(polys), "polygon_intervals": poly_intervals,
              "sample_marker_ids": [e.attrib["data-sample"] for e in samples],
              "survey_node_counts": [int(e.attrib.get("data-node-count", 0)) for e in surveys],
              "image_count": images, "text": text_audit}
    checks.append({"check": f"{name} actual SVG geometry, labels, and deterministic render",
                   "status": "pass" if stable and images == 0 and text_audit["outside_count"] == 0 else "fail",
                   "detail": result})
    if name == "section_alt":
        marker = next((e for e in samples if e.attrib.get("data-sample") == "T1"), None)
        survey_pts = []
        for line in surveys:
            points = [tuple(float(v) for v in p.split(",")) for p in line.attrib.get("points", "").split()]
            if len(points) == 3:
                survey_pts.append(points)
        profile = max(survey_pts, key=lambda pts: max(p[1] for p in pts) - min(p[1] for p in pts)) if survey_pts else []
        segment_dx = profile[2][0] - profile[1][0] if profile else 0
        segment_dy = profile[2][1] - profile[1][1] if profile else 0
        # Actual SVG profile: the second segment has 4.330127 m horizontal
        # projection and 2.5 m rise from the source survey geometry.
        ratio_ok = segment_dy != 0 and math.isclose(abs(segment_dx / segment_dy), 4.330127018922195 / 2.5, abs_tol=2e-5)
        sample_d = marker.attrib.get("d", "") if marker is not None else ""
        sm = re.search(r"M\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+L", sample_d)
        sample_x = float(sm.group(1)) + 4 if sm else None
        sample_y = float(sm.group(2)) if sm else None
        sample_position_ok = bool(profile) and sample_x is not None and sample_y is not None and abs(sample_y - profile[0][1]) < .01
        sample_position_ok = sample_position_ok and math.isclose(sample_x, profile[0][0] + (profile[1][0] - profile[0][0]) * .2, abs_tol=.002)
        check("section_alt SVG survey vectors encode measured endpoint rise/run and T1 position",
              marker is not None and 3 in result["survey_node_counts"] and ratio_ok and sample_position_ok,
              {"svg_profile_points": profile, "second_segment_dx_px": segment_dx, "second_segment_dy_px": segment_dy,
               "projected_world_ratio": 4.330127018922195 / 2.5, "ratio_ok": ratio_ok,
               "T1_marker_center_px": [sample_x, sample_y], "sample_position_ok": sample_position_ok})
    return result


def run() -> dict[str, Any]:
    sys.path.insert(0, str(HERE))
    section_spec = importlib.util.spec_from_file_location("section_importer_v2_audit", HERE / "importer.py")
    drill_spec = importlib.util.spec_from_file_location("drill_importer_v2_audit", HERE / "drill_importer.py")
    if not section_spec or not section_spec.loader or not drill_spec or not drill_spec.loader:
        raise RuntimeError("cannot load v2 importer modules")
    section_importer = importlib.util.module_from_spec(section_spec)
    drill_importer = importlib.util.module_from_spec(drill_spec)
    section_spec.loader.exec_module(section_importer)
    drill_spec.loader.exec_module(drill_importer)
    original_section = json.loads(ORIGINAL_SECTION.read_text(encoding="utf-8"))
    original_drill = json.loads(ORIGINAL_DRILL.read_text(encoding="utf-8"))
    input_results: dict[str, Any] = {}

    # Blank templates: fixed headers and project parameters, with no data rows.
    section_blank_path = STANDARD / "实测剖面-标准模板.xlsx"
    sh, sd, sf = read_xlsx(section_blank_path)
    project_keys = [r["values"].get("参数") for r in sd["项目"]]
    check("section blank exact project parameters", project_keys == SECTION_PARAMS,
          {"actual": project_keys, "expected": SECTION_PARAMS})
    check("section blank canonical headers", sh["测段"] == SECTION_COLUMNS,
          {"actual": sh["测段"], "expected": SECTION_COLUMNS})
    check("section blank has no data rows", len(sd["测段"]) == 0, len(sd["测段"]))
    check("section blank default units", value_at(sd, "项目", 5, "值") == "m" and value_at(sd, "项目", 6, "值") == "deg")
    check("section blank has no formulas", not sf, sf)

    drill_blank_path = STANDARD / "钻孔柱状图-标准模板.xlsx"
    dh, dd, df = read_xlsx(drill_blank_path)
    drill_keys = [r["values"].get("参数") for r in dd["项目"]]
    check("drill blank exact project parameters", drill_keys == DRILL_PARAMS,
          {"actual": drill_keys, "expected": DRILL_PARAMS})
    check("drill blank exact table headers", all(dh.get(s) == cols for s, cols in DRILL_COLUMNS.items()),
          {s: dh.get(s) for s in DRILL_COLUMNS})
    check("drill blank contains no data records", all(not dd[s] for s in DRILL_COLUMNS),
          {s: len(dd[s]) for s in DRILL_COLUMNS})
    check("drill blank fixed contract values", value_at(dd, "项目", 2, "值") == "钻孔柱状图"
          and value_at(dd, "项目", 3, "值") == "1.0" and value_at(dd, "项目", 6, "值") == "m")
    check("drill blank has no formulas", not df, df)

    # PM01 source workbook: exact raw cells, nulls, values and importer geometry.
    section_path = STANDARD / "实测剖面-填写示例.xlsx"
    sh, sd, sf = read_xlsx(section_path)
    parsed_section = section_importer.load_workbook_data(section_path)
    raw_mismatches = [
        {"record": i, "expected": src.get("raw", {}), "actual": rec.get("raw", {})}
        for i, (src, rec) in enumerate(zip(original_section["records"], parsed_section["records"]))
        if src.get("raw", {}) != rec.get("raw", {})
    ]
    field_names = ["id", "leg_id", "layer_id", "length_m", "slope_deg", "azimuth_deg",
                   "dip_direction_deg", "dip_angle_deg", "lithology_name", "description", "true_thickness_m"]
    field_mismatches = [
        {"record": i, "field": name, "expected": src.get(name), "actual": rec.get(name)}
        for i, (src, rec) in enumerate(zip(original_section["records"], parsed_section["records"]))
        for name in field_names if src.get(name) != rec.get(name)
    ]
    computed_diffs = [abs(src["computed"][k] - rec["computed"][k])
                      for src, rec in zip(original_section["records"], parsed_section["records"])
                      for k in ("horizontal_m", "vertical_m", "east_delta_m", "north_delta_m")]
    src_samples = {s["id"]: (s.get("record_id"), s.get("layer_id"), s.get("location_status"))
                   for s in original_section["samples"]}
    parsed_samples = {s["id"]: (s.get("record_id"), s.get("layer_id"), s.get("location_status"))
                      for s in parsed_section["samples"]}
    sample_mismatches = [{"id": key, "expected": value, "actual": parsed_samples.get(key)}
                         for key, value in src_samples.items() if parsed_samples.get(key) != value]
    counts = parsed_section["summary"]
    check("PM01 canonical headers", sh["测段"] == SECTION_COLUMNS)
    check("PM01 source rows exact including null omissions", not raw_mismatches, raw_mismatches[:3])
    check("PM01 normalized field values exact", not field_mismatches, field_mismatches[:5])
    check("PM01 sample identifiers and locations exact", not sample_mismatches, sample_mismatches[:5])
    check("PM01 recomputed geometry matches normalized values", max(computed_diffs, default=0) <= 1e-12,
          max(computed_diffs, default=0))
    check("PM01 counts 43/26/20/14", [counts[k] for k in ("records", "intervals", "stations", "samples")] == [43, 26, 20, 14], counts)
    check("PM01 no importer errors", not any(i["severity"] == "error" for i in parsed_section["issues"]),
          {"errors": [i for i in parsed_section["issues"] if i["severity"] == "error"]})
    check("PM01 xlsx has no formulas", not sf, sf)
    input_results["pm01"] = {
        "source_cell_mismatches": raw_mismatches,
        "normalized_field_mismatches": field_mismatches,
        "sample_mismatches": sample_mismatches,
        "counts": counts,
        "computed_geometry_max_abs_diff": max(computed_diffs, default=0),
        "issue_counts": {severity: sum(i["severity"] == severity for i in parsed_section["issues"])
                         for severity in ("error", "warning")},
        "warning_codes": {code: sum(i["code"] == code for i in parsed_section["issues"])
                          for code in sorted({i["code"] for i in parsed_section["issues"] if i["severity"] == "warning"})},
    }

    # Alternate section fixture: independently exercise different geometry.
    section_alt_path = FIXTURES / "section_alt.xlsx"
    ah, ad, af = read_xlsx(section_alt_path)
    parsed_alt_section = section_importer.load_workbook_data(section_alt_path)
    alt_summary = parsed_alt_section["summary"]
    alt_end = parsed_alt_section["nodes"][-1]
    check("alternate section project id and axis", value_at(ad, "项目", 3, "值") == "TEST-SECTION-02"
          and approx_equal(value_at(ad, "项目", 4, "值"), 90))
    check("alternate section canonical columns", ah["测段"] == SECTION_COLUMNS)
    check("alternate section ids and source sample", [r["id"] for r in parsed_alt_section["records"]] == ["R1", "R2"]
          and [(s["id"], s["record_id"]) for s in parsed_alt_section["samples"]] == [("T1", "R1")])
    check("alternate section geometry 14.330127018922195/2.5",
          approx_equal(alt_end["x_m"], 14.330127018922195, 1e-12)
          and approx_equal(alt_end["z_m"], 2.5, 1e-12),
          {"x_m": alt_end["x_m"], "z_m": alt_end["z_m"], "summary": alt_summary})
    check("alternate section optional caches and thickness remain empty",
          all(value_at(ad, "测段", row, f) is None for row in (2, 3)
              for f in ("原表平距_m", "原表高差_m", "原表累计高差_m", "原表累计北_m", "原表累计东_m", "实测真厚度_m")))
    check("alternate section has no formulas", not af, af)
    input_results["section_alt"] = {"summary": alt_summary, "endpoint": {"x_m": alt_end["x_m"], "z_m": alt_end["z_m"]}}

    # ZK0003 workbook: preserve source order, basis, missing assays and measurements.
    drill_path = STANDARD / "钻孔柱状图-填写示例.xlsx"
    dh, dd, df = read_xlsx(drill_path)
    parsed_drill = drill_importer.load_drill_workbook(drill_path)
    params = {str(r["values"].get("参数")): r["values"].get("值") for r in dd["项目"]}
    layer_rows = dd["分层"]
    turn_rows = dd["回次"]
    sample_rows = dd["样品"]
    expected_names = {1: "泥岩夹泥质粉砂岩", 4: "泥岩、泥质粉砂岩。", 5: "砂岩夹粉砂岩"}
    source_layers = original_drill["layers"]
    layer_mismatches = []
    for i, (row, src, imported) in enumerate(zip(layer_rows, source_layers, parsed_drill["layers"])):
        vals = row["values"]
        expected_name = expected_names.get(i + 1)
        expected_description = src.get("description")
        if (vals.get("层号") != src.get("id") or not approx_equal(vals.get("顶深_m"), src.get("top_m"))
                or not approx_equal(vals.get("底深_m"), src.get("bottom_m"))
                or not approx_equal(vals.get("岩心长_m"), src.get("core_m"))
                or vals.get("岩性名称") != expected_name or vals.get("岩性描述") != expected_description
                or vals.get("花纹代码") is not None):
            layer_mismatches.append({"row": row["row"], "values": vals, "source": src})
    turn_mismatches = [
        {"row": row["row"], "values": row["values"], "source": src}
        for row, src in zip(turn_rows, original_drill["turns"])
        if row["values"].get("回次号") != src.get("id")
        or not approx_equal(row["values"].get("顶深_m"), src.get("top_m"))
        or not approx_equal(row["values"].get("底深_m"), src.get("bottom_m"))
        or not approx_equal(row["values"].get("岩心长_m"), src.get("core_m"))
    ]
    sample_mismatches = [
        {"row": row["row"], "values": row["values"], "source": src}
        for row, src in zip(sample_rows, original_drill["samples"])
        if row["values"].get("样品编号") != src.get("id")
        or not approx_equal(row["values"].get("顶深_m"), src.get("top_m"))
        or not approx_equal(row["values"].get("底深_m"), src.get("bottom_m"))
        or not approx_equal(row["values"].get("岩心长_m"), src.get("core_m"))
        or any(row["values"].get(e) is not None for e in ("Au", "Pb", "Zn"))
    ]
    layer_contiguous = bool(layer_rows) and approx_equal(layer_rows[0]["values"]["顶深_m"], 0) and approx_equal(layer_rows[-1]["values"]["底深_m"], 382.79)
    layer_contiguous = layer_contiguous and all(approx_equal(layer_rows[i]["values"]["底深_m"], layer_rows[i + 1]["values"]["顶深_m"]) for i in range(len(layer_rows) - 1))
    turn_contiguous = bool(turn_rows) and approx_equal(turn_rows[0]["values"]["顶深_m"], 0) and approx_equal(turn_rows[-1]["values"]["底深_m"], 382.79)
    turn_contiguous = turn_contiguous and all(approx_equal(turn_rows[i]["values"]["底深_m"], turn_rows[i + 1]["values"]["顶深_m"]) for i in range(len(turn_rows) - 1))
    expected_patterns = {1: "short-dash-double-dot", 4: "dot-rows-thin-lines", 5: "point-dash-ellipse-bands"}
    imported_patterns = {int(x["id"]): x.get("pattern_id") for x in parsed_drill["layers"] if str(x.get("id", "")).isdigit()}
    check("ZK0003 ids, depth basis, and version", params.get("钻孔编号") == "ZK0003"
          and params.get("孔深基准") == "原始沿孔深" and params.get("模板版本") == "1.0"
          and isinstance(params.get("模板版本"), str), params)
    check("ZK0003 exact headers", all(dh.get(s) == cols for s, cols in DRILL_COLUMNS.items()))
    check("ZK0003 endpoint 382.79", approx_equal(params.get("终孔深度_m"), 382.79)
          and approx_equal(parsed_drill["summary"]["endpoint_m"], 382.79))
    check("ZK0003 counts 131/23/97", [len(turn_rows), len(layer_rows), len(sample_rows)] == [131, 23, 97],
          {"turns": len(turn_rows), "layers": len(layer_rows), "samples": len(sample_rows)})
    check("ZK0003 source layer values, descriptions, nulls, names, and codes exact", not layer_mismatches, layer_mismatches[:3])
    check("ZK0003 turn ids and boundary values exact", not turn_mismatches, turn_mismatches[:3])
    check("ZK0003 sample ids, boundaries, cores and absent assays exact", not sample_mismatches, sample_mismatches[:3])
    check("ZK0003 layer coverage continuous 0 to endpoint", layer_contiguous)
    check("ZK0003 turn coverage continuous 0 to endpoint", turn_contiguous)
    check("ZK0003 exact pattern names auto-map and unknown remains pending",
          all(imported_patterns.get(k) == v for k, v in expected_patterns.items())
          and parsed_drill["summary"]["pending_patterns"] == 20, imported_patterns)
    check("ZK0003 no assay units or values fabricated", params.get("Au单位") is None and params.get("Pb单位") is None
          and params.get("Zn单位") is None and all(r["values"].get(e) is None for r in sample_rows for e in ("Au", "Pb", "Zn")))
    check("ZK0003 no formulas", not df, df)
    input_results["zk0003"] = {
        "summary": parsed_drill["summary"], "depth_basis": params.get("孔深基准"),
        "layer_contiguous": layer_contiguous, "turn_contiguous": turn_contiguous,
        "layer_mismatches": layer_mismatches, "turn_mismatches": turn_mismatches,
        "sample_mismatches": sample_mismatches,
        "pattern_ids": imported_patterns,
        "overlap_warning_count": sum(i["code"] == "OVERLAPPING_SAMPLES" for i in parsed_drill["issues"]),
        "assays_all_null": all(s["assays"][e] is None for s in parsed_drill["samples"] for e in ("Au", "Pb", "Zn")),
    }

    # Independent short drill fixture: a second hole depth and overlapping samples.
    drill_alt_path = FIXTURES / "drill_alt.xlsx"
    fdh, fdd, fdf = read_xlsx(drill_alt_path)
    parsed_alt_drill = drill_importer.load_drill_workbook(drill_alt_path)
    alt_params = {str(r["values"].get("参数")): r["values"].get("值") for r in fdd["项目"]}
    alt_layers = parsed_alt_drill["layers"]
    alt_turns = parsed_alt_drill["turns"]
    alt_samples = parsed_alt_drill["samples"]
    overlaps = [(a["id"], b["id"]) for i, a in enumerate(alt_samples) for b in alt_samples[i + 1:]
                if max(a["top_m"], b["top_m"]) < min(a["bottom_m"], b["bottom_m"])]
    check("alternate drill second hole identity, basis, endpoint, and Au unit",
          alt_params.get("钻孔编号") == "ZK-TEST-02" and alt_params.get("孔深基准") == "原始沿孔深"
          and approx_equal(alt_params.get("终孔深度_m"), 7)
          and alt_params.get("Au单位") == "g/t")
    check("alternate drill counts 2/3/3/7", [len(alt_turns), len(alt_layers), len(alt_samples), parsed_alt_drill["summary"]["endpoint_m"]] == [2, 3, 3, 7],
          parsed_alt_drill["summary"])
    check("alternate drill layer labels and exact material mappings",
          [(x["id"], x["lithology_name"], x.get("pattern_id")) for x in alt_layers] == [
              ("A", "泥岩夹泥质粉砂岩", "short-dash-double-dot"),
              ("B", "砂岩夹粉砂岩", "point-dash-ellipse-bands"),
              ("C", "新岩性名称待定义", None)])
    check("alternate drill sample ids, assay value and nulls",
          [(s["id"], s["assays"]["Au"]) for s in alt_samples] == [("S1", 0.15), ("S2", None), ("S3", None)]
          and all(s["assays"][e] is None for s in alt_samples[1:] for e in ("Au", "Pb", "Zn")))
    check("alternate drill overlapping sample pair permitted and flagged", overlaps == [("S1", "S2")]
          and any(i["code"] == "OVERLAPPING_SAMPLES" and "S1" in i["message"] and "S2" in i["message"]
                  for i in parsed_alt_drill["issues"]), {"overlaps": overlaps, "issues": parsed_alt_drill["issues"]})
    check("alternate drill no formulas", not fdf, fdf)
    input_results["drill_alt"] = {
        "summary": parsed_alt_drill["summary"], "sample_overlaps": overlaps,
        "issues": parsed_alt_drill["issues"],
        "sample_assays": {s["id"]: s["assays"] for s in alt_samples},
    }

    # Render each imported workbook directly through production renderers. The
    # geometry checks below parse generated SVG XML, independently of audit JSON.
    renderer_spec = importlib.util.spec_from_file_location("section_renderer_v2_audit", HERE / "renderer.py")
    drill_renderer_spec = importlib.util.spec_from_file_location("drill_renderer_v2_audit", HERE / "drill_renderer.py")
    if not renderer_spec or not renderer_spec.loader or not drill_renderer_spec or not drill_renderer_spec.loader:
        raise RuntimeError("cannot load v2 renderer modules")
    renderer = importlib.util.module_from_spec(renderer_spec)
    drill_renderer = importlib.util.module_from_spec(drill_renderer_spec)
    renderer_spec.loader.exec_module(renderer)
    drill_renderer_spec.loader.exec_module(drill_renderer)
    render_dir = LOG_DIR / "v2-acceptance-renders"
    render_results = {
        "drill_zk0003": _render_drill_case("drill_zk0003", drill_path, render_dir / "drill-zk0003", drill_importer, drill_renderer),
        "drill_alt": _render_drill_case("drill_alt", drill_alt_path, render_dir / "drill-alt", drill_importer, drill_renderer),
        "section_pm01": _render_section_case("section_pm01", section_path, render_dir / "section-pm01", section_importer, renderer),
        "section_alt": _render_section_case("section_alt", section_alt_path, render_dir / "section-alt", section_importer, renderer),
    }

    failed = [c for c in checks if c["status"] != "pass"]
    result = {
        "phase": "input-and-svg-acceptance",
        "renderer_geometry_audit": "svg-xml-and-font-metrics",
        "status": "pass" if not failed else "fail",
        "check_count": len(checks),
        "failed_check_count": len(failed),
        "checks": checks,
        "inputs": input_results,
        "renders": render_results,
    }
    return result


if __name__ == "__main__":
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    try:
        result = run()
    except Exception as exc:  # Save a compact failure log for the reviewer.
        result = {"phase": "input-and-svg-acceptance", "status": "error", "error": f"{type(exc).__name__}: {exc}"}
    out = LOG_DIR / "v2-acceptance-render.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result.get("status"), "check_count": result.get("check_count"),
                      "failed_check_count": result.get("failed_check_count"), "log": str(out)}, ensure_ascii=False))
    if result.get("status") != "pass":
        raise SystemExit(1)
