// No. 5 — Night Mow. Everything learned so far, at once: the lawn grows on every
// face of the world, so a kicked mower drives over the edge, along the underside,
// and up the far side, sometimes all the way round and back to your feet.
// You follow its stripes onto walls and under the world (the camera turns over
// with you, and the colours turn inside out). The two halves of the lawn only
// meet once you dock the floating strip between them.
import * as THREE from 'three';
import { rng, farIslands } from './base.js';
import { Level2, Mower } from './level2.js';
import { assembleSet } from '../core/illusion.js';
import { dirFromYawPitch } from '../core/camera.js';
import { buildHouse } from '../world/house.js';
import { audio } from '../core/audio.js';
import * as P from '../world/props.js';
import { TOP5, UNDER5, STRIP5, BOTTOM5, fillTerrain5, cells5, find5 } from './level5map.js';

const GRASS = {
  height: 0.42, mownHeight: 0.04, root: '#0f2a2a', tip: '#2f9a7a', tip2: '#64c3a0', mownTint: '#e6ffd0',
  stripes: 0.0, scale: 0.26, flowers: 0.05,
};

export class Level5 extends Level2 {
  static meta = { number: 5, title: 'Night Mow', quote: 'The lawn goes all the way around.' };

  constructor(game) {
    super(game);
    this.mood = 'dusk';
    this.followGravity = true;
    this.cameraStart = { yaw: 35, pitch: 40, zoom: 7.6, target: new THREE.Vector3(3.5, -1, 2.5) };
    this.cameraLimits = { pitchMin: -40, pitchMax: 89.6, zoomMin: 4.5, zoomMax: 12 };
    this.hintDelay = 100;
    this.garageDir = new THREE.Vector3(-1, 0, 0);
  }

  build() {
    const scene = this.scene, graph = this.graph;
    this.environment({
      skyTop: '#0b0f33', skyHorizon: '#6b3fa0', skyBottom: '#14102e',
      sunDir: new THREE.Vector3(0.45, 0.7, 0.55), sunColor: '#b9c6ff', sunIntensity: 1.9, sunGlow: '#c9a6ff',
      hemiSky: '#7f8cff', hemiGround: '#2a1d4a', hemiIntensity: 1.2,
      fill: { color: '#ff7ad9', intensity: 0.6, dir: new THREE.Vector3(-0.6, 0.2, -0.4) },
      mist: { color: '#14102e', top: -30, bottom: -50 },
      strata: ['#e6d9ff', '#9d7bd8', '#5a3f8f', '#2a1d4a'],
      center: new THREE.Vector3(3.5, -1, 2.5), shadowBox: 11,
      grade: { sat: 1.12, contrast: 1.08, lift: [0.01, 0.0, 0.03], gain: [1.0, 1.0, 1.04], tilt: 0.45, warp: 0.25 },
      exposure: 1.1, bloom: 0.55, envIntensity: 0.6, stars: 1.0, moteColor: '#c9b6ff', moteCount: 320,
    });
    const moon = new THREE.DirectionalLight('#ffb8f0', 1.4);
    moon.position.set(-10, -30, 6);
    scene.add(moon);

    // ---------------------------------------------------------------- the slab, grass on every face
    const T = this.terrain({ grass: GRASS, tileMinY: -9, shells: 18 });
    this.cells = fillTerrain5(T);
    T.build({ graph, parent: scene });
    this.yard = T;

    // floating strip that joins the halves
    const D = dirFromYawPitch(-24, 64);
    const pieces = STRIP5.map(({ x, z }, i) => {
      const g = new THREE.Group();
      scene.add(g);
      const S = this.terrain({ grass: GRASS, tileMinY: -9, shells: 18 });
      S.fill(x, x, z, z, { top: 0, bottom: BOTTOM5, kind: 'grass', under: 'grass', outerWall: 'grass' });
      const tiles = S.build({ graph, parent: g, group: g });
      return { obj: g, tiles, k: i === 0 ? 3.2 : 5.6 };
    });
    this.sBridge = this.game.director.add(assembleSet({ id: 'strip', pieces, view: D, bob: 0.14, reveal: { yaw: 26, pitch: -20 } }));

    // ---------------------------------------------------------------- obstacles, both faces
    for (const c of this.cells) {
      const top = { gnome: () => P.makeGnome({ seed: c.x + 3 }), birdbath: () => P.makeBirdbath(), flamingo: () => P.makeFlamingo({ seed: c.z }), tree: () => P.makeRoundTree({ seed: 30 + c.x, height: 2.2, color: '#3f7f8f' }) };
      if (c.tObs && top[c.tObs]) this.prop(top[c.tObs](), c.x, 0, c.z, { rot: c.x * 1.3 });
      if (c.uObs && top[c.uObs]) this.hang(top[c.uObs](), c.x, c.z, c.z * 0.9, { y: BOTTOM5 });
    }
    // the garage hangs under the east half; the mower parks into it heading west
    const A = find5(UNDER5, 'A');
    const house = buildHouse({ w: 2.2, d: 1.2, H: 1.1, roofH: 0.6, color: '#ff9fd2', roof: '#2b2350', porch: false, dormers: false, door: false, frontWindows: [], lit: true, seed: 12 });
    this.hang(house.group, A.x - 1.1, A.z, Math.PI / 2, { y: BOTTOM5 });
    this.garage = this.makeGarageDoor(A.x - 0.5, A.z, { hang: { rot: Math.PI / 2, y: BOTTOM5 } });

    // dressing: lamps on the patio, far floating lots in the night, clouds of stars
    this.prop(P.makeLampPost({ lit: true }), -0.3, 0.06, 1.6, { rot: Math.PI / 2 });
    farIslands(this, { count: 6, grass: GRASS, colors: ['#ff9fd2', '#9fd8ff', '#c9a6ff', '#ffd59f', '#9fffd5', '#ff9f9f'], center: new THREE.Vector3(3.5, -1, 2.5), radius: 24, y: -4, buildHouse });

    const m0 = find5(TOP5, 'M');
    this.mower = new Mower(this, this.tile(m0.x, 0, m0.z));
    this.mower.place(this.mower.tile, new THREE.Vector3(0, 0, 1));
    this.updaters.push((t, dt) => this.mower.update(dt));

    const s = find5(TOP5, 'S');
    this.start = this.tile(s.x, 0, s.z);
    this.apron = this.tile(A.x, BOTTOM5, A.z, 'under');
    this.flip = 0;
  }

  begin() {
    this.game.ui.prompt('move', 'The lawn grows on every side of the world. Join the two halves first.');
    this.game.after(6, () => this.game.ui.hidePrompt('move'));
  }

  cameraFocus(p) {
    return new THREE.Vector3(p.x * 0.4 + 2.1, p.y * 0.4 - 0.6, p.z * 0.4 + 1.5);
  }

  update(dt, t) {
    super.update(dt, t);
    const g = this.game;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(g.rig.frame);
    const flip = THREE.MathUtils.clamp((1 - up.y) / 2, 0, 1);
    this.flip = flip;
    if (g.state === 'play' || g.state === 'complete') {
      const u = g.post.u;
      u.uInvert.value = THREE.MathUtils.smoothstep(flip, 0.3, 0.9) * 0.85;
      u.uHue.value = Math.sin(t * 0.07) * 0.35 + flip * 1.2;
      u.uWarp.value = 0.25 + flip * 0.5;
      this.sky.material.uniforms.uOpSky.value = flip * 0.55;
      audio.setUndersideBlend(flip);
    }
  }

  hintText() {
    const steps = [
      'Kick the mower one step south from the patio.',
      'Stand on the stone and kick it east. Watch where it goes, and where it comes back.',
      'It came all the way round and stopped under your feet. Kick it again from the same stone.',
      'Keep sending the mower east along that row: each lap carries it further.',
      'Each lap carves the row a little further. Follow the stripes round.',
      'From the stones on the east half, kick it south.',
      'Again from the south — it will stop on the wall below the edge.',
      'Walk down the stripe onto the wall and kick it from there.',
      'Under the world now: get behind it and send it west, into the garage.',
    ];
    if (this.sBridge.state !== 'home') return 'First, join the two halves: the floating strip of lawn fits the slot between them if you look down from the north-west.';
    return steps[Math.min(this.kicks, steps.length - 1)];
  }
}
