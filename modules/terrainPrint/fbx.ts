import { terrainTrackPalette, type terrainPrintStl } from './mesh.ts';

type TerrainPrintOptions = Parameters<typeof terrainPrintStl>[1];

type Texture = { filename: string; bytes: ArrayBuffer; mime: 'image/png' | 'image/jpeg' };
type Vector2 = [number, number];
type Point3 = [number, number, number];

const MAX_TRIANGLES = 700_000;
const FBX_VERSION = 7400;
const FIRST_TRACK_MATERIAL_ID = 7;
const encoder = new TextEncoder();

function stlTriangles(stl: ArrayBuffer) {
  if (stl.byteLength < 134) throw new Error('地形模型文件无效。');
  const view = new DataView(stl);
  const count = view.getUint32(80, true);
  if (count < 1 || count > MAX_TRIANGLES || 84 + 50 * count !== stl.byteLength) {
    throw new Error('地形模型面数无效或文件不完整。');
  }
  return { view, count };
}

function pointAt(view: DataView, offset: number): Point3 {
  return [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)];
}

/** UVs are pinched to the original terrain footprint, excluding the surrounding base. */
export function terrainPrintTextureMapping(stl: ArrayBuffer, options: TerrainPrintOptions) {
  const { view, count } = stlTriangles(stl);
  const { widthMm, baseMm, rimMm, shape } = options;
  let minY = Infinity, maxY = -Infinity;
  for (let triangle = 0; triangle < count; triangle++) {
    const offset = 84 + triangle * 50 + 12;
    for (let corner = 0; corner < 3; corner++) {
      const y = view.getFloat32(offset + corner * 12 + 4, true);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const depthMm = shape === 'circle' ? widthMm : maxY - minY - 2 * rimMm;
  if ((shape !== 'rectangle' && shape !== 'circle') || ![widthMm, depthMm, baseMm, rimMm].every(Number.isFinite)
      || widthMm <= 0 || depthMm <= 0 || baseMm <= 0 || rimMm < 0) {
    throw new Error('模型尺寸或选区格式无效。');
  }
  const tolerance = Math.max(widthMm, depthMm) * 1e-6;
  const inside = (x: number, y: number) => shape === 'circle'
    ? Math.hypot(x, y) <= widthMm / 2 + tolerance
    : Math.abs(x) <= widthMm / 2 + tolerance && Math.abs(y) <= depthMm / 2 + tolerance;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return {
    coordinate: (x: number, y: number): Vector2 => [clamp(x / widthMm + 0.5), clamp(y / depthMm + 0.5)],
    isTerrainFace: (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, normalZ: number) =>
      normalZ > 0 && inside(ax, ay) && inside(bx, by) && inside(cx, cy),
  };
}

type Value =
  | ['S', string]
  | ['I' | 'L' | 'D', number]
  | ['d', Float64Array]
  | ['i', Int32Array]
  | ['R', Uint8Array];
type Node = { name: string; values: Value[]; children: Node[] };
const string = (value: string): Value => ['S', value];
const integer = (value: number): Value => ['I', value];
const id = (value: number): Value => ['L', value];
const number = (value: number): Value => ['D', value];
const node = (name: string, values: Value[] = [], children: Node[] = []): Node => ({ name, values, children });
const valueNode = (name: string, value: Value) => node(name, [value]);

/** Single-pass binary writer once node/property lengths are known. */
function writeFbx(nodes: Node[]): ArrayBuffer {
  const magic = encoder.encode('Kaydara FBX Binary  \x00\x1a\x00');
  const prepare = (part: Node) => {
    const label = encoder.encode(part.name);
    const items = part.values.map(([kind, value]) => ({
      kind,
      value: typeof value === 'string' ? encoder.encode(value) : value,
    }));
    const propSize = items.reduce((size, { kind, value }) => {
      const payload = typeof value === 'number' ? (kind === 'I' ? 4 : 8)
        : value.byteLength + (kind === 'd' || kind === 'i' ? 12 : 4);
      return size + 1 + payload;
    }, 0);
    return { label, items, propSize };
  };
  type Prepared = ReturnType<typeof prepare> & { children: Prepared[]; size: number };
  const layout = (part: Node): Prepared => {
    const head = prepare(part);
    const children = part.children.map(layout);
    const size = 13 + head.label.length + head.propSize + (children.length ? 13 : 0)
      + children.reduce((total, child) => total + child.size, 0);
    return { ...head, children, size };
  };
  const roots = nodes.map(layout);
  const footerStart = magic.length + 4 + roots.reduce((sum, part) => sum + part.size, 0) + 13;
  const footerAlignment = 16 - ((footerStart + 20) % 16);
  const bytes = new Uint8Array(footerStart + 20 + footerAlignment + 140);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  function raw(value: Uint8Array) { bytes.set(value, offset); offset += value.byteLength; }
  function uint32(value: number) { view.setUint32(offset, value, true); offset += 4; }
  function write(part: Prepared) {
    uint32(offset + part.size);
    uint32(part.items.length);
    uint32(part.propSize);
    bytes[offset++] = part.label.length;
    raw(part.label);
    for (const { kind, value } of part.items) {
      bytes[offset++] = kind.charCodeAt(0);
      if (kind === 'I') { uint32(value as number); continue; }
      if (kind === 'L') { view.setBigInt64(offset, BigInt(value as number), true); offset += 8; continue; }
      if (kind === 'D') { view.setFloat64(offset, value as number, true); offset += 8; continue; }
      const data = value as Exclude<typeof value, number | string>;
      if (kind === 'i' || kind === 'd') {
        uint32(data.length);
        uint32(0);
      }
      uint32(data.byteLength);
      // Supported Android, Windows and macOS engines are little-endian.
      raw(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
    for (const child of part.children) write(child);
    if (part.children.length) offset += 13;
  }

  raw(magic);
  uint32(FBX_VERSION);
  for (const part of roots) write(part);
  offset += 13;
  raw(Uint8Array.of(250, 188, 171, 9, 208, 200, 212, 102, 177, 118, 251, 131, 28, 247, 38, 126));
  offset += 4 + footerAlignment;
  uint32(FBX_VERSION);
  offset += 120;
  raw(Uint8Array.of(248, 90, 140, 106, 222, 245, 217, 126, 236, 233, 12, 227, 117, 143, 41, 11));
  return bytes.buffer;
}

const property = (name: string, type: string, label: string, ...values: Value[]) =>
  node('P', [string(name), string(type), string(label), string(''), ...values]);
const properties = (values: Node[]) => node('Properties70', [], values);
const leafText = (name: string, value: string) => valueNode(name, string(value));
const leafInt = (name: string, value: number) => valueNode(name, integer(value));
const object = (name: string, identifier: number, label: string, type: string, children: Node[]) =>
  node(name, [id(identifier), string(label + '\x00\x01' + name), string(type)], children);
const connect = (child: number, parent: number, slot?: string) =>
  node('C', slot ? [string('OP'), id(child), id(parent), string(slot)] : [string('OO'), id(child), id(parent)]);

function material(identifier: number, name: string, color: Point3) {
  return object('Material', identifier, name, '', [
    leafInt('Version', 102),
    leafText('ShadingModel', 'Lambert'),
    leafInt('MultiLayer', 0),
    properties([
      property('DiffuseColor', 'Color', '', ...color.map(number)),
      property('DiffuseFactor', 'Number', '', number(1)),
    ]),
  ]);
}

function embeddedTexture(data: Texture) {
  const extension = data.mime === 'image/png' ? '.png' : '.jpg';
  const name = data.filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '-').slice(0, 64) || 'Shantu-imagery';
  const filename = name + extension;
  const payload = new Uint8Array(data.bytes);
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => payload[index] === byte);
  const jpeg = payload[0] === 255 && payload[1] === 216 && payload[2] === 255;
  if (payload.byteLength > 32 * 1024 * 1024 || (data.mime === 'image/png' ? !png : !jpeg)) {
    throw new Error('FBX 贴图格式无效或文件过大。');
  }
  return [
    object('Texture', 5, 'TerrainImagery', 'TextureVideoClip', [
      leafText('Type', 'TextureVideoClip'), leafInt('Version', 202),
      leafText('TextureName', 'TerrainImagery\x00\x01Texture'), leafText('Media', name + '\x00\x01Video'),
      leafText('FileName', filename), leafText('RelativeFilename', filename),
      properties([
        property('UVSet', 'KString', '', string('TerrainUV')),
        property('WrapModeU', 'enum', '', integer(1)),
        property('WrapModeV', 'enum', '', integer(1)),
      ]),
    ]),
    object('Video', 6, name, 'Clip', [
      leafText('Type', 'Clip'), leafInt('UseMipMap', 0), leafText('Filename', filename),
      leafText('RelativeFilename', filename), valueNode('Content', ['R', payload]),
    ]),
  ];
}

/** Portable FBX 7.4. Terrain and base stay welded and the selected image is embedded in the file. */
export function exportTerrainPrintFbx(
  stl: ArrayBuffer,
  options: TerrainPrintOptions,
  texture?: Texture,
  trackColors?: readonly string[],
): ArrayBuffer {
  const { view, count } = stlTriangles(stl);
  const mapping = terrainPrintTextureMapping(stl, options);
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices = new Int32Array(count * 3);
  const normals = new Float64Array(count * 3);
  const materials = new Int32Array(count);
  const palette = trackColors ? terrainTrackPalette(trackColors) : [];
  const trackMaterialIndices = new Map<number, number>();
  const trackMaterials: Node[] = [];
  const welded = new Map<string, number>();
  for (let face = 0; face < count; face++) {
    const offset = 84 + 50 * face;
    const normal = pointAt(view, offset);
    const a = pointAt(view, offset + 12);
    const b = pointAt(view, offset + 24);
    const c = pointAt(view, offset + 36);
    if (!(a.every(Number.isFinite) && b.every(Number.isFinite) && c.every(Number.isFinite) && normal.every(Number.isFinite))) {
      throw new Error('模型包含无效坐标。');
    }
    normals.set(normal, face * 3);
    const attribute = view.getUint16(offset + 48, true);
    const trackIndex = attribute & 0x7fff;
    const hex = (attribute & 0x8000) ? palette[trackIndex] : undefined;
    if (hex) {
      let materialIndex = trackMaterialIndices.get(trackIndex);
      if (materialIndex === undefined) {
        const color: Point3 = [
          parseInt(hex.slice(1, 3), 16) / 255,
          parseInt(hex.slice(3, 5), 16) / 255,
          parseInt(hex.slice(5, 7), 16) / 255,
        ];
        materialIndex = trackMaterials.length + 2;
        trackMaterialIndices.set(trackIndex, materialIndex);
        trackMaterials.push(material(FIRST_TRACK_MATERIAL_ID + trackMaterials.length, `Track ${hex}`, color));
      }
      materials[face] = materialIndex;
    } else {
      materials[face] = mapping.isTerrainFace(a[0], a[1], b[0], b[1], c[0], c[1], normal[2]) ? 0 : 1;
    }
    [a, b, c].forEach((point, corner) => {
      const key = point.join(',');
      let index = welded.get(key);
      if (index === undefined) {
        index = vertices.length / 3;
        welded.set(key, index);
        vertices.push(...point);
        uvs.push(...mapping.coordinate(point[0], point[1]));
      }
      indices[face * 3 + corner] = corner === 2 ? -index - 1 : index;
    });
  }
  const layers = [
    node('LayerElementNormal', [integer(0)], [
      leafInt('Version', 101), leafText('Name', ''),
      leafText('MappingInformationType', 'ByPolygon'), leafText('ReferenceInformationType', 'Direct'),
      valueNode('Normals', ['d', normals]),
    ]),
    node('LayerElementUV', [integer(0)], [
      leafInt('Version', 101), leafText('Name', 'TerrainUV'),
      leafText('MappingInformationType', 'ByVertice'), leafText('ReferenceInformationType', 'Direct'),
      valueNode('UV', ['d', Float64Array.from(uvs)]),
    ]),
    node('LayerElementMaterial', [integer(0)], [
      leafInt('Version', 101), leafText('Name', ''),
      leafText('MappingInformationType', 'ByPolygon'), leafText('ReferenceInformationType', 'IndexToDirect'),
      valueNode('Materials', ['i', materials]),
    ]),
  ];
  const geometry = object('Geometry', 2, 'ShantuTerrain', 'Mesh', [
    leafInt('GeometryVersion', 124),
    valueNode('Vertices', ['d', Float64Array.from(vertices)]),
    valueNode('PolygonVertexIndex', ['i', indices]),
    ...layers,
    node('Layer', [integer(0)], [leafInt('Version', 100),
      ...layers.map(layer => node('LayerElement', [], [leafText('Type', layer.name), leafInt('TypedIndex', 0)]))]),
  ]);
  return writeFbx([
    node('FBXHeaderExtension', [], [
      leafInt('FBXHeaderVersion', 1003), leafInt('FBXVersion', FBX_VERSION), leafText('Creator', 'Shantu Terrain Print'),
    ]),
    node('GlobalSettings', [], [
      leafInt('Version', 1000),
      properties([
        property('UpAxis', 'int', 'Integer', integer(2)),
        property('UpAxisSign', 'int', 'Integer', integer(1)),
        property('FrontAxis', 'int', 'Integer', integer(1)),
        property('FrontAxisSign', 'int', 'Integer', integer(-1)),
        property('CoordAxis', 'int', 'Integer', integer(0)),
        property('CoordAxisSign', 'int', 'Integer', integer(1)),
        property('UnitScaleFactor', 'double', 'Number', number(0.1)),
        property('OriginalUnitScaleFactor', 'double', 'Number', number(0.1)),
      ]),
    ]),
    node('Objects', [], [
      geometry,
      object('Model', 1, 'ShantuTerrain', 'Mesh', [leafInt('Version', 232)]),
      material(3, 'Terrain', texture ? [1, 1, 1] : [0.44, 0.53, 0.38]),
      material(4, 'Base', [0.28, 0.25, 0.22]),
      ...trackMaterials,
      ...(texture ? embeddedTexture(texture) : []),
    ]),
    node('Connections', [], [
      connect(1, 0), connect(2, 1), connect(3, 1), connect(4, 1),
      ...trackMaterials.map((_, index) => connect(FIRST_TRACK_MATERIAL_ID + index, 1)),
      ...(texture ? [connect(5, 3, 'DiffuseColor'), connect(6, 5)] : []),
    ]),
  ]);
}
