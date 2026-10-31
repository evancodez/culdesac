/**
 * Cul-de-sac — procedural prop builders.
 *
 * Every builder returns a THREE.Group with its origin at the base centre on the
 * ground (y = 0) and its front facing +Z. 1 unit = 1 walkable tile (~1.2 m);
 * the player is ~0.62 units tall.
 *
 * Materials and geometries are shared through module-level caches, so building
 * the same prop twice (same params / seed) costs no new GPU buffers. Parts that
 * share a material are merged into a single mesh to keep draw calls low.
 *
 * Animated props expose `group.userData.update(t, dt)` (t in seconds).
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------------------ */
/* Seeded randomness                                                         */
/* ------------------------------------------------------------------------ */

/** Classic mulberry32 PRNG. Returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed, salt = 0) {
  let h = (2166136261 ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

function makeRand(seed, salt = 0) {
  const next = mulberry32(hashSeed(seed, salt));
  const R = () => next();
  R.range = (a, b) => a + (b - a) * next();
  R.int = (a, b) => a + Math.floor((b - a + 1) * next());
  R.pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(next() * arr.length))];
  R.sign = () => (next() < 0.5 ? -1 : 1);
  R.gauss = () => (next() + next() + next() + next() - 2) * 1.732;
  return R;
}

function randDir(R, out = new THREE.Vector3()) {
  const u = R.range(-1, 1);
  const th = R.range(0, TAU);
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(th), u, s * Math.sin(th));
}

/** Smooth seeded 3D noise: a sum of randomly oriented sine waves (~[-1, 1]). */
function makeNoise(R, { freq = 2, octaves = 3, gain = 0.5, waves = 3 } = {}) {
  const w = [];
  const d = new THREE.Vector3();
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const f = freq * Math.pow(2.03, o);
    for (let k = 0; k < waves; k++) {
      randDir(R, d);
      w.push(d.x * f, d.y * f, d.z * f, R.range(0, TAU), amp);
      total += amp;
    }
    amp *= gain;
  }
  const norm = 1 / (total * 0.5);
  return (x, y, z) => {
    let s = 0;
    for (let i = 0; i < w.length; i += 5) s += w[i + 4] * Math.sin(x * w[i] + y * w[i + 1] + z * w[i + 2] + w[i + 3]);
    return s * norm;
  };
}

/* ------------------------------------------------------------------------ */
/* Caches & helpers                                                          */
/* ------------------------------------------------------------------------ */

const _mats = new Map();
const _geos = new Map();
const _texs = new Map();

/**
 * Shared MeshStandardMaterial keyed by colour + options.
 * Defaults: roughness 0.8, metalness 0.
 */
export function mat(color, opts = {}) {
  const key = color + '|' + JSON.stringify(opts, (k, v) => (v && v.isTexture ? 'tex:' + v.uuid : v));
  let m = _mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...opts });
    m.name = 'prop:' + color;
    _mats.set(key, m);
  }
  return m;
}

/* --- "fluff": procedural micro-bump for foliage (velvet / blossom texture) ---
 * Perturbs the normal with a smooth 3D value-noise height field evaluated in
 * object space (derivative-based bump, no UVs needed) and darkens the little
 * creases a touch. Fades out with distance so it never shimmers. */
const FLUFF_PARS = /* glsl */ `
varying vec3 vFluffPos;
uniform float uFluffFreq;
uniform float uFluffAmp;
uniform float uFluffAO;
float fl_hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float fl_noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fl_hash(i), fl_hash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(fl_hash(i + vec3(0.0, 1.0, 0.0)), fl_hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(fl_hash(i + vec3(0.0, 0.0, 1.0)), fl_hash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(fl_hash(i + vec3(0.0, 1.0, 1.0)), fl_hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`;
const FLUFF_FRAG = /* glsl */ `
{
  vec3 fp = vFluffPos * uFluffFreq;
  float fade = 1.0 - smoothstep(0.22, 0.7, length(fwidth(fp)));
  if (fade > 0.001) {
    float h = fl_noise(fp) * 0.62 + fl_noise(fp * 2.17 + 3.7) * 0.38;
    h = smoothstep(0.12, 0.88, h);
    vec3 dpdx = dFdx(-vViewPosition);
    vec3 dpdy = dFdy(-vViewPosition);
    vec3 r1 = cross(dpdy, normal);
    vec3 r2 = cross(normal, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    normal = normalize(abs(det) * normal - grad * (uFluffAmp * fade));
    diffuseColor.rgb *= 1.0 - uFluffAO * fade * (1.0 - h);
  }
}
`;

/** Shared MeshStandardMaterial with the fluff micro-bump. fluff = [freqPerUnit, bumpHeight, creaseDarkening]. */
function fluffMat(color, opts = {}, fluff = [12, 0.012, 0.18]) {
  const key = 'fluff|' + color + '|' + JSON.stringify(opts) + '|' + fluff.join(',');
  let m = _mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...opts });
    m.name = 'prop:fluff:' + color;
    const [freq, amp, ao] = fluff;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uFluffFreq = { value: freq };
      shader.uniforms.uFluffAmp = { value: amp };
      shader.uniforms.uFluffAO = { value: ao };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFluffPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFluffPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FLUFF_PARS)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FLUFF_FRAG);
    };
    m.customProgramCacheKey = () => 'prop-fluff-1';
    _mats.set(key, m);
  }
  return m;
}

function cached(key, build) {
  let v = _geos.get(key);
  if (v === undefined) {
    v = build();
    _geos.set(key, v);
  }
  return v;
}

function mesh(geo, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _sv = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);

function composeMatrix(p = [0, 0, 0], r = [0, 0, 0], s = 1, out = _m4) {
  if (typeof r === 'number') r = [0, r, 0];
  _e.set(r[0], r[1], r[2]);
  _q.setFromEuler(_e);
  if (typeof s === 'number') _sv.set(s, s, s);
  else _sv.set(s[0], s[1], s[2]);
  if (p.isVector3) _pv.copy(p);
  else _pv.set(p[0], p[1], p[2]);
  return out.compose(_pv, _q, _sv);
}

/** Clone a geometry and bake a transform into it. r may be [x,y,z] euler or a Y angle. */
function xf(geo, p, r, s) {
  const g = geo.clone();
  g.applyMatrix4(composeMatrix(p, r, s));
  return g;
}

/** Clone `geo` (a unit primitive along +Y, centred) and stretch it between points a and b. */
function between(geo, a, b, w, d = w) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  dir.divideScalar(len || 1);
  const q = new THREE.Quaternion().setFromUnitVectors(_Y, dir);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(w, len, d)));
  return g;
}

function ensureIndexed(g) {
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return g;
}

/** Merge geometries keeping only the listed attributes (fills missing ones). */
function mergeAll(geos, attrs = ['position', 'normal']) {
  const list = geos.map((g) => {
    if (attrs.includes('normal') && !g.attributes.normal) g.computeVertexNormals();
    for (const name of Object.keys(g.attributes)) if (!attrs.includes(name)) g.deleteAttribute(name);
    const n = g.attributes.position.count;
    if (attrs.includes('color') && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    if (attrs.includes('uv') && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.morphAttributes = {};
    g.clearGroups();
    return ensureIndexed(g);
  });
  const out = list.length === 1 ? list[0] : mergeGeometries(list, false);
  if (!out) throw new Error('props: mergeGeometries failed');
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Collects transformed geometries per material, then bakes one merged mesh per material. */
class Parts {
  constructor() {
    this.map = new Map();
  }
  add(material, geo, p, r, s) {
    const g = p !== undefined || r !== undefined || s !== undefined ? xf(geo, p, r, s === undefined ? 1 : s) : geo.clone();
    return this.raw(material, g);
  }
  raw(material, g) {
    let list = this.map.get(material);
    if (!list) this.map.set(material, (list = []));
    list.push(g);
    return this;
  }
  bake() {
    const out = [];
    for (const [m, list] of this.map) {
      const attrs = ['position', 'normal'];
      if (m.map) attrs.push('uv');
      if (m.vertexColors) attrs.push('color');
      out.push({ material: m, geometry: mergeAll(list, attrs) });
    }
    return out;
  }
}

function spawn(baked, parent, opts) {
  for (const b of baked) parent.add(mesh(b.geometry, b.material, opts));
  return parent;
}

/* --- primitive geometries (unit sized, cached; always cloned before use) --- */
const prim = {
  box: () => cached('p:box', () => new THREE.BoxGeometry(1, 1, 1)),
  sphere: (w = 20, h = 14) => cached(`p:sph${w}:${h}`, () => new THREE.SphereGeometry(1, w, h)),
  hemi: (w = 28, h = 10) => cached(`p:hemi${w}:${h}`, () => new THREE.SphereGeometry(1, w, h, 0, TAU, 0, Math.PI / 2)),
  ico: (d = 1) => cached(`p:ico${d}`, () => new THREE.IcosahedronGeometry(1, d)),
  /** Cylinder radius 1, height 1, centred on origin along Y. */
  cyl: (seg = 16, rt = 1, rb = 1, open = false) =>
    cached(`p:cyl${seg}:${rt}:${rb}:${open}`, () => new THREE.CylinderGeometry(rt, rb, 1, seg, 1, open)),
  capsule: (r, len, cap = 4, rad = 10) =>
    cached(`p:cap${r}:${len}:${cap}:${rad}`, () => new THREE.CapsuleGeometry(r, len, cap, rad, 1)),
  torus: (R, r, rs = 8, ts = 24, arc = TAU) => cached(`p:tor${R}:${r}:${rs}:${ts}:${arc}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc)),
};

/** LatheGeometry from [[r, y], ...] (bottom → top gives outward normals), with creased normals. */
function lathe(pts, segs = 24, crease = 0.75) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  return crease ? toCreasedNormals(g, crease) : g;
}

/**
 * Tube along a curve whose radius varies with t (0..1).
 * Same topology / winding as THREE.TubeGeometry.
 */
function taperedTube(curve, segs, radial, rFn) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    const r = typeof rFn === 'number' ? rFn : rFn(t);
    const Nf = frames.normals[i];
    const Bf = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * TAU;
      const s = Math.sin(v);
      const c = -Math.cos(v);
      N.set(c * Nf.x + s * Bf.x, c * Nf.y + s * Bf.y, c * Nf.z + s * Bf.z).normalize();
      pos.push(P.x + r * N.x, P.y + r * N.y, P.z + r * N.z);
      nor.push(N.x, N.y, N.z);
      uv.push(t, j / radial);
    }
  }
  for (let i = 1; i <= segs; i++) {
    for (let j = 1; j <= radial; j++) {
      const a = (radial + 1) * (i - 1) + (j - 1);
      const b = (radial + 1) * i + (j - 1);
      const c = (radial + 1) * i + j;
      const d = (radial + 1) * (i - 1) + j;
      idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Rounded box (w × h × d, centred) built from a subdivided cube projected onto a
 * rounded-box surface. Optional `deform(x,y,z,n)` displaces along the normal and
 * `post(v)` can reshape (taper etc.) before normals are computed.
 */
function roundedBoxGeo(w, h, d, r, { seg = 3, flat = 2, deform = null, post = null } = {}) {
  const half = [w / 2, h / 2, d / 2];
  r = Math.max(1e-4, Math.min(r, half[0] - 1e-4, half[1] - 1e-4, half[2] - 1e-4));
  const flats = Array.isArray(flat) ? flat : [flat, flat, flat];
  const N = flats.map((f) => 2 * seg + Math.max(1, f));
  let g = new THREE.BoxGeometry(1, 1, 1, N[0], N[1], N[2]);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const map = (u, axis) => {
    const Nn = N[axis];
    const i = Math.round((u + 0.5) * Nn);
    const fl = half[axis] - r;
    if (i <= seg) return -fl - r * Math.tan(((seg - i) / seg) * (Math.PI / 4));
    if (i >= Nn - seg) return fl + r * Math.tan(((i - (Nn - seg)) / seg) * (Math.PI / 4));
    return -fl + (2 * fl * (i - seg)) / (Nn - 2 * seg);
  };
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const inner = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    v.set(map(pos.getX(k), 0), map(pos.getY(k), 1), map(pos.getZ(k), 2));
    inner.set(
      clamp(v.x, -(half[0] - r), half[0] - r),
      clamp(v.y, -(half[1] - r), half[1] - r),
      clamp(v.z, -(half[2] - r), half[2] - r),
    );
    n.subVectors(v, inner);
    const L = n.length();
    if (L < 1e-9) n.set(0, 1, 0);
    else n.divideScalar(L);
    v.copy(inner).addScaledVector(n, r);
    if (deform) v.addScaledVector(n, deform(v.x, v.y, v.z, n));
    if (post) post(v, n);
    pos.setXYZ(k, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * Puffy blob: unit icosphere displaced by smooth low-frequency noise plus
 * "billowy" |noise| that leaves soft creases between puffs.
 * Returns { geo, cav (per-vertex 0 = crease .. 1 = puff top), surf(dir) }.
 */
function blob(R, { detail = 3, lump = 0.1, puff = 0.18, f1 = 1.6, f2 = 3.4 } = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const nA = makeNoise(R, { freq: f1, octaves: 2, gain: 0.5 });
  const nB = makeNoise(R, { freq: f2, octaves: 2, gain: 0.45 });
  const surf = (x, y, z) => {
    const b = Math.abs(nB(x, y, z));
    return [1 + lump * nA(x, y, z) + puff * (b - 0.35), b];
  };
  const pos = g.attributes.position;
  const cav = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const L = Math.hypot(x, y, z);
    x /= L;
    y /= L;
    z /= L;
    const [r, b] = surf(x, y, z);
    cav[i] = b;
    pos.setXYZ(i, x * r, y * r, z * r);
  }
  g.computeVertexNormals();
  return { geo: g, cav, surf: (d) => surf(d.x, d.y, d.z)[0] };
}

function paint(geo, fn) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(c, i, pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

const WHITE = new THREE.Color(1, 1, 1);
const _tmpM = new THREE.Matrix4();
const _tmpQ = new THREE.Quaternion();
const _tmpE = new THREE.Euler();
const _tmpS = new THREE.Vector3();

/** Build an InstancedMesh from flat arrays (matrices: 16/instance, colors: 3/instance). */
function instanced(geo, material, matrices, colors = null, { cast = true, receive = true } = {}) {
  const count = matrices.length / 16;
  const im = new THREE.InstancedMesh(geo, material, count);
  im.instanceMatrix.array.set(matrices);
  im.instanceMatrix.needsUpdate = true;
  if (colors) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3);
  im.castShadow = cast;
  im.receiveShadow = receive;
  im.computeBoundingSphere();
  return im;
}

function pushMatrix(arr, p, r, s) {
  composeMatrix(p, r, s, _tmpM);
  for (let i = 0; i < 16; i++) arr.push(_tmpM.elements[i]);
}

function pushColor(arr, hexOrColor, jitter = 0, R = null) {
  const c = hexOrColor.isColor ? hexOrColor.clone() : new THREE.Color(hexOrColor);
  if (jitter && R) c.multiplyScalar(1 + R.range(-jitter, jitter));
  arr.push(c.r, c.g, c.b);
}

/* ------------------------------------------------------------------------ */
/* Canvas textures                                                           */
/* ------------------------------------------------------------------------ */

function createCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

function canvasTex(key, w, h, draw) {
  if (_texs.has(key)) return _texs.get(key);
  const c = createCanvas(w, h);
  let tex = null;
  if (c) {
    draw(c.getContext('2d'), w, h);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
  }
  _texs.set(key, tex);
  return tex;
}

function fitFont(g, text, font, maxW) {
  g.font = font;
  const w = g.measureText(text).width;
  if (w <= maxW) return font;
  const m = font.match(/(\d+(?:\.\d+)?)px/);
  if (!m) return font;
  const px = Math.floor((parseFloat(m[1]) * maxW) / w);
  const f = font.replace(m[0], px + 'px');
  g.font = f;
  return f;
}

/**
 * Text rendered to a cached CanvasTexture (sRGB). Returns null when no canvas
 * is available (e.g. Node). bg = null → transparent background.
 */
export function makeTextTexture(
  text,
  { font = 'bold 96px Georgia, serif', color = '#ffffff', bg = null, width = 256, height = 128, padding = 0.08 } = {},
) {
  const key = 'text:' + JSON.stringify([String(text), font, color, bg, width, height, padding]);
  return canvasTex(key, width, height, (g, w, h) => {
    if (bg) {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
    }
    fitFont(g, String(text), font, w * (1 - 2 * padding));
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(String(text), w / 2, h / 2 + h * 0.04);
  });
}

function stopSignTexture() {
  return canvasTex('stop-sign', 512, 512, (g, S) => {
    const oct = (r) => {
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + (i * Math.PI) / 4;
        const x = S / 2 + Math.cos(a) * r;
        const y = S / 2 + Math.sin(a) * r;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.closePath();
    };
    g.fillStyle = '#f6f2ea';
    oct(S / 2);
    g.fill();
    g.fillStyle = '#c9252d';
    oct(S / 2 - 20);
    g.fill();
    // soft inner sheen
    const grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0, 'rgba(255,255,255,0.10)');
    grd.addColorStop(1, 'rgba(0,0,0,0.06)');
    g.fillStyle = grd;
    oct(S / 2 - 20);
    g.fill();
    g.fillStyle = '#f6f2ea';
    fitFont(g, 'STOP', 'bold 170px Helvetica, Arial, sans-serif', S * 0.74);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('STOP', S / 2, S / 2 + 10);
  });
}

/* ------------------------------------------------------------------------ */
/* Trees                                                                     */
/* ------------------------------------------------------------------------ */

function buildTreeData(kind, seed, height, color) {
  const cherry = kind === 'cherry';
  const R = makeRand(seed, cherry ? 11 : 23);
  const H = height;
  const s = H / (cherry ? 3.2 : 2.8);

  // --- trunk -------------------------------------------------------------
  const trunkH = H * (cherry ? 0.3 : 0.36);
  const la = R.range(0, TAU);
  const lean = R.range(0.04, 0.12) * s;
  const top = v3(Math.cos(la) * lean, trunkH, Math.sin(la) * lean);
  const jit = () => R.range(-0.035, 0.035) * s;
  const trunkCurve = new THREE.CatmullRomCurve3(
    [
      v3(0, -0.06, 0),
      v3(top.x * 0.1 + jit(), trunkH * 0.33, top.z * 0.1 + jit()),
      v3(top.x * 0.55 + jit(), trunkH * 0.68, top.z * 0.55 + jit()),
      top.clone(),
    ],
    false,
    'centripetal',
  );
  const r0 = 0.1 * s;
  const ph = R.range(0, TAU);
  const woodGeos = [
    taperedTube(trunkCurve, 18, 10, (t) =>
      r0 * (1 - 0.3 * t) * (1 + 0.9 * Math.pow(Math.max(0, 1 - t / 0.14), 2)) * (1 + 0.05 * Math.sin(t * 21 + ph)),
    ),
  ];

  // --- canopy envelope ---------------------------------------------------
  const cy = H * (cherry ? 0.7 : 0.66);
  const halfW = (cherry ? 1.3 : 1.12) * s;
  const halfH = (cherry ? 0.5 : 0.8) * s;
  const sq = cherry ? 0.8 : 0.92;
  const clusters = [];
  const clampC = (c, r) => {
    const dx = c.x - top.x;
    const dz = c.z - top.z;
    const d = Math.hypot(dx, dz);
    const maxD = Math.max(0, halfW - r * 0.95);
    if (d > maxD) {
      c.x = top.x + (dx / d) * maxD;
      c.z = top.z + (dz / d) * maxD;
    }
    if (c.y + r * sq > H) c.y = H - r * sq;
    return c;
  };

  // --- branches (each ends inside a blossom cluster) ---------------------
  const nb = R.int(3, 5);
  const a0 = R.range(0, TAU);
  for (let b = 0; b < nb; b++) {
    const ang = a0 + (b / nb) * TAU + R.range(-0.3, 0.3);
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const reach = halfW * (cherry ? R.range(0.45, 0.62) : R.range(0.36, 0.5));
    const tipR = (cherry ? R.range(0.5, 0.62) : R.range(0.55, 0.7)) * s;
    const tipY = cy + halfH * (cherry ? R.range(-0.4, 0.05) : R.range(-0.3, 0.15));
    const tip = clampC(v3(top.x + dx * reach, tipY, top.z + dz * reach), tipR);
    const start = trunkCurve.getPointAt(R.range(0.8, 0.96));
    const px = -dz;
    const pz = dx;
    const g1 = R.range(-0.09, 0.09) * s;
    const g2 = R.range(-0.08, 0.08) * s;
    const rise = tip.y - start.y;
    const o1 = cherry ? 0.45 : 0.3;
    const m1 = v3(lerp(start.x, tip.x, o1) + px * g1, start.y + rise * (cherry ? 0.2 : 0.35), lerp(start.z, tip.z, o1) + pz * g1);
    const m2 = v3(lerp(start.x, tip.x, 0.8) + px * g2, start.y + rise * 0.62, lerp(start.z, tip.z, 0.8) + pz * g2);
    const curve = new THREE.CatmullRomCurve3([start, m1, m2, tip], false, 'centripetal');
    const rb0 = r0 * R.range(0.55, 0.68);
    const rb1 = 0.022 * s;
    const bph = R.range(0, TAU);
    woodGeos.push(taperedTube(curve, 14, 7, (t) => lerp(rb0, rb1, Math.pow(t, 0.8)) * (1 + 0.07 * Math.sin(t * 15 + bph))));
    clusters.push({ c: tip.clone(), r: tipR });

    // side twigs carrying their own clusters
    const nTw = cherry ? R.int(1, 2) : R() < 0.7 ? 1 : 0;
    for (let k = 0; k < nTw; k++) {
      const p = curve.getPointAt(R.range(0.4, 0.7));
      const ta = ang + R.sign() * R.range(0.6, 1.1);
      const tl = halfW * (cherry ? R.range(0.25, 0.4) : R.range(0.22, 0.36));
      const tr = (cherry ? R.range(0.42, 0.52) : R.range(0.45, 0.6)) * s;
      const tt = clampC(v3(p.x + Math.cos(ta) * tl, p.y + R.range(0.15, 0.4) * s, p.z + Math.sin(ta) * tl), tr);
      const tm = p.clone().lerp(tt, 0.5);
      tm.y -= 0.05 * s;
      const tc = new THREE.CatmullRomCurve3([p, tm, tt], false, 'centripetal');
      const tr0 = rb0 * 0.5;
      woodGeos.push(taperedTube(tc, 8, 5, (t) => lerp(tr0, 0.012 * s, t)));
      clusters.push({ c: tt, r: tr });
    }
    // satellites around the tip
    const nSat = cherry ? 1 : 2;
    for (let k = 0; k < nSat; k++) {
      const sa = ang + R.range(-1.3, 1.3);
      const off = R.range(0.28, 0.45) * s;
      const r = (cherry ? R.range(0.4, 0.5) : R.range(0.42, 0.58)) * s;
      clusters.push({ c: clampC(v3(tip.x + Math.cos(sa) * off, tip.y + R.range(-0.15, 0.2) * s, tip.z + Math.sin(sa) * off), r), r });
    }
  }
  if (!cherry) {
    // central leader up into the dome
    const lt = v3(top.x + R.range(-0.08, 0.08) * s, cy + halfH * 0.35, top.z + R.range(-0.08, 0.08) * s);
    const lc = new THREE.CatmullRomCurve3([trunkCurve.getPointAt(0.9), top.clone().lerp(lt, 0.5).add(v3(jit(), 0, jit())), lt], false, 'centripetal');
    woodGeos.push(taperedTube(lc, 10, 7, (t) => lerp(r0 * 0.6, 0.02 * s, t)));
  }
  // crown fill
  const nTop = cherry ? R.int(2, 3) : R.int(2, 4);
  for (let k = 0; k < nTop; k++) {
    const r = (cherry ? R.range(0.5, 0.62) : R.range(0.52, 0.7)) * s;
    const spread = cherry ? 0.35 : 0.4;
    clusters.push({
      c: clampC(v3(top.x + R.range(-spread, spread) * s, cy + halfH * (cherry ? R.range(0.3, 0.6) : R.range(0.25, 0.5)), top.z + R.range(-spread, spread) * s), r),
      r,
    });
  }
  while (clusters.length < 14) {
    const a = R.range(0, TAU);
    const rr = R.range(0.25, 0.6) * halfW;
    const r = R.range(0.42, 0.55) * s;
    clusters.push({ c: clampC(v3(top.x + Math.cos(a) * rr, cy + halfH * R.range(-0.2, 0.45), top.z + Math.sin(a) * rr), r), r });
  }
  if (clusters.length > 24) clusters.length = 24;

  // --- canopy geometry (one merged, vertex-coloured mesh) ----------------
  let minY = Infinity;
  let maxY = -Infinity;
  for (const cl of clusters) {
    minY = Math.min(minY, cl.c.y - cl.r * sq);
    maxY = Math.max(maxY, cl.c.y + cl.r * sq);
  }
  const C = (h) => new THREE.Color(h);
  const pal = cherry
    ? [C('#f2a7c0'), C(color), C('#f7c6d6'), C('#fbd9e4'), C(color)]
    : [C(color), C(color).offsetHSL(-0.02, 0.03, 0.04), C(color).offsetHSL(0.006, 0, -0.03), C(color).offsetHSL(-0.035, 0.05, 0.03)];
  const canopyGeos = [];
  // colour drifts smoothly across the whole canopy (not per cluster) so it reads as one tree
  const hueField = makeNoise(R, { freq: 1.3 / s, octaves: 2 });
  const deepPal = pal.map((col) => (cherry ? col.clone().offsetHSL(-0.012, 0.16, -0.17) : col.clone().offsetHSL(0.008, 0.04, -0.11)));
  const lightPal = pal.map((col) => (cherry ? col.clone().lerp(WHITE, 0.3) : col.clone().offsetHSL(-0.045, 0.06, 0.09)));
  const tmpA = new THREE.Color();
  const tmpB = new THREE.Color();
  for (const cl of clusters) {
    const big = cl.r > (cherry ? 0.5 : 0.6) * s;
    const B = blob(R, { detail: big ? 5 : 4, lump: 0.12, puff: cherry ? 0.27 : 0.22, f1: 1.8, f2: 4.3 });
    const g = B.geo;
    g.scale(cl.r, cl.r * sq, cl.r);
    g.translate(cl.c.x, cl.c.y, cl.c.z);
    const jitter = R.range(-0.04, 0.04);
    paint(g, (c, i, x, y, z, nx, ny) => {
      const crev = smoothstep(0.08, 0.8, B.cav[i]);
      const gy = (y - minY) / (maxY - minY);
      const up = ny * 0.5 + 0.5;
      // pick a palette position from the smooth field
      const f = clamp(hueField(x, y, z) * 0.5 + 0.5, 0, 0.999) * (pal.length - 1);
      const k = Math.floor(f);
      const u = f - k;
      tmpA.copy(deepPal[k]).lerp(deepPal[k + 1], u);
      tmpB.copy(lightPal[k]).lerp(lightPal[k + 1], u);
      const t = clamp(0.04 + 0.46 * crev + 0.2 * up + 0.3 * gy + jitter + R.range(-0.05, 0.05), 0, 1);
      c.copy(tmpA).lerp(tmpB, t);
    });
    canopyGeos.push(g);
  }
  const canopyGeo = mergeAll(canopyGeos, ['position', 'normal', 'color']);
  const woodGeo = mergeAll(woodGeos, ['position', 'normal']);

  // --- fallen petals (cherry) ---------------------------------------------
  const petalM = [];
  const petalC = [];
  if (cherry) {
    const n = 90;
    for (let i = 0; i < n; i++) {
      const a = R.range(0, TAU);
      const rr = halfW * 1.15 * Math.sqrt(R());
      const sc = R.range(0.022, 0.034) * s;
      pushMatrix(petalM, [top.x + Math.cos(a) * rr, 0.004 + R() * 0.004, top.z + Math.sin(a) * rr], [R.range(-0.15, 0.15), R.range(0, TAU), R.range(-0.15, 0.15)], [sc, 1, sc * 0.62]);
      pushColor(petalC, R.pick(['#f7c6d6', '#f2a7c0', '#fbd9e4', '#ffffff', color]), 0.03, R);
    }
  }

  return {
    woodGeo,
    canopyGeo,
    petalM: new Float32Array(petalM),
    petalC: new Float32Array(petalC),
    canopy: clusters.map((c) => ({ center: c.c.clone(), radius: c.r })),
    swayPhase: R.range(0, TAU),
  };
}

function treeGroup(kind, data, { bark, emissive, emissiveIntensity, fluff }) {
  const group = new THREE.Group();
  group.name = kind;
  const sway = new THREE.Group();
  sway.name = 'sway';
  group.add(sway);
  sway.add(mesh(data.woodGeo, mat(bark, { roughness: 0.92 })));
  const canopyMat = fluffMat('#ffffff', { vertexColors: true, roughness: 0.9, emissive, emissiveIntensity }, fluff);
  const canopy = mesh(data.canopyGeo, canopyMat);
  canopy.name = 'canopy';
  sway.add(canopy);
  if (data.petalM.length) {
    const petalGeo = cached('p:petal', () => new THREE.CircleGeometry(1, 7).rotateX(-Math.PI / 2));
    const pm = mat('#ffffff', { roughness: 0.9, side: THREE.DoubleSide, emissive, emissiveIntensity: 0.05 });
    const petals = instanced(petalGeo, pm, data.petalM, data.petalC, { cast: false });
    petals.name = 'fallenPetals';
    group.add(petals);
  }
  group.userData.canopy = data.canopy.map((c) => ({ center: c.center.clone(), radius: c.radius }));
  const ph = data.swayPhase;
  group.userData.update = (t) => {
    const a = 0.011;
    sway.rotation.z = Math.sin(t * 0.55 + ph) * a + Math.sin(t * 1.31 + ph * 2) * a * 0.3;
    sway.rotation.x = Math.sin(t * 0.43 + ph * 1.7) * a * 0.7;
  };
  return group;
}

/**
 * Cherry blossom tree. ~2.6 wide canopy, `height` tall.
 * userData.canopy = [{ center: Vector3 (local), radius }]; userData.update sways gently.
 * petals = false skips the instanced fallen petals on the ground.
 */
export function makeCherryTree({ seed = 1, height = 3.2, color = '#f6b8cc', petals = true } = {}) {
  const data = cached(`tree:cherry:${seed}:${height}:${color}`, () => buildTreeData('cherry', seed, height, color));
  const d = petals ? data : { ...data, petalM: new Float32Array(0) };
  return treeGroup('cherryTree', d, { bark: '#4a3a3a', emissive: '#ffb3c8', emissiveIntensity: 0.08, fluff: [10, 0.014, 0.2] });
}

/** Summer shade tree with a green puffy dome. Same userData as makeCherryTree. */
export function makeRoundTree({ seed = 1, height = 2.8, color = '#3f8f4a' } = {}) {
  const data = cached(`tree:round:${seed}:${height}:${color}`, () => buildTreeData('round', seed, height, color));
  return treeGroup('roundTree', data, { bark: '#5a4a3e', emissive: '#4f8a3a', emissiveIntensity: 0.04, fluff: [11, 0.012, 0.22] });
}

/* ------------------------------------------------------------------------ */
/* Shrub & hedge                                                             */
/* ------------------------------------------------------------------------ */

/** Tiny five-petal blossom (unit radius) facing +Y, slightly cupped. */
function flowerGeo() {
  return cached('p:flower', () => {
    const s = new THREE.Shape();
    const n = 30;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const r = 0.45 + 0.55 * Math.pow(Math.abs(Math.cos(2.5 * a)), 0.7);
      if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const g = new THREE.ShapeGeometry(s, 1);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      pos.setY(i, 0.25 * r * r);
    }
    g.computeVertexNormals();
    return g;
  });
}

/** Small puffy bush ~size wide. `flowers` = colour string to scatter blossoms. */
export function makeShrub({ seed = 1, size = 0.6, color = '#3c7a45', flowers = null } = {}) {
  const data = cached(`shrub:${seed}:${size}:${color}:${flowers}`, () => {
    const R = makeRand(seed, 31);
    const S = size;
    const parts = [{ c: v3(0, S * 0.3, 0), r: S * 0.34 }];
    const n = R.int(4, 6);
    const a0 = R.range(0, TAU);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * TAU + R.range(-0.35, 0.35);
      const dd = S * R.range(0.17, 0.24);
      const r = S * R.range(0.2, 0.27);
      parts.push({ c: v3(Math.cos(a) * dd, r * 0.75 + R.range(0, 0.05) * S, Math.sin(a) * dd), r });
    }
    parts.push({ c: v3(R.range(-0.05, 0.05) * S, S * 0.5, R.range(-0.05, 0.05) * S), r: S * 0.24 });
    const baseCol = new THREE.Color(color);
    const geos = [];
    const blobs = [];
    const top = S * 0.75;
    for (const p of parts) {
      const B = blob(R, { detail: 3, lump: 0.1, puff: 0.18 });
      const g = B.geo;
      g.scale(p.r, p.r * 0.9, p.r);
      g.translate(p.c.x, p.c.y, p.c.z);
      // settle the bottom onto the ground
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < 0.01) pos.setY(i, 0.01 + (y - 0.01) * 0.15);
      }
      g.computeVertexNormals();
      const col = baseCol.clone().offsetHSL(R.range(-0.008, 0.008), 0, R.range(-0.015, 0.015));
      const deep = col.clone().offsetHSL(0.008, 0.05, -0.1);
      const light = col.clone().offsetHSL(-0.04, 0.05, 0.08);
      paint(g, (c, i, x, y, z, nx, ny) => {
        const crev = smoothstep(0.1, 0.85, B.cav[i]);
        const t = clamp(0.05 + 0.42 * crev + 0.2 * (ny * 0.5 + 0.5) + 0.3 * clamp(y / top, 0, 1) + R.range(-0.06, 0.06), 0, 1);
        c.copy(deep).lerp(light, t);
      });
      geos.push(g);
      blobs.push({ p, surf: B.surf });
    }
    const geo = mergeAll(geos, ['position', 'normal', 'color']);
    const fm = [];
    const fc = [];
    if (flowers) {
      const count = Math.max(8, Math.round(46 * (S / 0.6) ** 2));
      const d = new THREE.Vector3();
      const fcol = new THREE.Color(flowers);
      for (let i = 0; i < count; i++) {
        const b = R.pick(blobs);
        randDir(R, d);
        d.y = Math.abs(d.y) * 0.9 + 0.15;
        d.normalize();
        const rr = b.surf(d) * b.p.r;
        const y = b.p.c.y + d.y * rr * 0.9;
        if (y < 0.06 * S) continue;
        const sc = R.range(0.018, 0.025) * Math.sqrt(S / 0.6);
        const q = new THREE.Quaternion().setFromUnitVectors(_Y, d).multiply(new THREE.Quaternion().setFromAxisAngle(_Y, R.range(0, TAU)));
        _tmpM.compose(v3(b.p.c.x + d.x * rr * 1.01, y + 0.003, b.p.c.z + d.z * rr * 1.01), q, _tmpS.set(sc, sc, sc));
        for (let e = 0; e < 16; e++) fm.push(_tmpM.elements[e]);
        const c = fcol.clone().offsetHSL(R.range(-0.02, 0.02), 0, R.range(-0.05, 0.08));
        fc.push(c.r, c.g, c.b);
      }
    }
    return { geo, fm: new Float32Array(fm), fc: new Float32Array(fc) };
  });
  const group = new THREE.Group();
  group.name = 'shrub';
  group.add(mesh(data.geo, fluffMat('#ffffff', { vertexColors: true, roughness: 0.92 }, [17, 0.008, 0.2])));
  if (data.fm.length) {
    const fmat = mat('#ffffff', { roughness: 0.7, emissive: flowers, emissiveIntensity: 0.12 });
    group.add(instanced(flowerGeo(), fmat, data.fm, data.fc, { cast: false }));
  }
  return group;
}

/** Rounded-box topiary hedge w × h × d (footprint centred on origin) with a soft lumpy surface. */
export function makeHedge({ w = 1, d = 1, h = 0.8, color = '#2f6b3c', seed = 1 } = {}) {
  const geo = cached(`hedge:${w}:${d}:${h}:${color}:${seed}`, () => {
    const R = makeRand(seed, 41);
    const r = Math.min(0.17, Math.min(w, d, h) * 0.3);
    const dens = 13;
    const flat = [w, h, d].map((L) => clamp(Math.round((L - 2 * r) * dens), 1, 56));
    const noise = makeNoise(R, { freq: 11, octaves: 3, gain: 0.5 });
    const amp = Math.min(0.028, Math.min(w, d, h) * 0.04);
    const g = roundedBoxGeo(w, h, d, r, { seg: 4, flat, deform: (x, y, z) => amp * noise(x, y, z) });
    g.translate(0, h / 2, 0);
    const base = new THREE.Color(color);
    const deep = base.clone().offsetHSL(0.008, 0.04, -0.08);
    const light = base.clone().offsetHSL(-0.035, 0.06, 0.1);
    paint(g, (c, i, x, y, z, nx, ny) => {
      const n = noise(x, y - h / 2, z);
      const t = clamp(0.1 + 0.4 * smoothstep(-0.8, 0.8, n) + 0.32 * (y / h) + 0.12 * Math.max(0, ny) + R.range(-0.05, 0.05), 0, 1);
      c.copy(deep).lerp(light, t);
    });
    return g;
  });
  const group = new THREE.Group();
  group.name = 'hedge';
  group.add(mesh(geo, fluffMat('#ffffff', { vertexColors: true, roughness: 0.95 }, [20, 0.006, 0.22])));
  return group;
}

/* ------------------------------------------------------------------------ */
/* Fence                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * White picket fence from x = 0 to x = length, centred on z = 0, pickets on the
 * +Z side. gaps = [[x0, x1], ...] left open (e.g. for gates).
 */
export function makePicketFence(length = 4, { height = 0.55, color = '#f4f1ea', gaps = [] } = {}) {
  const group = new THREE.Group();
  group.name = 'picketFence';
  const H = height;
  const k = H / 0.55;
  const m = mat(color, { roughness: 0.72 });
  const G = gaps.map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
  const overlapsGap = (x0, x1) => G.some(([a, b]) => x1 > a && x0 < b);
  const insideGap = (x) => G.some(([a, b]) => x > a + 1e-3 && x < b - 1e-3);

  const spacing = 0.14;
  const pw = 0.088;
  const pt = 0.02;
  const pGeo = cached(`fence:picket:${H}`, () => {
    const hw = pw / 2;
    const tip = 0.055 * k;
    const s = new THREE.Shape();
    s.moveTo(-hw, 0.004);
    s.lineTo(hw, 0.004);
    s.lineTo(hw, H - tip);
    s.lineTo(0, H - 0.004);
    s.lineTo(-hw, H - tip);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: pt, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 1 });
    g.translate(0, 0, -pt / 2);
    return toCreasedNormals(g, 0.5);
  });

  const n = Math.max(1, Math.round(length / spacing));
  const step = length / n;
  const pm = [];
  for (let i = 0; i < n; i++) {
    const x = step * (i + 0.5);
    if (overlapsGap(x - pw / 2 - 0.01, x + pw / 2 + 0.01)) continue;
    pushMatrix(pm, [x, 0, 0.032], 0, 1);
  }
  if (pm.length) group.add(instanced(pGeo, m, pm));

  // rails between gaps
  const segs = [];
  let cur = 0;
  for (const [a, b] of [...G].sort((p, q) => p[0] - q[0])) {
    if (a > cur) segs.push([cur, Math.min(a, length)]);
    cur = Math.max(cur, b);
  }
  if (cur < length) segs.push([cur, length]);
  const rm = [];
  for (const [a, b] of segs) {
    const L = b - a;
    if (L < 0.02) continue;
    for (const y of [0.14 * k, 0.4 * k]) pushMatrix(rm, [(a + b) / 2, y, 0.008], 0, [L, 0.038 * k, 0.022]);
  }
  if (rm.length) group.add(instanced(prim.box(), m, rm));

  // posts every unit, plus ends and gate posts
  const postGeo = cached(`fence:post:${H}`, () => {
    const ph = H * 0.9;
    const P = [];
    P.push(xf(prim.box(), [0, ph / 2, 0], 0, [0.062, ph, 0.062]));
    P.push(xf(prim.cyl(4, 0, 1), [0, ph + 0.022, 0], [0, Math.PI / 4, 0], [0.05, 0.045, 0.05]));
    return mergeAll(P);
  });
  const xs = new Set();
  for (let x = 0; x <= length + 1e-6; x += 1) xs.add(+x.toFixed(3));
  xs.add(+length.toFixed(3));
  for (const [a, b] of G) {
    if (a > 0 && a < length) xs.add(+a.toFixed(3));
    if (b > 0 && b < length) xs.add(+b.toFixed(3));
  }
  const sorted = [...xs].filter((x) => !insideGap(x)).sort((p, q) => p - q);
  const postXs = [];
  for (const x of sorted) if (!postXs.length || x - postXs[postXs.length - 1] > 0.2 || x === +length.toFixed(3)) postXs.push(x);
  const qm = [];
  for (const x of postXs) {
    // keep posts fully inside the run
    const cx = clamp(x, 0.031, length - 0.031);
    pushMatrix(qm, [cx, 0, -0.03], 0, 1);
  }
  if (qm.length) group.add(instanced(postGeo, m, qm));
  return group;
}

/* ------------------------------------------------------------------------ */
/* Street furniture                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Classic suburban street lamp, ~1.85 tall.
 * userData.bulb (Mesh), userData.light (PointLight, when lit), userData.setLit(bool).
 */
export function makeLampPost({ lit = true } = {}) {
  const group = new THREE.Group();
  group.name = 'lampPost';
  const iron = mat('#1f2b26', { roughness: 0.55 });
  const baked = cached('lamp:body', () => {
    const P = new Parts();
    P.add(iron, lathe([[0, 0], [0.1, 0], [0.1, 0.035], [0.086, 0.045], [0.08, 0.065], [0.062, 0.085], [0.05, 0.13], [0.042, 0.2], [0.036, 0.3], [0.03, 0.335], [0.024, 0.35], [0.021, 0.36]], 20));
    P.add(iron, prim.cyl(14), [0, 0.95, 0], 0, [0.021, 1.2, 0.021]);
    P.add(iron, lathe([[0.021, 0.78], [0.032, 0.79], [0.034, 0.8], [0.032, 0.81], [0.021, 0.82]], 16));
    P.add(iron, lathe([[0.021, 1.47], [0.03, 1.5], [0.042, 1.53], [0.066, 1.553], [0.07, 1.563], [0.0, 1.564]], 16));
    P.add(iron, prim.box(), [0, 1.566, 0], 0, [0.13, 0.014, 0.13]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.raw(iron, between(prim.box(), v3(sx * 0.058, 1.566, sz * 0.058), v3(sx * 0.082, 1.728, sz * 0.082), 0.013, 0.013));
    P.add(iron, prim.box(), [0, 1.73, 0], 0, [0.186, 0.016, 0.186]);
    P.add(iron, prim.cyl(4, 0, 1), [0, 1.787, 0], [0, Math.PI / 4, 0], [0.118 * Math.SQRT2, 0.098, 0.118 * Math.SQRT2]);
    P.add(iron, prim.cyl(8), [0, 1.842, 0], 0, [0.011, 0.025, 0.011]);
    P.add(iron, prim.sphere(12, 8), [0, 1.862, 0], 0, 0.018);
    // little scroll arms under the lantern
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const curve = new THREE.QuadraticBezierCurve3(v3(c * 0.02, 1.42, s * 0.02), v3(c * 0.075, 1.46, s * 0.075), v3(c * 0.06, 1.55, s * 0.06));
      P.raw(iron, taperedTube(curve, 8, 5, (t) => lerp(0.007, 0.005, t)));
    }
    return P.bake();
  });
  spawn(baked, group);

  const glassGeo = cached('lamp:glass', () => xf(prim.cyl(4, 0.08 * Math.SQRT2, 0.058 * Math.SQRT2), [0, 1.647, 0], [0, Math.PI / 4, 0], [1, 0.16, 1]));
  const glassLit = mat('#fff3dc', { roughness: 0.3, emissive: '#ffcf8a', emissiveIntensity: 0.9 });
  const glassOff = mat('#cdd6d8', { roughness: 0.2 });
  const glass = mesh(glassGeo, lit ? glassLit : glassOff, { cast: false });
  glass.name = 'lanternGlass';
  group.add(glass);

  const bulbLit = mat('#fff6e6', { roughness: 0.4, emissive: '#ffd59a', emissiveIntensity: 2.4 });
  const bulbOff = mat('#e8e2d6', { roughness: 0.4 });
  const bulb = mesh(prim.sphere(14, 10), lit ? bulbLit : bulbOff, { cast: false, receive: false });
  bulb.scale.setScalar(0.034);
  bulb.position.set(0, 1.64, 0);
  bulb.name = 'bulb';
  group.add(bulb);
  group.userData.bulb = bulb;
  group.userData.glass = glass;

  const ensureLight = () => {
    if (!group.userData.light) {
      const light = new THREE.PointLight('#ffd59a', 2, 4, 2);
      light.position.set(0, 1.64, 0);
      light.castShadow = false;
      group.add(light);
      group.userData.light = light;
    }
    return group.userData.light;
  };
  if (lit) ensureLight();
  group.userData.setLit = (on) => {
    bulb.material = on ? bulbLit : bulbOff;
    glass.material = on ? glassLit : glassOff;
    if (on) ensureLight().visible = true;
    else if (group.userData.light) group.userData.light.visible = false;
  };
  return group;
}

/**
 * Rural mailbox on a wooden post (~0.75 tall). userData.flag = pivot Object3D
 * (rotation.x = 0 down, userData.flagUpAngle = -PI/2 up); userData.setFlag(bool).
 */
export function makeMailbox({ number = '1', color = '#2f3b52', flagUp = false } = {}) {
  const group = new THREE.Group();
  group.name = 'mailbox';
  const wood = mat('#8a6a4c', { roughness: 0.9 });
  const paintM = mat(color, { roughness: 0.6 });
  const metal = mat('#c9ccce', { roughness: 0.4, metalness: 0.5 });
  const red = mat('#d8392e', { roughness: 0.55 });
  const Y0 = 0.57; // underside of the box
  const bodyShape = (sc = 1) => {
    const s = new THREE.Shape();
    const hw = 0.075 * sc;
    s.moveTo(-hw, 0);
    s.lineTo(hw, 0);
    s.lineTo(hw, 0.09);
    s.absarc(0, 0.09, hw, 0, Math.PI, false);
    s.lineTo(-hw, 0);
    return s;
  };
  const baked = cached('mailbox:' + color, () => {
    const P = new Parts();
    P.add(wood, roundedBoxGeo(0.062, 0.55, 0.062, 0.008, { seg: 1, flat: 1 }), [0, 0.275, -0.03]);
    P.add(wood, roundedBoxGeo(0.17, 0.022, 0.25, 0.006, { seg: 1, flat: 1 }), [0, Y0 - 0.011, 0]);
    P.add(wood, roundedBoxGeo(0.03, 0.09, 0.03, 0.006, { seg: 1, flat: 1 }), [0, Y0 - 0.05, -0.075], [-0.6, 0, 0]);
    const bodyG = new THREE.ExtrudeGeometry(bodyShape(), { depth: 0.28, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 18 });
    bodyG.translate(0, Y0 + 0.004, -0.14);
    P.raw(paintM, toCreasedNormals(bodyG, 0.6));
    const doorG = new THREE.ExtrudeGeometry(bodyShape(1.06), { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 18 });
    doorG.translate(0, Y0 - 0.002, 0.146);
    P.raw(paintM, toCreasedNormals(doorG, 0.6));
    P.add(metal, prim.sphere(10, 8), [0, Y0 + 0.125, 0.162], 0, [0.012, 0.012, 0.009]);
    P.add(metal, prim.cyl(10), [0.084, Y0 + 0.12, -0.1], [0, 0, Math.PI / 2], [0.011, 0.022, 0.011]);
    return P.bake();
  });
  spawn(baked, group);

  // painted house numbers on both sides
  const tex = makeTextTexture(String(number), { font: 'bold 110px Georgia, serif', color: '#f6eedb', width: 256, height: 128 });
  if (tex) {
    const nm = mat('#ffffff', { map: tex, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const pg = cached('mailbox:numplane', () => new THREE.PlaneGeometry(0.13, 0.065));
    for (const sx of [-1, 1]) {
      const p = mesh(pg, nm, { cast: false });
      p.position.set(sx * 0.0805, Y0 + 0.048, 0.035);
      p.rotation.y = (sx * Math.PI) / 2;
      group.add(p);
    }
  }

  // flag on its pivot (+X side). Down: arm points forward along the side.
  const flag = new THREE.Group();
  flag.name = 'flag';
  flag.position.set(0.096, Y0 + 0.12, -0.1);
  const flagBaked = cached('mailbox:flag', () => {
    const P = new Parts();
    P.add(red, prim.box(), [0, 0, 0.075], 0, [0.007, 0.014, 0.165]);
    P.add(red, roundedBoxGeo(0.007, 0.056, 0.07, 0.003, { seg: 1, flat: 1 }), [0, 0.028, 0.13]);
    return P.bake();
  });
  spawn(flagBaked, flag);
  group.add(flag);
  group.userData.flag = flag;
  group.userData.flagUpAngle = -Math.PI / 2;
  group.userData.setFlag = (up) => {
    flag.rotation.x = up ? -Math.PI / 2 : 0;
  };
  group.userData.setFlag(flagUp);
  return group;
}

/** Stop sign on a ~1.5 tall pole, face toward +Z. */
export function makeStopSign() {
  const group = new THREE.Group();
  group.name = 'stopSign';
  const pole = mat('#a3a9ad', { roughness: 0.45, metalness: 0.35 });
  const back = mat('#9aa0a3', { roughness: 0.5, metalness: 0.3 });
  const R0 = 0.2;
  const cyc = 1.29;
  const baked = cached('stop:body', () => {
    const P = new Parts();
    P.add(pole, prim.cyl(10), [0, 0.7, -0.022], 0, [0.018, 1.4, 0.018]);
    P.add(pole, prim.cyl(10), [0, 0.012, -0.022], 0, [0.03, 0.024, 0.03]);
    const s = new THREE.Shape();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      if (i) s.lineTo(Math.cos(a) * R0, Math.sin(a) * R0);
      else s.moveTo(Math.cos(a) * R0, Math.sin(a) * R0);
    }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.01, bevelEnabled: false });
    g.translate(0, cyc, -0.006);
    P.raw(back, g);
    for (const y of [cyc + 0.12, cyc - 0.12]) P.add(pole, prim.cyl(8), [0, y, -0.011], [Math.PI / 2, 0, 0], [0.01, 0.012, 0.01]);
    return P.bake();
  });
  spawn(baked, group);
  const tex = stopSignTexture();
  const face = mesh(
    cached('stop:face', () => new THREE.CircleGeometry(R0, 8, Math.PI / 8)),
    tex ? mat('#ffffff', { map: tex, roughness: 0.5 }) : mat('#c9252d', { roughness: 0.5 }),
  );
  face.position.set(0, cyc, 0.0055);
  face.name = 'signFace';
  group.add(face);
  return group;
}

/** Galvanised trash can with lid, ~0.46 tall. */
export function makeTrashCan() {
  const group = new THREE.Group();
  group.name = 'trashCan';
  const metal = mat('#a7afb4', { roughness: 0.45, metalness: 0.35 });
  const lidM = mat('#b9c0c4', { roughness: 0.4, metalness: 0.35 });
  const baked = cached('trash', () => {
    const P = new Parts();
    const rAt = (y) => 0.132 + ((0.148 - 0.132) * (y - 0.03)) / 0.33;
    const prof = [[0, 0.004], [0.122, 0.004], [0.13, 0.012], [0.132, 0.03]];
    for (const y of [0.1, 0.2, 0.3]) {
      const r = rAt(y);
      prof.push([rAt(y - 0.014), y - 0.014], [r + 0.006, y - 0.005], [r + 0.006, y + 0.005], [rAt(y + 0.014), y + 0.014]);
    }
    prof.push([0.148, 0.36], [0.155, 0.366], [0.155, 0.376], [0, 0.376]);
    P.raw(metal, lathe(prof, 28, 0.6));
    P.raw(lidM, lathe([[0, 0.37], [0.163, 0.37], [0.166, 0.381], [0.16, 0.392], [0.14, 0.405], [0.1, 0.417], [0.05, 0.423], [0, 0.425]], 28, 0.6));
    P.add(metal, prim.torus(0.036, 0.007, 6, 14, Math.PI), [0, 0.422, 0]);
    for (const sx of [-1, 1]) {
      const c = new THREE.QuadraticBezierCurve3(v3(sx * 0.15, 0.315, -0.04), v3(sx * 0.2, 0.31, 0), v3(sx * 0.15, 0.315, 0.04));
      P.raw(metal, taperedTube(c, 10, 6, 0.007));
    }
    return P.bake();
  });
  return spawn(baked, group);
}

/** Classic red fire hydrant with cream caps, ~0.38 tall. */
export function makeFireHydrant() {
  const group = new THREE.Group();
  group.name = 'fireHydrant';
  const red = mat('#d63a2c', { roughness: 0.5 });
  const cream = mat('#f1ead9', { roughness: 0.55 });
  const baked = cached('hydrant', () => {
    const P = new Parts();
    P.raw(red, lathe([[0, 0], [0.1, 0], [0.1, 0.022], [0.088, 0.03], [0.072, 0.036], [0.066, 0.05], [0.064, 0.2], [0.062, 0.255], [0.078, 0.262], [0.08, 0.278], [0.066, 0.284], [0, 0.284]], 24, 0.6));
    P.raw(cream, lathe([[0, 0.28], [0.067, 0.28], [0.068, 0.3], [0.062, 0.318], [0.045, 0.338], [0.024, 0.35], [0, 0.352]], 24, 0.9));
    P.add(cream, prim.cyl(5), [0, 0.364, 0], 0, [0.02, 0.03, 0.02]);
    for (const sx of [-1, 1]) {
      P.add(red, prim.cyl(14), [sx * 0.078, 0.19, 0], [0, 0, Math.PI / 2], [0.026, 0.045, 0.026]);
      P.add(cream, prim.cyl(14), [sx * 0.104, 0.19, 0], [0, 0, Math.PI / 2], [0.031, 0.016, 0.031]);
      P.add(cream, prim.cyl(5), [sx * 0.117, 0.19, 0], [0, 0, Math.PI / 2], [0.013, 0.014, 0.013]);
    }
    P.add(red, prim.cyl(16), [0, 0.165, 0.078], [Math.PI / 2, 0, 0], [0.034, 0.045, 0.034]);
    P.add(cream, prim.cyl(16), [0, 0.165, 0.105], [Math.PI / 2, 0, 0], [0.04, 0.016, 0.04]);
    P.add(cream, prim.cyl(5), [0, 0.165, 0.118], [Math.PI / 2, 0, 0], [0.015, 0.014, 0.015]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      P.add(cream, prim.sphere(6, 4), [Math.cos(a) * 0.089, 0.024, Math.sin(a) * 0.089], 0, 0.007);
    }
    return P.bake();
  });
  return spawn(baked, group);
}

/** Park bench with wooden slats and dark iron ends, ~0.96 wide × 0.5 tall. */
export function makeBench() {
  const group = new THREE.Group();
  group.name = 'bench';
  const wood = mat('#c99d6e', { roughness: 0.75 });
  const iron = mat('#24302b', { roughness: 0.55 });
  const baked = cached('bench', () => {
    const P = new Parts();
    const r = 0.014;
    for (const sx of [-1, 1]) {
      const x = sx * 0.4;
      const curves = [
        new THREE.CatmullRomCurve3([v3(x, 0, 0.135), v3(x, 0.12, 0.128), v3(x, 0.235, 0.12)]),
        new THREE.LineCurve3(v3(x, 0.235, 0.13), v3(x, 0.235, -0.13)),
        new THREE.CatmullRomCurve3([v3(x, 0, -0.15), v3(x, 0.12, -0.137), v3(x, 0.235, -0.13), v3(x, 0.37, -0.152), v3(x, 0.5, -0.182)]),
        new THREE.CatmullRomCurve3([v3(x, 0.36, -0.15), v3(x, 0.358, 0.0), v3(x, 0.35, 0.12), v3(x, 0.325, 0.15), v3(x, 0.28, 0.135), v3(x, 0.237, 0.122)]),
      ];
      for (const c of curves) P.raw(iron, taperedTube(c, 12, 6, r));
      P.add(iron, prim.sphere(10, 6), [x, 0.008, 0.135], 0, [0.022, 0.012, 0.026]);
      P.add(iron, prim.sphere(10, 6), [x, 0.008, -0.15], 0, [0.022, 0.012, 0.026]);
      P.add(iron, prim.sphere(10, 8), [x, 0.352, 0.14], 0, 0.02);
    }
    const slat = roundedBoxGeo(0.98, 0.022, 0.056, 0.008, { seg: 1, flat: [4, 1, 1] });
    for (const z of [0.105, 0.036, -0.033, -0.102]) P.add(wood, slat, [0, 0.259, z]);
    const tilt = Math.atan2(0.03, 0.2);
    const backSlat = roundedBoxGeo(0.98, 0.056, 0.02, 0.008, { seg: 1, flat: [4, 1, 1] });
    for (const u of [0.18, 0.5, 0.82]) {
      const y = lerp(0.29, 0.49, u);
      const z = lerp(-0.13, -0.175, u) + 0.024;
      P.add(wood, backSlat, [0, y, z], [-tilt, 0, 0]);
    }
    return P.bake();
  });
  return spawn(baked, group);
}

/** Wooden telephone pole with crossarm (along X) and glass insulators. Wires run along ±Z. */
export function makeTelephonePole({ height = 3.6, transformer = false } = {}) {
  const group = new THREE.Group();
  group.name = 'telephonePole';
  const H = height;
  const wood = mat('#6f5b49', { roughness: 0.95 });
  const dark = mat('#3a3a3c', { roughness: 0.6 });
  const glassI = mat('#9fd6c8', { roughness: 0.25, emissive: '#6fb8a8', emissiveIntensity: 0.06 });
  const grey = mat('#8f979b', { roughness: 0.5, metalness: 0.3 });
  const armY = H - 0.26;
  const insX = [-0.42, -0.16, 0.16, 0.42];
  const baked = cached(`pole:${H}:${transformer}`, () => {
    const P = new Parts();
    P.add(wood, prim.cyl(10, 0.042, 0.058), [0, H / 2, 0], 0, [1, H, 1]);
    P.add(wood, prim.hemi(10, 4), [0, H, 0], 0, [0.042, 0.02, 0.042]);
    P.add(wood, roundedBoxGeo(1.0, 0.07, 0.075, 0.01, { seg: 1, flat: [6, 1, 1] }), [0, armY, 0.065]);
    for (const sx of [-1, 1]) P.raw(dark, between(prim.box(), v3(0, armY - 0.32, 0.05), v3(sx * 0.3, armY - 0.03, 0.065), 0.014, 0.008));
    for (const x of insX) {
      P.add(dark, prim.cyl(6), [x, armY + 0.06, 0.065], 0, [0.007, 0.06, 0.007]);
      P.raw(glassI, lathe([[0, armY + 0.05], [0.026, armY + 0.05], [0.03, armY + 0.062], [0.024, armY + 0.075], [0.022, armY + 0.095], [0.014, armY + 0.105], [0, armY + 0.108]], 12, 0.8).translate(x, 0, 0.065));
    }
    for (let y = 1.3, i = 0; y < H - 0.5; y += 0.3, i++) {
      const sx = i % 2 ? 1 : -1;
      P.add(dark, prim.cyl(6), [sx * 0.07, y, 0], [0, 0, Math.PI / 2], [0.008, 0.07, 0.008]);
    }
    if (transformer) {
      P.add(grey, prim.cyl(16), [0, H - 0.95, 0.15], 0, [0.09, 0.24, 0.09]);
      P.add(grey, prim.hemi(16, 4), [0, H - 0.83, 0.15], 0, [0.09, 0.025, 0.09]);
      P.add(dark, prim.box(), [0, H - 0.95, 0.06], 0, [0.05, 0.12, 0.03]);
      P.raw(glassI, lathe([[0, 0], [0.016, 0], [0.012, 0.03], [0, 0.034]], 8).translate(0.04, H - 0.81, 0.15));
    }
    return P.bake();
  });
  spawn(baked, group);
  group.userData.wireAnchors = insX.map((x) => v3(x, armY + 0.1, 0.065));
  return group;
}

/* ------------------------------------------------------------------------ */
/* Lawn & garden                                                             */
/* ------------------------------------------------------------------------ */

/**
 * HERO PROP — red push mower. Deck ~0.55 wide, ~1.2 long incl. handle, handle top
 * ~0.86. Drives toward +Z; handle rises toward −Z.
 * userData.body (Group to jiggle), userData.wheels (4 Groups, spin about local X),
 * userData.running (bool → built-in engine jiggle), userData.speed (units/s → wheel spin).
 */
export function makeLawnMower({ bag = false } = {}) {
  const group = new THREE.Group();
  group.name = 'lawnMower';
  const body = new THREE.Group();
  body.name = 'mowerBody';
  group.add(body);
  const red = mat('#e0352b', { roughness: 0.35 });
  const black = mat('#1e1e21', { roughness: 0.5 });
  const rubber = mat('#161616', { roughness: 0.85 });
  const hubM = mat('#d7d9db', { roughness: 0.45 });
  const steel = mat('#5d6166', { roughness: 0.45, metalness: 0.4 });
  const yellow = mat('#f2c230', { roughness: 0.5 });
  const fabric = mat('#3f5446', { roughness: 0.95 });

  const baked = cached('mower:body:' + bag, () => {
    const P = new Parts();
    // --- deck ---
    const deck = new THREE.ExtrudeGeometry(roundedRectShape(0.46, 0.62, 0.12), {
      depth: 0.1,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.03,
      bevelSegments: 5,
      curveSegments: 10,
    });
    deck.rotateX(-Math.PI / 2);
    deck.translate(0, 0.09, 0);
    P.raw(red, toCreasedNormals(deck, 0.55));
    P.add(red, prim.hemi(28, 8), [0, 0.224, 0.02], 0, [0.205, 0.055, 0.255]);
    // front bumper lip
    P.add(red, prim.capsule(0.018, 0.34, 4, 8), [0, 0.085, 0.335], [0, 0, Math.PI / 2]);
    // side discharge chute (+X)
    P.add(red, roundedBoxGeo(0.1, 0.085, 0.17, 0.035, { seg: 2, flat: 1 }), [0.255, 0.135, -0.07]);
    P.add(black, roundedBoxGeo(0.02, 0.055, 0.13, 0.01, { seg: 1, flat: 1 }), [0.3, 0.13, -0.07]);
    // wheel-height levers
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(black, roundedBoxGeo(0.026, 0.06, 0.03, 0.01, { seg: 1, flat: 1 }), [sx * 0.236, 0.245, sz * 0.245], [sz * 0.3, 0, 0]);
    // --- engine ---
    const ez = -0.045;
    P.add(black, prim.cyl(24), [0, 0.248, ez], 0, [0.13, 0.03, 0.13]);
    P.add(black, roundedBoxGeo(0.21, 0.07, 0.21, 0.03, { seg: 2, flat: 1 }), [0, 0.29, ez]);
    P.raw(black, lathe([[0, 0.3], [0.122, 0.3], [0.128, 0.31], [0.13, 0.36], [0.126, 0.395], [0.112, 0.418], [0.08, 0.43], [0, 0.434]], 28, 0.7).translate(0, 0, ez));
    P.add(steel, prim.cyl(24), [0, 0.435, ez], 0, [0.066, 0.01, 0.066]);
    P.add(black, roundedBoxGeo(0.1, 0.07, 0.075, 0.022, { seg: 2, flat: 1 }), [-0.085, 0.335, ez + 0.13]);
    P.add(yellow, prim.cyl(16), [0.072, 0.418, ez + 0.06], 0, [0.022, 0.026, 0.022]);
    P.add(steel, roundedBoxGeo(0.05, 0.055, 0.1, 0.016, { seg: 2, flat: 1 }), [0.135, 0.305, ez - 0.03]);
    P.add(black, prim.cyl(10), [0, 0.3, ez + 0.13], [Math.PI / 2, 0, 0], [0.012, 0.04, 0.012]);
    // pull cord + T-grip resting on top of the engine
    const cord = new THREE.QuadraticBezierCurve3(v3(0.03, 0.395, ez - 0.122), v3(0.04, 0.45, ez - 0.14), v3(0.035, 0.452, ez - 0.075));
    P.raw(steel, taperedTube(cord, 10, 4, 0.0035));
    P.add(black, prim.capsule(0.012, 0.045, 3, 8), [0.035, 0.452, ez - 0.07], [0, 0, Math.PI / 2]);
    // --- handle ---
    const ang = 50 * DEG;
    const dir = v3(0, Math.sin(ang), -Math.cos(ang));
    const L = (0.86 - 0.2) / Math.sin(ang);
    const BL = v3(-0.2, 0.2, -0.315);
    const BR = v3(0.2, 0.2, -0.315);
    const TL = BL.clone().addScaledVector(dir, L).add(v3(-0.015, 0, 0));
    const TR = BR.clone().addScaledVector(dir, L).add(v3(0.015, 0, 0));
    const uL = TL.clone().sub(BL).normalize();
    const uR = TR.clone().sub(BR).normalize();
    const rc = 0.06;
    const path = new THREE.CurvePath();
    path.add(new THREE.LineCurve3(BL, TL.clone().addScaledVector(uL, -rc)));
    path.add(new THREE.QuadraticBezierCurve3(TL.clone().addScaledVector(uL, -rc), TL.clone(), TL.clone().add(v3(rc, 0, 0))));
    path.add(new THREE.LineCurve3(TL.clone().add(v3(rc, 0, 0)), TR.clone().add(v3(-rc, 0, 0))));
    path.add(new THREE.QuadraticBezierCurve3(TR.clone().add(v3(-rc, 0, 0)), TR.clone(), TR.clone().addScaledVector(uR, -rc)));
    path.add(new THREE.LineCurve3(TR.clone().addScaledVector(uR, -rc), BR));
    P.raw(black, new THREE.TubeGeometry(path, 72, 0.012, 6, false));
    // foam grip
    P.add(rubber, prim.cyl(12), [0, TL.y, TL.z], [0, 0, Math.PI / 2], [0.019, 0.3, 0.019]);
    // lower crossbar
    const at = (u, side) => (side < 0 ? BL.clone().lerp(TL, u) : BR.clone().lerp(TR, u));
    P.raw(black, between(prim.cyl(8), at(0.3, -1), at(0.3, 1), 0.009));
    // folding knobs
    for (const sd of [-1, 1]) {
      const p = at(0.46, sd);
      P.add(black, prim.cyl(10), [p.x + sd * 0.022, p.y, p.z], [0, 0, Math.PI / 2], [0.02, 0.02, 0.02]);
      P.add(black, roundedBoxGeo(0.022, 0.07, 0.045, 0.008, { seg: 1, flat: 1 }), [sd * 0.2, 0.215, -0.31]);
    }
    // safety bail bar
    const AL = at(0.8, -1);
    const AR = at(0.8, 1);
    const o = v3(0, -0.035, 0.085);
    const bail = new THREE.CatmullRomCurve3(
      [AL, AL.clone().addScaledVector(o, 0.85).add(v3(0.008, 0, 0)), AL.clone().add(o).add(v3(0.06, 0, 0)), AR.clone().add(o).add(v3(-0.06, 0, 0)), AR.clone().addScaledVector(o, 0.85).add(v3(-0.008, 0, 0)), AR],
      false,
      'centripetal',
    );
    P.raw(black, new THREE.TubeGeometry(bail, 36, 0.008, 5, false));
    // throttle cable down the left bar
    const c0 = at(0.78, -1).add(v3(0.02, -0.01, 0.0));
    const cable = new THREE.CatmullRomCurve3([c0, at(0.45, -1).add(v3(0.03, -0.02, 0.02)), v3(-0.08, 0.38, ez - 0.11)], false, 'centripetal');
    P.raw(black, taperedTube(cable, 16, 4, 0.004));
    if (bag) {
      const R = makeRand(5, 5);
      const nz = makeNoise(R, { freq: 9, octaves: 2 });
      P.add(fabric, roundedBoxGeo(0.32, 0.27, 0.36, 0.1, { seg: 3, flat: 2, deform: (x, y, z) => 0.008 * nz(x, y, z) }), [0, 0.27, -0.56], [-0.18, 0, 0]);
      P.add(black, roundedBoxGeo(0.34, 0.05, 0.06, 0.02, { seg: 2, flat: 1 }), [0, 0.2, -0.38]);
    }
    return P.bake();
  });
  spawn(baked, body);

  // --- wheels (outside the jiggling body) ---
  const wheels = [];
  for (const [sx, sz, wr] of [[-1, 1, 0.095], [1, 1, 0.095], [-1, -1, 0.105], [1, -1, 0.105]]) {
    const w = new THREE.Group();
    w.name = 'wheel';
    w.position.set(sx * 0.292, wr, sz * 0.245);
    const wb = cached(`mower:wheel:${wr}:${sx}`, () => {
      const P = new Parts();
      P.add(rubber, prim.torus(wr - 0.03, 0.03, 8, 22), [0, 0, 0], [0, Math.PI / 2, 0]);
      const hr = wr - 0.042;
      P.add(hubM, prim.cyl(18), [0, 0, 0], [0, 0, Math.PI / 2], [hr, 0.05, hr]);
      P.add(hubM, prim.sphere(10, 6), [sx * 0.026, 0, 0], 0, [0.012, 0.028, 0.028]);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        P.add(steel, prim.sphere(6, 4), [sx * 0.026, Math.cos(a) * hr * 0.66, Math.sin(a) * hr * 0.66], 0, 0.0065);
      }
      return P.bake();
    });
    spawn(wb, w);
    w.userData.radius = wr;
    group.add(w);
    wheels.push(w);
  }

  const ud = group.userData;
  ud.body = body;
  ud.wheels = wheels;
  ud.running = false;
  ud.speed = 0;
  ud.update = (t, dt = 0) => {
    if (ud.running) {
      body.position.y = 0.0022 * Math.sin(t * 71) + 0.001 * Math.sin(t * 113);
      body.rotation.z = 0.0035 * Math.sin(t * 53);
      body.rotation.x = 0.0025 * Math.sin(t * 61 + 1);
    } else if (body.position.y !== 0 || body.rotation.z !== 0) {
      body.position.y = 0;
      body.rotation.set(0, 0, 0);
    }
    if (ud.speed) for (const w of wheels) w.rotation.x += (ud.speed * dt) / w.userData.radius;
  };
  return group;
}

/** Instanced patch of dandelions (yellow heads + ~15% seed puffballs) within `radius`. */
export function makeDandelions({ seed = 1, count = 40, radius = 1.2 } = {}) {
  const group = new THREE.Group();
  group.name = 'dandelions';
  const data = cached(`dand:${seed}:${count}:${radius}`, () => {
    const R = makeRand(seed, 51);
    const clumps = [];
    const nc = R.int(2, 4);
    for (let i = 0; i < nc; i++) {
      const a = R.range(0, TAU);
      const d = radius * 0.55 * Math.sqrt(R());
      clumps.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    const stems = [];
    const heads = [];
    const puffs = [];
    const leaves = [];
    const hc = [];
    for (let i = 0; i < count; i++) {
      let x;
      let z;
      if (R() < 0.7) {
        const c = R.pick(clumps);
        x = c[0] + R.gauss() * radius * 0.22;
        z = c[1] + R.gauss() * radius * 0.22;
      } else {
        const a = R.range(0, TAU);
        const d = radius * Math.sqrt(R());
        x = Math.cos(a) * d;
        z = Math.sin(a) * d;
      }
      const dd = Math.hypot(x, z);
      if (dd > radius) {
        x *= radius / dd;
        z *= radius / dd;
      }
      const puff = R() < 0.15;
      const h = puff ? R.range(0.1, 0.15) : R.range(0.05, 0.11);
      const lx = R.range(-0.18, 0.18);
      const lz = R.range(-0.18, 0.18);
      pushMatrix(stems, [x, 0, z], [lx, 0, lz], [1, h, 1]);
      // top of the tilted stem
      _tmpE.set(lx, 0, lz);
      const tip = v3(0, h, 0).applyEuler(_tmpE);
      if (puff) {
        const s = R.range(0.026, 0.034);
        pushMatrix(puffs, [x + tip.x, tip.y + s * 0.6, z + tip.z], [R.range(0, TAU), R.range(0, TAU), 0], s);
      } else {
        const s = R.range(0.02, 0.028);
        pushMatrix(heads, [x + tip.x, tip.y + s * 0.25, z + tip.z], [lx, R.range(0, TAU), lz], [s, s * 0.62, s]);
        pushColor(hc, R.pick(['#ffd23a', '#ffcc2e', '#ffdb4d', '#ffc824']), 0.03, R);
      }
      const nl = R.int(2, 3);
      const la = R.range(0, TAU);
      for (let k = 0; k < nl; k++) {
        const a = la + (k / nl) * TAU + R.range(-0.4, 0.4);
        const ls = R.range(0.6, 1.0);
        pushMatrix(leaves, [x, 0.004, z], [0, a, 0], [ls, ls, ls]);
      }
    }
    return { stems: new Float32Array(stems), heads: new Float32Array(heads), puffs: new Float32Array(puffs), leaves: new Float32Array(leaves), hc: new Float32Array(hc) };
  });
  const stemGeo = cached('dand:stem', () => new THREE.CylinderGeometry(0.0035, 0.005, 1, 5, 1).translate(0, 0.5, 0));
  const leafGeo = cached('dand:leaf', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(0.018, 0.03, 0.006, 0.085);
    s.lineTo(0, 0.095);
    s.lineTo(-0.006, 0.085);
    s.quadraticCurveTo(-0.018, 0.03, 0, 0);
    const g = new THREE.ShapeGeometry(s, 4);
    g.rotateX(-Math.PI / 2 + 0.25);
    return g;
  });
  if (data.stems.length) group.add(instanced(stemGeo, mat('#5f9a3e', { roughness: 0.8 }), data.stems, null, { cast: false }));
  if (data.leaves.length) group.add(instanced(leafGeo, mat('#4f8f3a', { roughness: 0.85, side: THREE.DoubleSide }), data.leaves, null, { cast: false }));
  if (data.heads.length) group.add(instanced(prim.ico(1), mat('#ffffff', { roughness: 0.7, emissive: '#ffb800', emissiveIntensity: 0.18 }), data.heads, data.hc));
  if (data.puffs.length) group.add(instanced(prim.ico(2), mat('#fbfbf6', { roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.18 }), data.puffs));
  return group;
}

/** Garden gnome ~0.46 tall: red cone hat, white beard, blue coat. */
export function makeGnome({ seed = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'gnome';
  const baked = cached('gnome:' + seed, () => {
    const R = makeRand(seed, 61);
    const coat = mat(R.pick(['#3f6fb8', '#3a66ad', '#4677c0']), { roughness: 0.65 });
    const hatM = mat(R.pick(['#d8332c', '#d23a30', '#dc2f33']), { roughness: 0.6 });
    const skin = mat('#f2c4a2', { roughness: 0.7 });
    const rosy = mat('#ee9c8a', { roughness: 0.65 });
    const beardM = mat('#f7f4ee', { roughness: 0.92 });
    const black = mat('#29231f', { roughness: 0.6 });
    const pants = mat('#6b4b35', { roughness: 0.8 });
    const gold = mat('#e2b64a', { roughness: 0.4, metalness: 0.4 });
    const P = new Parts();
    // boots + legs
    for (const sx of [-1, 1]) {
      P.add(black, prim.sphere(14, 10), [sx * 0.042, 0.02, 0.018], [0, sx * 0.15, 0], [0.034, 0.024, 0.05]);
      P.add(pants, prim.cyl(10), [sx * 0.038, 0.05, 0], 0, [0.03, 0.05, 0.03]);
    }
    // coat
    P.raw(coat, lathe([[0, 0.06], [0.085, 0.06], [0.104, 0.072], [0.106, 0.1], [0.1, 0.14], [0.088, 0.18], [0.07, 0.215], [0.042, 0.237], [0, 0.242]], 22, 1.2));
    P.add(black, prim.cyl(22), [0, 0.128, 0], 0, [0.103, 0.018, 0.103]);
    P.add(gold, roundedBoxGeo(0.03, 0.024, 0.01, 0.004, { seg: 1, flat: 1 }), [0, 0.128, 0.103]);
    // arms + hands (clasped over the belly)
    for (const sx of [-1, 1]) {
      const arm = new THREE.CatmullRomCurve3([v3(sx * 0.068, 0.212, -0.004), v3(sx * 0.09, 0.172, 0.028), v3(sx * 0.062, 0.143, 0.072), v3(sx * 0.036, 0.14, 0.09)], false, 'centripetal');
      P.raw(coat, taperedTube(arm, 12, 10, (t) => lerp(0.024, 0.019, t)));
      P.add(coat, prim.sphere(12, 8), [sx * 0.068, 0.212, -0.004], 0, 0.025);
      P.add(skin, prim.sphere(12, 8), [sx * 0.03, 0.14, 0.096], 0, 0.021);
    }
    // head + face
    P.add(skin, prim.sphere(20, 14), [0, 0.29, 0.008], 0, 0.058);
    P.add(rosy, prim.sphere(12, 8), [0, 0.281, 0.067], 0, 0.019);
    for (const sx of [-1, 1]) {
      P.add(rosy, prim.sphere(10, 6), [sx * 0.031, 0.276, 0.052], 0, [0.013, 0.01, 0.006]);
      P.add(black, prim.sphere(8, 6), [sx * 0.021, 0.298, 0.059], 0, 0.0075);
      P.add(beardM, prim.sphere(10, 8), [sx * 0.022, 0.266, 0.064], [0, 0, sx * -0.4], [0.024, 0.011, 0.012]);
    }
    // beard
    const bl = R.range(0.12, 0.14);
    P.raw(beardM, xf(lathe([[0, -bl], [0.018, -bl + 0.02], [0.04, -bl * 0.55], [0.056, -0.02], [0.058, 0.01], [0.045, 0.03], [0, 0.036]], 18, 1.4), [0, 0.262, 0.042], 0, [1, 1, 0.68]));
    // hat: bent cone
    const ba = R.range(0, TAU);
    const bm = R.range(0.03, 0.055);
    const bx = Math.cos(ba) * bm;
    const bz = Math.sin(ba) * bm - 0.02;
    const hatCurve = new THREE.CatmullRomCurve3([v3(0, 0.31, 0.002), v3(0, 0.362, -0.004), v3(bx * 0.45, 0.41, bz * 0.45), v3(bx, 0.462, bz)], false, 'centripetal');
    P.raw(hatM, taperedTube(hatCurve, 14, 14, (t) => 0.068 * Math.pow(1 - t, 0.95) + 0.003));
    P.add(hatM, prim.torus(0.064, 0.01, 8, 24), [0, 0.312, 0.002], [Math.PI / 2, 0, 0]);
    return P.bake();
  });
  return spawn(baked, group);
}

/** Stone birdbath ~0.6 tall with a glossy water disc. */
export function makeBirdbath() {
  const group = new THREE.Group();
  group.name = 'birdbath';
  const stone = mat('#d8d2c6', { roughness: 0.95 });
  const water = mat('#a9d8ea', { roughness: 0.1, emissive: '#7fc4de', emissiveIntensity: 0.12 });
  const baked = cached('birdbath', () => {
    const P = new Parts();
    P.raw(stone, lathe([[0, 0], [0.15, 0], [0.15, 0.035], [0.13, 0.045], [0.12, 0.06], [0.085, 0.075], [0.065, 0.1], [0.055, 0.15], [0.05, 0.25], [0.052, 0.33], [0.06, 0.38], [0.075, 0.41], [0.08, 0.425], [0, 0.425]], 28, 0.7));
    P.raw(stone, lathe([[0, 0.42], [0.07, 0.42], [0.14, 0.45], [0.21, 0.5], [0.25, 0.545], [0.265, 0.565], [0.27, 0.58], [0.262, 0.592], [0.245, 0.586], [0.2, 0.566], [0.12, 0.549], [0, 0.543]], 32, 0.8));
    return P.bake();
  });
  spawn(baked, group);
  const w = mesh(cached('birdbath:water', () => new THREE.CircleGeometry(0.228, 32).rotateX(-Math.PI / 2)), water, { cast: false });
  w.position.y = 0.572;
  w.name = 'water';
  group.add(w);
  return group;
}

/** Pink plastic lawn flamingo ~0.74 tall on thin wire legs. */
export function makeFlamingo({ seed = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'flamingo';
  const baked = cached('flamingo:' + seed, () => {
    const R = makeRand(seed, 71);
    const pink = mat('#f47aa7', { roughness: 0.4 });
    const pinkDark = mat('#e5608f', { roughness: 0.42 });
    const beakM = mat('#f6dcd2', { roughness: 0.5 });
    const black = mat('#1c1a1b', { roughness: 0.45 });
    const leg = mat('#3a3434', { roughness: 0.5 });
    const P = new Parts();
    for (const sx of [-1, 1]) {
      P.raw(leg, between(prim.cyl(6), v3(sx * 0.022, -0.02, 0.0), v3(sx * 0.018, 0.38, -0.01), 0.0055));
    }
    P.add(pink, prim.sphere(24, 16), [0, 0.425, -0.01], [-0.14, 0, 0], [0.074, 0.068, 0.13]);
    P.add(pink, prim.sphere(16, 10), [0, 0.452, -0.13], [0.45, 0, 0], [0.042, 0.028, 0.085]);
    for (const sx of [-1, 1]) P.add(pinkDark, prim.sphere(16, 10), [sx * 0.058, 0.44, -0.03], [-0.25, sx * 0.08, 0], [0.022, 0.05, 0.105]);
    const nb = R.range(-0.015, 0.015);
    const neck = new THREE.CatmullRomCurve3(
      [v3(0, 0.44, 0.08), v3(0, 0.5, 0.135 + nb), v3(0, 0.565, 0.105), v3(0, 0.625, 0.045 + nb), v3(0, 0.685, 0.05), v3(0, 0.715, 0.085)],
      false,
      'centripetal',
    );
    P.raw(pink, taperedTube(neck, 32, 10, (t) => lerp(0.024, 0.015, t)));
    const head = v3(0, 0.718, 0.1);
    P.add(pink, prim.sphere(16, 12), head, 0, [0.029, 0.027, 0.033]);
    for (const sx of [-1, 1]) P.add(black, prim.sphere(8, 6), [sx * 0.022, 0.726, 0.11], 0, 0.006);
    const b0 = v3(0, 0.713, 0.125);
    const b1 = v3(0, 0.704, 0.152);
    const b2 = v3(0, 0.672, 0.168);
    P.raw(beakM, taperedTube(new THREE.QuadraticBezierCurve3(b0, v3(0, 0.712, 0.142), b1), 6, 10, (t) => lerp(0.016, 0.011, t)));
    P.raw(black, taperedTube(new THREE.QuadraticBezierCurve3(b1, v3(0, 0.695, 0.166), b2), 6, 10, (t) => lerp(0.011, 0.0025, t)));
    P.add(black, prim.sphere(8, 6), b1, 0, 0.011);
    return P.bake();
  });
  spawn(baked, group);
  group.rotation.y = 0;
  return group;
}

/**
 * Small rotary lawn sprinkler (~0.1 tall). userData.update spins the head and
 * animates two arcing streams of instanced droplets (range ~0.9).
 * userData.on = false pauses the water.
 */
export function makeSprinkler() {
  const group = new THREE.Group();
  group.name = 'sprinkler';
  const green = mat('#2f8f57', { roughness: 0.5 });
  const brass = mat('#c9a24a', { roughness: 0.4, metalness: 0.4 });
  const yellow = mat('#f2c230', { roughness: 0.45 });
  const baked = cached('sprinkler:base', () => {
    const P = new Parts();
    P.raw(green, lathe([[0, 0], [0.07, 0], [0.074, 0.008], [0.068, 0.018], [0.03, 0.026], [0.014, 0.03], [0, 0.03]], 24, 0.8));
    P.add(brass, prim.cyl(10), [0, 0.055, 0], 0, [0.008, 0.05, 0.008]);
    return P.bake();
  });
  spawn(baked, group);
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 0.08;
  const hb = cached('sprinkler:head', () => {
    const P = new Parts();
    P.add(yellow, prim.cyl(12), [0, 0, 0], 0, [0.014, 0.022, 0.014]);
    for (const sx of [-1, 1]) {
      const c = new THREE.CatmullRomCurve3([v3(0, 0, 0), v3(sx * 0.035, 0.004, 0), v3(sx * 0.058, 0.014, 0), v3(sx * 0.064, 0.018, sx * 0.012)], false, 'centripetal');
      P.raw(yellow, taperedTube(c, 10, 6, (t) => lerp(0.007, 0.005, t)));
      P.add(brass, prim.sphere(8, 6), [sx * 0.064, 0.018, sx * 0.013], 0, 0.006);
    }
    return P.bake();
  });
  spawn(hb, head);
  group.add(head);

  const N = 140;
  const dropMat = mat('#d9f2ff', { roughness: 0.15, transparent: true, opacity: 0.75, depthWrite: false, emissive: '#bfe6ff', emissiveIntensity: 0.35 });
  const drops = new THREE.InstancedMesh(prim.ico(0), dropMat, N);
  drops.name = 'droplets';
  drops.castShadow = false;
  drops.receiveShadow = false;
  drops.frustumCulled = false;
  drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(drops);
  const R = makeRand(7, 81);
  const P = [];
  for (let i = 0; i < N; i++) P.push({ ph: R(), vh: R.range(0.85, 1.12), vy: R.range(1.05, 1.3), ja: R.range(-0.05, 0.05), sz: R.range(0.007, 0.011), arm: i % 2 });
  const spin = 1.6;
  const g = 3.0;
  const ny = 0.098;
  const m = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const ud = group.userData;
  ud.on = true;
  ud.update = (t) => {
    head.rotation.y = t * spin;
    for (let i = 0; i < N; i++) {
      const p = P[i];
      if (!ud.on) {
        drops.setMatrixAt(i, hidden);
        continue;
      }
      const life = (p.vy + Math.sqrt(p.vy * p.vy + 2 * g * ny)) / g;
      const age = (t / life + p.ph) % 1;
      const tau = age * life;
      const a = (t - tau) * spin + p.arm * Math.PI + p.ja + 0.2;
      const cx = Math.cos(a);
      const cz = -Math.sin(a);
      const r = 0.064 + p.vh * tau;
      const y = ny + p.vy * tau - 0.5 * g * tau * tau;
      if (y < 0) {
        drops.setMatrixAt(i, hidden);
        continue;
      }
      const s = p.sz * (1 - age * 0.35);
      m.makeScale(s, s * 1.25, s).setPosition(cx * r, y, cz * r);
      drops.setMatrixAt(i, m);
    }
    drops.instanceMatrix.needsUpdate = true;
  };
  ud.update(0);
  return group;
}

/* ------------------------------------------------------------------------ */
/* Car                                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Rounded vintage sedan ~1.0 × 0.7 × 2.0 (front = +Z).
 * Seed picks two-tone roof / whitewalls. userData.wheels spin about local X.
 */
export function makeCar({ color = '#9fc7c9', seed = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'car';
  const R = makeRand(seed, 91);
  const twoTone = R() < 0.55;
  const whitewalls = R() < 0.75;
  const roofColor = twoTone ? '#f6f1e4' : color;
  const paintM = mat(color, { roughness: 0.38 });
  const roofM = mat(roofColor, { roughness: 0.38 });
  const chrome = mat('#e6eaee', { roughness: 0.22, metalness: 0.75 });
  const glass = mat('#27313d', { roughness: 0.12, metalness: 0.1 });
  const tireM = mat('#18181a', { roughness: 0.85 });
  const wallM = mat('#f2efe8', { roughness: 0.7 });
  const lens = mat('#fff8e4', { roughness: 0.3, emissive: '#fff1c8', emissiveIntensity: 0.5 });
  const tail = mat('#d43a33', { roughness: 0.4, emissive: '#b0201a', emissiveIntensity: 0.25 });
  const dark = mat('#2a2d31', { roughness: 0.6 });

  const baked = cached(`car:${color}:${roofColor}`, () => {
    const P = new Parts();
    const bodyPost = (v) => {
      const yf = (v.y + 0.13) / 0.26;
      v.y -= 0.05 * smoothstep(0.42, 1.0, Math.abs(v.z) / 0.95) * yf * yf; // rounded hood & trunk
      v.x *= 1 - 0.035 * yf;
    };
    P.add(paintM, roundedBoxGeo(0.84, 0.26, 1.9, 0.12, { seg: 3, flat: [3, 2, 10], post: bodyPost }), [0, 0.31, 0]);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // pontoon fenders, slightly drooping toward the bumpers
        P.add(paintM, roundedBoxGeo(0.17, 0.205, 0.6, 0.085, { seg: 3, flat: [1, 1, 3] }), [sx * 0.415, 0.308, sz * 0.6], [sz * 0.05, 0, 0]);
      }
    }
    const ch = 0.2;
    const taper = (v) => {
      const f = (v.y + ch / 2) / ch;
      v.x *= 1 - 0.12 * f;
      v.z *= 1 - 0.22 * f;
    };
    P.add(glass, roundedBoxGeo(0.76, ch, 1.0, 0.085, { seg: 3, flat: [3, 2, 4], post: taper }), [0, 0.54, -0.1]);
    const dome = (v) => {
      if (v.y > 0) v.y += 0.024 * Math.max(0, 1 - (v.x / 0.35) ** 2) * Math.max(0, 1 - (v.z / 0.41) ** 2);
    };
    P.add(roofM, roundedBoxGeo(0.7, 0.06, 0.82, 0.03, { seg: 3, flat: [4, 1, 4], post: dome }), [0, 0.655, -0.1]);
    // pillars
    const pil = (a, b) => P.raw(roofM, between(prim.box(), a, b, 0.042, 0.04));
    for (const sx of [-1, 1]) {
      pil(v3(sx * 0.345, 0.44, 0.372), v3(sx * 0.306, 0.645, 0.268));
      pil(v3(sx * 0.382, 0.44, -0.13), v3(sx * 0.336, 0.645, -0.13));
      pil(v3(sx * 0.345, 0.44, -0.572), v3(sx * 0.306, 0.645, -0.468));
    }
    // belt line, chrome trim
    for (const sx of [-1, 1]) {
      P.add(chrome, prim.capsule(0.007, 1.3, 3, 6), [sx * 0.422, 0.37, -0.02], [Math.PI / 2, 0, 0]);
      for (const z of [0.04, -0.34]) P.add(chrome, prim.capsule(0.006, 0.03, 3, 6), [sx * 0.425, 0.405, z], [Math.PI / 2, 0, 0]);
    }
    // bumpers + guards
    for (const sz of [-1, 1]) {
      P.add(chrome, prim.capsule(0.036, 0.84, 4, 10), [0, 0.2, sz * 0.968], [0, 0, Math.PI / 2]);
      for (const sx of [-1, 1]) P.add(chrome, prim.capsule(0.016, 0.05, 3, 8), [sx * 0.2, 0.235, sz * 0.985]);
    }
    // grille
    P.add(dark, roundedBoxGeo(0.36, 0.11, 0.02, 0.012, { seg: 2, flat: 1 }), [0, 0.305, 0.952]);
    for (const y of [0.275, 0.305, 0.335]) P.add(chrome, prim.capsule(0.007, 0.32, 3, 6), [0, y, 0.963], [0, 0, Math.PI / 2]);
    // headlights in the fender noses
    for (const sx of [-1, 1]) {
      P.add(chrome, prim.torus(0.036, 0.008, 6, 18), [sx * 0.415, 0.345, 0.896]);
      P.add(lens, prim.sphere(16, 10), [sx * 0.415, 0.345, 0.898], 0, [0.034, 0.034, 0.014]);
      P.add(tail, prim.sphere(12, 8), [sx * 0.415, 0.33, -0.898], 0, [0.025, 0.035, 0.012]);
    }
    // hood ornament
    P.add(chrome, prim.sphere(10, 8), [0, 0.445, 0.86], 0, [0.012, 0.012, 0.032]);
    return P.bake();
  });
  spawn(baked, group);

  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Group();
      w.name = 'wheel';
      w.position.set(sx * 0.415, 0.137, sz * 0.6);
      const wb = cached(`car:wheel:${sx}:${whitewalls}`, () => {
        const P = new Parts();
        P.add(tireM, prim.torus(0.093, 0.044, 8, 22), [0, 0, 0], [0, Math.PI / 2, 0]);
        P.add(tireM, prim.cyl(20), [0, 0, 0], [0, 0, Math.PI / 2], [0.07, 0.07, 0.07]);
        if (whitewalls) P.add(wallM, cached('car:wall', () => new THREE.RingGeometry(0.062, 0.1, 22)), [sx * 0.041, 0, 0], [0, (sx * Math.PI) / 2, 0]);
        P.add(chrome, prim.sphere(12, 8), [sx * 0.03, 0, 0], 0, [0.024, 0.062, 0.062]);
        return P.bake();
      });
      spawn(wb, w);
      w.userData.radius = 0.137;
      group.add(w);
      wheels.push(w);
    }
  }
  group.userData.wheels = wheels;
  return group;
}

/* ------------------------------------------------------------------------ */
/* Sky                                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Puffy cloud of smooth merged blobs, ~3.4 × 1.4 × 1.2 at scale 1, origin at its
 * flat base. No shadows. userData.update bobs it gently.
 */
export function makeCloud({ seed = 1, scale = 1 } = {}) {
  const geo = cached(`cloud:${seed}`, () => {
    const R = makeRand(seed, 101);
    const parts = [{ c: v3(0, 0.5, 0), r: 0.72 }];
    const n = R.int(5, 7);
    for (let i = 0; i < n; i++) {
      const x = R.range(-1.3, 1.3);
      const r = lerp(0.62, 0.36, Math.abs(x) / 1.3) * R.range(0.85, 1.15);
      parts.push({ c: v3(x, r * 0.55 + R.range(0, 0.12), R.range(-0.3, 0.3)), r });
    }
    for (let i = 0, k = R.int(1, 2); i < k; i++) parts.push({ c: v3(R.range(-0.55, 0.55), 0.85, R.range(-0.2, 0.2)), r: R.range(0.38, 0.5) });
    const geos = [];
    const floor = 0.12;
    for (const p of parts) {
      const B = blob(R, { detail: 5, lump: 0.06, puff: 0.07, f1: 1.4, f2: 3 });
      const g = B.geo;
      g.scale(p.r, p.r, p.r);
      g.translate(p.c.x, p.c.y, p.c.z);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < floor) pos.setY(i, floor + (y - floor) * 0.18);
      }
      g.computeVertexNormals();
      geos.push(g);
    }
    const out = mergeAll(geos, ['position', 'normal']);
    out.computeBoundingBox();
    out.translate(0, -out.boundingBox.min.y, 0);
    out.computeBoundingBox();
    const top = out.boundingBox.max.y;
    const lo = new THREE.Color('#d5dfee');
    paint(out, (c, i, x, y) => c.copy(lo).lerp(WHITE, smoothstep(0, top * 0.75, y)));
    return out;
  });
  const group = new THREE.Group();
  group.name = 'cloud';
  const m = mesh(geo, mat('#ffffff', { vertexColors: true, roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.35 }), { cast: false, receive: false });
  m.scale.setScalar(scale);
  group.add(m);
  const ph = makeRand(seed, 102)() * TAU;
  group.userData.update = (t) => {
    m.position.y = Math.sin(t * 0.3 + ph) * 0.05 * scale;
  };
  return group;
}
