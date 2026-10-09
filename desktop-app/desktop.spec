import os
import re
from pathlib import Path

from PyInstaller.utils.hooks import collect_all


APP_DIR = Path(SPEC).resolve().parent
REPO = APP_DIR.parent
INDUSTRY = REPO / "research" / "geology" / "generator-v1"
SHELL = APP_DIR / "shell"
ICON = REPO / ".openai" / "build" / "desktop-app" / "shantu.ico"
ONEFILE = os.environ.get("SHANTU_DESKTOP_ONEFILE") == "1"

required_shell = ("index.html", "shell.js", "shell.css")
required_shell_files = [SHELL / name for name in required_shell]
for path in [*required_shell_files, ICON]:
    if not path.is_file():
        raise FileNotFoundError(f"Required desktop application resource is missing: {path}")

datas = [(str(path), "desktop-shell") for path in required_shell_files]
datas += [
    (str(INDUSTRY / "web" / "index.html"), "web"),
    (str(INDUSTRY / "web" / "vector-viewer.html"), "web"),
    (str(ICON), "."),
]

# These exact four workbooks are the only bundled input data.
for name in (
    "实测剖面-标准模板.xlsx", "实测剖面-填写示例.xlsx",
    "钻孔柱状图-标准模板.xlsx", "钻孔柱状图-填写示例.xlsx",
    "钻孔资料整合模板-v3.xlsx", "钻孔整合模板-300米连续采样模拟.xlsx",
):
    path = INDUSTRY / "outputs" / "standard-input-v2" / name
    if not path.is_file():
        raise FileNotFoundError(f"Required bundled workbook is missing: {path}")
    datas.append((str(path), "outputs/standard-input-v2"))

# Pipeline provenance hashes depend on the exact code and template source files.
for name in (
    "importer.py", "renderer.py", "layer_geometry.py", "readability.py", "pipeline.py",
    "drill_importer.py", "drill_integrated_importer.py", "drill_renderer.py",
    "drill_reference_renderer.py", "drill_pipeline.py",
):
    datas.append((str(INDUSTRY / name), "."))
for name in ("materials.json", "drawing.json", "drill-patterns.json"):
    datas.append((str(INDUSTRY / "templates" / name), "templates"))

webview_datas, webview_binaries, webview_hiddenimports = collect_all("webview")
datas += webview_datas
binaries = webview_binaries
hiddenimports = webview_hiddenimports + [
    "webview.platforms.winforms",
    "webview.platforms.edgechromium",
    "clr",
    "pythonnet",
]

if ONEFILE:
    # The one-file build must carry its complete, private map runtime so it can
    # be copied without the versioned onedir folder beside it. Keep the allowlist
    # narrow: only Node, the bundled server, the map web payload, and its private
    # map configuration are runtime inputs.
    product_source = (REPO / "config" / "product.ts").read_text(encoding="utf-8")
    version_match = re.search(r"APP_VERSION\s*=\s*'([^']+)'", product_source)
    if not version_match:
        raise RuntimeError("APP_VERSION could not be read from config/product.ts")
    release_version = re.sub(r"-test$", "", version_match.group(1))
    default_map_runtime = REPO / "EXE" / f"山兔桌面-{release_version}" / "resources" / "map-runtime"
    map_runtime = Path(os.environ.get("SHANTU_MAP_RUNTIME", str(default_map_runtime))).resolve()
    node_exe = map_runtime / "node.exe"
    map_server = map_runtime / "server.mjs"
    map_web = map_runtime / "web"
    private_config = map_runtime / "config.private.json"
    for required in (node_exe, map_server, map_web / "index.html", private_config):
        if not required.is_file():
            raise FileNotFoundError(f"Required bundled map runtime file is missing: {required}")
    binaries.append((str(node_exe), "map-runtime"))
    datas.append((str(map_server), "map-runtime"))
    datas.append((str(private_config), "map-runtime"))
    for path in map_web.rglob("*"):
        if path.is_file():
            relative_parent = path.relative_to(map_runtime).parent
            datas.append((str(path), str(Path("map-runtime") / relative_parent)))

a = Analysis(
    [str(APP_DIR / "desktop_main.py")],
    pathex=[str(INDUSTRY)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "PyQt5", "PyQt6", "PySide2", "PySide6", "gi", "cefpython3",
        "pytest", "unittest",
    ],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)
if ONEFILE:
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.datas,
        [],
        name="山兔桌面",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        console=False,
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        icon=str(ICON),
    )
else:
    exe = EXE(
        pyz,
        a.scripts,
        [],
        exclude_binaries=True,
        name="山兔桌面",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        console=False,
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        icon=str(ICON),
    )
    coll = COLLECT(
        exe,
        a.binaries,
        a.datas,
        strip=False,
        upx=False,
        upx_exclude=[],
        name="山兔桌面",
    )
