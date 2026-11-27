import { raiseTerrainTracks, type TerrainPrintTracks } from './trackRelief.ts';

export { normalizeTerrainTrackColor, terrainTrackPalette, type TerrainPrintTracks } from './trackRelief.ts';

/** Regular elevation grid. Samples are row-major from north-west to south-east. */
export type TerrainPrintGrid = {
  width: number;
  height: number;
  eastWestMeters: number;
  northSouthMeters: number;
  sampleSpacingMeters?: number;
  elevations: (number | null)[];
};

type TerrainPrintOptions = {
  shape: 'rectangle' | 'circle';
  widthMm: number;
  baseMm: number;
  rimMm: number;
};

const MAX_GRID_SAMPLES = 250_000;
const MIN_CIRCLE_GRID_SIDE = 17;
const MIN_SIZE_MM = 0.1;
const MAX_SIZE_MM = 2000;
const MISSING_ELEVATION = '所选范围有高程数据缺口，请缩小或更换范围。';

function circleGridSide(side: number): number {
  // An odd number puts a vertex at each cardinal point, keeping the stated diameter.
  return Math.max(MIN_CIRCLE_GRID_SIDE, side + (side % 2 === 0 ? 1 : 0));
}

function validElevation(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateGrid(grid: TerrainPrintGrid, circleRadius: number | null): void {
  for (let row = 0; row < grid.height; row++) {
    const north = (0.5 - row / (grid.height - 1)) * grid.northSouthMeters;
    for (let col = 0; col < grid.width; col++) {
      const east = (col / (grid.width - 1) - 0.5) * grid.eastWestMeters;
      if (circleRadius !== null && Math.hypot(east, north) > circleRadius + 1e-7) continue;
      if (!validElevation(grid.elevations[row * grid.width + col])) {
        throw new Error(MISSING_ELEVATION);
      }
    }
  }
}

/** Bilinear interpolation ignores only missing samples outside the validated circle. */
function sampleElevation(grid: TerrainPrintGrid, east: number, north: number): number {
  const x = Math.max(0, Math.min(grid.width - 1, (0.5 + east / grid.eastWestMeters) * (grid.width - 1)));
  const y = Math.max(0, Math.min(grid.height - 1, (0.5 - north / grid.northSouthMeters) * (grid.height - 1)));
  const col = Math.min(grid.width - 2, Math.floor(x));
  const row = Math.min(grid.height - 2, Math.floor(y));
  let weightedElevation = 0;
  let totalWeight = 0;
  for (let dy = 0; dy <= 1; dy++) {
    const wy = dy === 0 ? row + 1 - y : y - row;
    for (let dx = 0; dx <= 1; dx++) {
      const wx = dx === 0 ? col + 1 - x : x - col;
      const elevation = grid.elevations[(row + dy) * grid.width + col + dx];
      if (!validElevation(elevation)) continue;
      weightedElevation += elevation * wx * wy;
      totalWeight += wx * wy;
    }
  }
  if (totalWeight === 0) throw new Error(MISSING_ELEVATION);
  return weightedElevation / totalWeight;
}

/** Boundary indices in counterclockwise order as seen from above. */
function perimeterIndices(width: number, height: number): number[] {
  const perimeter: number[] = [];
  const south = (height - 1) * width;
  for (let col = 0; col < width - 1; col++) perimeter.push(south + col);
  for (let row = height - 1; row > 0; row--) perimeter.push(row * width + width - 1);
  for (let col = width - 1; col > 0; col--) perimeter.push(col);
  for (let row = 0; row < height - 1; row++) perimeter.push(row * width);
  return perimeter;
}

/** Export a closed binary STL in millimetres, with identical horizontal and vertical scales. */
export function terrainPrintStl(
  grid: TerrainPrintGrid, options: TerrainPrintOptions, tracks?: TerrainPrintTracks, trackColors?: readonly string[],
): ArrayBuffer {
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) ||
      grid.width < 2 || grid.height < 2 || grid.width * grid.height > MAX_GRID_SAMPLES ||
      grid.elevations.length !== grid.width * grid.height ||
      !Number.isFinite(grid.eastWestMeters) || grid.eastWestMeters <= 0 ||
      !Number.isFinite(grid.northSouthMeters) || grid.northSouthMeters <= 0) {
    throw new Error('高程网格尺寸无效，或范围过大。');
  }
  const { shape, widthMm, baseMm, rimMm } = options;
  if ((shape !== 'rectangle' && shape !== 'circle') ||
      ![widthMm, baseMm, rimMm].every(Number.isFinite) ||
      widthMm < MIN_SIZE_MM || baseMm < MIN_SIZE_MM || rimMm < 0 ||
      (rimMm > 0 && rimMm < MIN_SIZE_MM) || widthMm + 2 * rimMm > MAX_SIZE_MM || baseMm > MAX_SIZE_MM) {
    throw new Error('模型宽度、底部厚度或包边宽度无效。');
  }
  const circleRadius = shape === 'circle' ? Math.min(grid.eastWestMeters, grid.northSouthMeters) / 2 : null;
  const width = circleRadius === null ? grid.width : circleGridSide(grid.width);
  const height = circleRadius === null ? grid.height : circleGridSide(grid.height);
  const sampleCount = width * height;
  if (sampleCount > MAX_GRID_SAMPLES) throw new Error('高程网格尺寸无效，或范围过大。');
  validateGrid(grid, circleRadius);

  const eastWestMeters = circleRadius === null ? grid.eastWestMeters : circleRadius * 2;
  const northSouthMeters = circleRadius === null ? grid.northSouthMeters : circleRadius * 2;
  const scale = widthMm / eastWestMeters;
  const depthMm = northSouthMeters * scale;
  if (!Number.isFinite(depthMm) || depthMm < MIN_SIZE_MM || depthMm + 2 * rimMm > MAX_SIZE_MM) {
    throw new Error('模型进深超出 STL 导出范围。');
  }
  let perimeter = perimeterIndices(width, height);
  const withRim = rimMm > 0;
  let positions = new Float32Array(3 * (sampleCount + perimeter.length * (withRim ? 3 : 1) + 1));
  const elevations = new Float64Array(sampleCount);
  let minimum = Infinity;

  for (let row = 0; row < height; row++) {
    const v = 1 - 2 * row / (height - 1);
    for (let col = 0; col < width; col++) {
      const u = 2 * col / (width - 1) - 1;
      const i = row * width + col;
      let east = u * eastWestMeters / 2;
      let north = v * northSouthMeters / 2;
      let elevation = grid.elevations[i];
      if (circleRadius !== null) {
        // The square-to-disk map places every boundary vertex on the same true circle.
        east *= Math.sqrt(1 - v * v / 2);
        north *= Math.sqrt(1 - u * u / 2);
        elevation = sampleElevation(grid, east, north);
      }
      if (!validElevation(elevation)) throw new Error(MISSING_ELEVATION);
      elevations[i] = elevation;
      minimum = Math.min(minimum, elevation);
      positions[i * 3] = east * scale;
      positions[i * 3 + 1] = north * scale;
    }
  }
  for (let i = 0; i < sampleCount; i++) {
    positions[i * 3 + 2] = baseMm + (elevations[i] - minimum) * scale;
    if (!Number.isFinite(positions[i * 3 + 2])) throw new Error('模型高程超出 STL 数值范围。');
  }

  const relief = tracks?.length ? raiseTerrainTracks(
    positions, width, height, perimeter, tracks, grid.eastWestMeters * scale, grid.northSouthMeters * scale, withRim, trackColors,
  ) : null;
  if (relief) {
    positions = relief.positions;
    perimeter = relief.perimeter;
  }

  let nextVertex = relief?.vertexCount ?? sampleCount;
  const addVertex = (x: number, y: number, z: number) => {
    const index = nextVertex++;
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;
    return index;
  };
  const inner = withRim ? perimeter.map(index => addVertex(positions[index * 3], positions[index * 3 + 1], baseMm)) : perimeter;
  const outer = withRim ? perimeter.map((index) => {
    const x = positions[index * 3];
    const y = positions[index * 3 + 1];
    return addVertex(
      x * (1 + 2 * rimMm / widthMm),
      y * (1 + 2 * rimMm / depthMm),
      baseMm,
    );
  }) : perimeter;
  const bottom = outer.map(index => addVertex(positions[index * 3], positions[index * 3 + 1], 0));
  const floorCenter = addVertex(0, 0, 0);

  const topFaces = relief ? relief.triangles.length / 3 : 2 * (width - 1) * (height - 1);
  const maxTriangles = topFaces + perimeter.length * (withRim ? 7 : 3);
  const buffer = new ArrayBuffer(84 + maxTriangles * 50);
  new Uint8Array(buffer, 0, 80).set(new TextEncoder().encode('Shantu terrain print | millimeters | 1x relief'));
  const stl = new DataView(buffer);
  let offset = 84;

  const writeTriangle = (a: number, b: number, c: number, color?: number) => {
    const ia = a * 3;
    const ib = b * 3;
    const ic = c * 3;
    const ux = positions[ib] - positions[ia];
    const uy = positions[ib + 1] - positions[ia + 1];
    const uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia];
    const vy = positions[ic + 1] - positions[ia + 1];
    const vz = positions[ic + 2] - positions[ia + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    // The rim's inner wall can merge with the terrain along its lowest border.
    if (length === 0) return;
    stl.setFloat32(offset, nx / length, true);
    stl.setFloat32(offset + 4, ny / length, true);
    stl.setFloat32(offset + 8, nz / length, true);
    for (let j = 0; j < 3; j++) {
      stl.setFloat32(offset + 12 + 4 * j, positions[ia + j], true);
      stl.setFloat32(offset + 24 + 4 * j, positions[ib + j], true);
      stl.setFloat32(offset + 36 + 4 * j, positions[ic + j], true);
    }
    if (color) stl.setUint16(offset + 48, color, true);
    offset += 50;
  };

  if (relief) {
    const { triangles, faceColors } = relief;
    for (let i = 0; i < triangles.length; i += 3) {
      writeTriangle(triangles[i], triangles[i + 1], triangles[i + 2], faceColors?.[i / 3]);
    }
  } else {
    for (let row = 0; row < height - 1; row++) {
      for (let col = 0; col < width - 1; col++) {
        const nw = row * width + col;
        const sw = nw + width;
        writeTriangle(nw, sw, nw + 1);
        writeTriangle(nw + 1, sw, sw + 1);
      }
    }
  }
  for (let i = 0; i < perimeter.length; i++) {
    const j = (i + 1) % perimeter.length;
    if (withRim) {
      writeTriangle(perimeter[i], inner[i], inner[j]);
      writeTriangle(perimeter[i], inner[j], perimeter[j]);
      writeTriangle(inner[i], outer[i], outer[j]);
      writeTriangle(inner[i], outer[j], inner[j]);
    }
    writeTriangle(outer[i], bottom[i], bottom[j]);
    writeTriangle(outer[i], bottom[j], outer[j]);
    writeTriangle(floorCenter, bottom[j], bottom[i]);
  }
  stl.setUint32(80, (offset - 84) / 50, true);
  return offset === buffer.byteLength ? buffer : buffer.slice(0, offset);
}
