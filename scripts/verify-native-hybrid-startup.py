"""Verify cold startup with the exact APK's shipped web assets and Android native map."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import time
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree
from zipfile import ZipFile

PACKAGE = 'com.shantu.oldengine'
ACTIVITY = PACKAGE + '/com.guanyun.weather.NativeReactActivity'
ASSET_ERROR = re.compile(r'(\b(?:ReferenceError|SyntaxError|TypeError|RangeError):.*?)["\'], source:.*?(/assets/[^ ?)]+)', re.I)
SOURCE_POSITION = re.compile(r'(/assets/[^ :)]+)[ (:]([0-9]+):?([0-9]+)?')


def run(command, timeout=30):
    return subprocess.run(command, capture_output=True, check=True, timeout=timeout).stdout.decode('utf-8', errors='replace')


def wait_boot(adb):
    deadline = time.monotonic() + 360
    while time.monotonic() < deadline:
        try:
            if run(adb + ['shell', 'getprop', 'sys.boot_completed'], timeout=8).strip() == '1':
                return
        except (subprocess.SubprocessError, OSError):
            pass
        time.sleep(2)
    raise RuntimeError('Isolated Android did not complete boot')


def unpack_apk(apk, destination):
    destination.mkdir(parents=True, exist_ok=True)
    js_assets = {}
    with ZipFile(apk) as package:
        for name in package.namelist():
            if not name.startswith('assets/') or name.endswith('/'):
                continue
            path = PurePosixPath(name)
            if '..' in path.parts or '\\' in name:
                raise ValueError('Invalid APK asset path')
            data = package.read(name)
            target = destination.joinpath(*path.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            if name.startswith('assets/assets/') and path.suffix == '.js':
                js_assets[path.name] = data
        if 'assets/index.html' not in package.namelist():
            raise ValueError('APK lacks Android hybrid index.html')
    return js_assets


def boot_failure(log, assets):
    for line in log.splitlines():
        if 'CONSOLE(' not in line:
            continue
        error = ASSET_ERROR.search(line)
        if error:
            name = PurePosixPath(error[2]).name
            match = SOURCE_POSITION.search(line)
            position = [int(match[2]), int(match[3])] if match and match[3] else None
            result = {'error': error[1], 'asset': name, 'position': position}
            if position and name in assets:
                line_number, column = position
                data = assets[name].splitlines()[line_number - 1]
                result['hexByte'] = data[column - 1:column].hex()
            return result
    return None


def inspect_ui(adb):
    run(adb + ['shell', 'uiautomator', 'dump', '/data/local/tmp/shantu-startup-check.xml'], timeout=16)
    raw = run(adb + ['shell', 'cat', '/data/local/tmp/shantu-startup-check.xml'])
    tree = ElementTree.fromstring(raw.strip())
    return [node.attrib for node in tree.iter() if node.get('package') == PACKAGE]


def ui_failure(adb, nodes, assets):
    details = next((node for node in nodes if '兼容信息' in [node.get('text'), node.get('content-desc')]), None)
    if details:
        coords = [int(value) for value in re.findall(r'\d+', details['bounds'])]
        if len(coords) == 4:
            run(adb + ['shell', 'input', 'tap', str((coords[0] + coords[2]) // 2), str((coords[1] + coords[3]) // 2)])
            time.sleep(.5)
            nodes = inspect_ui(adb)
    text = '\n'.join(node.get('text', '') + ' ' + node.get('content-desc', '') for node in nodes)
    diagnostic = re.search(r'(?:ReferenceError|SyntaxError|TypeError|RangeError):[^\r\n"\\]+', text)
    occurrence = re.search(r'/assets/([\w.-]+\.js):(\d+):(\d+)', text)
    result = {'error': diagnostic[0].strip() if diagnostic else 'Native bootstrap failure shown',
              'renderer': 'native' if '"renderer": "native"' in text else None}
    if occurrence:
        name, line, column = occurrence[1], int(occurrence[2]), int(occurrence[3])
        result.update(asset=name, position=[line, column])
        if name in assets:
            result['hexByte'] = assets[name].splitlines()[line - 1][column - 1:column].hex()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('apk', type=Path)
    parser.add_argument('--adb', required=True)
    parser.add_argument('--serial', required=True)
    parser.add_argument('--avd-name', required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--expect', choices=['ready', 'error'], default='ready')
    parser.add_argument('--keep-data', action='store_true', help='Test upgrade over the preinstalled package on this isolated emulator')
    parser.add_argument('--observe-only', action='store_true', help='Read back a previously started APK without restarting it')
    args = parser.parse_args()
    if not args.serial.startswith('emulator-'):
        parser.error('Only an isolated Android SDK emulator is accepted')
    adb = [args.adb, '-s', args.serial]
    avd = run(adb + ['emu', 'avd', 'name']).splitlines()[0]
    if avd != args.avd_name or not avd.startswith('ShantuCold'):
        parser.error('Unexpected emulator instance. No app installed or cleared.')
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    with args.apk.open('rb') as source:
        sha256 = hashlib.file_digest(source, 'sha256').hexdigest()
    # Bundled private configuration always stays in the already ignored workspace area.
    private_assets = Path(__file__).resolve().parents[1] / '.openai' / 'startup-private' / sha256
    assets = unpack_apk(args.apk.resolve(), private_assets)
    report = {'apkSHA256': sha256, 'jsAssets': len(assets), 'activity': ACTIVITY, 'emulator': avd}
    # Legacy Windows platform-tools may misread non-ASCII paths. The install
    # source is a byte-for-byte copy of the exact delivery artifact.
    if not args.observe_only:
        install_apk = private_assets / 'delivery.apk'
        shutil.copyfile(args.apk, install_apk)
        with install_apk.open('rb') as package:
            if hashlib.file_digest(package, 'sha256').hexdigest() != sha256:
                raise RuntimeError('Staged APK differs from delivery')
        wait_boot(adb)
        install = subprocess.run(adb + ['install', '-r', str(install_apk)], timeout=120,
                                 capture_output=True, text=True, errors='replace')
        if install.returncode:
            raise RuntimeError('Installer failed: ' + (install.stdout + install.stderr).strip())
        if not args.keep_data:
            run(adb + ['shell', 'pm', 'clear', PACKAGE])
        run(adb + ['shell', 'am', 'force-stop', PACKAGE])
        run(adb + ['shell', 'input', 'keyevent', '82'])
        report['keptUserData'] = args.keep_data
        run(adb + ['shell', 'am', 'start', '-W', '-n', ACTIVITY], timeout=60)
    else:
        installed = run(adb + ['shell', 'pm', 'path', PACKAGE]).splitlines()[0].removeprefix('package:')
        guest_hash = run(adb + ['shell', 'sha256sum', installed], timeout=35).split()[0]
        if guest_hash != sha256:
            raise RuntimeError('The installed APK differs from the supplied artifact')
        report['installedSHA256'] = guest_hash
        report['observedExistingProcess'] = True
    deadline = time.monotonic() + 85
    while time.monotonic() < deadline:
        surface = run(adb + ['shell', 'dumpsys', 'SurfaceFlinger', '--list'])
        native_surfaces = [line.strip() for line in surface.splitlines()
                           if 'SurfaceView' in line and '(BLAST)' in line and PACKAGE in line]
        foreground = run(adb + ['shell', 'dumpsys', 'activity', 'activities'])
        native_foreground = any(ACTIVITY in line for line in foreground.splitlines() if 'topResumedActivity' in line)
        try:
            nodes = inspect_ui(adb)
        except (subprocess.SubprocessError, ElementTree.ParseError):
            nodes = []
        labels = [value for node in nodes for value in (node.get('text'), node.get('content-desc')) if value]
        if any('地图暂未启动' in label for label in labels):
            report.update(result='error', **ui_failure(adb, nodes, assets))
            break
        if native_surfaces and native_foreground:
            menu = [title for title in ('路线', '工具', '记录') if title in labels]
            report.update(result='ready' if len(menu) == 3 else 'surface-ready',
                          nativeSurfaces=native_surfaces, nativeForeground=True,
                          accessibilityNodes=len(nodes), menu=menu)
            if len(menu) == 3:
                break
        try:
            pid = run(adb + ['shell', 'pidof', PACKAGE]).strip().split()[0]
        except (IndexError, subprocess.SubprocessError):
            report['result'] = 'no-app-process'
            break
        failure = boot_failure(run(adb + ['logcat', '-d', '--pid=' + pid]), assets)
        if failure:
            report.update(result='error', **failure)
            break
        time.sleep(2)
    else:
        report.setdefault('result', 'timeout')

    with (evidence / 'startup.png').open('wb') as output:
        subprocess.run(adb + ['exec-out', 'screencap', '-p'], stdout=output, timeout=20, check=True)
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    (evidence / 'startup.json').write_text(rendered + '\n', encoding='utf-8')
    print(rendered)
    return 0 if report['result'] == args.expect else 1


if __name__ == '__main__':
    raise SystemExit(main())
