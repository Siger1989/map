"""Build a small, attributed FABDEM terrain tile set for Chengdu.

Downloads only two members using HTTP ranges (not the entire 2.7 GB ZIP).
Requires numpy, Pillow and rasterio. Generated assets contain elevation data,
not an artistic smoothing/flattening of the city. At the outer 5 km only,
blend into the existing Mapzen dataset to avoid a discontinuity.
"""
import io
import json
import math
from pathlib import Path
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image
import rasterio
from rasterio.merge import merge
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'outputs' / 'terrain-source'
OUT = ROOT / 'public' / 'terrain' / 'fabdem-v1-2'
URL = 'https://data.bris.ac.uk/datasets/s5hqmjcdj8yo2ibzi9b4ew3sn/N30E100-N40E110_FABDEM_V1-2.zip'
MEMBERS = ['N30E103_FABDEM_V1-2.tif', 'N30E104_FABDEM_V1-2.tif']
R = 20037508.342789244


class RemoteZip(io.RawIOBase):
    def __init__(self):
        with urllib.request.urlopen(urllib.request.Request(URL, headers={'Range': 'bytes=-22'}), timeout=60) as r:
            if r.status != 206:
                raise RuntimeError('HTTP ranges are required')
            self.size = int(r.headers['Content-Range'].split('/')[-1])
        self.position = 0

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        return self.position

    def tell(self):
        return self.position

    def seekable(self):
        return True

    def read(self, size=-1):
        end = self.size if size < 0 else min(self.size, self.position + size)
        if end <= self.position:
            return b''
        chunks = []
        while self.position < end:
            stop = min(end, self.position + 4 * 1024 * 1024)
            req = urllib.request.Request(URL, headers={'Range': f'bytes={self.position}-{stop - 1}'})
            with urllib.request.urlopen(req, timeout=90) as r:
                if r.status != 206:
                    raise RuntimeError('Invalid range response')
                chunk = r.read()
            if len(chunk) != stop - self.position:
                raise RuntimeError('Incomplete range response')
            chunks.append(chunk)
            self.position = stop
        return b''.join(chunks)


def download(name):
    target = CACHE / name
    if not target.exists():
        with zipfile.ZipFile(RemoteZip()) as archive:
            payload = archive.read(name)  # ZIP CRC is validated before saving.
        target.write_bytes(payload)
    print(f'Source ready: {name}', flush=True)
    return target


def lat_y(lat):
    return R * math.asinh(math.tan(math.radians(lat))) / math.pi


def build():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        paths = list(pool.map(download, MEMBERS))
    datasets = [rasterio.open(p) for p in paths]
    mosaic, transform = merge(datasets)
    for dataset in datasets:
        dataset.close()
    source = mosaic[0]
    bounds = (103, 30, 105, 31)
    extent = (R * 103 / 180, lat_y(30), R * 105 / 180, lat_y(31))
    manifest = {}
    jobs = []
    for z in range(7, 13):
        n = 2 ** z
        xmin = int((103 + 180) / 360 * n)
        xmax = int((105 + 180) / 360 * n)
        ymin = int((1 - extent[3] / R) / 2 * n)
        ymax = int((1 - extent[1] / R) / 2 * n)
        manifest[str(z)] = [xmin, xmax, ymin, ymax]
        jobs.extend((z, x, y) for x in range(xmin, xmax + 1) for y in range(ymin, ymax + 1))

    def tile(job):
        z, x, y = job
        path = OUT / str(z) / str(x) / f'{y}.png'
        if path.exists():
            return
        size = 2 * R / 2 ** z
        west, north = -R + x * size, R - y * size
        dem = np.full((256, 256), -9999, dtype=np.float32)
        reproject(source, dem, src_transform=transform, src_crs='EPSG:4326', src_nodata=-9999,
                  dst_transform=from_bounds(west, north-size, west+size, north, 256, 256),
                  dst_crs='EPSG:3857', dst_nodata=-9999, resampling=Resampling.bilinear)
        xx = west + (np.arange(256) + .5) * size / 256
        yy = north - (np.arange(256) + .5) * size / 256
        distance = np.minimum(np.minimum(xx - extent[0], extent[2] - xx)[None, :],
                              np.minimum(yy - extent[1], extent[3] - yy)[:, None])
        weight = np.clip(distance / 5800, 0, 1)
        weight = weight * weight * (3 - 2 * weight)
        weight[dem == -9999] = 0
        if np.any(weight < 1):
            url = f'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'
            with urllib.request.urlopen(url, timeout=60) as r:
                rgb = np.asarray(Image.open(io.BytesIO(r.read())).convert('RGB'), dtype=np.float64)
            original = rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768
            dem = dem * weight + original * (1 - weight)
        packed = np.round(np.clip(dem + 32768, 0, 65535.996) * 256).astype(np.uint32)
        rgb = np.stack([(packed >> 16) & 255, (packed >> 8) & 255, packed & 255], axis=-1).astype('uint8')
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(rgb).save(path)

    with ThreadPoolExecutor(max_workers=6) as pool:
        for i, _ in enumerate(pool.map(tile, jobs), 1):
            if i % 50 == 0:
                print(f'Terrain tiles: {i}/{len(jobs)}', flush=True)
    (ROOT / 'modules' / 'terrain' / 'ground-coverage.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (OUT / 'SOURCE.json').write_text(json.dumps({
        'dataset': 'FABDEM V1-2', 'source': URL,
        'landing_page': 'https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn',
        'license': 'CC BY-NC-SA 4.0; non-commercial use only',
        'attribution': 'Hawker, L.; Neal, J. (2023), FABDEM V1-2, University of Bristol',
        'members': MEMBERS, 'bounds': bounds, 'maxzoom': 12,
        'processing': 'Bilinear reprojection to Terrarium. Outer 5 km blends into Mapzen SRTM. No city flattening.',
        'tiles': len(jobs)
    }, indent=2) + '\n')
    print(f'Finished {len(jobs)} terrain tiles', flush=True)


if __name__ == '__main__':
    build()
