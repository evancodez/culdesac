// Shared level plumbing: environment (sky, sun, mist, grade), props, tiles.
import * as THREE from 'three';
import { Terrain } from '../core/terrain.js';
import { G, makeSky, patchTree, opartify } from '../core/materials.js';
import { makeMotes } from '../core/fx.js';

export class Level {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.graph = game.graph;
    this.fx = game.fx;
    this.updaters = [];
    this.terrains = [];
    this.undoable = false;
    this.prompts = [];
    this.done = false;
    this.cameraLimits = { pitchMin: 8, pitchMax: 89.4 };
    this.followGravity = false;
  }

  // ---------------------------------------------------------------- environment
  environment(o) {
    const scene = this.scene;
    this.env = o;
    const sky = makeSky();
    const su = sky.material.uniforms;
    su.uTop.value.set(o.skyTop);
    su.uHorizon.value.set(o.skyHorizon);
    su.uBottom.value.set(o.skyBottom ?? o.mist?.color ?? o.skyHorizon);
    su.uSunColor.value.set(o.sunGlow ?? o.sunColor ?? '#ffe2b8');
    su.uStars.value = o.stars ?? 0;
    this.sky = sky;
    scene.add(sky);

    const sunDir = o.sunDir.clone().normalize();
    su.uSunDir.value.copy(sunDir);
    this.sunDir = sunDir;
    const sun = new THREE.DirectionalLight(o.sunColor ?? '#fff1dc', o.sunIntensity ?? 2.6);
    sun.castShadow = true;
    const sb = o.shadowBox ?? 16;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -sb, right: sb, top: sb, bottom: -sb, near: 1, far: 120 });
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 3;
    this.sun = sun;
    this.sunCenter = (o.center ?? new THREE.Vector3()).clone();
    sun.position.copy(this.sunCenter).addScaledVector(sunDir, 50);
    sun.target.position.copy(this.sunCenter);
    scene.add(sun, sun.target);

    const hemi = new THREE.HemisphereLight(o.hemiSky ?? '#cfe3ff', o.hemiGround ?? '#6d7a5a', o.hemiIntensity ?? 0.9);
    scene.add(hemi);
    this.hemi = hemi;
    if (o.fill) {
      const fill = new THREE.DirectionalLight(o.fill.color, o.fill.intensity);
      fill.position.copy(o.fill.dir).multiplyScalar(30);
      scene.add(fill);
      this.fill = fill;
    }

    G.uMistColor.value.set(o.mist?.color ?? o.skyHorizon);
    G.uMistTop.value = o.mist?.top ?? -3;
    G.uMistBottom.value = o.mist?.bottom ?? -10;
    if (o.strata) o.strata.forEach((c, i) => G['uStrata' + i].value.set(c));
    G.uOpAmount.value = 1;

    // image-based light from a gradient of the same sky
    this.makeEnvironment(o);

    const u = this.game.post.u;
    const gr = o.grade ?? {};
    u.uSat.value = gr.sat ?? 1.05;
    u.uContrast.value = gr.contrast ?? 1.04;
    u.uLift.value.set(...(gr.lift ?? [0.0, 0.0, 0.01]));
    u.uGain.value.set(...(gr.gain ?? [1, 1, 1]));
    u.uVignette.value = gr.vignette ?? 0.32;
    u.uTilt.value = gr.tilt ?? 0.55;
    u.uBW.value = 0;
    this.game.post.renderer.toneMappingExposure = o.exposure ?? 1.0;
    this.game.post.bloom.strength = o.bloom ?? 0.3;

    if (o.motes !== false) {
      const m = makeMotes({ center: o.center ?? new THREE.Vector3(), size: new THREE.Vector3(26, 12, 26), color: o.moteColor ?? '#fff3d6', count: o.moteCount ?? 240 });
      this.fx.addMotes(m);
      this.motes = m;
    }
  }

  makeEnvironment(o) {
    const pmrem = new THREE.PMREMGenerator(this.game.post.renderer);
    const s = new THREE.Scene();
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(o.envTop ?? o.skyTop) },
        mid: { value: new THREE.Color(o.envHorizon ?? o.skyHorizon) },
        bot: { value: new THREE.Color(o.envBottom ?? o.hemiGround ?? '#556b4a') },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top, mid, bot; varying vec3 vP; void main(){ float y = normalize(vP).y; vec3 c = y > 0.0 ? mix(mid, top, pow(y, 0.6)) : mix(mid, bot, pow(-y, 0.5)); gl_FragColor = vec4(c, 1.0); }',
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), m));
    const rt = pmrem.fromScene(s, 0.02);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = o.envIntensity ?? 0.55;
    pmrem.dispose();
  }

  // ---------------------------------------------------------------- building
  terrain(opts) {
    const t = new Terrain(opts);
    this.terrains.push(t);
    return t;
  }

  // place a prop on the ground at (x, y, z)
  prop(obj, x, y, z, { rot = 0, scale = 1, parent = null, block = false, opart = false, mist = true } = {}) {
    obj.position.set(x, y, z);
    obj.rotation.y = rot;
    obj.scale.setScalar(scale);
    patchTree(obj, { mist });
    if (obj.name === 'cloud') obj.traverse((o) => { if (o.material?.emissive) { o.material.emissiveIntensity = 0.08; o.material.color?.setScalar?.(0.92); } });
    if (opart) opartify(obj, typeof opart === 'number' ? opart : 1);
    (parent ?? this.scene).add(obj);
    if (obj.userData.update) this.updaters.push(obj.userData.update);
    if (block) {
      const t = this.graph.at(x, y, z, 'top');
      if (t) t.blocked = true;
    }
    return obj;
  }

  tile(x, y, z, face = 'top') {
    const t = this.graph.at(x, y, z, face);
    if (!t) console.warn('no tile at', x, y, z, face);
    return t;
  }

  // ---------------------------------------------------------------- hooks
  update(dt, t) {
    for (const u of this.updaters) u(t, dt);
  }
  onArrive(tile, from) {}
  getState() { return null; }
  setState(s) {}
  canEnter(tile) { return true; }
  kick() { return false; }
  get busy() { return false; }
}

// distant floating lots in the haze (McGloughlin-style repetition of the suburb)
export function farIslands(level, { count = 5, grass, colors, center = new THREE.Vector3(), radius = 28, y = -6, buildHouse }) {
  const r = rng(99);
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group();
    const ang = (i / count) * Math.PI * 2 + r() * 0.5;
    const dist = radius + r() * 10;
    g.position.set(center.x + Math.cos(ang) * dist, y + r() * 5, center.z + Math.sin(ang) * dist);
    g.rotation.y = r() * Math.PI * 2;
    level.scene.add(g);
    const T = level.terrain({ grass, tileMinY: 0, shells: 4 });
    T.fill(-2, 2, -2, 2, { top: 0, bottom: -3, kind: 'grass' });
    T.paint(-2, 2, 2, 2, { kind: 'sidewalk' });
    T.build({ graph: null, parent: g, castShadow: false });
    const h = buildHouse({ w: 2.2, d: 2, H: 1.0, roofH: 0.7, porch: false, dormers: false, color: colors[i % colors.length], seed: 40 + i });
    h.group.position.set(0, 0, -0.4);
    g.add(h.group);
    const base = g.position.clone();
    level.updaters.push((t) => { g.position.y = base.y + Math.sin(t * 0.25 + i * 2) * 0.4; });
  }
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
