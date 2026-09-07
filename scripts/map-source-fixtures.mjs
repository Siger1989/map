import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { writeArrayBuffer } from 'geotiff';
import { zlibSync } from 'fflate';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const header = Buffer.from(type),
    result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length);
  header.copy(result, 4);
  Buffer.from(bytes).copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}
export function mapTile() {
  const size = 256,
    header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const scan = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      scan[i] = x < 128 ? 245 : 30;
      scan[i + 1] = y < 128 ? 205 : 90;
      scan[i + 2] = 90;
      scan[i + 3] = 255;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(scan)),
    chunk('IEND', new Uint8Array()),
  ]);
}
export async function makeFixtures(
  directory = 'artifacts/map-source-fixtures',
) {
  await mkdir(directory, { recursive: true });
  const SQL = await initSqlJs(),
    db = new SQL.Database();
  db.run(
    'CREATE TABLE metadata(name TEXT,value TEXT); CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB); CREATE UNIQUE INDEX tile_index ON tiles(zoom_level,tile_column,tile_row)',
  );
  db.run(
    "INSERT INTO metadata VALUES('name','离线测试地图'),('format','png'),('bounds','90,0,180,66.5132604431')",
  );
  db.run('INSERT INTO tiles VALUES(?,?,?,?)', [2, 3, 2, mapTile()]);
  await writeFile(`${directory}/test.mbtiles`, db.export());
  db.close();
  const width = 32,
    height = 32,
    pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      pixels[i] = x < 16 ? 255 : 20;
      pixels[i + 1] = y < 16 ? 220 : 80;
      pixels[i + 2] = 100;
    }
  const tiff = writeArrayBuffer(pixels, {
    width,
    height,
    BitsPerSample: [8, 8, 8],
    SamplesPerPixel: 3,
    PhotometricInterpretation: 2,
    ModelPixelScale: [0.025, 0.025, 0],
    ModelTiepoint: [0, 0, 0, 103, 31, 0],
    GeographicTypeGeoKey: 4326,
    GTModelTypeGeoKey: 2,
    GTRasterTypeGeoKey: 1,
  });
  await writeFile(`${directory}/test.tif`, new Uint8Array(tiff));
  await writeFile(`${directory}/tile.png`, mapTile());
  return directory;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(await makeFixtures());
