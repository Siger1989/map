"""Render a compact visual review sheet for templates/materials.json."""
from __future__ import annotations

import html
import json
import sys
from pathlib import Path

from renderer import _pattern_defs


ROOT = Path(__file__).resolve().parent
MATERIALS = ROOT / "templates" / "materials.json"
DEFAULT_OUTPUT = ROOT / ".verification" / "reference-pattern-evidence" / "materials-contact-sheet.svg"


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def main() -> None:
    output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_OUTPUT
    materials = json.loads(MATERIALS.read_text(encoding="utf-8"))
    defs = _pattern_defs(materials, context="focus")
    items = list(materials["materials"].items())
    columns, cell_w, cell_h = 2, 650, 160
    rows = (len(items) + columns - 1) // columns
    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{columns * cell_w}" height="{rows * cell_h + 65}" viewBox="0 0 {columns * cell_w} {rows * cell_h + 65}">',
        '<style>text{font-family:"Microsoft YaHei",sans-serif;fill:#111}.title{font-size:25px;font-weight:700}.name{font-size:17px;font-weight:700}.meta{font-size:12px;fill:#4b5563}.pending{fill:#8a4b08}</style>',
        f"<defs>{defs}</defs>",
        '<rect width="100%" height="100%" fill="#fff"/>',
        '<text x="28" y="38" class="title">PM01 参考图纹样核对表</text>',
    ]
    for index, (name, spec) in enumerate(items):
        col, row = index % columns, index // columns
        x, y = col * cell_w + 24, row * cell_h + 64
        status = spec["reference_status"]
        border = '#9a5b13' if status == 'unverified' else '#111'
        dash = ' stroke-dasharray="5 4"' if status == 'unverified' else ''
        svg.extend([
            f'<rect x="{x}" y="{y}" width="602" height="128" rx="5" fill="#fff" stroke="#c9ced6"/>',
            f'<rect x="{x + 12}" y="{y + 14}" width="196" height="76" fill="url(#{esc(spec["id"])})" stroke="{border}"{dash}/>',
            f'<text x="{x + 224}" y="{y + 34}" class="name">{esc(name)}</text>',
            f'<text x="{x + 224}" y="{y + 57}" class="meta">{esc("/".join(spec["reference_evidence"]["layer_ids"]))}</text>',
            f'<text x="{x + 224}" y="{y + 79}" class="meta {"pending" if status == "unverified" else ""}">{esc(status)}</text>',
            f'<text x="{x + 12}" y="{y + 112}" class="meta">tile {esc(spec.get("tile_width", materials["tile"]["width"]))}×{esc(spec.get("tile_height", materials["tile"]["height"]))}</text>',
        ])
    svg.append("</svg>")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("".join(svg), encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
