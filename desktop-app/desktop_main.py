"""One-window desktop host for Shantu map and geology tools."""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import http.client
import json
import logging
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from email import policy
from email.parser import BytesParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlsplit

import server as industry_server


APP_TITLE = "山兔桌面"
IS_FROZEN = bool(getattr(sys, "frozen", False))
APP_SOURCE = Path(__file__).resolve().parent
REPO_ROOT = APP_SOURCE.parent
RESOURCE_ROOT = Path(sys._MEIPASS).resolve() if IS_FROZEN else (REPO_ROOT / "research" / "geology" / "generator-v1").resolve()
INSTALL_ROOT = Path(sys.executable).resolve().parent if IS_FROZEN else (REPO_ROOT / "EXE" / "山兔桌面").resolve()
SHELL_ROOT = RESOURCE_ROOT / "desktop-shell" if IS_FROZEN else APP_SOURCE / "shell"
MAP_RUNTIME = INSTALL_ROOT / "resources" / "map-runtime"
ICON_PATH = RESOURCE_ROOT / "shantu.ico" if IS_FROZEN else REPO_ROOT / ".openai" / "build" / "desktop-app" / "shantu.ico"
DEFAULT_PORT = 9190
READY_TIMEOUT_SECONDS = 25
REQUEST_TIMEOUT_SECONDS = 180
HOP_BY_HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade",
}
INDUSTRY_PATHS = {
    "/api/status", "/api/generate", "/template", "/vector-viewer.html",
}
SHELL_FILES = {"index.html", "shell.js", "shell.css", "shantu.ico"}


def _default_data_dir() -> Path:
    documents = Path.home() / "Documents" / "山兔桌面"
    try:
        documents.mkdir(parents=True, exist_ok=True)
        probe = documents / ".write-check"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return documents
    except OSError:
        fallback = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Shantu" / "Desktop"
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def _configure_data(data_dir: Path) -> Path:
    data_dir = data_dir.expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    industry_server.configure_runtime(data_dir / "industry", resource_root=RESOURCE_ROOT)
    import pipeline
    import drill_pipeline

    pipeline.LOG_ROOT = data_dir / "industry" / "logs"
    drill_pipeline.LOG_ROOT = data_dir / "industry" / "logs"
    return data_dir


def _settings_path(data_dir: Path) -> Path:
    return data_dir / "desktop-settings.json"


def _load_port(data_dir: Path, override: int | None) -> int:
    if override is not None:
        if not 0 <= override <= 65535:
            raise ValueError("--port 必须是 0–65535 的整数")
        if override > 0:
            settings_path = _settings_path(data_dir)
            settings_path.write_text(
                json.dumps({"http_port": override}, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        return override
    try:
        value = json.loads(_settings_path(data_dir).read_text(encoding="utf-8")).get("http_port")
        if isinstance(value, int) and 1 <= value <= 65535:
            return value
    except (OSError, ValueError, AttributeError):
        pass
    return DEFAULT_PORT


def _acquire_instance(data_dir: Path) -> tuple[int | None, bool]:
    """Return a Windows mutex handle and whether another instance already owns it."""
    if os.name != "nt":
        return None, False
    key = hashlib.sha256(str(data_dir).casefold().encode("utf-8")).hexdigest()[:24]
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateMutexW.argtypes = (wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR)
    kernel.CreateMutexW.restype = wintypes.HANDLE
    ctypes.set_last_error(0)
    handle = kernel.CreateMutexW(None, False, f"Local\\ShantuDesktop-{key}")
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    return int(handle), ctypes.get_last_error() == 183


def _release_instance(handle: int | None) -> None:
    if handle and os.name == "nt":
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        kernel.CloseHandle.restype = wintypes.BOOL
        kernel.CloseHandle(wintypes.HANDLE(handle))


def _write_ready(path: Path | None, payload: dict) -> None:
    if not path:
        return
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


class NodeRuntime:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.process: subprocess.Popen | None = None
        self.port: int | None = None
        self.url: str | None = None
        self.ready_file = data_dir / "runtime" / "map-ready.json"

    def start(self) -> int:
        node = MAP_RUNTIME / "node.exe"
        script = MAP_RUNTIME / "server.mjs"
        web_root = MAP_RUNTIME / "web"
        if not node.is_file() or not script.is_file() or not (web_root / "index.html").is_file():
            raise FileNotFoundError(f"地图运行资源不完整：{MAP_RUNTIME}")
        self.ready_file.parent.mkdir(parents=True, exist_ok=True)
        self.ready_file.unlink(missing_ok=True)
        logs = self.data_dir / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        stdout_path = logs / "map-node.stdout.log"
        stderr_path = logs / "map-node.stderr.log"
        self._stdout = stdout_path.open("ab")
        self._stderr = stderr_path.open("ab")
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        startupinfo = None
        if os.name == "nt":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = 0
        self.process = subprocess.Popen(
            [str(node), str(script), "--port", "0", "--ready-file", str(self.ready_file), "--web-root", str(web_root)],
            cwd=str(MAP_RUNTIME), stdin=subprocess.DEVNULL, stdout=self._stdout,
            stderr=self._stderr, creationflags=creation_flags, startupinfo=startupinfo,
        )
        deadline = time.monotonic() + READY_TIMEOUT_SECONDS
        last_error = "尚未写入就绪文件"
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(f"地图服务提前退出（code={self.process.returncode}），详见 {stderr_path}")
            try:
                payload = json.loads(self.ready_file.read_text(encoding="utf-8"))
                if payload.get("app") != "shantu-desktop-map":
                    raise ValueError("app标识不匹配")
                self.port = int(payload["port"])
                parsed = urlsplit(str(payload["url"]))
                if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"} or parsed.port != self.port:
                    raise ValueError("ready url 必须是对应端口的本机 HTTP 地址")
                self.url = f"http://127.0.0.1:{self.port}"
                status = _fetch_json(self.url + "/__shantu__/status", timeout=3)
                if status.get("app") != "shantu-desktop-web":
                    raise ValueError("地图服务健康检查失败")
                return self.port
            except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, urllib.error.URLError) as exc:
                last_error = str(exc)
            time.sleep(0.1)
        raise TimeoutError(f"地图服务启动等待超时：{last_error}；详见 {stderr_path}")

    def stop(self) -> None:
        process = self.process
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        self.process = None
        for name in ("_stdout", "_stderr"):
            stream = getattr(self, name, None)
            if stream:
                try:
                    stream.close()
                except OSError:
                    pass
                setattr(self, name, None)

    @property
    def pid(self) -> int | None:
        return self.process.pid if self.process else None


def _fetch_json(url: str, *, timeout: float = 5) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


class DesktopHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    request_queue_size = 128

    def __init__(self, address: tuple[str, int], handler, *, map_port: int):
        self.map_port = map_port
        super().__init__(address, handler)


class DesktopHandler(industry_server.Handler):
    server: DesktopHTTPServer
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        # Keep the loopback access log in the user's writable data directory.
        import logging
        logging.info("%s %s", self.address_string(), fmt % args)

    def parse_request(self) -> bool:
        if not super().parse_request():
            return False
        port = self.server.server_address[1]
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if (self.headers.get("Host") or "").lower() not in allowed_hosts:
            self.send_error(HTTPStatus.FORBIDDEN)
            return False
        return True

    def _same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urlsplit(origin)
        return parsed.scheme == "http" and parsed.netloc.lower() == (self.headers.get("Host") or "").lower()

    def _send_shell_file(self, name: str, *, head_only: bool = False) -> None:
        if name not in SHELL_FILES:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        path = (SHELL_ROOT / name).resolve()
        if SHELL_ROOT.resolve() not in path.parents or not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in {"application/javascript", "application/json"}:
            content_type += "; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(path.stat().st_size))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if not head_only:
            with path.open("rb") as stream:
                shutil.copyfileobj(stream, self.wfile, length=64 * 1024)

    def _is_industry(self, path: str) -> bool:
        return path in INDUSTRY_PATHS or path.startswith("/generated/")

    def _proxy_map(self, *, head_only: bool = False) -> None:
        port = self.server.map_port
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=REQUEST_TIMEOUT_SECONDS)
        path = self.path
        if path == "/map":
            path = "/"
        elif path.startswith("/map/"):
            path = path[len("/map"):]
        headers = []
        for key, value in self.headers.items():
            if key.lower() in HOP_BY_HOP_HEADERS or key.lower() == "host":
                continue
            headers.append((key, value))
        headers.append(("Host", f"127.0.0.1:{port}"))
        response_started = False
        try:
            connection.putrequest(self.command, path, skip_host=True, skip_accept_encoding=True)
            for key, value in headers:
                connection.putheader(key, value)
            connection.putheader("Connection", "close")
            if not self.headers.get("Content-Length") and self.headers.get("Transfer-Encoding"):
                self.send_error(HTTPStatus.LENGTH_REQUIRED)
                return
            connection.endheaders()
            remaining = int(self.headers.get("Content-Length", "0") or "0")
            while remaining:
                chunk = self.rfile.read(min(64 * 1024, remaining))
                if not chunk:
                    raise ConnectionError("客户端上传在Content-Length之前中断")
                connection.send(chunk)
                remaining -= len(chunk)
            response = connection.getresponse()
            self.send_response(response.status, response.reason)
            for key, value in response.getheaders():
                if key.lower() in HOP_BY_HOP_HEADERS or key.lower() == "server":
                    continue
                self.send_header(key, value)
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            response_started = True
            if not head_only:
                while chunk := response.read(64 * 1024):
                    self.wfile.write(chunk)
        except (OSError, http.client.HTTPException, ConnectionError) as exc:
            if response_started:
                self.close_connection = True
            else:
                self.send_error(HTTPStatus.BAD_GATEWAY, f"地图服务不可用：{type(exc).__name__}")
        finally:
            connection.close()

    def _dispatch_industry(self, method: str, *, head_only: bool = False) -> None:
        original_command, original_path = self.command, self.path
        self.command = method
        # The archive's Handler intentionally exposes its industry endpoints at root paths.
        if self.path.startswith("/industry/"):
            self.path = self.path[len("/industry"):]
        try:
            if method == "GET":
                industry_server.Handler.do_GET(self)
            elif method == "POST":
                industry_server.Handler.do_POST(self)
            else:
                self._head_industry()
        finally:
            self.command, self.path = original_command, original_path

    def _head_industry(self) -> None:
        path = self.path.split("?", 1)[0]
        download_name = None
        if path in {"/", "/index.html", "/vector-viewer.html"}:
            candidate = industry_server.WEB_ROOT / ("index.html" if path in {"/", "/index.html"} else "vector-viewer.html")
        elif path == "/template":
            from urllib.parse import parse_qs
            query = parse_qs(urlsplit(self.path).query)
            kind = (query.get("type") or ["section"])[0]
            example = (query.get("example") or ["0"])[0]
            if kind not in industry_server.DRAWING_TYPES or example not in {"0", "1"}:
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            candidate = industry_server.TEMPLATE_ROOT / industry_server.TEMPLATE_FILES[(kind, example == "1")]
            download_name = candidate.name
        elif path.startswith("/generated/"):
            relative = path[len("/generated/"):].split("/")
            if len(relative) != 2 or relative[1] not in industry_server.GENERATED_FILE_LABELS or not re.fullmatch(r"[A-Za-z0-9_-]+", relative[0]):
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            root = industry_server.GENERATED_ROOT.resolve()
            candidate = (industry_server.GENERATED_ROOT / relative[0] / relative[1]).resolve()
            if root not in candidate.parents:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
        else:
            # Reuse the exact JSON/status semantics and suppress only the HEAD body.
            self._head_only = True
            try:
                industry_server.Handler.do_GET(self)
            finally:
                self._head_only = False
            return
        if not candidate.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type + ("; charset=utf-8" if content_type.startswith("text/") else ""))
        self.send_header("Content-Length", str(candidate.stat().st_size))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        if download_name:
            ascii_name = re.sub(r"[^A-Za-z0-9._-]", "_", download_name)
            self.send_header("Content-Disposition", f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(download_name)}")
        self.end_headers()

    def _json(self, status: int, payload: dict) -> None:
        if not getattr(self, "_head_only", False):
            return industry_server.Handler._json(self, status, payload)
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path in {"/", "/desktop/", "/desktop/index.html"}:
            self._send_shell_file("index.html")
        elif path in {"/desktop/shell.js", "/desktop/shell.css", "/desktop/shantu.ico"}:
            self._send_shell_file(path.rsplit("/", 1)[-1])
        elif path == "/industry/":
            self._dispatch_industry("GET", head_only=False)
        elif self._is_industry(path):
            self._dispatch_industry("GET")
        elif path.startswith("/map/"):
            self._proxy_map()
        else:
            self._proxy_map()

    def do_HEAD(self) -> None:
        path = urlsplit(self.path).path
        if path in {"/", "/desktop/", "/desktop/index.html"}:
            self._send_shell_file("index.html", head_only=True)
        elif path in {"/desktop/shell.js", "/desktop/shell.css", "/desktop/shantu.ico"}:
            self._send_shell_file(path.rsplit("/", 1)[-1], head_only=True)
        elif path == "/industry/":
            original = self.path
            self.path = "/"
            try:
                self._dispatch_industry("HEAD", head_only=True)
            finally:
                self.path = original
        elif self._is_industry(path):
            self._dispatch_industry("HEAD", head_only=True)
        else:
            self._proxy_map(head_only=True)

    def do_POST(self) -> None:
        if not self._same_origin():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        path = urlsplit(self.path).path
        if path in {"/api/generate", "/industry/api/generate"}:
            self._dispatch_industry("POST")
        else:
            self._proxy_map()

    def do_PUT(self) -> None:
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def do_DELETE(self) -> None:
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def do_OPTIONS(self) -> None:
        self._proxy_map()


def _start_http_server(port: int, map_port: int) -> tuple[DesktopHTTPServer, threading.Thread, str]:
    try:
        httpd = DesktopHTTPServer(("127.0.0.1", port), DesktopHandler, map_port=map_port)
    except OSError as exc:
        if getattr(exc, "winerror", None) == 10048 or exc.errno in {48, 98, 10048}:
            raise RuntimeError(f"桌面应用端口 127.0.0.1:{port} 已被占用。为保留此端口对应的地图存档，请关闭占用程序或用 --port 指定新端口。") from exc
        raise
    thread = threading.Thread(target=httpd.serve_forever, name="shantu-desktop-http", daemon=True)
    thread.start()
    return httpd, thread, f"http://127.0.0.1:{httpd.server_address[1]}/"


def _probe_local(url: str, *, expected: set[int] | None = None,
                 method: str = "GET", timeout: float = 8) -> tuple[int, bytes]:
    request = urllib.request.Request(url, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status, body = response.status, response.read(4 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        status, body = exc.code, exc.read(4 * 1024 * 1024 + 1)
    if expected is not None and status not in expected:
        raise RuntimeError(f"检查 {url} 返回 HTTP {status}，期望 {sorted(expected)}")
    return status, body


def _self_test(data_dir: Path, node: NodeRuntime) -> dict:
    import pipeline
    from drill_pipeline import run_drill_pipeline

    report: dict = {"ok": False, "app": APP_TITLE, "python": sys.version.split()[0],
                    "data_root": str(data_dir), "checks": {}}
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    outputs = data_dir / "self-test" / timestamp
    checks = report["checks"]
    status = _fetch_json(str(node.url) + "/__shantu__/status", timeout=5)
    if status.get("app") != "shantu-desktop-web":
        raise RuntimeError("Node地图服务健康状态不匹配")
    checks["node"] = {"ok": True, "status": status, "port": node.port, "pid": node.pid}

    httpd, thread, base_url = _start_http_server(0, int(node.port))
    try:
        shell_status, shell = _probe_local(base_url, expected={200})
        shell_js_status, shell_js = _probe_local(base_url + "desktop/shell.js", expected={200})
        map_status, map_html = _probe_local(base_url + "map/", expected={200})
        industry_status, industry_html = _probe_local(base_url + "industry/", expected={200})
        shell_head_status, shell_head = _probe_local(base_url, expected={200}, method="HEAD")
        map_head_status, map_head = _probe_local(base_url + "map/", expected={200}, method="HEAD")
        template_head_status, template_head = _probe_local(base_url + "template?type=section&example=1",
                                                           expected={200}, method="HEAD")
        if b"/map/" not in shell or b"industry-frame" not in shell or b"/industry/" not in shell_js:
            raise RuntimeError("桌面shell HTML/JS未正确配置地图与行业入口")
        if b"<!doctype html" not in map_html[:1024].lower():
            raise RuntimeError("地图首页内容无效")
        if b"<!doctype html" not in industry_html[:1024].lower():
            raise RuntimeError("行业首页内容无效")
        templates = _fetch_json(base_url + "api/status", timeout=10).get("templates", {})
        if len(templates) != 4 or not all(templates.values()):
            raise RuntimeError(f"行业模板缺失：{templates}")
        terrain_status, terrain_body = _probe_local(base_url + "api/terrain/x/0/0.png", expected={400})
        if b"Invalid terrain tile" not in terrain_body:
            raise RuntimeError("地图terrain API返回内容不符合预期")
        if shell_head or map_head or template_head:
            raise RuntimeError("HEAD响应意外包含响应体")
        checks["front_door"] = {"ok": True, "shell_http": shell_status, "map_http": map_status,
                                 "industry_http": industry_status, "terrain_api_http": terrain_status,
                                 "head": {"shell": shell_head_status, "map": map_head_status,
                                          "template": template_head_status, "empty_bodies": True},
                                 "templates": templates, "url": base_url}
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=3)

    examples = {
        "section": industry_server.TEMPLATE_ROOT / industry_server.TEMPLATE_FILES[("section", True)],
        "drill": industry_server.TEMPLATE_ROOT / industry_server.TEMPLATE_FILES[("drill", True)],
    }
    for kind, source in examples.items():
        if not source.is_file():
            raise FileNotFoundError(f"缺少内置填写示例：{source.name}")
        destination = outputs / kind
        result = pipeline.run_pipeline(source, destination) if kind == "section" else run_drill_pipeline(source, destination)
        svg, png = destination / "drawing.svg", destination / "preview.png"
        if not svg.is_file() or "<svg" not in svg.read_text(encoding="utf-8")[:2048]:
            raise RuntimeError(f"{kind} SVG导出校验失败")
        if not png.is_file() or png.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
            raise RuntimeError(f"{kind} PNG导出校验失败")
        checks[kind] = {"imported": True, "svg": {"path": str(svg), "bytes": svg.stat().st_size},
                        "png": {"path": str(png), "bytes": png.stat().st_size},
                        "summary": result.get("summary", {})}
    report["ok"] = True
    report["outputs"] = str(outputs)
    report["report"] = str(data_dir / "self-test-report.json")
    report_path = data_dir / "self-test-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


class FullscreenBridge:
    def __init__(self, window):
        self.window = window
        self._fullscreen = False
        self._lock = threading.Lock()

    def toggle_fullscreen(self) -> dict:
        with self._lock:
            self.window.toggle_fullscreen()
            self._fullscreen = not self._fullscreen
            return {"fullscreen": self._fullscreen}

    def exit_fullscreen(self) -> dict:
        with self._lock:
            if self._fullscreen:
                self.window.toggle_fullscreen()
                self._fullscreen = False
            return {"fullscreen": self._fullscreen}

    def get_window_state(self) -> dict:
        state = getattr(self.window, "state", {})
        return {"fullscreen": self._fullscreen, "maximized": bool(getattr(state, "maximized", False))}


def _show_window(url: str, data_dir: Path, icon: Path) -> None:
    import webview

    webview.settings["ALLOW_DOWNLOADS"] = True
    storage_path = data_dir / "webview"
    storage_path.mkdir(parents=True, exist_ok=True)
    window = webview.create_window(APP_TITLE, url, width=1280, height=860, min_size=(900, 620),
                                   resizable=True, js_api=None)
    bridge = FullscreenBridge(window)
    window.expose(bridge.toggle_fullscreen, bridge.exit_fullscreen, bridge.get_window_state)
    try:
        webview.start(gui="edgechromium", debug=False, private_mode=False,
                      storage_path=str(storage_path), icon=str(icon))
    except Exception as exc:
        raise RuntimeError(
            "pywebview 的 Edge/WebView2 窗口无法启动。请安装或修复 Microsoft Edge WebView2 Runtime。"
        ) from exc


def _message(text: str, *, error: bool = False) -> None:
    if os.name == "nt":
        ctypes.windll.user32.MessageBoxW(None, text, APP_TITLE, 0x10 if error else 0x40)
    else:
        print(text, file=sys.stderr if error else sys.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description=APP_TITLE)
    parser.add_argument("--data-dir", type=Path, help="指定用户数据目录")
    parser.add_argument("--port", type=int, help="本地统一服务端口；0仅供临时验收")
    parser.add_argument("--self-test", action="store_true", help="检查Node地图服务、统一网关、模板导入与SVG/PNG生成")
    parser.add_argument("--serve", action="store_true", help="隐藏GUI启动统一loopback服务，供本机浏览器验收")
    parser.add_argument("--ready-file", type=Path, help="启动完成后写入URL和进程信息JSON")
    args = parser.parse_args()
    data_dir = _configure_data(args.data_dir or _default_data_dir())
    (data_dir / "logs").mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=data_dir / "logs" / "desktop.log", level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", encoding="utf-8")
    mutex_handle, already_running = _acquire_instance(data_dir)
    if already_running:
        _release_instance(mutex_handle)
        _message("山兔桌面已在运行；请使用现有窗口，未启动第二个后台服务。", error=True)
        return 2
    node = NodeRuntime(data_dir)
    httpd = None
    thread = None
    try:
        map_port = node.start()
        if args.self_test:
            _self_test(data_dir, node)
            return 0
        port = _load_port(data_dir, args.port)
        httpd, thread, url = _start_http_server(port, map_port)
        _write_ready(args.ready_file, {"url": url, "port": httpd.server_address[1],
                                       "pid": os.getpid(), "data_dir": str(data_dir),
                                       "map_port": map_port, "map_pid": node.pid,
                                       "mode": "serve" if args.serve else "webview"})
        if args.serve:
            while True:
                time.sleep(1)
        _show_window(url, data_dir, ICON_PATH)
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"
        error_file = data_dir / "logs" / "desktop-startup-error.txt"
        error_file.parent.mkdir(parents=True, exist_ok=True)
        error_file.write_text(message + "\n", encoding="utf-8")
        if not args.serve and not args.self_test:
            _message(f"山兔桌面启动失败：\n{message}", error=True)
        return 1
    finally:
        if httpd is not None:
            httpd.shutdown()
            httpd.server_close()
        if thread is not None:
            thread.join(timeout=3)
        node.stop()
        _release_instance(mutex_handle)


if __name__ == "__main__":
    raise SystemExit(main())
