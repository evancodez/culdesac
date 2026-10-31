// Particles: sparkles, petals, grass clippings, dust puffs, and ambient motes.
import * as THREE from 'three';
import { G } from './materials.js';

const SHAPES = { soft: 0, petal: 1, spark: 2, clip: 3, ring: 4 };

export class Particles {
  constructor(max = 600, { shape = 'soft', additive = false } = {}) {
    this.max = max;
    this.n = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.g = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.col = new Float32Array(max * 4);
    this.rot = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.sway = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aRot', this.aRot);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 50 }, uShape: { value: SHAPES[shape] } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute vec4 aColor; attribute float aRot;
        uniform float uScale;
        varying vec4 vColor; varying float vRot;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(aSize * uScale, 0.0);
          vColor = aColor; vRot = aRot;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uShape;
        varying vec4 vColor; varying float vRot;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float c = cos(vRot), s = sin(vRot);
          p = mat2(c, -s, s, c) * p;
          float a;
          if (uShape < 0.5) {
            a = smoothstep(0.5, 0.0, length(p));
            a *= a;
          } else if (uShape < 1.5) {
            vec2 q = p * vec2(2.4, 1.3);
            float d = length(q) + 0.25 * q.x;
            a = smoothstep(0.62, 0.48, d);
            vec3 col = mix(vColor.rgb, vColor.rgb * 1.15 + 0.08, smoothstep(0.4, -0.3, q.x));
            gl_FragColor = vec4(col, a * vColor.a);
            if (gl_FragColor.a < 0.01) discard;
            return;
          } else if (uShape < 2.5) {
            float d = length(p);
            float star = max(smoothstep(0.06, 0.0, abs(p.x)) * smoothstep(0.5, 0.0, abs(p.y)), smoothstep(0.06, 0.0, abs(p.y)) * smoothstep(0.5, 0.0, abs(p.x)));
            a = max(star, smoothstep(0.22, 0.0, d));
          } else if (uShape < 3.5) {
            vec2 q = p * vec2(5.0, 1.2);
            a = smoothstep(0.55, 0.4, length(q));
          } else {
            float d = length(p);
            a = smoothstep(0.08, 0.0, abs(d - 0.38));
          }
          gl_FragColor = vec4(vColor.rgb, a * vColor.a);
          if (gl_FragColor.a < 0.01) discard;
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  emit({ pos, vel = null, life = 1, size = 0.1, size1 = null, color = '#ffffff', alpha = 1, rot = null, spin = 0, gravity = null, drag = 0.5, sway = 0 }) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.p[i * 3] = pos.x; this.p[i * 3 + 1] = pos.y; this.p[i * 3 + 2] = pos.z;
    this.v[i * 3] = vel?.x ?? 0; this.v[i * 3 + 1] = vel?.y ?? 0; this.v[i * 3 + 2] = vel?.z ?? 0;
    this.g[i * 3] = gravity?.x ?? 0; this.g[i * 3 + 1] = gravity?.y ?? 0; this.g[i * 3 + 2] = gravity?.z ?? 0;
    this.life[i] = this.maxLife[i] = life;
    this.size[i] = size;
    this.size1[i] = size1 ?? size;
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    this.col[i * 4] = c.r; this.col[i * 4 + 1] = c.g; this.col[i * 4 + 2] = c.b; this.col[i * 4 + 3] = alpha;
    this.rot[i] = rot ?? Math.random() * 6.28;
    this.spin[i] = spin;
    this.drag[i] = drag;
    this.sway[i] = sway;
  }

  clear() { this.n = 0; }

  update(dt, t, pixelsPerUnit) {
    this.mat.uniforms.uScale.value = pixelsPerUnit;
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      if (j !== i) {
        for (let k = 0; k < 3; k++) {
          this.p[j * 3 + k] = this.p[i * 3 + k]; this.v[j * 3 + k] = this.v[i * 3 + k]; this.g[j * 3 + k] = this.g[i * 3 + k];
        }
        for (let k = 0; k < 4; k++) this.col[j * 4 + k] = this.col[i * 4 + k];
        this.life[j] = this.life[i]; this.maxLife[j] = this.maxLife[i]; this.size[j] = this.size[i]; this.size1[j] = this.size1[i];
        this.rot[j] = this.rot[i]; this.spin[j] = this.spin[i]; this.drag[j] = this.drag[i]; this.sway[j] = this.sway[i];
      }
      const d = Math.exp(-this.drag[j] * dt);
      for (let k = 0; k < 3; k++) {
        this.v[j * 3 + k] = this.v[j * 3 + k] * d + this.g[j * 3 + k] * dt;
        this.p[j * 3 + k] += this.v[j * 3 + k] * dt;
      }
      if (this.sway[j]) {
        this.p[j * 3] += Math.sin(t * 1.7 + j) * this.sway[j] * dt;
        this.p[j * 3 + 2] += Math.cos(t * 1.3 + j * 1.7) * this.sway[j] * dt;
      }
      this.rot[j] += this.spin[j] * dt;
      j++;
    }
    this.n = j;
    const P = this.aPos.array, S = this.aSize.array, C = this.aColor.array, R = this.aRot.array;
    for (let i = 0; i < this.n; i++) {
      P[i * 3] = this.p[i * 3]; P[i * 3 + 1] = this.p[i * 3 + 1]; P[i * 3 + 2] = this.p[i * 3 + 2];
      const k = 1 - this.life[i] / this.maxLife[i];
      S[i] = this.size[i] + (this.size1[i] - this.size[i]) * k;
      const fade = Math.min(1, this.life[i] / Math.min(0.4, this.maxLife[i] * 0.5)) * Math.min(1, k * 8 + 0.2);
      C[i * 4] = this.col[i * 4]; C[i * 4 + 1] = this.col[i * 4 + 1]; C[i * 4 + 2] = this.col[i * 4 + 2];
      C[i * 4 + 3] = this.col[i * 4 + 3] * fade;
      R[i] = this.rot[i];
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aColor.needsUpdate = this.aRot.needsUpdate = true;
  }
}

// drifting, twinkling dust motes (image 3's floating specks), all on the GPU
export function makeMotes({ count = 260, center = new THREE.Vector3(), size = new THREE.Vector3(24, 10, 24), color = '#fff6dc', scale = 0.07 } = {}) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = center.x + (Math.random() - 0.5) * size.x;
    pos[i * 3 + 1] = center.y + (Math.random() - 0.5) * size.y;
    pos[i * 3 + 2] = center.z + (Math.random() - 0.5) * size.z;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: G.uTime, uScale: { value: 50 }, uSize: { value: scale }, uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime, uScale, uSize; varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime * (0.15 + aSeed * 0.2);
        p += vec3(sin(t + aSeed * 40.0), sin(t * 0.7 + aSeed * 13.0) * 0.6, cos(t * 0.8 + aSeed * 21.0)) * 0.8;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (0.8 + aSeed * 2.0) + aSeed * 60.0), 3.0);
        gl_PointSize = uSize * uScale * (0.6 + aSeed * 0.8);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha; varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor, a * a * vA * uAlpha); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 11;
  return pts;
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.soft = new Particles(800, { shape: 'soft' });
    this.glow = new Particles(600, { shape: 'spark', additive: true });
    this.petals = new Particles(500, { shape: 'petal' });
    this.clips = new Particles(500, { shape: 'clip' });
    this.rings = new Particles(40, { shape: 'ring', additive: true });
    this.all = [this.soft, this.glow, this.petals, this.clips, this.rings];
    for (const p of this.all) scene.add(p.points);
    this.motes = [];
  }

  attach(scene) {
    for (const p of this.all) { p.clear(); scene.add(p.points); }
    this.scene = scene;
  }

  addMotes(m) { this.motes.push(m); this.scene.add(m); return m; }

  update(dt, t, ppu) {
    for (const p of this.all) p.update(dt, t, ppu);
    for (const m of this.motes) m.material.uniforms.uScale.value = ppu;
  }

  puff(pos, up, { n = 6, color = '#efe6da', size = 0.12 } = {}) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5), 0, (Math.random() - 0.5)).multiplyScalar(0.9);
      v.addScaledVector(up, -v.dot(up)).addScaledVector(up, 0.25 + Math.random() * 0.3);
      this.soft.emit({ pos, vel: v, life: 0.5 + Math.random() * 0.3, size, size1: size * 2.2, color, alpha: 0.55, drag: 4 });
    }
  }

  sparkle(pos, { n = 10, spread = 0.6, color = '#fff4d8', size = 0.14, up = new THREE.Vector3(0, 1, 0), life = 1.2 } = {}) {
    for (let i = 0; i < n; i++) {
      const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread));
      const v = up.clone().multiplyScalar(0.2 + Math.random() * 0.5);
      this.glow.emit({ pos: p, vel: v, life: life * (0.6 + Math.random() * 0.6), size: size * (0.5 + Math.random()), size1: 0, color, alpha: 0.9, spin: (Math.random() - 0.5) * 2, drag: 1.5 });
    }
  }

  ring(pos, { color = '#fff4d8', size = 0.5, size1 = 3.5, life = 0.9 } = {}) {
    this.rings.emit({ pos, life, size, size1, color, alpha: 0.9, rot: 0 });
  }

  clippings(pos, dir, up, n = 4) {
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(-0.6 - Math.random() * 0.8).addScaledVector(up, 0.8 + Math.random() * 1.2);
      v.x += (Math.random() - 0.5) * 1.2; v.z += (Math.random() - 0.5) * 1.2;
      const c = new THREE.Color().setHSL(0.27 + Math.random() * 0.06, 0.55, 0.42 + Math.random() * 0.2);
      this.clips.emit({ pos, vel: v, life: 0.7 + Math.random() * 0.5, size: 0.09, color: c, gravity: up.clone().multiplyScalar(-4.5), drag: 0.8, spin: (Math.random() - 0.5) * 14 });
    }
  }

  petal(pos, { color = '#f7bfd0', gravity = new THREE.Vector3(0, -0.35, 0), wind = new THREE.Vector3(0.25, 0, 0.1) } = {}) {
    const c = new THREE.Color(color).offsetHSL((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.08);
    this.petals.emit({ pos, vel: wind.clone().multiplyScalar(0.5 + Math.random()), life: 5 + Math.random() * 4, size: 0.085, color: c, gravity, drag: 0.6, spin: (Math.random() - 0.5) * 4, sway: 0.5, alpha: 0.95 });
  }
}
