"""Open an existing unified local geology tool or start it on port 9188."""

from __future__ import annotations

import json
import socket
import threading
import time
import urllib.request
import webbrowser

import server

URL = "http://127.0.0.1:9188/"
STATUS_URL = URL + "api/status"


def _existing_generator() -> bool:
    try:
        with urllib.request.urlopen(STATUS_URL, timeout=1.2) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return payload.get("app") == "geology-generator-v1" and {"section", "drill"}.issubset(payload.get("modes", []))
    except Exception:
        return False


def _port_in_use() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", 9188)) == 0


def _open_after_start() -> None:
    time.sleep(1.0)
    webbrowser.open(URL)


def main() -> int:
    if _existing_generator():
        webbrowser.open(URL)
        print("地质绘图工具已在运行，已打开现有页面。")
        return 0
    if _port_in_use():
        print("端口 9188 已被其他程序占用，且该程序不是统一地质绘图工具。")
        print("请确认端口后再启动。")
        return 1
    threading.Thread(target=_open_after_start, daemon=True).start()
    return server.main()


if __name__ == "__main__":
    raise SystemExit(main())
