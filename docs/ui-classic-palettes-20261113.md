# Classic palette comparison set

This is a visual comparison draft for the Shantu map UI. The color values below are original Shantu adaptations, not official Material, Ant, Apple, or IBM themes. Cream Orange remains the current default. Existing presets and the `shantu.appearance.v1` saved preference shape remain supported.

## What informed the directions

- **Material 3** organizes colors as roles and pairs foreground/background tones for readable surfaces. This informed keeping each palette's accent, page surface, raised control surface, and foreground as separate values: [Material 3 color roles](https://m3.material.io/styles/color/the-color-system/key-colors-tones).
- **Ant Design** builds a family of related colors from a base hue and gives colors distinct product/UI roles. This informed making the five new options recognizable hue families rather than recoloring one neutral scheme: [Ant Design colors](https://ant.design/docs/spec/colors/?locale=en-US).
- **Apple HIG** advises using color consistently and sparingly on glass, and checking contrast where content sits over translucent material. This informed reserving the accent for interaction and keeping text on opaque palette roles: [Apple Color](https://developer.apple.com/design/human-interface-guidelines/color), [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials).
- **IBM Carbon** uses role-based tokens and ordered surface layers. This informed preserving distinct page, button, and field roles across light and dark variants: [Carbon color overview](https://www.carbondesignsystem.com/building-blocks/foundations/color/overview).

## Main comparison set

Values show `accent / background / button / foreground`; contrast is computed by `themeTokens` and checked in `tests/appearance.test.mjs`.

| Preset | Light | Dark | Direction |
| --- | --- | --- | --- |
| 奶油橙 | `#f4a900 / #fffaf1 / #fff0d8 / #49311f` | `#ffc45e / #2b2119 / #493628 / #fff3df` | Existing user-approved warm default; soft cream surfaces with a clear amber action color. |
| 海盐蓝 | `#1769aa / #f5faff / #e5f0fa / #162e46` | `#81c9ff / #142332 / #20394c / #edf7ff` | Cool, open blue with clear foreground separation. |
| 薄荷绿 | `#16856e / #f3fbf7 / #ddf2e8 / #183b32` | `#79d9b6 / #122b26 / #1e4036 / #ecfaf3` | Botanical green, quieter than the map's semantic route colors. |
| 雾紫 | `#7155a5 / #f8f5fc / #ece5f6 / #302746` | `#c2a5ff / #241c32 / #3a2d4d / #f8f2ff` | Soft violet with a cooler, calm surface. |
| 珊瑚 | `#b9443c / #fff6f2 / #ffe4dc / #4a2826` | `#ff9a83 / #311e1c / #4b2d28 / #fff0eb` | Warm coral with earthy dark surfaces. |
| 深琥珀 | `#8f5700 / #fff8e8 / #f4e6c6 / #3f2b17` | `#ffcb66 / #241c13 / #41311f / #fff5e1` | Amber-forward light scheme and a deep, warm night scheme. |

The prior **山兔默认**, **科技深蓝**, **湖蓝**, and **暖沙** choices remain available for continuity. New palettes use the same light/dark structure and color-token derivation; no existing user preference is rewritten. Theme glass surfaces now use 84% theme-background opacity, with the existing 18px blur. Text and input content continue to use their opaque foreground/control roles rather than being faded with the glass layer.

## Review scope

This source-level comparison does not select a winning theme or establish visual acceptance. Review the same real preview scene under each named preset; inspect text, controls, map readability, and both appearance modes before choosing a direction. Existing map/route/data visualization colors remain semantic and independent of these palettes.

## Real preview comparison · 2026-11-13

Captured from the independent Playwright `palette-study` session at `http://127.0.0.1:9174/phone-preview.html`. The outer browser viewport was 900×1000; the actual phone iframe reported 390×857. Each candidate was selected through About → Personalization → Palette, the panels were closed, then the bottom-bar Record panel was opened without starting a recording. The map view and scale remained unchanged. The record console stayed at 0 points / not started; no GPS was supplied or simulated.

For all six captures, the root `--ui-glass-surface` computed to the matching palette surface at alpha `0.84`; the theme background blur remains 18px. Sampled values:

| Preset | Computed glass token |
| --- | --- |
| 奶油橙·浅色 | `rgba(255, 250, 241, 0.84)` |
| 海盐蓝·浅色 | `rgba(245, 250, 255, 0.84)` |
| 薄荷绿·浅色 | `rgba(243, 251, 247, 0.84)` |
| 雾紫·浅色 | `rgba(248, 245, 252, 0.84)` |
| 珊瑚·浅色 | `rgba(255, 246, 242, 0.84)` |
| 深琥珀·深色 | `rgba(36, 28, 19, 0.84)` |

Files: `artifacts/screenshots/ui-palettes-20261113/cream-orange-light.png`, `sea-salt-blue-light.png`, `mint-green-light.png`, `mist-violet-light.png`, `coral-light.png`, and `deep-amber-dark.png`. `index.html` is a local six-card comparison page; click an image to open its original PNG. I visually opened all six source screenshots. The status line's location-estimate wording can change asynchronously; the map imagery, labels, camera scale, and unopened recording state are otherwise the shared scene.

The `palette-sheet` Playwright CLI rejects direct `file:` navigation, while the existing 9174 route falls back to the app shell for files under `artifacts/`. No additional server was started. Therefore the local HTML is available, but no browser-generated `comparison.png` was produced in this pass.
