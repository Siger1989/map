from pathlib import Path

from PyInstaller.utils.hooks import collect_all


APP_DIR = Path(SPEC).resolve().parent
REPO = APP_DIR.parent
INDUSTRY = REPO / "research" / "geology" / "generator-v1"
SHELL = APP_DIR / "shell"
ICON = REPO / ".openai" / "build" / "desktop-app" / "shantu.ico"

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
):
    path = INDUSTRY / "outputs" / "standard-input-v2" / name
    if not path.is_file():
        raise FileNotFoundError(f"Required bundled workbook is missing: {path}")
    datas.append((str(path), "outputs/standard-input-v2"))

# Pipeline provenance hashes depend on the exact code and template source files.
for name in (
    "importer.py", "renderer.py", "layer_geometry.py", "readability.py", "pipeline.py",
    "drill_importer.py", "drill_renderer.py", "drill_pipeline.py",
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
