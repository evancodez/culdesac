// No. 2 — Mow Day (noon). The lawn is too tall to walk through.
// Kick the driverless mower: it drives until something stops it and leaves a
// walkable stripe — over lips, down walls, across the sunken garden and out.
// Dock the floating strip of lawn, then send the mower home into its garage.
import * as THREE from 'three';
import { Level, rng, farIslands } from './base.js';
import { assembleSet } from '../core/illusion.js';
import { dirFromYawPitch } from '../core/camera.js';
import { quatFromUpForward } from '../core/character.js';
import { buildHouse } from '../world/house.js';
import { audio } from '../core/audio.js';
import * as P from '../world/props.js';
import { MAP2, parseMap, fillTerrain, fillBridge, findChar, BRIDGE } from './level2map.js';
import { mowerRun, pushDir } from './mow.js';

const GRASS = {
  height: 0.46, mownHeight: 0.04, root: '#163a1c', tip: '#3f9a38', tip2: '#6dbd48', mownTint: '#f2ffb0',
  stripes: 0.0, scale: 0.26, flowers: 0.035,
};

class Mower {
  constructor(level, tile) {
    this.level = level;
    this.obj = P.makeLawnMower({ bag: true });
    level.prop(this.obj, 0, 0, 0);
    this.kickable = true;
    this.tile = null;
    this.dir = new THREE.Vector3(0, 0, -1);
    this.anim = null;
    this.parked = false;
    this.place(tile, this.dir);
  }

  place(tile, dir) {
    if (this.tile && this.tile.occupant === this) this.tile.occupant = null;
    this.tile = tile;
    this.anim = null;
    this.parked = false;
    this.obj.visible = true;
    this.obj.scale.setScalar(1);
    if (tile) {
      tile.occupant = this;
      if (dir) this.dir.copy(dir);
      tile.footPos(this.obj.position);
      quatFromUpForward(tile.up, this.dir, this.obj.quaternion);
    }
    this.obj.userData.running = false;
    this.obj.userData.speed = 0;
  }

  // animate along a precomputed run
  drive(path, from, { intoGarage = false, onDone = null } = {}) {
    const pts = [];
    let prev = from;
    for (const st of path) {
      const a = prev.footPos(new THREE.Vector3());
      const b = st.tile.footPos(new THREE.Vector3());
      const wrap = prev.up.dot(st.tile.up) < 0.99;
      pts.push({ a, b, mid: st.mid.clone(), wrap, upA: prev.up.clone(), upB: st.tile.up.clone(), tile: st.tile, dir: st.dir.clone(), dur: wrap ? 0.2 : 0.12 });
      prev = st.tile;
    }
    this.anim = { pts, i: 0, t: 0, intoGarage, onDone, spin: 0 };
    this.obj.userData.running = true;
    this.obj.userData.speed = 7;
    audio.mowerStart();
  }

  update(dt) {
    const A = this.anim;
    if (!A) return;
    const L = this.level;
    const s = A.pts[A.i];
    if (!s) {
      this.anim = null;
      this.obj.userData.running = false;
      this.obj.userData.speed = 0;
      audio.mowerRun(false);
      audio.mowerStop();
      L.game.rig.shake(0.05, 0.25);
      L.fx.puff(this.obj.position.clone(), this.tile?.up ?? new THREE.Vector3(0, 1, 0), { n: 6, color: '#e9f2d0' });
      A.onDone?.();
      return;
    }
    s.t = (s.t ?? 0) + dt / s.dur;
    const k = Math.min(1, s.t);
    let fwd;
    const pos = this.obj.position;
    let up;
    if (s.wrap) {
      if (k < 0.5) { pos.lerpVectors(s.a, s.mid, k * 2); fwd = s.mid.clone().sub(s.a); }
      else { pos.lerpVectors(s.mid, s.b, (k - 0.5) * 2); fwd = s.b.clone().sub(s.mid); }
      const q = new THREE.Quaternion().setFromUnitVectors(s.upA, s.upB);
      up = s.upA.clone().applyQuaternion(new THREE.Quaternion().slerp(q, THREE.MathUtils.smoothstep(k, 0.25, 0.75)));
    } else {
      pos.lerpVectors(s.a, s.b, k);
      fwd = s.b.clone().sub(s.a);
      up = s.upA;
    }
    if (fwd.lengthSq() > 1e-6) this.dir.copy(fwd).normalize();
    const tq = quatFromUpForward(up, this.dir, new THREE.Quaternion());
    this.obj.quaternion.slerp(tq, 1 - Math.exp(-30 * dt));
    // cut the grass under the deck as we pass
    if (k > 0.35 && !s.cut) {
      s.cut = true;
      L.animateCut(s.tile);
    }
    if (Math.random() < 0.9) L.fx.clippings(pos.clone().addScaledVector(up, 0.12), this.dir, up, 2);
    if (k >= 1) {
      A.i++;
      if (A.i >= A.pts.length && A.intoGarage) {
        // roll on into the garage and vanish
        this.anim = null;
        L.parkMower(this, A.onDone);
      }
    }
  }
}

export class Level2 extends Level {
  static meta = { number: 2, title: 'Mow Day', quote: 'The lawn goes all the way down.' };

  constructor(game) {
    super(game);
    this.mood = 'noon';
    this.undoable = true;
    this.cameraStart = { yaw: 24, pitch: 44, zoom: 9.6, target: new THREE.Vector3(3.2, 0, 4.5) };
    this.cameraLimits = { pitchMin: 8, pitchMax: 89.6, zoomMin: 4.5, zoomMax: 13 };
    this.hintDelay = 90;
    this.kicks = 0;
    this.cuts = [];
  }

  build() {
    const scene = this.scene, graph = this.graph;
    this.environment({
      skyTop: '#1f6fd8', skyHorizon: '#9fd0ff', skyBottom: '#a9d6c6',
      sunDir: new THREE.Vector3(-0.42, 0.82, 0.38), sunColor: '#fff6e6', sunIntensity: 3.1, sunGlow: '#fff2d6',
      hemiSky: '#bcd9ff', hemiGround: '#4f7a3e', hemiIntensity: 0.95,
      fill: { color: '#c8dcff', intensity: 0.3, dir: new THREE.Vector3(0.6, 0.3, -0.5) },
      mist: { color: '#a9d6c6', top: -4.6, bottom: -11 },
      strata: ['#f0dcc0', '#d6a487', '#a9745f', '#6f4d44'],
      center: new THREE.Vector3(4.5, 0, 2), shadowBox: 15,
      grade: { sat: 1.1, contrast: 1.06, lift: [0.0, 0.005, 0.02], gain: [1.0, 1.0, 1.0], tilt: 0.5 },
      exposure: 0.98, bloom: 0.22, envIntensity: 0.6, moteColor: '#fffbe8', moteCount: 160,
    });

    // ---------------------------------------------------------------- yard
    const T = this.terrain({ grass: GRASS, tileMinY: -6, shells: 20 });
    this.cells = fillTerrain(T, MAP2);
    T.build({ graph, parent: scene });
    this.yard = T;

    // the floating strip of lawn (two tiles), scattered toward the east
    const D = dirFromYawPitch(92, 24);
    const pieces = [];
    for (let z = BRIDGE.z0; z <= BRIDGE.z1; z++) {
      const g = new THREE.Group();
      scene.add(g);
      const B = this.terrain({ grass: GRASS, tileMinY: -6, shells: 20 });
      B.fill(BRIDGE.x, BRIDGE.x, z, z, { top: 0, bottom: -1.2, kind: 'grass' });
      const tiles = B.build({ graph, parent: g, group: g });
      pieces.push({ obj: g, tiles, k: z === BRIDGE.z0 ? 6.5 : 3.6 });
    }
    this.sBridge = this.game.director.add(assembleSet({
      id: 'strip', pieces, view: D, bob: 0.12, reveal: { yaw: -28, pitch: 16 },
    }));

    // ---------------------------------------------------------------- props on the map
    for (const c of this.cells) {
      const y = c.top;
      if (c.obstacle === 'gnome') this.prop(P.makeGnome({ seed: c.x * 7 + c.z }), c.x, y, c.z, { rot: Math.PI * 0.85 });
      if (c.obstacle === 'birdbath') this.prop(P.makeBirdbath(), c.x, y, c.z);
      if (c.obstacle === 'flamingo') this.prop(P.makeFlamingo({ seed: 3 }), c.x, y, c.z, { rot: -Math.PI / 2 });
      if (c.obstacle === 'tree') this.prop(P.makeRoundTree({ seed: 10 + c.x, height: c.z < 0 ? 2.3 : 2.6 }), c.x, y, c.z, { rot: c.x });
      if (c.obstacle === 'flowers') {
        this.prop(P.makeShrub({ seed: 40 + c.x, size: 0.62, color: '#3b7a3f', flowers: c.x % 2 ? '#ff9fbf' : '#fff1a8' }), c.x, y, c.z);
      }
    }

    // the house, with a garage door where the apron is
    const apron = findChar(MAP2, 'A')[0];
    const house = buildHouse({
      w: 4.6, d: 1.9, H: 1.35, roofH: 0.85, color: '#ee9aa2', roof: '#3f3d52', porch: false, dormers: true,
      door: false, frontWindows: [-1.6, 1.6], seed: 6,
    });
    this.prop(house.group, apron.x, 0, -4.45);
    this.garage = this.makeGarageDoor(apron.x, -3.5);

    // white picket fence around the yard
    const fs = P.makePicketFence(10, { gaps: [] });
    this.prop(fs, -0.5, 0, 9.42);
    const fw = P.makePicketFence(10, { gaps: [[0.0, 1.6]] });
    this.prop(fw, -0.42, 0, 9.5, { rot: Math.PI / 2 });
    const fe = P.makePicketFence(10, {});
    this.prop(fe, 9.42, 0, 9.5, { rot: Math.PI / 2 });

    // decoration
    const r = rng(5);
    this.prop(P.makeSprinkler(), 9.35, 0, -0.35);
    this.prop(P.makeSprinkler(), -0.35, 0, -0.35);
    for (let i = 0; i < 8; i++) {
      const c = P.makeCloud({ seed: 60 + i, scale: 1.8 + r() * 1.8 });
      const a = (i / 8) * Math.PI * 2 + r() * 0.4;
      this.prop(c, 4.5 + Math.cos(a) * (16 + r() * 8), -14 - r() * 4, 2 + Math.sin(a) * (16 + r() * 8), { mist: false });
    }
    // a lounge chair and a hose by the patio
    this.prop(P.makeBench(), -0.15, 0, 7.3, { rot: Math.PI / 2 });
    farIslands(this, { count: 5, grass: GRASS, colors: ['#f6c9a4', '#bfdde6', '#e7d0f2', '#d8ebc4', '#f3b9c6'], center: new THREE.Vector3(4.5, 0, 2), radius: 26, y: -7, buildHouse });

    // the mower
    const m0 = findChar(MAP2, 'M')[0];
    this.mower = new Mower(this, this.tile(m0.x, 0, m0.z));
    this.mower.dir.set(0, 0, -1);
    this.mower.place(this.mower.tile, this.mower.dir);
    this.updaters.push((t, dt) => this.mower.update(dt));

    const s = findChar(MAP2, 'S')[0];
    this.start = this.tile(s.x, 0, s.z);
    this.apron = this.tile(apron.x, 0, apron.z);
  }

  makeGarageDoor(x, z) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.86, 0.06), new THREE.MeshStandardMaterial({ color: '#f4efe8', roughness: 0.6 }));
    frame.position.y = 0.55;
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.74), new THREE.MeshBasicMaterial({ color: '#1a1820' }));
    dark.position.set(0, 0.49, 0.035);
    const door = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.74, 0.03), new THREE.MeshStandardMaterial({ color: '#f7f3ec', roughness: 0.5 }));
    panel.position.y = 0.37;
    door.add(panel);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.012, 0.02), new THREE.MeshStandardMaterial({ color: '#d9d2c8' }));
      l.position.set(0, 0.1 + i * 0.18, 0.02);
      door.add(l);
    }
    door.position.set(0, 0.12, 0.05);
    g.add(frame, dark, door);
    this.prop(g, x, 0, z);
    for (const m of [frame, panel]) { m.castShadow = true; m.receiveShadow = true; }
    return { group: g, door };
  }

  begin() {
    this.game.ui.prompt('move', '{move} walk — the lawn is too tall to wade through');
  }

  cameraFocus(p) {
    return new THREE.Vector3(p.x * 0.35 + 3.2, p.y * 0.4, p.z * 0.35 + 1.4);
  }

  get busy() {
    return !!this.mower.anim || !!this.parking;
  }

  // ------------------------------------------------------------------ mowing
  animateCut(tile) {
    if (tile.kind === 'mown' && tile.terrain?.getCut(tile) >= 1) return;
    this.cuts.push({ tile, t: tile.terrain?.getCut(tile) ?? 0 });
  }

  update(dt, t) {
    super.update(dt, t);
    for (let i = this.cuts.length - 1; i >= 0; i--) {
      const c = this.cuts[i];
      c.t = Math.min(1, c.t + dt * 6);
      c.tile.terrain?.setCut(c.tile, c.t);
      if (c.t >= 1) this.cuts.splice(i, 1);
    }
    if (this.parking) {
      const p = this.parking;
      p.t += dt;
      const k = Math.min(1, p.t / 1.1);
      const m = this.mower.obj;
      this.garage.door.position.y = 0.12 + Math.min(1, p.t / 0.5) * 0.7;
      if (p.t > 0.35) {
        const kk = Math.min(1, (p.t - 0.35) / 0.75);
        m.position.lerpVectors(p.from, p.to, kk);
        if (kk >= 1 && !p.closed) {
          p.closed = true;
          m.visible = false;
          audio.door();
        }
      }
      if (p.t > 1.3) this.garage.door.position.y = 0.12 + Math.max(0, 1 - (p.t - 1.3) / 0.5) * 0.7;
      if (p.t > 1.9) {
        this.parking = null;
        this.garage.door.position.y = 0.12;
        p.onDone?.();
      }
    }
  }

  parkMower(mower, onDone) {
    const from = mower.obj.position.clone();
    const to = from.clone().add(new THREE.Vector3(0, 0, -0.9));
    this.parking = { t: 0, from, to, onDone };
    mower.tile.occupant = null;
    mower.tile = null;
    mower.parked = true;
    audio.mowerRun(false);
  }

  kick(mower, from, tile) {
    const g = this.game;
    const dir = pushDir(this.graph, from, tile);
    if (!dir) return false;
    const path = mowerRun(this.graph, tile, dir, (t) => t === from || t === g.player.tile);
    if (!path.length) {
      audio.bump();
      g.ui.toast(this.kicks === 0 ? 'Something’s in the way.' : 'It won’t budge that way.', 2.2);
      return false;
    }
    this.kicks++;
    g.ui.hidePrompt('move');
    g.ui.hidePrompt('kick');
    // logic happens now; visuals catch up
    const start = tile;
    if (start.kind === 'grass') start.kind = 'mown';
    for (const st of path) if (st.tile.kind === 'grass') st.tile.kind = 'mown';
    const last = path[path.length - 1].tile;
    const intoGarage = last.kind === 'apron';
    start.occupant = null;
    mower.tile = last;
    last.occupant = intoGarage ? null : mower;
    const walls = path.some((s) => s.tile.face === 'wall');
    mower.drive(path, start, {
      intoGarage,
      onDone: () => {
        if (intoGarage) {
          g.ui.toast('Put away. Now go on in.', 3);
        } else {
          mower.place(last, mower.dir);
          if (this.kicks === 1) g.ui.prompt('undo', 'It only stops when something stops it.  {undo} undo  ·  {restart}');
          if (walls && !this.wallToast) {
            this.wallToast = true;
            g.ui.toast('Gravity follows the stripe.', 3.5);
          }
        }
      },
    });
    if (start.terrain) this.animateCut(start);
    return true;
  }

  onArrive(tile) {
    const g = this.game;
    if (tile === this.apron && this.mower.parked) g.completeLevel();
    const mt = this.mower.tile;
    if (this.kicks === 0 && mt && this.graph.neighbor(tile, mt) && !this.kickPrompted) {
      this.kickPrompted = true;
      g.ui.prompt('kick', 'Walk into the mower to kick it');
    }
    if (this.kicks > 0) g.ui.hidePrompt('undo');
  }

  onBump(tile) {
    if (tile.kind === 'grass' && !this.tallToast) {
      this.tallToast = true;
      this.game.ui.toast('Too tall to walk through.', 2.5);
    }
  }

  // ------------------------------------------------------------------ undo
  getState() {
    const mown = [];
    for (const t of this.graph.tiles) if (t.kind === 'mown' && t.data.wasGrass !== false && t.terrain) mown.push(t);
    return {
      mower: this.mower.tile, dir: this.mower.dir.clone(), parked: this.mower.parked,
      mown: new Set(mown), strip: this.sBridge.state, kicks: this.kicks,
    };
  }

  setState(s) {
    for (const t of this.graph.tiles) {
      if (!t.terrain || t.data.grassVert == null) continue;
      t.occupant = null;
      if (t.kind !== 'mown' && t.kind !== 'grass') continue;
      t.kind = s.mown.has(t) || t.data.ch === 'M' ? 'mown' : 'grass';
      t.terrain.setCut(t, t.kind === 'mown' ? 1 : 0);
    }
    this.cuts.length = 0;
    this.parking = null;
    this.garage.door.position.y = 0.12;
    this.mower.place(s.mower, s.dir);
    if (s.parked) { this.mower.obj.visible = false; this.mower.parked = true; if (this.mower.tile) this.mower.tile.occupant = null; this.mower.tile = null; }
    if (this.sBridge.state !== s.strip) this.sBridge.setState(s.strip);
    this.kicks = s.kicks;
  }

  hintText() {
    const b = this.game.director.best;
    if (b && !this.hintedStrip && this.kicks >= 4) { this.hintedStrip = true; return 'The strip of lawn floating off to the east fits the gap — if you look at it from that side.'; }
    const hints = [
      'Kick the mower north along the garden’s west side, then find a stone to stand on.',
      'The mower doesn’t care about the sunken garden: it goes down, across, and back up.',
      'Get behind it: stepping stones are the only way around the tall grass.',
      'The garage is across the gap. The lawn strip floating to the east fits that gap, seen from the east.',
    ];
    const i = Math.min(hints.length - 1, Math.max(0, this.kicks - 1));
    return this.kicks === 0 ? 'Walk into the mower from the patio. It drives until something stops it.' : hints[i];
  }

  doorInfo() {
    const target = this.apron.pos.clone().add(new THREE.Vector3(0, 0.06, -0.9));
    return {
      target,
      open: () => {
        const d = this.garage.door;
        this.game.tween(d.position, 'y', 0.82, 0.8);
      },
    };
  }
}
