"""Rebuild the verified Eling Lake low-zoom DEM defect from same-source z13.

Entry: python scripts/prepare-terrain-repair.py [--verify-only]
Dependencies: numpy, Pillow. No runtime dependency. Inputs are cached outside Git.
Average decoded elevations, NEVER encoded RGB channels. Preserve all pixels outside
the repair footprint, blend the outer 16 pixels, and propagate only that footprint
into existing parent tiles. No global smoothing or elevation ceiling is applied.
"""
import hashlib
import io
import json
from pathlib import Path
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'outputs/terrain-repair-source'
OUT = ROOT / 'public/terrain/repairs-v1'
BASE = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium'
MAX_ZOOM, MIN_ZOOM = 12, 7
RANGE = (3159, 3161, 1623, 1625)
INPUTS = {}


def decode(payload):
    rgb = np.asarray(Image.open(io.BytesIO(payload)).convert('RGB'), dtype=np.float64)
    if rgb.shape != (256, 256, 3):
        raise ValueError('Unexpected terrain dimensions')
    return rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768


def read(tile):
    z, x, y = tile
    key = f'{z}/{x}/{y}.png'
    path = CACHE / key
    if not path.exists():
        payload = urllib.request.urlopen(f'{BASE}/{key}', timeout=45).read()
        decode(payload)  # Validate before caching.
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
    payload = path.read_bytes()
    INPUTS[key] = hashlib.sha256(payload).hexdigest()
    return decode(payload)


def average(a):
    return a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2).mean(axis=(1, 3))


def write(tile, heights):
    if not np.isfinite(heights).all() or heights.min() < -32768 or heights.max() >= 32768:
        raise ValueError('Invalid DEM values')
    packed = np.rint((heights + 32768) * 256).astype(np.uint32)
    rgb = np.stack([(packed >> 16) & 255, (packed >> 8) & 255, packed & 255], axis=-1).astype('uint8')
    path = OUT / str(tile[0]) / str(tile[1]) / f'{tile[2]}.png'
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb).save(path)
    return decode(path.read_bytes())


def verify():
    manifest = json.loads((OUT / 'coverage.json').read_text())
    source = json.loads((OUT / 'SOURCE.json').read_text())
    count = 0
    for z, tiles in manifest.items():
        for xy in tiles:
            key = f'{z}/{xy}.png'
            payload = (OUT / key).read_bytes()
            assert hashlib.sha256(payload).hexdigest() == source['outputs_sha256'][key], key
            heights = decode(payload)
            assert np.isfinite(heights).all()
            count += 1
    repaired = decode((OUT / '12/3160/1624.png').read_bytes())
    # Both sides of the source's adjacent pit/spike; checks preserve the real lake altitude.
    assert 4250 < repaired[236, 210] < 4310
    assert 4250 < repaired[237, 210] < 4310
    assert 4200 < repaired.min() < repaired.max() < 4500
    assert count == len(source['outputs_sha256'])
    print(json.dumps({'verified_tiles': count, 'known_pit': repaired[236, 210],
                      'known_spike': repaired[237, 210], 'min': repaired.min(), 'max': repaired.max()}))


def build():
    xmin, xmax, ymin, ymax = RANGE
    leaves = [(MAX_ZOOM, x, y) for x in range(xmin, xmax + 1) for y in range(ymin, ymax + 1)]
    children = [(z + 1, x * 2 + dx, y * 2 + dy) for z, x, y in leaves for dx in range(2) for dy in range(2)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(read, children + leaves))
    current = {}
    coverage = {}
    checks = []
    for tile in leaves:
        z, x, y = tile
        original = read(tile)
        finer = np.block([[read((z + 1, x * 2 + dx, y * 2 + dy)) for dx in range(2)] for dy in range(2)])
        rebuilt = average(finer)
        xx = (x - xmin) * 256 + np.arange(256)
        yy = (y - ymin) * 256 + np.arange(256)
        distance = np.minimum(np.minimum(xx, (xmax - xmin + 1) * 256 - 1 - xx)[None, :],
                              np.minimum(yy, (ymax - ymin + 1) * 256 - 1 - yy)[:, None])
        weight = np.clip(distance / 16, 0, 1)
        weight = weight * weight * (3 - 2 * weight)
        corrected = write(tile, original * (1 - weight) + rebuilt * weight)
        current[tile] = (corrected, weight > 0)
        checks.append({'tile': list(tile), 'before_min': float(original.min()), 'before_max': float(original.max()),
                       'after_min': float(corrected.min()), 'after_max': float(corrected.max()),
                       'largest_change_m': float(np.abs(corrected - original).max())})
    for z in range(MAX_ZOOM, MIN_ZOOM - 1, -1):
        coverage[str(z)] = sorted(f'{x}/{y}' for _, x, y in current)
        if z == MIN_ZOOM:
            break
        parents = {}
        for (_, x, y), (heights, mask) in current.items():
            key = (z - 1, x // 2, y // 2)
            if key not in parents:
                parents[key] = (read(key), np.zeros((256, 256), dtype=bool))
            target, target_mask = parents[key]
            rows, cols = slice(y % 2 * 128, y % 2 * 128 + 128), slice(x % 2 * 128, x % 2 * 128 + 128)
            affected = average(mask.astype(float)) > 0
            target[rows, cols][affected] = average(heights)[affected]
            target_mask[rows, cols] |= affected
        current = {key: (write(key, heights), mask) for key, (heights, mask) in parents.items()}
    (OUT / 'coverage.json').write_text(json.dumps(coverage, indent=2) + '\n', encoding='utf-8')
    outputs = {f'{z}/{xy}.png': hashlib.sha256((OUT / f'{z}/{xy}.png').read_bytes()).hexdigest()
               for z, tiles in coverage.items() for xy in tiles}
    (OUT / 'SOURCE.json').write_text(json.dumps({
        'dataset': 'Mapzen / Tilezen Terrarium, Eling Lake low-zoom repair v1',
        'retrieved': '2026-09-07', 'source': BASE + '/{z}/{x}/{y}.png',
        'attribution': 'Mapzen, SRTM and underlying contributors',
        'license_reference': 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
        'processing': 'Decoded z13 elevations area-averaged to z12; 16px perimeter transition. Only covered pixels propagated to z7-11 parents. No invented heights or global clipping.',
        'limits': 'Repair covers reviewed z12 tiles only; does not guarantee all upstream defects are removed. Rebuilt cells remain raster estimates.',
        'inputs_sha256': dict(sorted(INPUTS.items())), 'outputs_sha256': outputs, 'checks': checks,
    }, indent=2) + '\n', encoding='utf-8')
    verify()


if __name__ == '__main__':
    verify() if '--verify-only' in sys.argv else build()
