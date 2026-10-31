// No. 4 — Turntable (golden hour). A lot sits on a lazy susan in a moat. Its
// path is an elbow; stepping on a brass plate turns the whole lot a quarter turn.
// Combine turning with seeing: the last stretch of walk is still in pieces.
import * as THREE from 'three';
import { Level, rng, farIslands } from './base.js';
import { assembleSet } from '../core/illusion.js';
import { dirFromYawPitch } from '../core/camera.js';
import { buildHouse } from '../world/house.js';
import { audio } from '../core/audio.js';
import * as P from '../world/props.js';

const GRASS = { height: 0.12, root: '#2b3a1c', tip: '#8fae45', tip2: '#c2c45a', stripes: 0.08, scale: 0.24 };

export class Level4 extends Level {
  static meta = { number: 3, title: 'Turntable', quote: 'Some lots turn when you’re not looking.' };

  constructor(game) {
    super(game);
    this.mood = 'title';
    this.cameraStart = { yaw: 30, pitch: 40, zoom: 8.4, target: new THREE.Vector3(-1, 0, 0) };
    this.cameraLimits = { pitchMin: 6, pitchMax: 89.6, zoomMin: 4.5, zoomMax: 13 };
    this.hintDelay = 70;
    this.turn = 0; // quarter turns applied (clockwise from above)
  }

  build() {
    const scene = this.scene, graph = this.graph;
    this.environment({
      skyTop: '#3d6fb8', skyHorizon: '#ffc27a', skyBottom: '#c9875c',
      sunDir: new THREE.Vector3(-0.8, 0.32, 0.5), sunColor: '#ffcf8a', sunIntensity: 3.0, sunGlow: '#ffb35c',
      hemiSky: '#c9d6ff', hemiGround: '#6b5a3a', hemiIntensity: 0.85,
      fill: { color: '#9fb6ff', intensity: 0.35, dir: new THREE.Vector3(0.6, 0.4, -0.5) },
      mist: { color: '#c9875c', top: -3.5, bottom: -10 },
      strata: ['#f5dfb5', '#e2a368', '#b5704a', '#6f4434'],
      center: new THREE.Vector3(1, 0, -0.5), shadowBox: 15,
      grade: { sat: 1.12, contrast: 1.06, lift: [0.02, 0.01, 0.0], gain: [1.03, 1.0, 0.95], tilt: 0.55, warp: 0.08 },
      exposure: 1.02, bloom: 0.36, envIntensity: 0.6, moteColor: '#ffe2a8', moteCount: 300,
    });

    // ---------------------------------------------------------------- land
    const T = this.terrain({ grass: GRASS, tileMinY: -4, shells: 14 });
    T.fill(-6, -3, -2, 2, { top: 0, bottom: -12 });           // west lot (start)
    T.paint(-6, -3, 0, 0, { kind: 'sidewalk' });
    T.fill(-2, -2, 0, 0, { top: 0, bottom: -12, kind: 'path' }); // stub to the table
    T.fill(-1, 1, -5, -3, { top: 0, bottom: -12 });            // north landing
    T.fill(0, 0, -2, -2, { top: 0, bottom: -12, kind: 'path' });
    T.paint(0, 0, -4, -3, { kind: 'path' });
    T.fill(2, 2, 0, 0, { top: 0, bottom: -12, kind: 'path' });   // east stub
    T.fill(5, 9, -2, 2, { top: 0, bottom: -12 });             // the home lot
    T.paint(5, 6, 0, 0, { kind: 'path' });
    T.paint(6, 6, 0, 0, { kind: 'porch' });
    T.paint(7, 9, -1, 1, { blocked: true });
    T.build({ graph, parent: scene });
    this.land = T;

    // ---------------------------------------------------------------- the turntable
    const table = new THREE.Group();
    scene.add(table);
    const TT = this.terrain({ grass: GRASS, tileMinY: -4, shells: 14 });
    TT.fill(-1, 1, -1, 1, { top: 0, bottom: -2.6, outerWall: 'soil' });
    TT.paint(-1, 0, 0, 0, { kind: 'path' });
    TT.paint(0, 0, -1, -1, { kind: 'path' });
    this.tableTiles = TT.build({ graph, parent: table, group: table });
    this.table = table;
    // brass lazy susan beneath it
    const brass = new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.85, roughness: 0.32 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.4, 0.22, 64), brass);
    disc.position.y = -2.75;
    disc.castShadow = disc.receiveShadow = true;
    table.add(disc);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 8, 24), brass);
    axle.position.y = -7;
    scene.add(axle);
    for (let i = 0; i < 24; i++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.24), brass);
      const a = (i / 24) * Math.PI * 2;
      tooth.position.set(Math.cos(a) * 2.38, -2.75, Math.sin(a) * 2.38);
      tooth.rotation.y = -a;
      table.add(tooth);
    }
    this.prop(P.makeShrub({ seed: 4, size: 0.5, color: '#55702f', flowers: '#ffd27a' }), 1, 0.02, 1, { parent: table });
    this.prop(P.makeLampPost({ lit: true }), 1.3, 0, -1.3, { parent: table });
    this.prop(P.makeFlamingo({ seed: 2 }), -1, 0, 1, { parent: table, rot: 0.7 });

    // brass plate on the north landing: steps turn the table clockwise
    this.plate = this.tile(0, 0, -4);
    this.plateMesh = this.makePlate(0, -4);

    // ---------------------------------------------------------------- the last stretch, in pieces
    const D = dirFromYawPitch(150, 26);
    const pieces = [];
    const ks = { 3: 3.0, 4: 5.5 };
    for (let x = 3; x <= 4; x++) {
      const g = new THREE.Group();
      scene.add(g);
      const C = this.terrain({ grass: GRASS, tileMinY: -4, shells: 14 });
      C.fill(x, x, -1, 1, { top: 0, bottom: -2.4 });
      C.paint(x, x, 0, 0, { kind: 'path' });
      const tiles = C.build({ graph, parent: g, group: g });
      pieces.push({ obj: g, tiles, k: ks[x] });
    }
    this.sWalk = this.game.director.add(assembleSet({ id: 'walk', pieces, view: D, bob: 0.12, reveal: { yaw: -30, pitch: 14 } }));

    // ---------------------------------------------------------------- the house and the repeating suburb
    const h = buildHouse({ w: 2.6, d: 2.2, H: 1.25, roofH: 0.8, color: '#ffb27a', roof: '#45324a', porch: false, lit: true, seed: 21 });
    this.prop(h.group, 7.95, 0, 0, { rot: -Math.PI / 2 });
    this.house = h;
    this.goal = this.tile(6, 0, 0);
    this.prop(P.makeMailbox({ number: '3', color: '#5a3d2a' }), 5.2, 0, 1.4);
    this.prop(P.makeRoundTree({ seed: 9, height: 2.4, color: '#c79a3a' }), -5.2, 0, -1.6);
    this.prop(P.makeRoundTree({ seed: 3, height: 2.2, color: '#d6884a' }), 5.4, 0, -1.6);
    this.prop(P.makeCherryTree({ seed: 6, height: 2.2 }), -3.8, 0, 1.6, { scale: 0.8 });
    this.prop(P.makePicketFence(4, {}), -6.4, 0, -2.4);
    for (const [x, z] of [[-5, -2], [5, -2], [-4, 2]]) { const t = this.tile(x, 0, z); if (t) t.blocked = true; }
    // McGloughlin-style repetition: the same house, over and over, circling in the haze
    const r = rng(4);
    const ring = new THREE.Group();
    scene.add(ring);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const copy = buildHouse({ w: 2.6, d: 2.2, H: 1.25, roofH: 0.8, color: '#ffb27a', roof: '#45324a', porch: false, lit: true, seed: 21 });
      copy.group.position.set(Math.cos(a) * 26, -6 + Math.sin(i * 1.7) * 2, Math.sin(a) * 26);
      copy.group.rotation.y = -a + Math.PI / 2;
      ring.add(copy.group);
    }
    this.prop(ring, 0, 0, 0);
    this.updaters.push((t) => { ring.rotation.y = t * 0.02; });
    for (let i = 0; i < 6; i++) {
      const c = P.makeCloud({ seed: 90 + i, scale: 2 + r() * 1.5 });
      const a = (i / 6) * Math.PI * 2;
      this.prop(c, Math.cos(a) * 18, -14 - r() * 3, Math.sin(a) * 18, { mist: false });
    }

    this.start = this.tile(-5, 0, 0);
    this.turning = null;
  }

  makePlate(x, z) {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.8, roughness: 0.3, emissive: '#ff9b30', emissiveIntensity: 0.0 });
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.05, 32), m);
    d.position.y = 0.085;
    const arrowShape = new THREE.Shape();
    arrowShape.absarc(0, 0, 0.22, 0.3, Math.PI * 1.6, false);
    arrowShape.absarc(0, 0, 0.15, Math.PI * 1.6, 0.3, true);
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape, 24), new THREE.MeshBasicMaterial({ color: '#5a3415' }));
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.y = 0.112;
    g.add(d, arrow);
    this.prop(g, x, 0, z);
    g.userData.mat = m;
    return g;
  }

  begin() {
    this.game.ui.prompt('move', 'A brass plate turns the lot a quarter turn. Step on it.');
    this.game.after(7, () => this.game.ui.hidePrompt('move'));
  }

  cameraFocus(p) {
    return new THREE.Vector3(p.x * 0.5 + 0.4, 0, p.z * 0.5 - 0.6);
  }

  get busy() { return !!this.turning; }

  turnTable(dir = -1) {
    const g = this.game;
    if (this.turning) return;
    if (this.tableTiles.includes(g.player.tile)) { g.ui.toast('It won’t turn with you on it.', 2.5); return; }
    for (const t of this.tableTiles) t.active = false;
    this.turn++;
    this.turning = { t: 0, from: this.table.rotation.y, to: this.table.rotation.y + dir * Math.PI / 2 };
    audio.fold();
    g.rig.shake(0.03, 0.6);
    g.input.rumble(0.3, 0.5, 400);
  }

  update(dt, t) {
    super.update(dt, t);
    const T = this.turning;
    if (T) {
      T.t += dt / 1.4;
      const k = Math.min(1, T.t);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.table.rotation.y = T.from + (T.to - T.from) * e;
      if (k >= 1) {
        this.turning = null;
        for (const tt of this.tableTiles) tt.active = true;
        this.graph.rebuild();
        audio.lock();
      }
    }
    const pm = this.plateMesh.userData.mat;
    const on = this.game.player?.tile === this.plate;
    pm.emissiveIntensity += ((on ? 0.8 : 0.1 + 0.08 * Math.sin(t * 3)) - pm.emissiveIntensity) * Math.min(1, dt * 6);
    // a slow golden hue drift for the haze
    if (this.game.state === 'play') this.game.post.u.uHue.value = Math.sin(t * 0.05) * 0.12;
  }

  onArrive(tile, from) {
    const g = this.game;
    if (tile === this.plate) this.turnTable(-1);
    if (tile === this.goal) g.completeLevel();
    if (tile.pos.x > 1.5 && tile.pos.x < 2.5 && this.sWalk.state !== 'home' && !this.gapToast) {
      this.gapToast = true;
      g.ui.toast('The last stretch is floating off behind the house.', 4);
    }
  }

  hintText() {
    if (this.game.player.tile === this.plate || this.turn > 0) return 'Each step onto the plate turns the lot clockwise. Step off and on again to keep turning.';
    const b = this.game.director.best;
    if (this.sWalk.state !== 'home' && this.game.player.tile?.pos.x > 1.5) return 'Swing round behind the house and look back toward the table, low.';
    return 'Walk onto the table and out the other side, to the brass plate. Then think about which way the elbow points.';
  }

  doorInfo() {
    const target = new THREE.Vector3();
    this.house.group.localToWorld(target.set(0, 0.1, 0.9));
    return { pivot: this.house.door, glow: this.house.glow, target };
  }
}
