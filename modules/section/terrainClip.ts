import * as THREE from 'three';
import { planeBasis } from './planeMath';
import type { SectionSettings } from './types';

/** Version-scoped MapLibre 6.7 adapter. Only this canvas/context is wrapped.
 * Terrain's colour/depth writes are discarded together; the separate picking
 * DEM depth pass intentionally stays intact so users can still place the plane.
 * No driver readback, source swap, shader recompile or DEM upload while dragging.
 */
export function injectTerrainClip(source: string, vertex: boolean) {
  if (vertex) {
    if (!source.includes('a_pos3d') || !source.includes('v_fog_depth'))
      return source;
    return source
      .replace(
        /void main\s*\(\s*\)\s*\{/,
        `
uniform highp mat4 u_section_inverse;
out highp vec3 v_section_point;
void main() {`,
      )
      .replace(
        /(gl_Position\s*=\s*projectTileFor3D\([^;]+;)/,
        `$1\n highp vec4 sectionPoint = u_section_inverse * gl_Position;\n v_section_point = sectionPoint.xyz / sectionPoint.w;`,
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
in highp vec3 v_section_point;
uniform highp vec3 u_section_u;
uniform highp vec3 u_section_v;
uniform highp vec3 u_section_n;
uniform highp vec3 u_section_size;
void main() {
  if (u_section_size.z != 0.0 &&
      abs(dot(v_section_point, u_section_u)) < u_section_size.x &&
      abs(dot(v_section_point, u_section_v)) < u_section_size.y &&
      dot(v_section_point, u_section_n) * u_section_size.z > 0.05) discard;
`,
  );
}
export class TerrainClip {
  private state: {
    settings: SectionSettings;
    inverse: THREE.Matrix4;
    side: number;
  } | null = null;
  private revision = 0;
  matched = 0;
  private restore: () => void;
  constructor(gl: WebGL2RenderingContext) {
    const original = {
      shaderSource: gl.shaderSource,
      useProgram: gl.useProgram,
      drawElements: gl.drawElements,
    };
    let current: WebGLProgram | null = null;
    const programs = new WeakMap<
      WebGLProgram,
      { revision: number; locations: (WebGLUniformLocation | null)[] } | null
    >();
    const adapter = this;
    gl.shaderSource = function (shader, source) {
      const changed = injectTerrainClip(source, source.includes('a_pos3d'));
      if (changed !== source) adapter.matched++;
      original.shaderSource.call(gl, shader, changed);
    };
    gl.useProgram = function (program) {
      current = program;
      original.useProgram.call(gl, program);
    };
    gl.drawElements = function (mode, count, type, offset) {
      if (current) {
        if (!programs.has(current)) {
          const names = ['inverse', 'u', 'v', 'n', 'size'];
          const locations = names.map((name) =>
            gl.getUniformLocation(current!, `u_section_${name}`),
          );
          programs.set(
            current,
            locations[4] ? { revision: -1, locations } : null,
          );
        }
        const entry = programs.get(current);
        if (entry && entry.revision !== adapter.revision) {
          const [inverse, u, v, n, size] = entry.locations;
          const state = adapter.state;
          if (state) {
            const basis = planeBasis(
              state.settings.plane!.heading,
              state.settings.plane!.tilt,
              state.settings.plane!.roll,
            );
            gl.uniformMatrix4fv(inverse, false, state.inverse.elements);
            gl.uniform3f(u, basis.u.x, basis.u.y, basis.u.z);
            gl.uniform3f(v, basis.v.x, basis.v.y, basis.v.z);
            gl.uniform3f(n, basis.n.x, basis.n.y, basis.n.z);
            gl.uniform3f(
              size,
              state.settings.plane!.width / 2,
              state.settings.plane!.height / 2,
              state.side,
            );
          } else gl.uniform3f(size, 0, 0, 0);
          entry.revision = adapter.revision;
        }
      }
      original.drawElements.call(gl, mode, count, type, offset);
    };
    this.restore = () => Object.assign(gl, original);
  }
  update(settings: SectionSettings, inverse: THREE.Matrix4, side: number) {
    this.state = { settings, inverse, side };
    this.revision++;
  }
  disable() {
    this.state = null;
    this.revision++;
  }
  dispose() {
    this.disable();
    this.restore();
  }
}
