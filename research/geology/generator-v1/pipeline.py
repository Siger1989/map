"""Local CLI pipeline for geology-generator v1.

The only business input is the workbook passed with --input.  Normalization,
rendering, SVG rasterization and provenance reporting are performed in one run.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from importer import GeometryInputError, load_workbook_data
from readability import render_readability
from renderer import RenderInputError, render


ROOT = Path(__file__).resolve().parent
TEMPLATES = ROOT / "templates"
LOG_ROOT = ROOT / "logs"
FORBIDDEN_COMPONENTS = {"section-reproduction"}
FORBIDDEN_FILENAMES = {"section-data.json"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp"}
BUSINESS_SUFFIXES = {".xls", ".xlsx", ".json", ".svg"} | IMAGE_SUFFIXES
_AUDIT_LOCAL = threading.local()
_AUDIT_INSTALLED = False


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_read_mode(mode: Any) -> bool:
    if isinstance(mode, str):
        return "r" in mode or "+" in mode
    if isinstance(mode, int):
        return (mode & os.O_WRONLY) == 0
    return True


class BusinessReadAudit:
    """Block legacy/image inputs and record business files opened for reading."""

    def __init__(self, output_dir: Path, allowed_input: Path):
        self.output_dir = output_dir.resolve()
        self.allowed_input = allowed_input.resolve()
        self.owner_thread_id = threading.get_ident()
        self.paths: set[Path] = set()

    def hook(self, event: str, args: tuple[Any, ...]) -> None:
        if threading.get_ident() != self.owner_thread_id:
            return
        if event != "open" or not args or not isinstance(args[0], (str, bytes, os.PathLike)):
            return
        if not _is_read_mode(args[1] if len(args) > 1 else "r"):
            return
        try:
            path = Path(os.fsdecode(args[0])).resolve()
        except (OSError, ValueError, TypeError):
            return
        folded_parts = {part.casefold() for part in path.parts}
        if folded_parts & FORBIDDEN_COMPONENTS or path.name.casefold() in FORBIDDEN_FILENAMES:
            raise PermissionError(f"禁止读取旧成果：{path}")
        inside_output = path == self.output_dir or self.output_dir in path.parents
        if path.suffix.casefold() in IMAGE_SUFFIXES and not inside_output:
            raise PermissionError(f"禁止读取源图像：{path}")
        if path.suffix.casefold() in BUSINESS_SUFFIXES and not inside_output:
            self.paths.add(path)


def _audit_dispatch(event: str, args: tuple[Any, ...]) -> None:
    audit = getattr(_AUDIT_LOCAL, "current", None)
    if audit is not None:
        audit.hook(event, args)


def _find_browser() -> Path:
    candidates = [
        os.environ.get("GEOLOGY_BROWSER"),
        shutil.which("msedge"), shutil.which("chrome"), shutil.which("chrome.exe"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate).resolve()
    raise RuntimeError("未找到已安装的 Microsoft Edge 或 Google Chrome，无法生成 PNG")


def _svg_size(path: Path) -> tuple[int, int]:
    head = path.read_text(encoding="utf-8")[:2048]
    width = re.search(r'<svg\b[^>]*\bwidth="([0-9]+(?:\.[0-9]+)?)"', head)
    height = re.search(r'<svg\b[^>]*\bheight="([0-9]+(?:\.[0-9]+)?)"', head)
    if not width or not height:
        raise RuntimeError(f"SVG 缺少可用的 width/height：{path.name}")
    w, h = math.ceil(float(width.group(1))), math.ceil(float(height.group(1)))
    if w < 1 or h < 1 or w > 30000 or h > 30000:
        raise RuntimeError(f"SVG 尺寸超出栅格化范围：{w}×{h}")
    return w, h


def _png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as stream:
        header = stream.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise RuntimeError(f"浏览器未生成有效 PNG：{path.name}")
    return struct.unpack(">II", header[16:24])


def _rasterize(svg: Path, png: Path, browser: Path, log_path: Path, scale: int = 1,
               max_pixels: int = 64_000_000, max_dimension: int = 12_000) -> Dict[str, Any]:
    width, height = _svg_size(svg)
    if scale < 1:
        raise ValueError("栅格化倍率必须是正整数")
    if width * height > max_pixels or max(width, height) > max_dimension:
        raise RuntimeError(f"SVG 基础尺寸 {width}×{height} 已超过 PNG 资源上限，无法安全栅格化")
    requested_scale = scale
    # Bound both the decoded surface and either edge before launching Chromium.
    scale = min(scale, max(1, int(math.sqrt(max_pixels / (width * height)))))
    scale = min(scale, max(1, max_dimension // max(width, height)))
    raster_width, raster_height = width * scale, height * scale
    profile = svg.parent / f".browser-profile-{uuid.uuid4().hex}"
    profile.mkdir(parents=False, exist_ok=False)
    command = [
        str(browser), "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
        "--disable-background-networking", "--disable-default-apps", "--disable-extensions",
        f"--force-device-scale-factor={scale}", f"--user-data-dir={profile}",
        f"--window-size={width},{height}", f"--screenshot={png.resolve()}", svg.resolve().as_uri(),
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8",
                                   errors="replace", timeout=120, check=False)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(
            f"browser={browser}\nsvg={svg}\ncss_size={width}x{height}\nrequested_scale={requested_scale}\n"
            f"effective_scale={scale}\nexpected_png_size={raster_width}x{raster_height}\n"
            f"returncode={completed.returncode}\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}\n", encoding="utf-8"
        )
        if completed.returncode != 0 or not png.is_file():
            raise RuntimeError(f"浏览器栅格化失败，详见 {log_path}")
        actual = _png_size(png)
        if actual != (raster_width, raster_height):
            raise RuntimeError(f"PNG 尺寸 {actual[0]}×{actual[1]} 与预期 {raster_width}×{raster_height} 不一致")
        return {"css_width_px": width, "css_height_px": height, "requested_scale": requested_scale,
                "scale": scale, "png_width_px": actual[0], "png_height_px": actual[1],
                "pixel_limit": max_pixels, "dimension_limit": max_dimension,
                "scale_reduced_for_limits": scale < requested_scale, "browser": str(browser)}
    finally:
        try:
            if profile.parent.resolve() == svg.parent.resolve() and profile.name.startswith(".browser-profile-"):
                shutil.rmtree(profile, ignore_errors=True)
        except OSError:
            pass


def _file_info(path: Path, role: str) -> Dict[str, Any]:
    return {"name": path.name, "role": role, "bytes": path.stat().st_size, "sha256": _sha256(path)}


def _report(data: Dict[str, Any], output_dir: Path, outputs: Dict[str, str],
            layer_geometry: Optional[Dict[str, Any]] = None) -> Path:
    summary = data["summary"]
    issues = data.get("issues", [])
    rows = "".join(
        f"<tr><td>{html.escape(str(item.get('severity', '')))}</td>"
        f"<td>{html.escape(str(item.get('code', '')))}</td>"
        f"<td>{html.escape(str(item.get('message', '')))}</td>"
        f"<td>{html.escape(', '.join(map(str, item.get('cells', []))))}</td></tr>" for item in issues
    ) or '<tr><td colspan="4">无</td></tr>'
    layer_geometry = layer_geometry or {}
    layer_issues = layer_geometry.get("issues") or []
    layer_rows = "".join(
        f"<tr><td>{html.escape(str(item.get('severity', '')))}</td>"
        f"<td>{html.escape(str(item.get('code', '')))}</td>"
        f"<td>{html.escape(str(item.get('message', '')))}</td>"
        f"<td>{html.escape(', '.join(map(str, item.get('cells', []))))}</td></tr>" for item in layer_issues
    ) or '<tr><td colspan="4">无</td></tr>'
    source = data["source"]
    links = [
        ("drawing.svg", "矢量图"), ("preview.png", "PNG 预览"),
        ("complete-hd.png", "完整图高清 PNG"), ("normalized.json", "规范数据"),
        ("appendix.html", "完整附表"), ("layout-audit.json", "版式审计"), ("manifest.json", "生成清单"),
    ]
    if "readability_svg" in outputs:
        links.extend([
            ("readability.svg", "岩性与重点层识读图（SVG）"),
            ("readability.png", "岩性与重点层识读图（PNG）"),
            ("readability-audit.json", "识读图审计"),
        ])
    if "detail_svg" in outputs:
        links.extend([("detail.svg", "拥挤段矢量详图"), ("detail.png", "拥挤段 PNG")])
    link_html = "".join(f'<a href="{name}">{label}</a>' for name, label in links)
    doc = f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>实测剖面生成器 · 数据核验版报告</title>
<style>body{{font:14px/1.65 'Microsoft YaHei',sans-serif;margin:28px;color:#17202a;max-width:1180px}}nav a{{display:inline-block;margin:0 14px 8px 0}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #c5ccd3;padding:6px 8px;vertical-align:top}}th{{background:#eef3f7}}code{{word-break:break-all}}.note{{background:#fff7db;padding:10px 14px}}</style>
<body><h1>实测剖面生成器 · 数据核验版报告</h1><nav>{link_html}<a href="#source">来源</a><a href="#issues">导入问题</a></nav>
<p class="note"><strong>行业图式尚未完成核验，本报告不能据此认定为已符合正式行业制图规范。</strong>本报告用于核对导入字段、测线计算与相对高程。横纵坐标使用相同单位，垂直夸大为 1；米标尺表示图内数据尺度，不等于固定打印比例。近地表岩性区使用相邻层共享的视倾层界裁剪：层界锚定源分层节点，方向由后续层段首记录产状按剖面方向计算，属于局部平面显示假设，不是独立实测界面，不能读取真厚度或深部接触关系；缺少可用产状时受影响区域留白，不画竖直替代。层界相交时可缩短显示深度，该深度仍不代表厚度。岩性纹样按本参考图建立；未确认的纹样留白待核对，行业图式尚未完成整体核验。“岩性与重点层识读图”使用固定大小样块和独立局部放大帮助辨认，不能用来比较地层厚度，也不表示正式行业符号已经核验。本次动态读取样品 {summary['samples']} 个，其中明确定位 {summary['located_samples']} 个；缺少定位的样品只进入附表。</p>
<h2>概要</h2><table><tbody>
<tr><th>记录 / 层段 / 站点</th><td>{summary['records']} / {summary['intervals']} / {summary['stations']}</td></tr>
<tr><th>样品（已定位）</th><td>{summary['samples']}（{summary['located_samples']}）</td></tr>
<tr><th>总斜距 / 总平距 / 总高差</th><td>{summary['total_slant_m']:.12g} m / {summary['total_horizontal_m']:.12g} m / {summary['total_vertical_m']:.12g} m</td></tr>
<tr><th>剖面方位</th><td>{summary['axis_azimuth_deg']:.12g}°（{html.escape(data['settings']['axis_method'])}）</td></tr></tbody></table>
<h2>近地表岩性区审查</h2><table><tbody>
<tr><th>模式</th><td>{html.escape(str(layer_geometry.get('mode', '未提供')))}</td></tr>
<tr><th>请求 / 实际显示深度</th><td>{html.escape(str(layer_geometry.get('requested_depth_m', '未提供')))} m / {html.escape(str(layer_geometry.get('effective_depth_m', '未提供')))} m（均不表示厚度）</td></tr>
<tr><th>可绘制</th><td>{'是' if layer_geometry.get('eligible') else '否或待核对'}</td></tr></tbody></table>
<table><thead><tr><th>级别</th><th>代码</th><th>说明</th><th>单元格</th></tr></thead><tbody>{layer_rows}</tbody></table>
<h2 id="source">来源</h2><p>文件：{html.escape(source['filename'])}<br>SHA-256：<code>{source['sha256']}</code><br>适配器：{html.escape(source['adapter'])}；工作表：{html.escape(source['sheet'])}</p>
<h2 id="issues">导入问题（{len(issues)}）</h2><table><thead><tr><th>级别</th><th>代码</th><th>说明</th><th>单元格</th></tr></thead><tbody>{rows}</tbody></table>
</body></html>"""
    path = output_dir / "report.html"
    path.write_text(doc, encoding="utf-8")
    return path


def _run_pipeline_impl(input_path: os.PathLike[str] | str, output_dir: os.PathLike[str] | str,
                       axis: Optional[float] = None) -> Dict[str, Any]:
    source = Path(input_path).expanduser().resolve()
    out = Path(output_dir).expanduser().resolve()
    if source.suffix.casefold() not in {".xls", ".xlsx"}:
        raise GeometryInputError([{"severity": "error", "code": "UNSUPPORTED_FORMAT",
                                  "message": "仅支持已适配的 XLS 登记表或规范 XLSX", "cells": []}])
    out.mkdir(parents=True, exist_ok=True)
    audit = getattr(_AUDIT_LOCAL, "current", None) or BusinessReadAudit(out, source)
    settings = {"axis_azimuth_deg": axis} if axis is not None else None
    data = load_workbook_data(source, settings=settings)
    normalized = out / "normalized.json"
    normalized.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    rendered = render(data, out, config={"create_preview_png": False})
    layout_path = Path(rendered["layout_audit_json"])
    layout = json.loads(layout_path.read_text(encoding="utf-8"))
    layer_geometry = layout.get("layer_geometry") or {}
    materials_doc = json.loads((TEMPLATES / "materials.json").read_text(encoding="utf-8"))
    readability = render_readability(data, layer_geometry, materials_doc, out)
    all_outputs = {**rendered, **readability}
    browser = _find_browser()
    raster: Dict[str, Any] = {}
    raster["preview"] = _rasterize(Path(rendered["drawing_svg"]), out / "preview.png", browser,
                                    LOG_ROOT / f"raster-{out.name}-preview.log")
    raster["complete_hd"] = _rasterize(Path(rendered["drawing_svg"]), out / "complete-hd.png", browser,
                                         LOG_ROOT / f"raster-{out.name}-complete-hd.log", scale=4)
    if rendered.get("detail_svg"):
        raster["detail"] = _rasterize(Path(rendered["detail_svg"]), out / "detail.png", browser,
                                       LOG_ROOT / f"raster-{out.name}-detail.log")
    raster["readability"] = _rasterize(Path(readability["readability_svg"]), out / "readability.png", browser,
                                        LOG_ROOT / f"raster-{out.name}-readability.log")
    report = _report(data, out, all_outputs, layer_geometry)

    roles = {
        "normalized.json": "normalized_data", "drawing.svg": "vector_master", "preview.png": "raster_preview",
        "complete-hd.png": "complete_hd_raster",
        "appendix.html": "complete_appendix", "layout-audit.json": "layout_audit", "report.html": "run_report",
        "detail.svg": "vector_detail", "detail.png": "raster_detail",
        "readability.svg": "readability_vector", "readability.png": "readability_raster",
        "readability-audit.json": "readability_audit",
    }
    output_files = [_file_info(out / name, role) for name, role in roles.items() if (out / name).is_file()]
    code_files = [ROOT / "importer.py", ROOT / "renderer.py", ROOT / "layer_geometry.py", ROOT / "readability.py", ROOT / "pipeline.py"]
    template_files = [TEMPLATES / "materials.json", TEMPLATES / "drawing.json"]
    business_reads = []
    for path in sorted(audit.paths, key=lambda p: str(p).casefold()):
        if path.is_file():
            business_reads.append({"path": str(path), "sha256": _sha256(path)})
    manifest = {
        "schema_version": "1.0", "input": {"path": str(source), "filename": source.name, "sha256": _sha256(source)},
        "settings": data["settings"],
        "code": [{"name": p.name, "sha256": _sha256(p)} for p in code_files],
        "templates": [{"name": p.name, "sha256": _sha256(p)} for p in template_files],
        "business_file_reads": business_reads,
        "outputs": output_files + [{"name": "manifest.json", "role": "self_manifest", "bytes": None, "sha256": None}],
        "drawing_bounds": layout.get("geometry", {}),
        "precision_boundary": {
            "calculation": "unrounded IEEE-754 double precision", "display_coordinates_decimals": 3,
            "display_angles_decimals": 3, "vertical_exaggeration": 1,
            "lithology_band_width_represents_thickness": False,
        },
        "rasterization": raster,
    }
    manifest_path = out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return {"ok": True, "output_dir": str(out), "summary": data["summary"],
            "issues": data["issues"] + list(layer_geometry.get("issues") or []),
            "files": {item["role"]: item["name"] for item in output_files} | {"manifest": "manifest.json"},
            "manifest": manifest}


def run_pipeline(input_path: os.PathLike[str] | str, output_dir: os.PathLike[str] | str,
                 axis: Optional[float] = None) -> Dict[str, Any]:
    global _AUDIT_INSTALLED
    source = Path(input_path).expanduser().resolve()
    out = Path(output_dir).expanduser().resolve()
    if not _AUDIT_INSTALLED:
        sys.addaudithook(_audit_dispatch)
        _AUDIT_INSTALLED = True
    audit = BusinessReadAudit(out, source)
    previous = getattr(_AUDIT_LOCAL, "current", None)
    _AUDIT_LOCAL.current = audit
    try:
        return _run_pipeline_impl(source, out, axis)
    finally:
        if previous is None:
            try:
                del _AUDIT_LOCAL.current
            except AttributeError:
                pass
        else:
            _AUDIT_LOCAL.current = previous


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="从已适配 XLS/XLSX 生成实测剖面图与审查文件")
    parser.add_argument("--input", required=True, help="旧 XLS 登记表或规范 XLSX")
    parser.add_argument("--output", required=True, help="输出目录")
    parser.add_argument("--axis", type=float, default=None, help="显式剖面方位角（度，0≤值<360）")
    args = parser.parse_args(argv)
    try:
        result = run_pipeline(args.input, args.output, args.axis)
    except (GeometryInputError, RenderInputError) as exc:
        payload = {"ok": False, "error": "输入数据未通过校验", "issues": exc.issues}
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        return 2
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "output_dir": result["output_dir"], "summary": result["summary"],
                      "issue_count": len(result["issues"])}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
