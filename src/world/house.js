// The suburban house. Built from analytic parts so it can be built as a slice
// (xRange) — every part is clipped to the range and stays a closed solid, which
// lets a house be exploded into pieces for the perspective illusions.
import * as THREE from 'three';
import { patchMaterial } from '../core/materials.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const texCache = new Map();
function canvasTex(key, draw, size = 256) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

function sidingTex() {
  return canvasTex('siding', (g, s) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, s, s);
    const rows = 14;
    for (let i = 0; i < rows; i++) {
      const y = (i * s) / rows;
      const grad = g.createLinearGradient(0, y, 0, y + s / rows);
      grad.addColorStop(0, 'rgba(0,0,0,0.13)');
      grad.addColorStop(0.18, 'rgba(0,0,0,0.0)');
      grad.addColorStop(0.9, 'rgba(255,255,255,0.05)');
      grad.addColorStop(1, 'rgba(0,0,0,0.05)');
      g.fillStyle = grad;
      g.fillRect(0, y, s, s / rows);
    }
  });
}

function shingleTex() {
  return canvasTex('shingles', (g, s) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, s, s);
    const r = rng(3);
    const rows = 10, cols = 8;
    for (let j = 0; j < rows; j++) {
      for (let i = -1; i < cols + 1; i++) {
        const x = (i + (j % 2) * 0.5) * (s / cols);
        const v = 0.86 + r() * 0.16;
        g.fillStyle = `rgb(${Math.floor(255 * v)},${Math.floor(255 * v)},${Math.floor(255 * v)})`;
        g.fillRect(x + 1, j * (s / rows) + 1, s / cols - 2, s / rows - 1);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, (j + 1) * (s / rows) - 2, s, 2);
    }
  });
}

const matCache = new Map();
function M(color, o = {}) {
  const k = color + JSON.stringify(Object.keys(o).filter((x) => x !== 'map').map((x) => [x, o[x]])) + (o.map ? o.map.uuid : '');
  if (matCache.has(k)) return matCache.get(k);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, ...o });
  patchMaterial(m, { mist: true });
  matCache.set(k, m);
  return m;
}

// planar uvs: walls get (horizontal, y), tops get (x, z)
function planarUV(g, s = 1) {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    if (ny > 0.5) uv.setXY(i, x * s, z * s);
    else if (nx > 0.5) uv.setXY(i, z * s, y * s);
    else uv.setXY(i, x * s, y * s);
  }
  uv.needsUpdate = true;
}

export function buildHouse(opts = {}) {
  const {
    w = 3, d = 2.6, H = 1.3, roofH = 0.95, color = '#e88a7d', roof = '#3d4157', trim = '#f7f2ea',
    doorColor = '#f7f2ea', shutter = '#3f4a5e', xRange = null, lit = false, porch = true, dormers = true,
    chimney = true, seed = 1, glass = '#40506e', door = true,
  } = opts;
  const X0 = xRange ? xRange[0] : -1e9;
  const X1 = xRange ? xRange[1] : 1e9;
  const group = new THREE.Group();
  const out = { group, door: null, glow: null, windows: [] };

  const wallM = M(color, { map: sidingTex(), roughness: 0.78 });
  const trimM = M(trim, { roughness: 0.6 });
  const roofM = M(roof, { map: shingleTex(), roughness: 0.9 });
  const baseM = M('#b9aca3', { roughness: 0.95 });
  const glassM = lit
    ? M('#ffd79a', { emissive: new THREE.Color('#ffb860'), emissiveIntensity: 1.6, roughness: 0.3 })
    : M(glass, { roughness: 0.18, metalness: 0.1, emissive: new THREE.Color('#1c2438'), emissiveIntensity: 0.3 });
  const shutterM = M(shutter, { roughness: 0.7 });
  const brickM = M('#a8645a', { roughness: 0.9 });
  const doorM = M(doorColor, { roughness: 0.55 });

  const add = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh; };
  const box = (x0, x1, y0, y1, z0, z1, mat, uvScale = 0) => {
    const a = Math.max(x0, X0), b = Math.min(x1, X1);
    if (b - a < 1e-4) return null;
    const g = new THREE.BoxGeometry(b - a, y1 - y0, z1 - z0);
    g.translate((a + b) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (uvScale) planarUV(g, uvScale);
    return add(new THREE.Mesh(g, mat));
  };
  // closed prism along x with a cross-section polygon in (z, y), CCW
  const prismX = (x0, x1, pts, mat, uvScale = 1) => {
    const a = Math.max(x0, X0), b = Math.min(x1, X1);
    if (b - a < 1e-4) return null;
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: b - a, bevelEnabled: false });
    // extrude runs along +Z in shape space (x=z, y=y); rotate so it runs along +X
    g.rotateY(-Math.PI / 2);
    g.translate(b, 0, 0);
    g.computeVertexNormals();
    planarUV(g, uvScale);
    return add(new THREE.Mesh(g, mat));
  };
  const prismZ = (z0, z1, pts, mat, cx, uvScale = 1) => {
    if (cx < X0 || cx >= X1) return null;
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false });
    g.translate(0, 0, z0);
    g.computeVertexNormals();
    planarUV(g, uvScale);
    return add(new THREE.Mesh(g, mat));
  };
  const inX = (x) => x >= X0 && x < X1;

  const fh = 0.12; // foundation height
  const hw = w / 2, hd = d / 2;
  box(-hw - 0.03, hw + 0.03, 0, fh, -hd - 0.03, hd + 0.03, baseM);
  box(-hw, hw, fh, H, -hd, hd, wallM, 1.0);
  // corner boards
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * hw, z = sz * hd;
    box(x - 0.035, x + 0.035, fh, H, z - 0.035, z + 0.035, trimM);
  }
  // fascia band under eaves
  box(-hw - 0.02, hw + 0.02, H - 0.06, H, -hd - 0.02, hd + 0.02, trimM);

  // gable fill + roof
  const ov = 0.2, ovx = 0.16;
  prismX(-hw, hw, [[-hd, H], [hd, H], [0, H + roofH]], wallM, 1.0);
  const slope = Math.hypot(hd + ov, roofH * (hd + ov) / hd);
  const ang = Math.atan2(roofH, hd);
  for (const s of [-1, 1]) {
    const a = Math.max(-hw - ovx, X0), b = Math.min(hw + ovx, X1);
    if (b - a > 1e-4) {
      const g = new THREE.BoxGeometry(b - a, 0.07, slope);
      planarUV(g, 1.6);
      const m = add(new THREE.Mesh(g, roofM));
      m.position.set((a + b) / 2, H + roofH / 2 - 0.02 + 0.03, s * (hd + ov) / 2);
      m.rotation.x = s * ang;
      // the box rotates around its centre; nudge so the eave overhangs
      m.position.y = H + roofH * (1 - (hd + ov) / hd / 2) + 0.035;
    }
  }
  box(-hw - ovx, hw + ovx, H + roofH - 0.02, H + roofH + 0.06, -0.05, 0.05, M(roof, { roughness: 0.8 }));

  // dormers on the front slope
  if (dormers && w >= 2.4) {
    for (const cx of [-w * 0.26, w * 0.26]) {
      if (!inX(cx)) continue;
      const dw = 0.46, dh = 0.42;
      const zf = hd * 0.38; // front face of dormer
      const yb = H + roofH * (1 - zf / hd) - 0.05;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, 0.7), wallM);
      planarUV(body.geometry, 1);
      body.position.set(cx, yb + dh / 2, zf - 0.35);
      g.add(body);
      const wnd = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.04), glassM);
      wnd.position.set(cx, yb + dh * 0.45, zf + 0.005);
      g.add(wnd);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.03), trimM);
      fr.position.set(cx, yb + dh * 0.45, zf - 0.006);
      g.add(fr);
      out.windows.push(wnd);
      for (const m of g.children) { m.castShadow = m.receiveShadow = true; }
      group.add(g);
      // little gable roof along z
      const rw = dw / 2 + 0.07, rh = 0.24;
      const r = prismZ(zf - 0.75, zf + 0.08, [[cx - rw, yb + dh], [cx + rw, yb + dh], [cx, yb + dh + rh]], roofM, cx, 1.6);
      prismZ(zf - 0.7, zf, [[cx - dw / 2, yb + dh], [cx + dw / 2, yb + dh], [cx, yb + dh + rh - 0.04]], wallM, cx, 1);
    }
  }

  // chimney
  if (chimney) {
    const cx = hw * 0.55, cz = -hd * 0.35;
    box(cx - 0.14, cx + 0.14, H + 0.2, H + roofH + 0.45, cz - 0.14, cz + 0.14, brickM);
    box(cx - 0.17, cx + 0.17, H + roofH + 0.45, H + roofH + 0.52, cz - 0.17, cz + 0.17, M('#7d4842'));
  }

  // windows (front, either side of the door, and on the side walls)
  const win = (x, y, z, nx, nz, ww = 0.34, wh = 0.42) => {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.08, wh + 0.08, 0.04), trimM);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(ww, wh, 0.04), glassM);
    gl.position.z = 0.012;
    const mullV = new THREE.Mesh(new THREE.BoxGeometry(0.025, wh, 0.05), trimM);
    const mullH = new THREE.Mesh(new THREE.BoxGeometry(ww, 0.025, 0.05), trimM);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.14, 0.035, 0.1), trimM);
    sill.position.set(0, -wh / 2 - 0.05, 0.03);
    g.add(frame, gl, mullV, mullH, sill);
    if (nz !== 0) {
      for (const s of [-1, 1]) {
        const sh = new THREE.Mesh(new THREE.BoxGeometry(0.13, wh + 0.06, 0.03), shutterM);
        sh.position.set(s * (ww / 2 + 0.12), 0, 0.005);
        g.add(sh);
      }
    }
    for (const m of g.children) { m.castShadow = true; m.receiveShadow = true; }
    g.position.set(x, y, z);
    g.rotation.y = Math.atan2(nx, nz);
    group.add(g);
    out.windows.push(gl);
  };
  const wy = fh + (H - fh) * 0.55;
  const frontX = opts.frontWindows ?? [-w * 0.32, w * 0.32];
  for (const x of frontX) if (inX(x)) win(x, wy, hd + 0.02, 0, 1);
  if (X0 <= -hw + 0.01) win(-hw - 0.02, wy, 0, -1, 0);
  if (X1 >= hw - 0.01) win(hw + 0.02, wy, 0, 1, 0);
  for (const x of [-w * 0.3, w * 0.3]) if (inX(x)) win(x, wy, -hd - 0.02, 0, -1);

  // door
  if (door && inX(0)) {
    const dw = 0.44, dh = 0.8;
    const fr = box(-dw / 2 - 0.06, dw / 2 + 0.06, fh - 0.02, fh + dh + 0.08, hd - 0.01, hd + 0.04, trimM);
    // warm interior behind the door
    const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd28f').multiplyScalar(1.6) });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(dw, dh), glowM);
    glow.position.set(0, fh + dh / 2, hd + 0.042);
    glow.visible = false;
    group.add(glow);
    out.glow = glow;
    const pivot = new THREE.Group();
    pivot.position.set(-dw / 2, fh + dh / 2, hd + 0.05);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, 0.04), doorM);
    panel.position.x = dw / 2;
    panel.castShadow = true;
    pivot.add(panel);
    for (const [yy, hh] of [[0.18, 0.26], [-0.18, 0.26]]) {
      const inset = new THREE.Mesh(new THREE.BoxGeometry(dw * 0.7, hh, 0.02), M(doorColor, { roughness: 0.4, color: new THREE.Color(doorColor).multiplyScalar(0.92) }));
      inset.position.set(dw / 2, yy, 0.025);
      pivot.add(inset);
    }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), M('#c9a45a', { metalness: 0.7, roughness: 0.3 }));
    knob.position.set(dw - 0.07, -0.02, 0.04);
    pivot.add(knob);
    group.add(pivot);
    out.door = pivot;
    // transom light
    const tr = new THREE.Mesh(new THREE.BoxGeometry(dw, 0.1, 0.03), glassM);
    tr.position.set(0, fh + dh + 0.04, hd + 0.045);
    group.add(tr);
    // porch lamp
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffdca0').multiplyScalar(lit ? 2.5 : 0.9) }));
    lamp.position.set(dw / 2 + 0.17, fh + dh * 0.8, hd + 0.06);
    group.add(lamp);
    out.lamp = lamp;
  }

  // porch: shed roof on posts, railings
  if (porch === true) {
    const pd = 0.92, ph = fh + 1.0;
    const cols = [-hw + 0.08, -0.5, 0.5, hw - 0.08];
    for (const x of cols) box(x - 0.045, x + 0.045, 0.1, ph, hd + pd - 0.09, hd + pd, trimM);
    // roof slab
    const a = Math.max(-hw - 0.05, X0), b = Math.min(hw + 0.05, X1);
    if (b - a > 1e-4) {
      const g = new THREE.BoxGeometry(b - a, 0.06, pd + 0.2);
      planarUV(g, 1.6);
      const m = add(new THREE.Mesh(g, roofM));
      m.position.set((a + b) / 2, ph + 0.1, hd + pd / 2 + 0.02);
      m.rotation.x = 0.22;
    }
    box(-hw, hw, ph - 0.05, ph + 0.03, hd + pd - 0.11, hd + pd + 0.01, trimM);
    // railings between outer posts (leave the middle open)
    for (const [x0, x1] of [[cols[0], cols[1]], [cols[2], cols[3]]]) {
      box(x0, x1, 0.38, 0.42, hd + pd - 0.07, hd + pd - 0.03, trimM);
      box(x0, x1, 0.14, 0.17, hd + pd - 0.07, hd + pd - 0.03, trimM);
      for (let x = x0 + 0.1; x < x1 - 0.05; x += 0.1) box(x - 0.012, x + 0.012, 0.15, 0.4, hd + pd - 0.06, hd + pd - 0.04, trimM);
    }
  }
  return out;
}

// a simple boxy neighbour house for backgrounds (cheap, few parts)
export function buildFarHouse({ color = '#e9a99c', roof = '#3d4157', w = 2.2, d = 2, H = 1.1, seed = 1 } = {}) {
  return buildHouse({ w, d, H, roofH: 0.75, color, roof, porch: false, dormers: false, chimney: seed % 2 === 0, seed });
}
