// Shared materials and shader patches.
// Every lit material in the game goes through patchMaterial(), which adds:
//   - world-space varyings
//   - height mist (pits and island undersides dissolve into coloured fog)
//   - optional op-art (black & white warping patterns, for the underside world)
//   - optional shell-grass (velvet lawn fur) and strata (layered-cake earth)
import * as THREE from 'three';

export const G = {
  uTime: { value: 0 },
  uMistColor: { value: new THREE.Color('#7fa898') },
  uMistTop: { value: -2.0 },
  uMistBottom: { value: -9.0 },
  uOpCenter: { value: new THREE.Vector3(0, 0, 0) },
  uOpAmount: { value: 1.0 },
  uGrassNoise: { value: null },
  uStrata0: { value: new THREE.Color('#e9d3b8') },
  uStrata1: { value: new THREE.Color('#d39a86') },
  uStrata2: { value: new THREE.Color('#a86d62') },
  uStrata3: { value: new THREE.Color('#6e4a48') },
};

// ---------------------------------------------------------------------------
// procedural textures

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGrassNoise() {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const r = rng(7);
  // R: strand height (random per texel, clustered), G: smooth value noise (patches), B: random
  const grid = 8;
  const cells = [];
  for (let i = 0; i < grid * grid; i++) cells.push(r());
  const smooth = (x, y) => {
    const gx = (x / S) * grid, gy = (y / S) * grid;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const c = (i, j) => cells[((j % grid) + grid) % grid * grid + ((i % grid) + grid) % grid];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = c(x0, y0) * (1 - sx) + c(x0 + 1, y0) * sx;
    const b = c(x0, y0 + 1) * (1 - sx) + c(x0 + 1, y0 + 1) * sx;
    return a * (1 - sy) + b * sy;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const h = Math.pow(r(), 0.6);
      data[i] = Math.floor(h * 255);
      data[i + 1] = Math.floor(smooth(x, y) * 255);
      data[i + 2] = Math.floor(r() * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
G.uGrassNoise.value = makeGrassNoise();

const texCache = new Map();
function canvasTex(key, w, h, draw, { repeat = true, srgb = true } = {}) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

function speckle(g, w, h, n, colors, seed, size = 1.5) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.globalAlpha = 0.25 + r() * 0.35;
    const s = size * (0.5 + r());
    g.fillRect(r() * w, r() * h, s, s);
  }
  g.globalAlpha = 1;
}

// road tile texture: u runs along the road. style: 'yellow' (double yellow centre) or 'white' (dashed)
// edges: which sides have lines. side 'a' = v=0, side 'b' = v=1
export function roadTexture(style, aLine, bLine) {
  return canvasTex(`road-${style}-${aLine}-${bLine}`, 256, 256, (g, w, h) => {
    g.fillStyle = '#3d4352';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2600, ['#555c6c', '#2e3240', '#6a7080', '#4b5160'], 3, 2);
    const line = (kind, side) => {
      // side 0 => top rows (v=0), side 1 => bottom rows
      const y = side === 0 ? 0 : h;
      const dir = side === 0 ? 1 : -1;
      if (kind === 'edge') {
        g.fillStyle = '#ece6da';
        g.fillRect(0, y + dir * 18 - (dir < 0 ? 10 : 0), w, 10);
      } else if (kind === 'curb') {
        g.fillStyle = '#b7aea4';
        g.fillRect(0, y - (dir < 0 ? 14 : 0), w, 14);
      } else if (kind === 'center') {
        if (style === 'yellow') {
          g.fillStyle = '#e9c24c';
          g.fillRect(0, y - (dir < 0 ? 5 : 0), w, 5);
          g.fillRect(0, y + dir * 10 - (dir < 0 ? 5 : 0), w, 5);
        } else {
          g.fillStyle = '#efe9de';
          g.fillRect(w * 0.25, y - (dir < 0 ? 6 : 0), w * 0.5, 6);
        }
      }
    };
    if (aLine) line(aLine, 0);
    if (bLine) line(bLine, 1);
  });
}

export function sidewalkTexture() {
  return canvasTex('sidewalk', 256, 256, (g, w, h) => {
    g.fillStyle = '#dcc7ba';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 3000, ['#c9b2a5', '#efdfd4', '#b9a196'], 11, 2);
    g.strokeStyle = 'rgba(120,96,88,0.35)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
  });
}

export function plankTexture(color = '#eae4dc') {
  return canvasTex('planks-' + color, 256, 256, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let i = 0; i < 6; i++) {
      const y = (i * h) / 6;
      g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.05})`;
      g.fillRect(0, y, w, h / 6);
      g.fillStyle = 'rgba(90,70,60,0.35)';
      g.fillRect(0, y, w, 2);
      const x = r() * w;
      g.fillRect(x, y, 2, h / 6);
    }
    speckle(g, w, h, 800, ['#ffffff', '#c8bfb4'], 9, 1.5);
  });
}

export function brickTexture() {
  return canvasTex('brick', 256, 256, (g, w, h) => {
    g.fillStyle = '#c99a8a';
    g.fillRect(0, 0, w, h);
    const rows = 8, bw = w / 4, bh = h / rows;
    const r = rng(13);
    for (let j = 0; j < rows; j++) {
      for (let i = -1; i < 5; i++) {
        const x = i * bw + (j % 2 ? bw / 2 : 0);
        const c = 0.85 + r() * 0.25;
        g.fillStyle = `rgb(${Math.floor(206 * c)},${Math.floor(140 * c)},${Math.floor(124 * c)})`;
        g.fillRect(x + 2, j * bh + 2, bw - 4, bh - 4);
      }
    }
    speckle(g, w, h, 1200, ['#a67565', '#e8c2b2'], 4, 1.5);
  });
}

export function stoneTexture() {
  return canvasTex('stone', 128, 128, (g, w, h) => {
    g.fillStyle = '#cfc7bd';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1400, ['#b5aca2', '#e7e0d8', '#a39a90'], 21, 1.5);
  });
}

// ---------------------------------------------------------------------------
// shader patching

const COMMON_V = /* glsl */ `
varying vec3 vWP;
varying vec3 vWN;
uniform float uTime;
#ifdef SHELL
attribute float aShell;
attribute float aCut;
uniform float uGrassH;
uniform float uMownH;
varying float vShell;
varying float vCut;
varying float vGH;
#endif
`;

const COMMON_F = /* glsl */ `
varying vec3 vWP;
varying vec3 vWN;
uniform float uTime;
uniform vec3 uMistColor;
uniform float uMistTop;
uniform float uMistBottom;
uniform float uMistOn;
#ifdef OPART
uniform vec3 uOpCenter;
uniform float uOpMode;
uniform float uOpAmount;
float aaStep(float ph) {
  float s = sin(ph * 6.2831853);
  float w = fwidth(ph) * 6.2831853 * 0.8 + 1e-4;
  return smoothstep(-w, w, s);
}
float opPattern(vec3 p, vec3 n) {
  float t = uTime;
  vec3 q = p - uOpCenter;
  if (uOpMode < 0.5) {
    float r = length(q.xz);
    float a = atan(q.z, q.x);
    float warp = 0.45 * sin(a * 3.0 + t * 0.35 + r * 0.35) + 0.25 * sin(r * 0.8 - t * 0.6);
    return aaStep(r * 0.85 + warp - t * 0.12);
  } else if (uOpMode < 1.5) {
    float ph = p.y * 1.5 + 0.45 * sin(p.x * 1.0 + p.z * 0.8 + t * 0.5) + 0.2 * sin(p.x * 2.3 - t * 0.9);
    return aaStep(ph);
  } else if (uOpMode < 2.5) {
    vec2 uv = (abs(n.y) > 0.5 ? p.xz : (abs(n.x) > 0.5 ? p.zy : p.xy)) * 1.0;
    uv += 0.35 * vec2(sin(uv.y * 0.9 + t * 0.5), sin(uv.x * 0.8 - t * 0.45));
    float a = aaStep(uv.x * 0.5);
    float b = aaStep(uv.y * 0.5);
    return a * b + (1.0 - a) * (1.0 - b);
  } else {
    // zebra stripes that run across a road (along x and z both, picks the dominant axis)
    vec2 uv = abs(n.y) > 0.5 ? p.xz : (abs(n.x) > 0.5 ? p.zy : p.xy);
    float ph = (uv.x + uv.y) * 1.8 + 0.3 * sin(uv.x * 1.3 - uv.y * 0.7 + t * 0.7);
    return aaStep(ph);
  }
}
#endif
#ifdef SHELL
uniform sampler2D uGrassNoise;
uniform vec3 uGrassRoot;
uniform vec3 uGrassTip;
uniform vec3 uGrassTip2;
uniform vec3 uMownTint;
uniform float uGrassScale;
uniform float uStripeAmt;
uniform float uFlowers;
varying float vShell;
varying float vCut;
varying float vGH;
#endif
#ifdef STRATA
uniform vec3 uStrata0;
uniform vec3 uStrata1;
uniform vec3 uStrata2;
uniform vec3 uStrata3;
#endif
`;

let patchId = 0;
export function patchMaterial(mat, opts = {}, shareUniforms = null) {
  const o = {
    mist: true,
    opart: false,
    opMode: 0,
    shell: null,
    strata: false,
    ...opts,
  };
  mat._patch = o;
  const key = `p${o.opart ? 'O' + o.opMode : ''}${o.shell ? 'S' : ''}${o.strata ? 'T' : ''}`;
  mat.defines = mat.defines || {};
  if (o.opart) mat.defines.OPART = '';
  if (o.shell) mat.defines.SHELL = '';
  if (o.strata) mat.defines.STRATA = '';
  const local = {
    uMistOn: { value: o.mist ? 1 : 0 },
    uOpMode: { value: o.opMode },
  };
  if (o.shell) {
    local.uGrassH = { value: o.shell.height ?? 0.12 };
    local.uMownH = { value: o.shell.mownHeight ?? 0.03 };
    local.uGrassRoot = { value: new THREE.Color(o.shell.root ?? '#1d3a22') };
    local.uGrassTip = { value: new THREE.Color(o.shell.tip ?? '#5fae4e') };
    local.uGrassTip2 = { value: new THREE.Color(o.shell.tip2 ?? '#7cc25a') };
    local.uMownTint = { value: new THREE.Color(o.shell.mownTint ?? '#c8f0a0') };
    local.uGrassScale = { value: o.shell.scale ?? 0.22 };
    local.uStripeAmt = { value: o.shell.stripes ?? 0.06 };
    local.uFlowers = { value: o.shell.flowers ?? 0 };
  }
  if (shareUniforms) Object.assign(local, shareUniforms, { uOpMode: local.uOpMode, uMistOn: local.uMistOn });
  mat._uniforms = local;
  // chain with any patch the material already had (e.g. the props' foliage fluff)
  const prevCompile = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile') && !mat._patchedCompile ? mat.onBeforeCompile : mat._prevCompile ?? null;
  const prevKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') && !mat._patchedCompile ? mat.customProgramCacheKey : mat._prevKey ?? null;
  mat._prevCompile = prevCompile;
  mat._prevKey = prevKey;
  mat._patchedCompile = true;
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) + '+' : '') + key;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile.call(mat, shader, renderer);
    Object.assign(shader.uniforms, G, local);
    shader.vertexShader = COMMON_V + shader.vertexShader;
    if (o.shell) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        float gh = mix(uGrassH, uMownH, aCut);
        vShell = aShell; vCut = aCut; vGH = gh;
        vec3 gN = normalize(objectNormal);
        vec4 bw = modelMatrix * vec4(position, 1.0);
        float sw = sin(uTime * 1.3 + bw.x * 0.8 + bw.z * 0.6) * 0.6 + sin(uTime * 2.1 + bw.x * 2.3 - bw.z * 1.7) * 0.4;
        vec3 sd = vec3(1.0, 0.0, 0.45);
        sd = sd - gN * dot(sd, gN);
        transformed += gN * gh * aShell + sd * sw * gh * 0.22 * aShell * aShell;`
      );
    }
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `#include <project_vertex>
      vec4 _wp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        _wp = instanceMatrix * _wp;
      #endif
      _wp = modelMatrix * _wp;
      vWP = _wp.xyz;
      vWN = normalize(mat3(modelMatrix) * objectNormal);`
    );
    shader.fragmentShader = COMMON_F + shader.fragmentShader;
    let colorCode = '';
    if (o.shell) {
      colorCode += /* glsl */ `
      {
        vec3 gn = normalize(vWN);
        vec3 bp = vWP - gn * vGH * vShell;
        vec2 guv = abs(gn.y) > 0.5 ? bp.xz : (abs(gn.x) > 0.5 ? bp.zy : bp.xy);
        vec4 nz = texture2D(uGrassNoise, guv * uGrassScale);
        if (vShell > 0.001 && nz.r < vShell) discard;
        float pn = texture2D(uGrassNoise, guv * 0.04).g;
        vec3 tip = mix(uGrassTip, uGrassTip2, smoothstep(0.25, 0.75, pn));
        vec3 gc = mix(uGrassRoot, tip, pow(vShell, 0.75));
        gc *= 0.86 + 0.28 * nz.b;
        float stripe = smoothstep(0.42, 0.58, fract((bp.x + bp.z) * 0.25));
        gc *= 1.0 + uStripeAmt * (stripe * 2.0 - 1.0) * step(0.5, gn.y);
        gc = mix(gc, gc * uMownTint * 1.25, vCut * 0.85);
        float fl = step(1.0 - uFlowers, texture2D(uGrassNoise, guv * uGrassScale * 0.21 + 0.37).b) * smoothstep(0.72, 0.92, vShell) * (1.0 - vCut);
        gc = mix(gc, vec3(1.0, 0.8, 0.16), fl);
        diffuseColor.rgb = gc;
      }`;
    }
    if (o.strata) {
      colorCode += /* glsl */ `
      {
        float yy = vWP.y + 0.13 * sin(vWP.x * 1.7 + vWP.z * 1.3) + 0.07 * sin(vWP.x * 4.3 - vWP.z * 3.7);
        float band = floor(yy / 0.42);
        float h = fract(sin(band * 12.9898) * 43758.5453);
        vec3 c = h < 0.25 ? uStrata0 : (h < 0.5 ? uStrata1 : (h < 0.75 ? uStrata2 : uStrata3));
        float fine = fract(sin(dot(floor(vWP * 22.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        c *= 0.93 + 0.1 * fine;
        float edge = smoothstep(0.0, 0.06, fract(yy / 0.42)) ;
        c *= 0.85 + 0.15 * edge;
        diffuseColor.rgb = c;
      }`;
    }
    if (o.opart) {
      colorCode += /* glsl */ `
      {
        float op = opPattern(vWP, normalize(vWN));
        vec3 bwc = mix(vec3(0.015), vec3(0.93), op);
        diffuseColor.rgb = mix(diffuseColor.rgb, bwc, uOpAmount);
      }`;
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n' + colorCode
    );
    if (o.opart) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.16 * uOpAmount;'
      );
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      /* glsl */ `#include <fog_fragment>
      {
        float mist = smoothstep(uMistTop, uMistBottom, vWP.y) * uMistOn;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistColor, mist);
      }`
    );
  };
  patchId++;
  return mat;
}

// ---------------------------------------------------------------------------
// material library

const matCache = new Map();
export function lit(color, opts = {}) {
  const k = JSON.stringify([color, opts]);
  if (matCache.has(k)) return matCache.get(k);
  const { opart = false, opMode = 0, mist = true, ...rest } = opts;
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...rest });
  patchMaterial(m, { opart, opMode, mist });
  matCache.set(k, m);
  return m;
}

export function grassMaterial(shell, { opart = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 });
  patchMaterial(m, { shell, opart, opMode: 0 });
  return m;
}

export function strataMaterial({ opart = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 });
  patchMaterial(m, { strata: true, opart, opMode: 1 });
  return m;
}

export function texturedMaterial(map, opts = {}) {
  const { opart = false, opMode = 3, ...rest } = opts;
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, ...rest });
  patchMaterial(m, { opart, opMode });
  return m;
}

// Replace every material in a subtree with an op-art version (keeps emissive glows).
export function opartify(root, mode = 1) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.keepColor) return;
    const conv = (m) => {
      if (!m || m._patch?.opart) return m;
      const key = 'op-' + m.uuid + '-' + mode;
      if (matCache.has(key)) return matCache.get(key);
      let nm;
      if (m.isMeshStandardMaterial) {
        nm = m.clone();
        nm.map = null;
        if (m._prevCompile) nm.onBeforeCompile = m._prevCompile;
        if (m._prevKey) nm.customProgramCacheKey = m._prevKey;
        const p = m._patch;
        patchMaterial(nm, { ...(p || {}), opart: true, opMode: p?.shell ? 0 : mode }, p?.shell ? m._uniforms : null);
      } else {
        nm = m;
      }
      matCache.set(key, nm);
      return nm;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}

// Patch every standard material in a subtree (for props built elsewhere) so they get mist.
export function patchTree(root, opts = {}) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || m._patch) continue;
      if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) {
        patchMaterial(m, opts);
        m.needsUpdate = true;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// sky: a fullscreen background that fakes a wide perspective sky behind the
// orthographic diorama (the ortho camera has parallel rays, so we invent them)

export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uCamF: { value: new THREE.Vector3(0, 0, -1) },
      uCamR: { value: new THREE.Vector3(1, 0, 0) },
      uCamU: { value: new THREE.Vector3(0, 1, 0) },
      uAspect: { value: 1 },
      uTop: { value: new THREE.Color('#7fb3e6') },
      uHorizon: { value: new THREE.Color('#f6d7c3') },
      uBottom: { value: new THREE.Color('#7fa898') },
      uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.3).normalize() },
      uSunColor: { value: new THREE.Color('#ffd9a8') },
      uStars: { value: 0 },
      uOpSky: { value: 0 },
      uUnderTop: { value: new THREE.Color('#05060a') },
      uTime: G.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform vec3 uCamF, uCamR, uCamU, uTop, uHorizon, uBottom, uSunDir, uSunColor, uUnderTop;
      uniform float uAspect, uStars, uOpSky, uTime;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float aaStep(float ph) { float s = sin(ph * 6.2831853); float w = fwidth(ph) * 6.2831853 + 1e-4; return smoothstep(-w, w, s); }
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        p.x *= uAspect;
        vec3 dir = normalize(uCamF + (p.x * uCamR + p.y * uCamU) * 0.62);
        // mostly a screen-space gradient (the ortho diorama looks down), nudged by the real view
        float ys = (vUv.y - 0.38) * 1.9;
        float y = mix(ys, dir.y, 0.28);
        vec3 col = y > 0.0
          ? mix(uHorizon, uTop, pow(clamp(y, 0.0, 1.0), 0.5))
          : mix(uHorizon, uBottom, pow(clamp(-y, 0.0, 1.0), 0.4));
        float sd = max(dot(dir, uSunDir), 0.0);
        col += uSunColor * (pow(sd, 90.0) * 0.9 + pow(sd, 8.0) * 0.18);
        if (uStars > 0.001) {
          vec3 d = dir * 160.0;
          vec3 id = floor(d);
          float h = hash(id);
          if (h > 0.985) {
            float tw = 0.55 + 0.45 * sin(uTime * (1.0 + h * 3.0) + h * 80.0);
            float s = smoothstep(0.45, 0.0, length(fract(d) - 0.5));
            col += vec3(1.0, 0.97, 0.92) * tw * s * uStars * 1.6;
          }
        }
        if (uOpSky > 0.001) {
          // the underside sky: hypnotic stretchy rings, black and white
          vec3 q = dir;
          float r = acos(clamp(-q.y, -1.0, 1.0));
          float a = atan(q.z, q.x);
          float ph = r * 5.0 + 0.35 * sin(a * 4.0 + uTime * 0.3) + 0.2 * sin(r * 9.0 - uTime * 0.5) - uTime * 0.08;
          float rings = aaStep(ph);
          vec3 op = mix(vec3(0.02), vec3(0.62), rings);
          op = mix(op, uUnderTop, smoothstep(0.2, 1.4, r) * 0.0);
          col = mix(col, op, uOpSky);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.userData.isSky = true;
  return mesh;
}

// Clone a (possibly patched) material so it can be tinted/glowed independently.
export function cloneMat(m) {
  const c = m.clone();
  if (m._prevCompile) { c.onBeforeCompile = m._prevCompile; }
  if (m._prevKey) { c.customProgramCacheKey = m._prevKey; }
  if (m._patch) patchMaterial(c, m._patch, m._uniforms);
  return c;
}

// Give a subtree its own materials (for pieces that glow independently).
export function isolateMaterials(root) {
  const list = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) o.material = o.material.map((m) => { const c = cloneMat(m); list.push(c); return c; });
    else { o.material = cloneMat(o.material); list.push(o.material); }
  });
  return list;
}
