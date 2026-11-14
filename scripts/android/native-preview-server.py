"""Local-only actual Android screenshots/input; no rendered web map or APK building."""
import argparse
import json
import re
import secrets
import socket
import struct
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--adb', default='adb')
    parser.add_argument('--serial', required=True)
    parser.add_argument('--package', choices=['com.shantu.oldengine', 'com.shantu.hybridprobe'], default='com.shantu.oldengine')
    parser.add_argument('--port', type=int, default=19374)
    parser.add_argument('--helper-port', type=int, default=23458)
    args = parser.parse_args()
    token = secrets.token_urlsafe(32)
    project = Path(__file__).resolve().parents[2]
    capture_lock, input_lock = threading.Lock(), threading.Lock()
    cache = {'png': b'', 'at': 0, 'width': 0, 'height': 0}

    def adb(*command, timeout=15):
        return subprocess.check_output([args.adb, '-s', args.serial, *command], timeout=timeout, stderr=subprocess.DEVNULL)

    def helper(command):
        with socket.create_connection(('127.0.0.1', args.helper_port), timeout=2) as conn:
            conn.settimeout(12)
            conn.sendall((json.dumps(command) + '\n').encode())
            data = conn.makefile('rb').readline(65537)
            if len(data) > 65536:
                raise ValueError('helper response too large')
            return json.loads(data)

    def material(command):
        if args.package != 'com.shantu.oldengine':
            return {'ok': False, 'supported': False, 'error': '隔离验证仅检查实际画面，不连接其它包的调色助手。'}
        try:
            response = helper(command)
            if response.get('supported') is True:
                return response
        except (OSError, ValueError, KeyError):
            pass
        return {'ok': False, 'supported': False, 'error': '当前安装包或测试助手尚无实时调色通道；草稿不会冒充App已生效。'}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def send(self, value, status=200, kind='application/json; charset=utf-8'):
            data = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode()
            try:
                self.send_response(status)
                self.send_header('Content-Type', kind)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except ConnectionError:
                pass

        def do_GET(self):
            path = urlparse(self.path).path
            try:
                if path == '/state':
                    output = adb('shell', 'dumpsys', 'package', args.package).decode(errors='replace')
                    match = re.search(r'versionName=([^\s]+)', output)
                    self.send({'ok': True, 'token': token, 'device': args.serial, 'appPackage': args.package, 'appVersion': match.group(1) if match else '未安装', 'capture': '设备原始PNG · 低频刷新', 'material': material({'action': 'material-read'})})
                elif path == '/baseline':
                    preset = json.loads((project / 'modules/appearance/savedMaterialPreset.json').read_text(encoding='utf-8'))
                    self.send({'schema': 'shantu.material.v1', 'revision': 0, 'tokens': preset['tokens'], 'source': '203已保存配色基线，非设备读回'})
                elif path == '/frame.png':
                    with capture_lock:
                        if time.monotonic() - cache['at'] > 0.8:
                            png = adb('exec-out', 'screencap', '-p')
                            if not png.startswith(b'\x89PNG\r\n\x1a\n'):
                                raise ValueError('invalid screenshot')
                            width, height = struct.unpack('>II', png[16:24])
                            cache.update(png=png, at=time.monotonic(), width=width, height=height)
                        data = cache['png']
                    self.send(data, kind='image/png')
                else:
                    self.send({'ok': False}, 404)
            except (OSError, ValueError, subprocess.SubprocessError):
                self.send({'ok': False, 'error': '设备连接或画面读取失败，请检查模拟器。'}, 503)

        def do_POST(self):
            # Same-origin proxy is expected. A random session token prevents cross-site input.
            origin = self.headers.get('Origin', '')
            if (origin and origin not in ('http://127.0.0.1:9174', 'http://localhost:9174')) or self.headers.get('X-Preview-Token') != token:
                return self.send({'ok': False, 'error': '预览会话已失效'}, 403)
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 32768:
                    raise ValueError('invalid body')
                request = json.loads(self.rfile.read(length))
                path = urlparse(self.path).path
                if path == '/material':
                    if request.get('action') not in ('material-read', 'material-apply', 'material-restore'):
                        raise ValueError('invalid action')
                    return self.send(material(request))
                if path != '/input':
                    return self.send({'ok': False}, 404)
                action = request.get('action')
                if action not in ('tap', 'swipe', 'back', 'launch'):
                    raise ValueError('invalid action')
                def coordinate(name, limit):
                    value = request.get(name)
                    if not isinstance(value, (int, float)) or not 0 <= value < limit:
                        raise ValueError('invalid coordinate')
                    return str(round(value))
                with input_lock:
                    if action == 'launch':
                        adb('shell', 'am', 'start', '-n', args.package + '/com.guanyun.weather.NativeReactActivity')
                    elif action == 'back':
                        adb('shell', 'input', 'keyevent', '4')
                    else:
                        x, y = coordinate('x', cache['width']), coordinate('y', cache['height'])
                        if action == 'tap':
                            adb('shell', 'input', 'tap', x, y)
                        else:
                            x2, y2 = coordinate('x2', cache['width']), coordinate('y2', cache['height'])
                            adb('shell', 'input', 'swipe', x, y, x2, y2, str(max(80, min(1000, int(request.get('duration', 250))))))
                self.send({'ok': True})
            except (OSError, ValueError, TypeError, subprocess.SubprocessError):
                self.send({'ok': False, 'error': '设备操作未完成，请重新检查画面。'}, 400)

    print(f'Native PNG preview ready on 127.0.0.1:{args.port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
