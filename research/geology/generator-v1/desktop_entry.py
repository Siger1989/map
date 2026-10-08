"""Standalone Windows desktop entry point for geology-generator-v1."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import server


APP_TITLE = "山兔地质行业工具"
RESOURCE_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)).resolve()


def _default_data_dir() -> Path:
    documents = Path.home() / "Documents" / "山兔行业工具"
    try:
        documents.mkdir(parents=True, exist_ok=True)
        probe = documents / ".write-check"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return documents
    except OSError:
        local = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Shantu" / "GeologyGenerator"
        local.mkdir(parents=True, exist_ok=True)
        return local


def _configure_data(data_dir: Path) -> Path:
    data_dir = data_dir.expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    server.configure_runtime(data_dir, resource_root=RESOURCE_ROOT)
    import pipeline
    import drill_pipeline

    pipeline.LOG_ROOT = data_dir / "logs"
    drill_pipeline.LOG_ROOT = data_dir / "logs"
    return data_dir


def _start_server() -> tuple[server.ThreadingHTTPServer, threading.Thread, str]:
    server._setup_logging()
    httpd = server.ThreadingHTTPServer((server.HOST, 0), server.Handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, name="geology-http", daemon=True)
    thread.start()
    return httpd, thread, f"http://{server.HOST}:{port}/"


def _smoke(data_dir: Path) -> dict:
    """Exercise both packaged workbook import paths and verify SVG/PNG files."""
    import pipeline
    from drill_pipeline import run_drill_pipeline

    examples = {
        "section": server.TEMPLATE_ROOT / server.TEMPLATE_FILES[("section", True)],
        "drill": server.TEMPLATE_ROOT / server.TEMPLATE_FILES[("drill", True)],
    }
    report: dict[str, object] = {
        "ok": False,
        "python": sys.version.split()[0],
        "resource_root": str(RESOURCE_ROOT),
        "data_root": str(data_dir),
        "checks": {},
    }
    stamp = time.strftime("%Y%m%d-%H%M%S")
    outputs = data_dir / "self-test" / stamp
    checks: dict[str, object] = {}
    report["checks"] = checks
    for kind, source in examples.items():
        if not source.is_file():
            raise FileNotFoundError(f"缺少内置填写示例：{source.name}")
        destination = outputs / kind
        if kind == "section":
            result = pipeline.run_pipeline(source, destination)
        else:
            result = run_drill_pipeline(source, destination)
        svg = destination / "drawing.svg"
        png = destination / "preview.png"
        if not svg.is_file() or "<svg" not in svg.read_text(encoding="utf-8")[:2048]:
            raise RuntimeError(f"{kind} SVG 导出校验失败")
        if not png.is_file() or png.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
            raise RuntimeError(f"{kind} PNG 导出校验失败")
        checks[kind] = {
            "imported": True,
            "svg": {"path": str(svg), "bytes": svg.stat().st_size},
            "png": {"path": str(png), "bytes": png.stat().st_size},
            "summary": result.get("summary", {}),
        }
    report["ok"] = True
    report["outputs"] = str(outputs)
    report_path = data_dir / "self-test-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report["report"] = str(report_path)
    return report


def _message(text: str, *, error: bool = False) -> None:
    import ctypes

    ctypes.windll.user32.MessageBoxW(None, text, APP_TITLE, 0x10 if error else 0x40)


def _edge_browser() -> Path | None:
    candidates = [
        shutil.which("msedge"), shutil.which("msedge.exe"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    return next((Path(p) for p in candidates if p and Path(p).is_file()), None)


def _run_browser_app(url: str, data_dir: Path) -> None:
    browser = _edge_browser()
    if not browser:
        raise RuntimeError("需要安装 Microsoft WebView2 Runtime，或安装 Microsoft Edge/Google Chrome 后再启动。")
    profile = Path(tempfile.mkdtemp(prefix="shantu-geology-webview-"))
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        process = subprocess.Popen(
            [str(browser), f"--app={url}", f"--user-data-dir={profile}", "--no-first-run"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
        )
        process.wait()
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def _show_window(url: str, data_dir: Path) -> None:
    try:
        import webview

        webview.settings["ALLOW_DOWNLOADS"] = True
        window = webview.create_window(APP_TITLE, url, width=1280, height=860, min_size=(900, 620))
        webview.start(debug=False, icon=str(RESOURCE_ROOT / "shantu.ico"))
    except Exception as exc:
        _message(f"独立窗口无法启动，将切换到桌面浏览器窗口。\n\n{exc}")
        _run_browser_app(url, data_dir)


def main() -> int:
    parser = argparse.ArgumentParser(description=APP_TITLE)
    parser.add_argument("--data-dir", type=Path, help="指定生成成果、上传副本和日志目录")
    parser.add_argument("--smoke", "--self-test", action="store_true", dest="smoke",
                        help="运行两种内置工作簿导入及 SVG/PNG 导出检查")
    parser.add_argument("--serve", action="store_true", help="仅启动本机服务，供浏览器检查")
    parser.add_argument("--ready-file", type=Path, help="启动服务后写入含URL的JSON就绪文件")
    args = parser.parse_args()
    try:
        data_dir = _configure_data(args.data_dir or _default_data_dir())
        if args.smoke:
            try:
                _smoke(data_dir)
                return 0
            except Exception as exc:
                failure = {"ok": False, "error": f"{type(exc).__name__}: {exc}",
                           "data_root": str(data_dir)}
                (data_dir / "self-test-report.json").write_text(
                    json.dumps(failure, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                return 1
        httpd, thread, url = _start_server()
        try:
            if args.serve:
                if args.ready_file:
                    args.ready_file.parent.mkdir(parents=True, exist_ok=True)
                    args.ready_file.write_text(json.dumps({"url": url, "pid": os.getpid(),
                                                           "data_dir": str(data_dir)}, ensure_ascii=False),
                                               encoding="utf-8")
                else:
                    _message(f"行业工具已启动：\n{url}")
                while True:
                    time.sleep(1)
            if args.ready_file:
                args.ready_file.parent.mkdir(parents=True, exist_ok=True)
                args.ready_file.write_text(json.dumps({"url": url, "pid": os.getpid(),
                                                       "data_dir": str(data_dir), "mode": "webview"},
                                                       ensure_ascii=False), encoding="utf-8")
            _show_window(url, data_dir)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=3)
        return 0
    except Exception as exc:
        _message(f"行业工具启动或检查失败：\n{type(exc).__name__}: {exc}", error=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
