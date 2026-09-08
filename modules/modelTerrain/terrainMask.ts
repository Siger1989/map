import { Matrix4 } from 'three';
export const MODEL_MASK_SIZE = 48,
  MODEL_MASK_COLUMNS = 16,
  MODEL_MASK_ROWS = 5;
/** MapLibre 6.7 terrain colour pass adapter (including its depth writes). Picking DEM stays intact. */
export function injectModelMask(source: string, vertex: boolean) {
  if (vertex) {
    if (!source.includes('a_pos3d') || !source.includes('v_fog_depth'))
      return source;
    return source
      .replace(
        /void main\s*\(\s*\)\s*\{/,
        'uniform highp mat4 u_model_inverse;\nout highp vec3 v_model_point;\nvoid main() {',
      )
      .replace(
        /(gl_Position\s*=\s*projectTileFor3D\([^;]+;)/,
        '$1\n highp vec4 modelPoint = u_model_inverse * gl_Position;\n v_model_point = modelPoint.xyz / modelPoint.w;',
      );
  }
  if (
    !source.includes('u_fog_ground_blend_opacity') ||
    !source.includes('v_texture_pos')
  )
    return source;
  return source.replace(
    /void main\s*\(\s*\)\s*\{/,
    `
in highp vec3 v_model_point;
uniform highp int u_model_count;
uniform highp vec4 u_model_bounds[80];
uniform sampler2D u_model_mask;
void main() {
  for (int i=0;i<80;i++) {
    if (i>=u_model_count) break;
    highp vec4 b=u_model_bounds[i];
    highp vec2 uv=(v_model_point.xy-b.xy)/b.zw;
    if (uv.x>=0.0 && uv.x<1.0 && uv.y>=0.0 && uv.y<1.0) {
      highp vec2 at=(vec2(float(i%16),float(i/16))+uv)/vec2(16.0,5.0);
      if (texture(u_model_mask,at).r>0.5) discard;
    }
  }
`,
  );
}
export class TerrainModelMask {
  matched = 0;
  private count = 0;
  private bounds: Float32Array = new Float32Array(80 * 4);
  private inverse = new Matrix4();
  private revision = 0;
  private pixels: Uint8Array | null = null;
  private texture: WebGLTexture | null;
  private restore: () => void;
  private gl: WebGL2RenderingContext;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const original = {
      shaderSource: gl.shaderSource,
      useProgram: gl.useProgram,
      drawElements: gl.drawElements,
    };
    const adapter = this,
      unit = Math.min(
        31,
        gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) - 1,
      );
    this.texture = gl.createTexture();
    let current: WebGLProgram | null = null;
    const programs = new WeakMap<
      WebGLProgram,
      { revision: number; locations: (WebGLUniformLocation | null)[] } | null
    >();
    gl.shaderSource = function (shader, source) {
      const changed = injectModelMask(source, source.includes('a_pos3d'));
      if (changed !== source) adapter.matched++;
      original.shaderSource.call(gl, shader, changed);
    };
    gl.useProgram = function (program) {
      current = program;
      original.useProgram.call(gl, program);
    };
    gl.drawElements = function (mode, count, type, offset) {
      if (!current) {
        original.drawElements.call(gl, mode, count, type, offset);
        return;
      }
      if (!programs.has(current)) {
        const locations = [
          'u_model_inverse',
          'u_model_count',
          'u_model_bounds[0]',
          'u_model_mask',
        ].map((s) => gl.getUniformLocation(current!, s));
        programs.set(
          current,
          locations[1] ? { revision: -1, locations } : null,
        );
      }
      const entry = programs.get(current);
      if (!entry) {
        original.drawElements.call(gl, mode, count, type, offset);
        return;
      }
      if (entry.revision !== adapter.revision) {
        gl.uniformMatrix4fv(
          entry.locations[0],
          false,
          adapter.inverse.elements,
        );
        gl.uniform1i(entry.locations[1], adapter.count);
        gl.uniform4fv(entry.locations[2], adapter.bounds);
        gl.uniform1i(entry.locations[3], unit);
        entry.revision = adapter.revision;
      }
      const active = gl.getParameter(gl.ACTIVE_TEXTURE);
      gl.activeTexture(gl.TEXTURE0 + unit);
      const binding = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.bindTexture(gl.TEXTURE_2D, adapter.texture);
      if (adapter.pixels) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const flipped = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),
          premultiplied = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          MODEL_MASK_COLUMNS * MODEL_MASK_SIZE,
          MODEL_MASK_ROWS * MODEL_MASK_SIZE,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          adapter.pixels,
        );
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipped);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplied);
        adapter.pixels = null;
      }
      original.drawElements.call(gl, mode, count, type, offset);
      gl.bindTexture(gl.TEXTURE_2D, binding);
      gl.activeTexture(active);
    };
    this.restore = () => Object.assign(gl, original);
    this.pixels = new Uint8Array(
      MODEL_MASK_COLUMNS * MODEL_MASK_ROWS * MODEL_MASK_SIZE ** 2 * 4,
    );
  }
  setData(bounds: Float32Array, pixels: Uint8Array, count: number) {
    this.bounds = bounds;
    this.pixels = pixels;
    this.count = count;
    this.revision++;
  }
  frame(inverse: Matrix4) {
    this.inverse.copy(inverse);
    this.revision++;
  }
  disable() {
    this.count = 0;
    this.revision++;
  }
  dispose() {
    this.disable();
    this.restore();
    this.gl.deleteTexture(this.texture);
    this.texture = null;
  }
}
