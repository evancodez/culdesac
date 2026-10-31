// No. 1 — Front Walk (morning). The tutorial house.
// 1) chunks of the street float in the sky; line them up and they fill the gap
// 2) the pink house sits sunk on a pillar in its lot; from straight above the
//    walks touch, so the pillar rises to meet the street
// 3) the house itself is in three slices; at eye level from the front-left it
//    is whole, and the door is there
import * as THREE from 'three';
import { Level, rng } from './base.js';
import { assembleSet } from '../core/illusion.js';
import { dirFromYawPitch } from '../core/camera.js';
import { buildHouse } from '../world/house.js';
import * as P from '../world/props.js';

const GRASS = { height: 0.12, root: '#1e3b25', tip: '#5aa54a', tip2: '#86c45e', stripes: 0.07, scale: 0.24 };

function streetPaint(T, x0, x1) {
  T.paint(x0, x1, 5, 5, { kind: 'road', road: { axis: [1, 0, 0], a: 'edge', b: 'center', style: 'yellow' } });
  T.paint(x0, x1, 6, 6, { kind: 'road', road: { axis: [1, 0, 0], a: 'center', b: 'edge', style: 'yellow' } });
  T.paint(x0, x1, 3, 3, { kind: 'sidewalk' });
}

export class Level1 extends Level {
  static meta = { number: 1, title: 'Front Walk', quote: 'Every house looks like home from the right angle.' };

  constructor(game) {
    super(game);
    this.mood = 'morning';
    this.cameraStart = { yaw: 36, pitch: 33, zoom: 8.2, target: new THREE.Vector3(-4.5, 0, 2.5) };
    this.cameraLimits = { pitchMin: 6, pitchMax: 89.6, zoomMin: 4.5, zoomMax: 12.5 };
    this.hintDelay = 55;
    this.hintStep = 0;
    this.walked = 0;
  }

  build() {
    const scene = this.scene, graph = this.graph;
    this.environment({
      skyTop: '#78b0ee', skyHorizon: '#ffd6c0', skyBottom: '#9fc4b4',
      sunDir: new THREE.Vector3(0.75, 0.42, 0.42), sunColor: '#ffe3c2', sunIntensity: 2.9, sunGlow: '#ffcf9c',
      hemiSky: '#cfe0ff', hemiGround: '#5d7350', hemiIntensity: 0.85,
      fill: { color: '#b9c8ff', intensity: 0.35, dir: new THREE.Vector3(-0.6, 0.4, -0.5) },
      mist: { color: '#9cc3b2', top: -2.2, bottom: -9 },
      strata: ['#efd9c2', '#dba08c', '#b97b6e', '#7f5552'],
      center: new THREE.Vector3(0, 0, -1.5), shadowBox: 17,
      grade: { sat: 1.06, contrast: 1.05, lift: [0.01, 0.0, 0.015], gain: [1.02, 1.0, 0.98], tilt: 0.55 },
      exposure: 1.0, bloom: 0.32, envIntensity: 0.6,
    });

    // ---------------------------------------------------------------- island
    const T = this.terrain({ grass: GRASS, tileMinY: -4, shells: 14 });
    T.fill(-8, 8, -10, 6, { top: 0, bottom: -14, kind: 'grass' });
    streetPaint(T, -8, 8);
    T.paint(0, 0, 2, 2, { kind: 'path' });
    T.paint(-3, 3, -8, 1, { top: -12, kind: 'grass' }); // the sunken lot
    T.paint(-8, -5, -6, -6, { kind: 'path' });
    T.paint(-3, -1, 3, 6, { top: -2.2, kind: 'grass' }); // the missing piece of street
    T.build({ graph, parent: scene });
    this.island = T;

    // ---------------------------------------------------------------- illusion 1: street chunks
    const D1 = dirFromYawPitch(30, 55);
    const chunks = [];
    const ks = { [-3]: 3.0, [-2]: 5.2, [-1]: 7.4 };
    for (let x = -3; x <= -1; x++) {
      const g = new THREE.Group();
      scene.add(g);
      const C = this.terrain({ grass: GRASS, tileMinY: -4, shells: 14 });
      C.fill(x, x, 3, 6, { top: 0, bottom: -2.2, kind: 'grass' });
      streetPaint(C, x, x);
      const tiles = C.build({ graph, parent: g, group: g });
      chunks.push({ obj: g, tiles, k: ks[x] });
    }
    // a lamp post rides on one chunk
    this.prop(P.makeLampPost({ lit: false }), -2, 0.075, 3.38, { parent: chunks[1].obj, rot: Math.PI });
    this.sStreet = this.game.director.add(assembleSet({
      id: 'street', pieces: chunks, view: D1, bob: 0.1,
      reveal: { yaw: 18, pitch: -14 },
    }));

    // ---------------------------------------------------------------- the lot: pillar + house
    const pillar = new THREE.Group();
    scene.add(pillar);
    const PT = this.terrain({ grass: GRASS, tileMinY: -4, shells: 14 });
    PT.fill(-1, 1, -4, 1, { top: 0, bottom: -14, kind: 'grass', outerWall: 'grass' });
    PT.paint(0, 0, 0, 1, { kind: 'path' });
    PT.paint(-1, 1, -1, -1, { kind: 'porch' });
    PT.paint(-1, 1, -4, -2, { blocked: true });
    const ptiles = PT.build({ graph, parent: pillar, group: pillar });
    this.pillar = pillar;
    this.pillarTiles = ptiles;
    // flowers and shrubs on the pillar
    this.prop(P.makeShrub({ seed: 3, size: 0.5, color: '#3f7d47', flowers: '#ffd3e0' }), -1, 0.05, 0.6, { parent: pillar });
    this.prop(P.makeShrub({ seed: 5, size: 0.45, color: '#3f7d47', flowers: '#fff4c9' }), 1, 0.05, 0.6, { parent: pillar });
    this.prop(P.makeShrub({ seed: 8, size: 0.38, color: '#456f45' }), 1.1, 0.05, 1.1, { parent: pillar });

    const D2 = new THREE.Vector3(0, 1, 0);
    this.sLot = this.game.director.add(assembleSet({
      id: 'lot', view: D2, bob: 0.08,
      pieces: [{ obj: pillar, tiles: ptiles, k: -3, home: new THREE.Vector3(0, 0, 0) }],
      requires: () => this.sStreet.state === 'home',
      reveal: { yaw: 0, pitch: -50 },
    }));

    // the house in three slices
    const D3 = dirFromYawPitch(-32, 12);
    const sliceSpec = [
      { range: [-9, -0.5], k: -4.6 },
      { range: [-0.5, 0.5], k: 2.7 },
      { range: [0.5, 9], k: 0 },
    ];
    const slices = sliceSpec.map((s) => {
      const h = buildHouse({ xRange: s.range, color: '#ec8f80', roof: '#3d4157', seed: 2 });
      const g = h.group;
      pillar.add(g);
      g.position.set(0, 0, -3.0);
      g.userData.house = h;
      return { obj: g, tiles: [], k: s.k, home: new THREE.Vector3(0, 0, -3.0), house: h };
    });
    this.door = slices[1].house;
    this.sHouse = this.game.director.add(assembleSet({
      id: 'house', view: D3, bob: 0.1, pieces: slices,
      requires: () => this.sLot.state === 'home',
      reveal: { yaw: 22, pitch: 16, zoom: 6.5 },
    }));

    // ---------------------------------------------------------------- neighbourhood dressing
    this.dress();

    this.start = this.tile(-6, 0, 3);
    this.porch = this.tile(0, 0, -1);
  }

  dress() {
    const r = rng(11);
    // neighbour houses on either side of the lot
    const left = buildHouse({ w: 2.6, d: 2.4, H: 1.15, color: '#a9cfe0', roof: '#45465a', porch: false, dormers: false, seed: 4 });
    this.prop(left.group, -6, 0, -3.2, { rot: 0 });
    const right = buildHouse({ w: 2.6, d: 2.4, H: 1.2, color: '#f2d6a2', roof: '#4a4152', porch: false, dormers: true, seed: 5 });
    this.prop(right.group, 6, 0, -3.4, { rot: 0 });
    for (let x = -7; x <= -5; x++) for (let z = -5; z <= -2; z++) this.tile(x, 0, z).blocked = true;
    for (let x = 5; x <= 7; x++) for (let z = -5; z <= -2; z++) this.tile(x, 0, z).blocked = true;
    // fences
    const f1 = P.makePicketFence(5, {});
    this.prop(f1, -8.4, 0, 1.6);
    const f2 = P.makePicketFence(5, {});
    this.prop(f2, 3.6, 0, 1.6);
    // trees
    this.prop(P.makeCherryTree({ seed: 2, height: 3.0 }), -6.5, 0, 0.4);
    this.prop(P.makeCherryTree({ seed: 9, height: 2.6 }), 7.2, 0, -8.2);
    this.prop(P.makeRoundTree({ seed: 4, height: 3.1 }), -6.8, 0, -8.6);
    this.prop(P.makeRoundTree({ seed: 7, height: 2.7 }), 6.6, 0, 0.6);
    this.prop(P.makeRoundTree({ seed: 12, height: 2.4 }), 4.8, 0, -9.0);
    for (const [x, z] of [[-6.5, 0.4], [7.2, -8.2], [-6.8, -8.6], [6.6, 0.6], [4.8, -9]]) {
      const t = this.graph.at(Math.round(x), 0, Math.round(z), 'top'); if (t) t.blocked = true;
    }
    // street furniture
    this.prop(P.makeMailbox({ number: '1', color: '#2f3b52' }), 0.75, 0, 2.3, { rot: Math.PI });
    this.prop(P.makeFireHydrant(), 4.6, 0, 4.0);
    this.prop(P.makeLampPost({ lit: false }), 5.6, 0.0, 3.62, { rot: Math.PI });
    this.prop(P.makeCar({ color: '#9fd0cc', seed: 3 }), 3.0, 0.02, 5.1, { rot: Math.PI / 2 });
    this.prop(P.makeTrashCan(), -7.2, 0, 2.4);
    this.prop(P.makeDandelions({ seed: 3, count: 26, radius: 1.0 }), -4.5, 0.02, -0.5);
    this.prop(P.makeDandelions({ seed: 6, count: 20, radius: 0.9 }), 4.4, 0.02, -7.2);
    this.prop(P.makeShrub({ seed: 21, size: 0.5, color: '#3c7343', flowers: '#ffe1ea' }), -4.6, 0, -1.6);
    this.prop(P.makeShrub({ seed: 22, size: 0.55, color: '#3c7343' }), 4.4, 0, -1.2);
    // clouds and far islands in the haze
    for (let i = 0; i < 9; i++) {
      const c = P.makeCloud({ seed: 30 + i, scale: 1.6 + r() * 1.8 });
      const a = (i / 9) * Math.PI * 2 + r() * 0.4;
      this.prop(c, Math.cos(a) * (17 + r() * 8), -14 - r() * 4, Math.sin(a) * (17 + r() * 8) - 2, { mist: false });
      const base = c.position.clone();
      const sp = 0.05 + r() * 0.05;
      this.updaters.push((t) => { c.position.x = base.x + Math.sin(t * sp + i) * 1.5; });
    }
    this.farIslands(r);
  }

  farIslands(r) {
    for (let i = 0; i < 5; i++) {
      const g = new THREE.Group();
      const ang = -0.6 + i * 0.55 + r() * 0.2;
      const dist = 26 + r() * 10;
      g.position.set(Math.cos(ang) * dist * 1.1, -6 + r() * 5, -Math.sin(ang) * dist - 6);
      this.scene.add(g);
      const T = this.terrain({ grass: GRASS, tileMinY: 0, shells: 4 });
      T.fill(-2, 2, -2, 2, { top: 0, bottom: -3, kind: 'grass' });
      T.paint(-2, 2, 2, 2, { kind: 'sidewalk' });
      T.build({ graph: null, parent: g, castShadow: false });
      const h = buildHouse({ w: 2.2, d: 2, H: 1.0, roofH: 0.7, porch: false, dormers: false, color: ['#f0b7a8', '#b9d7e6', '#f1dca6', '#c9e2c0', '#eac0d8'][i], seed: 40 + i });
      h.group.position.set(0, 0, -0.4);
      g.add(h.group);
      const base = g.position.clone();
      this.updaters.push((t) => { g.position.y = base.y + Math.sin(t * 0.25 + i * 2) * 0.4; });
    }
  }

  begin() {
    this.game.ui.prompt('move', '{move} walk');
  }

  cameraFocus(p) {
    return new THREE.Vector3(p.x * 0.7, p.y * 0.6, p.z * 0.6 - 0.8);
  }

  occluders() {
    return [];
  }

  onArrive(tile) {
    const g = this.game;
    this.walked++;
    if (this.walked === 3) g.ui.hidePrompt('move');
    if (tile.pos.x >= -4.5 && tile.pos.x <= -3.5 && tile.pos.z > 2.5 && this.sStreet.state !== 'home' && !this.lookPrompted) {
      this.lookPrompted = true;
      g.ui.prompt('look', 'Some things only make sense from the right angle. {look}');
    }
    if (tile === this.porch) {
      if (this.sHouse.state === 'home') g.completeLevel();
      else if (!this.porchToast) { this.porchToast = true; g.ui.toast('The house isn’t all here.', 4); }
    }
    if (tile.pos.z < 2.5 && tile.pos.z > 1.5 && Math.abs(tile.pos.x) < 0.5 && this.sLot.state !== 'home' && !this.edgeToast) {
      this.edgeToast = true;
      g.ui.toast('The front walk stops at the edge of the lot.', 4);
    }
  }

  onLock(set) {
    this.game.ui.hidePrompt('look');
  }

  onMorphDone(set) {
    const g = this.game;
    if (set.id === 'street') g.ui.toast('If it looks connected, it is.', 4.5);
    if (set.id === 'house' && g.player.tile === this.porch) g.after(0.6, () => g.completeLevel());
  }

  hintText() {
    const b = this.game.director.best;
    if (!b) return null;
    if (b.set.id === 'street') return 'Swing the view until the floating pieces of street line up with the gap.';
    if (b.set.id === 'lot') return 'Look straight down on the lot. From up there, the two walks touch.';
    if (b.set.id === 'house') return 'Get down to eye level with the house, a little from the left of the front.';
    return null;
  }

  doorInfo() {
    const h = this.door;
    const target = new THREE.Vector3();
    h.group.localToWorld(target.set(0, 0.1, 0.6));
    return { pivot: h.door, glow: h.glow, target };
  }
}
