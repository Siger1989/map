"""127.0.0.1-only HTTP integration for section and drill geology imports."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import mimetypes
import re
import sys
import threading
import uuid
from urllib.parse import quote
from email import policy
from email.parser import BytesParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from importer import GeometryInputError
from pipeline import ROOT, run_pipeline
from renderer import RenderInputError

HOST = "127.0.0.1"
DEFAULT_PORT = 9188
MAX_BODY = 20 * 1024 * 1024
WEB_ROOT = ROOT / "web"
UPLOAD_ROOT = ROOT / "uploads"
GENERATED_ROOT = ROOT / "generated"
TEMPLATE_ROOT = ROOT / "outputs" / "standard-input-v2"
DRAWING_TYPES = {"section", "drill"}
TEMPLATE_FILES = {
    ("section", False): "实测剖面-标准模板.xlsx",
    ("section", True): "实测剖面-填写示例.xlsx",
    ("drill", False): "钻孔柱状图-标准模板.xlsx",
    ("drill", True): "钻孔柱状图-填写示例.xlsx",
}
GENERATION_LOCK = threading.Lock()
GENERATED_FILE_LABELS = {
    "drawing.svg": "SVG 主图", "preview.png": "PNG 预览", "detail.svg": "SVG 详图",
    "complete-hd.png": "高清完整图（PNG）", "detail.png": "PNG 详图",
    "readability.svg": "岩性识读图（SVG）", "readability.png": "岩性识读图（PNG）",
    "readability-audit.json": "识读图审计", "appendix.html": "完整附表",
    "normalized.json": "规范数据", "layout-audit.json": "版式审计", "report.html": "生成报告",
    "manifest.json": "生成清单",
}


def _setup_logging() -> None:
    (ROOT / "logs").mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=ROOT / "logs" / "server.log", level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", encoding="utf-8")


def _safe_filename(name: str) -> str:
    base = Path(name.replace("\\", "/")).name
    stem = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "_", base).strip("._")
    return stem[:120] or "upload.xlsx"


def _mode_of(directory: Path) -> str | None:
    try:
        data = json.loads((directory / "normalized.json").read_text(encoding="utf-8"))
        kind = data.get("drawing_type")
        if kind in DRAWING_TYPES:
            return kind
        # Historic generated directories predate drawing_type and all belong to section.
        return "section"
    except (OSError, ValueError, json.JSONDecodeError):
        return None


def _result_payload(directory: Path, *, previous: bool) -> dict:
    normalized_path, manifest_path = directory / "normalized.json", directory / "manifest.json"
    if not normalized_path.is_file() or not manifest_path.is_file():
        raise FileNotFoundError(directory)
    normalized = json.loads(normalized_path.read_text(encoding="utf-8"))
    drawing_type = normalized.get("drawing_type") or "section"
    if drawing_type not in DRAWING_TYPES:
        raise ValueError("invalid drawing type in result")
    files = {}
    for name, label in GENERATED_FILE_LABELS.items():
        if (directory / name).is_file():
            files[name] = {"label": label, "url": f"/generated/{directory.name}/{name}"}
    return {"job": directory.name, "drawing_type": drawing_type, "previous": previous,
            "summary": normalized.get("summary", {}), "issues": normalized.get("issues", []),
            "source": normalized.get("source", {}), "files": files}


def _latest_results() -> dict:
    latest: dict[str, tuple[float, dict]] = {}
    if not GENERATED_ROOT.is_dir():
        return {}
    for manifest in GENERATED_ROOT.glob("*/manifest.json"):
        directory = manifest.parent
        kind = _mode_of(directory)
        if kind is None:
            continue
        try:
            result = _result_payload(directory, previous=True)
            stamp = manifest.stat().st_mtime
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        if kind not in latest or stamp > latest[kind][0]:
            latest[kind] = (stamp, result)
    return {kind: row[1] for kind, row in latest.items()}


class Handler(BaseHTTPRequestHandler):
    server_version = "GeologyGenerator/2.0"

    def log_message(self, fmt: str, *args) -> None:
        logging.info("%s %s", self.address_string(), fmt % args)

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path: Path, *, download_name: str | None = None) -> None:
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type + ("; charset=utf-8" if content_type.startswith("text/") else ""))
        self.send_header("Content-Length", str(path.stat().st_size))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        if download_name:
            ascii_name = re.sub(r"[^A-Za-z0-9._-]", "_", download_name)
            self.send_header("Content-Disposition", f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(download_name)}")
        self.end_headers()
        with path.open("rb") as stream:
            while chunk := stream.read(64 * 1024):
                self.wfile.write(chunk)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            self._file(WEB_ROOT / "index.html")
            return
        if parsed.path == "/vector-viewer.html":
            self._file(WEB_ROOT / "vector-viewer.html")
            return
        if parsed.path == "/api/status":
            results = _latest_results()
            templates = {f"{kind}_{'example' if example else 'blank'}":
                         (TEMPLATE_ROOT / filename).is_file()
                         for (kind, example), filename in TEMPLATE_FILES.items()}
            self._json(200, {"ok": True, "app": "geology-generator-v1", "modes": ["section", "drill"],
                             "templates": templates, "last_results": results,
                             "last_result": results.get("section")})
            return
        if parsed.path == "/template":
            query = parse_qs(parsed.query)
            kind = (query.get("type") or ["section"])[0]
            example_text = (query.get("example") or ["0"])[0]
            if kind not in DRAWING_TYPES or example_text not in {"0", "1"}:
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            name = TEMPLATE_FILES[(kind, example_text == "1")]
            self._file(TEMPLATE_ROOT / name, download_name=name)
            return
        if parsed.path.startswith("/generated/"):
            relative = unquote(parsed.path[len("/generated/"):])
            parts = Path(relative).parts
            if len(parts) != 2 or parts[1] not in GENERATED_FILE_LABELS or not re.fullmatch(r"[A-Za-z0-9_-]+", parts[0]):
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            root = GENERATED_ROOT.resolve()
            candidate = (GENERATED_ROOT / parts[0] / parts[1]).resolve()
            if root not in candidate.parents or not candidate.is_file():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self._file(candidate)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/generate":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if length < 0:
            self._json(411, {"ok": False, "error": {"code": "LENGTH_REQUIRED", "message": "请求缺少有效长度"}})
            return
        if length > MAX_BODY:
            self._json(413, {"ok": False, "error": {"code": "UPLOAD_TOO_LARGE", "message": "上传内容不得超过 20 MB"}})
            return
        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("multipart/form-data"):
            self._json(415, {"ok": False, "error": {"code": "BAD_CONTENT_TYPE", "message": "请使用表单上传工作簿"}})
            return
        try:
            body = self.rfile.read(length)
            message = BytesParser(policy=policy.default).parsebytes(
                b"Content-Type: " + content_type.encode("ascii", "strict") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body)
        except Exception:
            self._json(400, {"ok": False, "error": {"code": "INVALID_MULTIPART", "message": "上传表单无法解析"}})
            return
        fields: dict[str, str] = {}
        filename, file_bytes = "", None
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if name == "workbook":
                filename, file_bytes = part.get_filename() or "", part.get_payload(decode=True)
            elif name:
                fields[name] = part.get_content().strip()
        kind = fields.get("drawing_type") or "section"
        if kind not in DRAWING_TYPES:
            self._json(400, {"ok": False, "error": {"code": "INVALID_DRAWING_TYPE", "message": "请选择实测剖面或钻孔柱状图"}})
            return
        axis_text = fields.get("axis", "")
        if kind == "drill" and axis_text:
            self._json(400, {"ok": False, "error": {"code": "AXIS_NOT_APPLICABLE", "message": "剖面方位角仅用于实测剖面"}})
            return
        if not filename or file_bytes is None:
            self._json(400, {"ok": False, "error": {"code": "MISSING_WORKBOOK", "message": "请选择工作簿"}})
            return
        clean_name = _safe_filename(filename)
        suffix = Path(clean_name).suffix.casefold()
        if suffix not in {".xls", ".xlsx"} or (kind == "drill" and suffix != ".xlsx"):
            message = "钻孔柱状图请选择 XLSX 工作簿" if kind == "drill" else "请选择 XLS 或 XLSX 工作簿"
            self._json(400, {"ok": False, "error": {"code": "UNSUPPORTED_FORMAT", "message": message}})
            return
        axis = None
        if axis_text:
            try:
                axis = float(axis_text)
            except ValueError:
                axis = -1
            if not 0 <= axis < 360:
                self._json(400, {"ok": False, "error": {"code": "INVALID_AXIS", "message": "剖面方位角必须在 0（含）到 360（不含）之间"}})
                return

        content_hash = hashlib.sha256(file_bytes).hexdigest()
        settings = "auto" if axis is None else format(axis, ".17g")
        job_id = f"{kind}-{content_hash[:12]}-{hashlib.sha256(settings.encode()).hexdigest()[:8]}-{uuid.uuid4().hex[:8]}"
        UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
        GENERATED_ROOT.mkdir(parents=True, exist_ok=True)
        upload_dir = UPLOAD_ROOT / content_hash[:16]
        upload_dir.mkdir(parents=True, exist_ok=True)
        upload_path = upload_dir / clean_name
        upload_path.write_bytes(file_bytes)
        output_dir = GENERATED_ROOT / job_id
        try:
            with GENERATION_LOCK:
                if kind == "section":
                    run_pipeline(upload_path, output_dir, axis)
                else:
                    from drill_pipeline import run_drill_pipeline
                    run_drill_pipeline(upload_path, output_dir)
            payload = _result_payload(output_dir, previous=False)
            payload.update({"ok": True, "message": "本次生成成功"})
            self._json(200, payload)
        except (GeometryInputError, RenderInputError) as exc:
            logging.info("%s input rejected: %s", kind, exc)
            self._json(400, {"ok": False, "error": {"code": "INPUT_VALIDATION_FAILED",
                       "message": "输入数据未通过校验，请根据表名和单元格提示修正", "issues": exc.issues}})
        except Exception:
            logging.exception("%s generation failed", kind)
            self._json(500, {"ok": False, "error": {"code": "GENERATION_FAILED",
                       "message": "生成失败，请检查工作簿或查看 logs/server.log"}})


def main() -> int:
    parser = argparse.ArgumentParser(description="统一实测剖面与钻孔柱状图本地工具")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    _setup_logging()
    WEB_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        server = ThreadingHTTPServer((HOST, args.port), Handler)
    except OSError as exc:
        print(f"无法监听 http://{HOST}:{args.port}：端口可能已被占用。{exc}", file=sys.stderr)
        return 1
    print(f"地质绘图工具已启动：http://{HOST}:{args.port}")
    print("关闭此窗口即可停止服务。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
