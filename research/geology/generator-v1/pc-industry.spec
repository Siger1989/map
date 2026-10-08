from pathlib import Path

from PyInstaller.utils.hooks import collect_all


ROOT = Path(SPEC).resolve().parent
REPO = ROOT.parents[2]
ICON = REPO / ".openai" / "build" / "pc-industry" / "shantu.ico"
if not ICON.is_file():
    raise FileNotFoundError(f"Shantu application icon is missing: {ICON}")

datas = [
    (str(ROOT / "web" / "index.html"), "web"),
    (str(ROOT / "web" / "vector-viewer.html"), "web"),
    (str(ROOT / "templates" / "materials.json"), "templates"),
    (str(ROOT / "templates" / "drawing.json"), "templates"),
    (str(ROOT / "templates" / "drill-patterns.json"), "templates"),
    (str(ICON), "."),
]
for name in (
    "实测剖面-标准模板.xlsx", "实测剖面-填写示例.xlsx",
    "钻孔柱状图-标准模板.xlsx", "钻孔柱状图-填写示例.xlsx",
):
    path = ROOT / "outputs" / "standard-input-v2" / name
    if not path.is_file():
        raise FileNotFoundError(f"Required bundled workbook is missing: {path}")
    datas.append((str(path), "outputs/standard-input-v2"))

# Pipelines record the hashes of their shipped source files in each manifest.
for name in (
    "importer.py", "renderer.py", "layer_geometry.py", "readability.py", "pipeline.py",
    "drill_importer.py", "drill_renderer.py", "drill_pipeline.py",
):
    datas.append((str(ROOT / name), "."))

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
    [str(ROOT / "desktop_entry.py")],
    pathex=[str(ROOT)],
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
    a.binaries,
    a.datas,
    [],
    name="山兔地质行业工具",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ICON),
)
