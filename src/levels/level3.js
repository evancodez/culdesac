// No. 3 — Underside (dusk -> night).
// A blossom street on a slab of land, with a second, upside-down, black-and-white
// street hanging beneath it. You start directly above where you need to be.
//   - the bridge over the canal can be re-seen: look straight down through the
//     gap and the bridge on the far side connects your road, so it moves to you
//   - the road folds over the east edge (assemble it from a low eastern view);
//     walk down it and the world turns over with you
//   - a zoetrope in the cul-de-sac animates only because you orbit the camera
import * as THREE from 'three';
import { Level, rng } from './base.js';
import { MorphSet, assembleSet } from '../core/illusion.js';
import { dirFromYawPitch } from '../core/camera.js';
import { Terrain } from '../core/terrain.js';
import { Tile } from '../core/tiles.js';
import { buildHouse } from '../world/house.js';
import { buildFigure } from '../core/character.js';
import { G, opartify, patchTree } from '../core/materials.js';
import { audio } from '../core/audio.js';
import * as P from '../world/props.js';

const GRASS = { height: 0.12, root: '#1d3530', tip: '#5d9f6a', tip2: '#8fb878', stripes: 0.05, scale: 0.24 };
const ROAD = { style: 'white' };
const X0 = -10, X1 = 7, Z0 = -5, Z1 = 4;

function streetRows(T, x0, x1, { top = true, under = true } = {}) {
  const north = { axis: [1, 0, 0], a: 'edge', b: 'center', ...ROAD };
  const south = { axis: [1, 0, 0], a: 'center', b: 'edge', ...ROAD };
  T.paint(x0, x1, -1, -1, { ...(top ? { kind: 'road', road: north } : {}), ...(under ? { under: 'road', underRoad: north } : {}) });
  T.paint(x0, x1, 0, 0, { ...(top ? { kind: 'road', road: south } : {}), ...(under ? { under: 'road', underRoad: south } : {}) });
  T.paint(x0, x1, -2, -2, { ...(top ? { kind: 'sidewalk' } : {}), ...(under ? { under: 'sidewalk' } : {}) });
  T.paint(x0, x1, 1, 1, { ...(top ? { kind: 'sidewalk' } : {}), ...(under ? { under: 'sidewalk' } : {}) });
}

export class Level3 extends Level {
  static meta = { number: 4, title: 'Underside', quote: 'There is another street beneath this one.' };

  constructor(game) {
    super(game);
    this.mood = 'dusk';
    this.followGravity = true;
    this.cameraStart = { yaw: 32, pitch: 30, zoom: 9.2, target: new THREE.Vector3(-6, 0, 0) };
    this.cameraLimits = { pitchMin: -38, pitchMax: 89.6, zoomMin: 4.5, zoomMax: 14 };
    this.hintDelay = 60;
    this.flip = 0;
  }

  build() {
    const scene = this.scene, graph = this.graph;
    this.environment({
      skyTop: '#1d2563', skyHorizon: '#ff9cb0', skyBottom: '#43305f',
      sunDir: new THREE.Vector3(-0.85, 0.3, 0.32), sunColor: '#ffbf98', sunIntensity: 2.4, sunGlow: '#ffb08f',
      hemiSky: '#a9b4f0', hemiGround: '#3a3550', hemiIntensity: 1.0,
      fill: { color: '#8fa6ff', intensity: 0.35, dir: new THREE.Vector3(0.7, 0.35, -0.4) },
      mist: { color: '#3a2c55', top: -40, bottom: -60 },
      strata: ['#e9d3c6', '#b99aa6', '#7d6377', '#45394d'],
      center: new THREE.Vector3(-1.5, -1.5, 0), shadowBox: 16,
      grade: { sat: 1.05, contrast: 1.06, lift: [0.015, 0.0, 0.03], gain: [1.02, 0.98, 1.0], tilt: 0.5 },
      exposure: 1.05, bloom: 0.42, envIntensity: 0.5, stars: 0.5, moteColor: '#ffe1ee', moteCount: 260,
    });
    // moonlight from below for the underside
    const moon = new THREE.DirectionalLight('#dfe6ff', 1.3);
    moon.position.set(2, -30, 8);
    scene.add(moon);
    G.uOpCenter.value.set(-6, -3, -0.5);

    // ---------------------------------------------------------------- the slab
    const T = this.terrain({ grass: GRASS, tileMinY: -5, shells: 14, opartUnder: true, roadStyle: 'white' });
    T.fill(X0, X1, Z0, Z1, { top: 0, bottom: -3, kind: 'grass', under: 'grass' });
    streetRows(T, -9, X1);
    T.carve(-1, 0, Z0, Z1); // the canal
    // underside cul-de-sac plaza + the house lot
    T.paint(-7, -5, -3, 2, { under: 'road', underRoad: { axis: [1, 0, 0], style: 'plain' } });
    T.paint(-6, -6, -1, 0, { underBlocked: true });
    T.paint(-8, -8, -2, 0, { under: 'porch' });
    T.paint(-10, -9, -2, 0, { under: 'grass', underBlocked: true });
    T.paint(-10, -9, -1, 0, { kind: 'grass' });
    T.paint(-10, -10, -1, 0, { kind: 'grass' });
    T.build({ graph, parent: scene });
    this.slab = T;

    // ---------------------------------------------------------------- the canal bridge
    const bridge = new THREE.Group();
    scene.add(bridge);
    const BT = new Terrain({ grass: GRASS, tileMinY: -5, shells: 10, opartUnder: true, roadStyle: 'white' });
    BT.fill(-1, 0, -1, 0, { top: 0, bottom: -0.25, kind: 'road', under: 'road' });
    streetRows(BT, -1, 0);
    const btiles = BT.build({ graph, parent: bridge, group: bridge });
    this.bridgeTiles = btiles;
    this.sBridge = this.game.director.add(new MorphSet({
      id: 'bridge', state: 'bottom', bob: 0, magnet: 8, tolerance: 1.2,
      pieces: [{ obj: bridge, tiles: btiles, positions: { top: new THREE.Vector3(0, 0, 0), bottom: new THREE.Vector3(0, -2.75, 0) } }],
      triggers: [
        { to: 'top', view: new THREE.Vector3(0, 1, 0), reveal: { yaw: 10, pitch: -48 } },
        { to: 'bottom', view: new THREE.Vector3(0, -1, 0), reveal: { yaw: 10, pitch: -48 } },
      ],
    }));

    // ---------------------------------------------------------------- the fold over the east edge
    // the island's own wall tiles there step aside for the road
    for (const t of T.tiles) {
      if (t.face === 'wall' && t.data.dir === 'e' && Math.abs(t.pos.x - 7.5) < 0.01 && (Math.abs(t.pos.z + 1) < 0.01 || Math.abs(t.pos.z) < 0.01)) t.active = false;
    }
    const D = dirFromYawPitch(78, -7);
    const strips = [];
    const ks = [2.2, 3.8, 5.4];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      scene.add(g);
      const tiles = [];
      for (const z of [-1, 0]) {
        const t = new Tile({
          center: new THREE.Vector3(7.5, -0.5 - i, z), normal: new THREE.Vector3(1, 0, 0), tangent: new THREE.Vector3(0, 1, 0),
          kind: 'road', group: g, face: 'wall',
          data: { road: { axis: [0, -1, 0], a: z === -1 ? 'edge' : 'center', b: z === -1 ? 'center' : 'edge', ...ROAD } },
        });
        graph.add(t);
        tiles.push(t);
      }
      const FT = new Terrain({ roadStyle: 'white' });
      for (const t of tiles) t.terrain = FT;
      FT.buildMeshes(tiles, [], g, null, true);
      // a slab of earth behind the road so the strip reads as a solid piece
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.98, 1.98), this.strataMat());
      slab.position.set(7.33, -0.5 - i, -0.5);
      slab.castShadow = slab.receiveShadow = true;
      g.add(slab);
      strips.push({ obj: g, tiles, k: ks[i] });
    }
    this.sFold = this.game.director.add(assembleSet({
      id: 'fold', pieces: strips, view: D, bob: 0.08,
      requires: () => this.sBridge.solvedOnce.has('top'),
      reveal: { yaw: 26, pitch: 22 },
    }));

    this.dressTop();
    this.dressUnder();
    this.makeZoetrope();

    this.start = this.tile(-8, 0, 0);
    this.goal = this.tile(-8, -3, -1, 'under');
  }

  strataMat() {
    // reuse the slab's strata look so docked strips match the cliff
    return this.slab.meshes.find((x) => x.material?._patch?.strata)?.material ?? new THREE.MeshStandardMaterial({ color: '#c98f8c' });
  }

  // ---------------------------------------------------------------- dressing
  dressTop() {
    const r = rng(31);
    const houses = [
      { x: -6.2, z: -4.0, rot: 0, color: '#f2b6c1' },
      { x: -3.4, z: 3.1, rot: Math.PI, color: '#b9d4ea' },
      { x: 3.2, z: -4.0, rot: 0, color: '#f4d7a6' },
      { x: 5.0, z: 3.1, rot: Math.PI, color: '#d6c7ef' },
    ];
    for (const h of houses) {
      const b = buildHouse({ w: 2.8, d: 2.1, H: 1.2, roofH: 0.8, porch: false, dormers: true, color: h.color, roof: '#3b3650', lit: true, seed: Math.round(h.x * 10) });
      this.prop(b.group, h.x, 0, h.z, { rot: h.rot });
    }
    const trees = [[-8.4, -3.0], [-3.6, -3.1], [-1.9, 2.3], [1.9, -3.0], [6.4, -3.1], [-8.0, 2.4], [2.4, 2.3], [7.0, 2.4], [-5.2, 2.6]];
    this.canopies = [];
    trees.forEach(([x, z], i) => {
      const t = P.makeCherryTree({ seed: 50 + i, height: 2.0 + r() * 0.5 });
      this.prop(t, x, 0, z, { rot: r() * 6, scale: 0.78 });
      for (const c of t.userData.canopy ?? []) this.canopies.push(t.localToWorld(c.center.clone()));
    });
    // lamps, lit
    for (const [x, z, rot] of [[-5, -2.38, 0], [3, -2.38, 0], [-2, 1.38, Math.PI], [5.5, 1.38, Math.PI]]) {
      this.prop(P.makeLampPost({ lit: true }), x, 0.075, z, { rot });
    }
    this.prop(P.makeStopSign(), 6.75, 0.075, -2.3, { rot: Math.PI / 2 });
    this.prop(P.makeMailbox({ number: '4', color: '#4a3b5c' }), -8.6, 0, -2.6);
    this.prop(P.makeFireHydrant(), 1.6, 0.075, 1.25);
    this.prop(P.makeCar({ color: '#e8a0b4', seed: 4 }), -4.5, 0.02, -1.05, { rot: Math.PI / 2 });
    this.tile(-5, 0, -1).blocked = true;
    this.tile(-4, 0, -1).blocked = true;
    for (let i = 0; i < 7; i++) {
      const c = P.makeCloud({ seed: 80 + i, scale: 1.8 + r() * 1.6 });
      const a = (i / 7) * Math.PI * 2 + r() * 0.4;
      this.prop(c, -1.5 + Math.cos(a) * (18 + r() * 6), -13 - r() * 4, Math.sin(a) * (18 + r() * 6), { mist: false });
      (this.clouds ??= []).push(c);
    }
  }

  hang(obj, x, z, faceRot = 0, { opart = 1 } = {}) {
    return super.hang(obj, x, z, faceRot, { opart, y: -3 });
  }

  dressUnder() {
    // the house at the end of the cul-de-sac (the way home)
    const home = buildHouse({ w: 3, d: 2, H: 1.25, roofH: 0.85, color: '#e9e4f0', roof: '#16151c', porch: true, lit: true, seed: 9 });
    this.homeHouse = home;
    this.homeG = this.hang(home.group, -9.5, -1, Math.PI / 2, { opart: 1 });
    home.glow.userData.keepColor = true;
    // other hanging houses, mirrored suburb
    const hs = [[3.4, -4.0, Math.PI], [5.2, 3.1, 0], [-3.4, -4.0, Math.PI], [-3.2, 3.1, 0]];
    hs.forEach(([x, z, rot], i) => {
      const b = buildHouse({ w: 2.6, d: 2.1, H: 1.15, roofH: 0.8, porch: false, dormers: i % 2 === 0, color: '#ffffff', lit: true, seed: 90 + i });
      this.hang(b.group, x, z, rot, { opart: 1 });
    });
    const r = rng(77);
    for (const [x, z] of [[1.9, -3.2], [6.3, 2.5], [-2.2, -3.1], [-8.6, 2.6], [-8.5, -3.6], [4.2, 2.4]]) {
      const t = P.makeCherryTree({ seed: 120 + Math.round(x * 3), height: 2.0 + r() * 0.5 });
      t.scale.setScalar(0.78);
      this.hang(t, x, z, r() * 6, { opart: 2 });
    }
    for (const [x, z] of [[2.5, 1.38], [-3, -2.38], [-4.6, 2.4]]) {
      const lamp = P.makeLampPost({ lit: true });
      this.hang(lamp, x, z, 0, { opart: 1 });
    }
  }

  makeZoetrope() {
    // a ring of twelve walkers on the plaza; only the one facing you is visible,
    // so orbiting the camera plays the walk cycle
    const g = new THREE.Group();
    g.position.set(-6, -3, -0.5);
    g.rotation.x = Math.PI;
    this.scene.add(g);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.8, 0.32, 40), new THREE.MeshStandardMaterial({ color: '#141418', roughness: 0.6 }));
    drum.position.y = 0.16;
    drum.castShadow = drum.receiveShadow = true;
    g.add(drum);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.02, 40), new THREE.MeshStandardMaterial({ color: '#f4f2ee', emissive: '#ffffff', emissiveIntensity: 0.15 }));
    top.position.y = 0.33;
    g.add(top);
    const N = 12;
    this.zoe = [];
    for (let i = 0; i < N; i++) {
      const f = buildFigure({ coat: '#fbfaf7', pants: '#0c0c10', skin: '#fbfaf7', boots: '#0c0c10' });
      const a = (i / N) * Math.PI * 2;
      const ph = (i / N) * Math.PI * 2 * 2;
      f.legL.rotation.x = Math.sin(ph) * 0.7;
      f.legR.rotation.x = -Math.sin(ph) * 0.7;
      f.armL.rotation.x = -Math.sin(ph) * 0.6;
      f.armR.rotation.x = Math.sin(ph) * 0.5;
      f.body.position.y = 0.2 + Math.abs(Math.cos(ph)) * 0.02;
      f.root.position.set(Math.sin(a) * 1.08, 0, Math.cos(a) * 1.08);
      f.root.rotation.y = a + Math.PI / 2;
      f.root.scale.setScalar(1.55);
      g.add(f.root);
      this.zoe.push({ obj: f.root, a });
    }
    patchTree(g);
    this.zoeGroup = g;
  }

  // ---------------------------------------------------------------- play
  begin() {
    this.game.ui.prompt('move', '{move} walk  ·  {look} look around');
  }

  cameraFocus(p) {
    return new THREE.Vector3(p.x * 0.75 - 0.4, p.y * 0.8 - 0.4, p.z * 0.6);
  }

  update(dt, t) {
    super.update(dt, t);
    const g = this.game;
    // how far the world has turned over: 0 = top side, 1 = underside
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(g.rig.frame);
    const flip = THREE.MathUtils.clamp((1 - up.y) / 2, 0, 1);
    this.flip = flip;
    const u = g.post.u;
    if (g.state === 'play' || g.state === 'complete') {
      u.uBW.value = THREE.MathUtils.smoothstep(flip, 0.25, 0.85);
      u.uContrast.value = 1.06 + flip * 0.22;
      this.sky.material.uniforms.uOpSky.value = THREE.MathUtils.smoothstep(flip, 0.3, 0.95) * 0.9;
      this.sky.material.uniforms.uStars.value = 0.5 + flip * 0.8;
      audio.setUndersideBlend(flip);
      g.post.bloom.strength = 0.42 - flip * 0.24;
      for (const c of this.clouds ?? []) c.visible = flip < 0.35;
    }
    // petals
    if (this.canopies?.length && Math.random() < dt * 9) {
      const c = this.canopies[Math.floor(Math.random() * this.canopies.length)];
      this.fx.petal(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, -0.3, (Math.random() - 0.5) * 1.2)));
    }
    // zoetrope strobe
    if (this.zoe) {
      const vd = g.rig.viewDir(new THREE.Vector3());
      const inv = this.zoeGroup.getWorldQuaternion(new THREE.Quaternion()).invert();
      vd.applyQuaternion(inv);
      const phi = Math.atan2(vd.x, vd.z);
      let best = null, bd = 9;
      for (const z of this.zoe) {
        let d = Math.abs(((z.a - phi + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < bd) { bd = d; best = z; }
      }
      for (const z of this.zoe) z.obj.visible = z === best;
    }
  }

  onArrive(tile, from) {
    const g = this.game;
    if (!this.moved) { this.moved = true; g.after(2.5, () => g.ui.hidePrompt('move')); }
    if (tile.pos.x > -2.6 && tile.pos.x < -1.4 && tile.face === 'top' && this.sBridge.state === 'bottom' && !this.canalToast) {
      this.canalToast = true;
      g.ui.toast('The bridge is down there, at the bottom of the canal.', 4);
    }
    if (tile.face === 'top' && tile.pos.x > 6.5 && !this.sFold.solvedOnce.has('home') && !this.edgeToast) {
      this.edgeToast = true;
      g.ui.toast('The road goes over the edge. Most of it, anyway.', 4);
    }
    if (tile.face === 'under' && from.face === 'wall' && !this.underToast) {
      this.underToast = true;
      g.after(1.0, () => g.ui.toast('There is another street beneath this one.', 4.5));
      audio.flip();
    }
    if (tile === this.goal) g.completeLevel();
  }

  onFrameFlip(up) {
    if (up.y < -0.5) this.game.rig.shake(0.03, 0.3);
  }

  blockMorph(set) {
    return false;
  }

  hintText() {
    const b = this.game.director.best;
    if (!b) return 'Follow the road.';
    if (b.set.id === 'bridge' && b.tr.to === 'top') return 'Look straight down through the gap. From up there, the bridge below joins your road.';
    if (b.set.id === 'fold') return 'Get down low, level with the east edge, and look back at the floating pieces of road.';
    if (b.set.id === 'bridge') return 'Same trick from this side: look straight “down” through the gap.';
    return null;
  }

  doorInfo() {
    const h = this.homeHouse;
    const target = new THREE.Vector3();
    h.group.localToWorld(target.set(0, 0.1, 0.85));
    return { pivot: h.door, glow: h.glow, target };
  }

  endingView() {
    const g = this.game;
    g.rig.set({ yaw: 28, pitch: 4, zoom: 13, target: new THREE.Vector3(-1.5, 1.0, 0) });
    g.post.u.uBW.value = 0.35;
    this.sBridge.setState('top');
    this.sFold.setState('home');
  }
}
