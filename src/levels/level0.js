// No. 0 — Mailbox. The tutorial: walk, look around, line something up, zoom,
// ask for a hint. One tiny lot, one broken step, one door.
import * as THREE from 'three';
import { Level, rng } from './base.js';
import { assembleSet } from '../core/illusion.js';
import { dirFromYawPitch } from '../core/camera.js';
import { buildHouse } from '../world/house.js';
import * as P from '../world/props.js';

const GRASS = { height: 0.12, root: '#1f3d2a', tip: '#62ad5a', tip2: '#93cf6e', stripes: 0.08, scale: 0.24 };

export class Level0 extends Level {
  static meta = { number: 0, title: 'Mailbox', quote: 'Look at things until they make sense.' };

  constructor(game) {
    super(game);
    this.mood = 'morning';
    this.cameraStart = { yaw: 30, pitch: 34, zoom: 6.0, target: new THREE.Vector3(-1, 0, 0.5) };
    this.cameraLimits = { pitchMin: 8, pitchMax: 89.6, zoomMin: 3.5, zoomMax: 10 };
    this.hintDelay = 30;
    this.stage = 'walk';
    this.steps = 0;
  }

  build() {
    const scene = this.scene, graph = this.graph;
    this.environment({
      skyTop: '#8cc3f0', skyHorizon: '#ffe3cf', skyBottom: '#b7d8cb',
      sunDir: new THREE.Vector3(0.6, 0.55, 0.55), sunColor: '#fff0dc', sunIntensity: 2.7, sunGlow: '#ffdcae',
      hemiSky: '#d6e6ff', hemiGround: '#68805a', hemiIntensity: 0.9,
      mist: { color: '#b7d8cb', top: -2.5, bottom: -9 },
      strata: ['#f6e3cf', '#e5b39f', '#c48e85', '#8a6566'],
      center: new THREE.Vector3(0, 0, 0), shadowBox: 9,
      grade: { sat: 1.05, contrast: 1.03, tilt: 0.5 },
      exposure: 1.0, bloom: 0.28, moteCount: 140,
    });
    const T = this.terrain({ grass: GRASS, tileMinY: -4, shells: 14 });
    T.fill(-4, 4, -3, 2, { top: 0, bottom: -9 });
    T.paint(-4, 3, 1, 1, { kind: 'sidewalk' });
    T.paint(3, 3, 0, 0, { kind: 'porch' });
    T.paint(0, 0, 1, 1, { top: -2.2, kind: 'grass' }); // the broken step
    T.paint(2, 4, -3, -1, { blocked: true });
    T.build({ graph, parent: scene });

    const D = dirFromYawPitch(58, 42);
    const g = new THREE.Group();
    scene.add(g);
    const C = this.terrain({ grass: GRASS, tileMinY: -4, shells: 14 });
    C.fill(0, 0, 1, 1, { top: 0, bottom: -2.2, kind: 'sidewalk' });
    const tiles = C.build({ graph, parent: g, group: g });
    this.sStep = this.game.director.add(assembleSet({ id: 'step', pieces: [{ obj: g, tiles, k: 3.4 }], view: D, bob: 0.12, magnet: 14, tolerance: 1.6, reveal: { yaw: -22, pitch: -6 } }));

    const h = buildHouse({ w: 2.4, d: 2.0, H: 1.15, roofH: 0.75, color: '#f0a3a0', porch: false, dormers: false, seed: 3 });
    this.prop(h.group, 3, 0, -1.55);
    this.house = h;
    this.prop(P.makeMailbox({ number: '0', color: '#2f3b52' }), 2.4, 0, 1.65, { rot: Math.PI });
    this.prop(P.makeCherryTree({ seed: 12, height: 2.4 }), -2.6, 0, -1.6, { scale: 0.85 });
    this.prop(P.makePicketFence(5, {}), -4.4, 0, 2.4);
    this.prop(P.makeShrub({ seed: 2, size: 0.5, color: '#3f7d47', flowers: '#ffd3e0' }), 1.0, 0, -0.4);
    for (const [x, z] of [[-3, -2], [1, 0]]) { const t = this.tile(x, 0, z); if (t) t.blocked = true; }
    const r = rng(2);
    for (let i = 0; i < 6; i++) {
      const c = P.makeCloud({ seed: 140 + i, scale: 1.6 + r() * 1.4 });
      const a = (i / 6) * Math.PI * 2;
      this.prop(c, Math.cos(a) * 14, -12 - r() * 3, Math.sin(a) * 14, { mist: false });
    }
    this.start = this.tile(-4, 0, 1);
    this.goal = this.tile(3, 0, 0);
  }

  begin() {
    this.game.ui.prompt('t', '{move} walk along the sidewalk');
  }

  cameraFocus(p) {
    return new THREE.Vector3(p.x * 0.5, 0, p.z * 0.5);
  }

  onArrive(tile) {
    const g = this.game;
    this.steps++;
    if (this.stage === 'walk' && tile.pos.x >= -1) {
      this.stage = 'look';
      g.ui.prompt('t', 'The step is missing. {look} swing the view until the floating step lines up');
    }
    if (this.stage === 'cross' && tile.pos.x >= 1) {
      this.stage = 'zoom';
      g.ui.prompt('t', '{zoom} zoom in and out  ·  {hint} hint whenever you’re stuck');
      g.after(6, () => { if (this.stage === 'zoom') { this.stage = 'door'; g.ui.prompt('t', 'Walk up to the door'); } });
    }
    if (tile === this.goal) { g.ui.hidePrompt('t'); g.completeLevel(); }
  }

  onLock() {
    this.game.ui.prompt('t', 'Hold it there…');
  }

  onMorphDone() {
    const g = this.game;
    this.stage = 'cross';
    g.ui.prompt('t', 'If it looks connected, it is. Walk across.');
  }

  hintText() {
    if (this.sStep.state !== 'home') return 'Swing the view to the right and up a little: the floating step will slide into the gap from your point of view.';
    return 'The door is at the end of the walk.';
  }

  doorInfo() {
    const target = new THREE.Vector3();
    this.house.group.localToWorld(target.set(0, 0.1, 0.85));
    return { pivot: this.house.door, glow: this.house.glow, target };
  }
}
