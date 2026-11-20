import type { DeviceSkyOptics, DeviceSkyPose } from './deviceSkyCamera';
import type { SkyDirection } from './astronomy';
import type { TerrainHorizon } from './terrainHorizon';

const rad = Math.PI / 180;
export function direction(azimuth: number, altitude: number) {
  const a = azimuth * rad,
    h = altitude * rad;
  return [Math.cos(h) * Math.sin(a), Math.cos(h) * Math.cos(a), Math.sin(h)];
}

// Each pixel traces a ray in east/north/up coordinates, including when the phone looks straight up.
const fragment = `
precision highp float;
varying vec2 screen;
uniform vec3 forwardAxis, rightAxis, upAxis, sun, moon;
uniform vec2 tangent;
uniform float live, fraction, daylight, textured, hasRidge;
uniform float sunDisc, moonDisc;
uniform sampler2D skyline;
const float rad=0.01745329252;
vec4 ridge(float index) {
  return texture2D(skyline, vec2((mod(index,360.0)+0.5)/360.0, 0.25));
}
float height(vec4 v) { return (v.r*65280.0+v.g*255.0)/256.0-90.0; }
void main() {
  vec3 ray=normalize(forwardAxis+screen.x*tangent.x*rightAxis+screen.y*tangent.y*upAxis);
  float az=0.0, alt=ray.z, rim=0.0;
  bool known=false;
  if(hasRidge>0.5 || (textured<0.5 && live<0.5)){
    alt=asin(clamp(ray.z,-1.0,1.0))/rad;
  }
  if(hasRidge>0.5){
    az=mod(atan(ray.x,ray.y)/rad+360.0,360.0);
    vec4 l=ridge(floor(az)), r=ridge(floor(az)+1.0);
    known=l.a>0.5 && r.a>0.5;
    if(known)rim=mix(height(l),height(r),fract(az));
  }
  float elev=clamp(ray.z,0.0,1.0);
  float dusk=(1.0-smoothstep(0.0,0.22,abs(sun.z+0.045)))*clamp(0.45+0.55*dot(ray,sun),0.0,1.0);
  vec3 horizon=mix(vec3(0.018,0.025,0.044),vec3(0.72,0.84,0.92),daylight);
  horizon=mix(horizon,vec3(0.96,0.51,0.28),dusk);
  vec3 zenith=mix(vec3(0.003,0.005,0.014),vec3(0.15,0.43,0.72),daylight);
  vec4 color=live>0.5?vec4(0.0):vec4(mix(horizon,zenith,sqrt(elev)),1.0);
  float sd=length(ray-sun), md=length(ray-moon);
  float halo=exp(-sd*58.0)*0.68;
  if (live<0.5 && sunDisc>0.5) color.rgb=mix(color.rgb,vec3(1.0,0.89,0.65),halo);
  if(sunDisc>0.5 && sd<0.00465) color=vec4(1.0,0.96,0.79,1.0);
  if(moonDisc>0.5 && md<0.00452) {
    vec3 local=(ray-moon*dot(ray,moon))/0.00452;
    vec3 light=sun-moon*dot(sun,moon);
    float phase=2.0*fraction-1.0;
    float bright=dot(local,light/max(length(light),0.00001))*sqrt(max(0.0,1.0-phase*phase))+sqrt(max(0.0,1.0-dot(local,local)))*phase;
    if(bright>0.0) color=vec4(0.93,0.94,0.91,1.0);
  }
  if(alt<rim) {
    if(live>0.5) color=vec4(0.0);
    else if(textured>0.5) color=vec4(mix(horizon,zenith,sqrt(elev)),1.0);
    else {
      vec3 base=known ? vec3(0.53,0.64,0.64) : vec3(0.45,0.55,0.56);
      color=vec4(base*(0.92+0.08*exp(-max(0.0,rim-alt)*0.10)),1.0);
    }
  }
  if(live>0.5 && known && abs(alt-rim)<0.10) color=vec4(0.99,0.82,0.48,0.75);
  if(live<0.5 && textured<0.5 && known && alt<rim) {
    vec4 layers=texture2D(skyline,vec2((floor(az)+0.5)/360.0,0.75));
    vec4 next=texture2D(skyline,vec2((mod(floor(az)+1.0,360.0)+0.5)/360.0,0.75));
    float nearRim=mix(height(layers),height(next),fract(az));
    float midRim=mix(height(vec4(layers.ba,0.0,0.0)),height(vec4(next.ba,0.0,0.0)),fract(az));
    if (alt < midRim) color.rgb=vec3(0.36,0.50,0.46);
    if (alt < nearRim) color.rgb=vec3(0.23,0.39,0.31);
  }
  gl_FragColor=color;
}`;
export function createSkyScene(canvas: HTMLCanvasElement, preserveDrawingBuffer = false) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer,
  });
  if (!gl) throw new Error('此设备无法绘制天空');
  const program = gl.createProgram()!;
  const shaders = [
    [
      gl.VERTEX_SHADER,
      'attribute vec2 p; varying vec2 screen; void main(){screen=p;gl_Position=vec4(p,0.0,1.0);}',
    ],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const;
  for (const [kind, code] of shaders) {
    const shader = gl.createShader(kind)!;
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    throw new Error('当前图形驱动无法绘制天空');
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const p = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(p);
  gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const filter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
    gl.texParameteri(gl.TEXTURE_2D, filter, gl.NEAREST);
  for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
    gl.texParameteri(gl.TEXTURE_2D, wrap, gl.CLAMP_TO_EDGE);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const u = Object.fromEntries(
    [
      'rightAxis',
      'upAxis',
      'forwardAxis',
      'sun',
      'moon',
      'fraction',
      'daylight',
      'tangent',
      'live',
      'textured',
      'hasRidge',
      'sunDisc',
      'moonDisc',
    ].map((key) => [key, uniform(key)]),
  );
  let prior: TerrainHorizon | null | undefined;
  return {
    draw(
      pose: DeviceSkyPose,
      optics: DeviceSkyOptics,
      sky: {
        sun: SkyDirection;
        moon: SkyDirection;
        moonIlluminatedFraction: number;
      },
      terrain: TerrainHorizon | null,
      live: boolean,
      textured = false,
      bodies?: {sun:boolean;moon:boolean},
    ) {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * scale)),
        height = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      if (prior !== terrain) {
        prior = terrain;
        const row = new Uint8Array(360 * 8);
        terrain?.directions.forEach(
          ({ altitudeDeg, nearAltitudeDeg, midAltitudeDeg }, i) => {
            if (altitudeDeg == null) return;
            const encoded = Math.round((90 + altitudeDeg) * 256);
            row[4 * i] = encoded >> 8;
            row[4 * i + 1] = encoded & 255;
            row[4 * i + 3] = 255;
            const near = Math.round((90 + (nearAltitudeDeg ?? -90)) * 256);
            const mid = Math.round((90 + (midAltitudeDeg ?? -90)) * 256);
            row.set(
              [near >> 8, near & 255, mid >> 8, mid & 255],
              (360 + i) * 4,
            );
          },
        );
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          360,
          2,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          row,
        );
      }
      const right = direction(pose.azimuth + 90, 0),
        up = direction(pose.azimuth, pose.altitude + 90);
      const c = Math.cos(pose.roll * rad),
        s = Math.sin(pose.roll * rad);
      gl.uniform3fv(u.forwardAxis, direction(pose.azimuth, pose.altitude));
      gl.uniform3fv(
        u.rightAxis,
        right.map((v, i) => c * v + s * up[i]),
      );
      gl.uniform3fv(
        u.upAxis,
        up.map((v, i) => c * v - s * right[i]),
      );
      gl.uniform2f(
        u.tangent,
        Math.tan((optics.horizontalFov * rad) / 2),
        Math.tan((optics.verticalFov * rad) / 2),
      );
      gl.uniform3fv(u.sun, direction(sky.sun.azimuthDeg, sky.sun.altitudeDeg));
      gl.uniform3fv(
        u.moon,
        direction(sky.moon.azimuthDeg, sky.moon.altitudeDeg),
      );
      gl.uniform1f(u.fraction, sky.moonIlluminatedFraction);
      gl.uniform1f(
        u.daylight,
        Math.min(1, Math.max(0, (sky.sun.altitudeDeg + 12) / 18)),
      );
      gl.uniform1f(u.textured, textured ? 1 : 0);
      gl.uniform1f(u.hasRidge, terrain ? 1 : 0);
      gl.uniform1f(u.sunDisc,bodies?.sun===false?0:1);
      gl.uniform1f(u.moonDisc,bodies?.moon===false?0:1);
      gl.uniform1f(u.live, live ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
