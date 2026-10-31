// Perspective illusions.
// A MorphSet is a set of pieces (Object3Ds carrying meshes + tiles) with named
// states (a position per piece per state). A trigger fires when the camera looks
// along its view direction: pieces then slide to the trigger's target state.
// For "assemble" illusions, the scattered positions are home + k * viewDir,
// so from the aligned view the scattered pieces look exactly whole.
import * as THREE from 'three';
import { isolateMaterials } from './materials.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => { const c1 = 1.2, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

export class MorphSet {
  constructor({ id, pieces, state, triggers, tolerance = 1.1, magnet = 9, bob = 0.12, onMorph = null, glowColor = '#ffe2bd' }) {
    this.id = id;
    this.pieces = pieces; // [{ obj, tiles: [], positions: { stateName: Vector3 } }]
    this.state = state;
    this.triggers = triggers; // [{ to, view: Vector3, requires?: fn, reveal?: {yaw, pitch} (deg offsets), hint?: string }]
    this.tolerance = THREE.MathUtils.degToRad(tolerance);
    this.magnet = THREE.MathUtils.degToRad(magnet);
    this.bob = bob;
    this.onMorph = onMorph;
    this.animating = null;
    this.closeness = 0;
    this.dwell = 0;
    this.solvedOnce = new Set();
    this.glowColor = new THREE.Color(glowColor);
    this.mats = [];
    for (const p of pieces) {
      p.mats = isolateMaterials(p.obj);
      // docked pieces share faces with the world around them: push them back a hair so they never z-fight
      for (const m of p.mats) { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 3; }
      this.mats.push(...p.mats);
      p.obj.position.copy(p.positions[state]);
      p.phase = Math.random() * Math.PI * 2;
    }
    this.setTilesActive(true);
  }

  setTilesActive(on) {
    for (const p of this.pieces) for (const t of p.tiles) t.active = on;
  }

  // triggers that could fire now
  eligible() {
    if (this.animating) return [];
    return this.triggers.filter((tr) => tr.to !== this.state && (!tr.requires || tr.requires()));
  }

  update(dt, t, rig) {
    // floating bob along the view direction keeps the illusion exact from that angle
    for (const p of this.pieces) {
      if (this.animating) continue;
      const pos = p.positions[this.state];
      const bobDir = p.bobDir;
      if (bobDir && this.bob > 0 && this.state === 'scattered') {
        p.obj.position.copy(pos).addScaledVector(bobDir, Math.sin(t * 0.8 + p.phase) * this.bob);
      } else {
        p.obj.position.copy(pos);
      }
    }
    if (this.animating) {
      const a = this.animating;
      a.t += dt;
      let done = true;
      this.pieces.forEach((p, i) => {
        const delay = a.stagger * i;
        const k = Math.min(1, Math.max(0, (a.t - a.delay - delay) / a.duration));
        if (k < 1) done = false;
        p.obj.position.lerpVectors(p.from, p.positions[a.to], a.overshoot ? easeOutBack(k) : ease(k));
      });
      // glow fades out as pieces settle
      const g = Math.max(0, 1 - a.t / (a.delay + a.duration + 0.4));
      this.setGlow(g * 0.45);
      if (done) {
        this.animating = null;
        this.state = a.to;
        for (const p of this.pieces) p.obj.position.copy(p.positions[a.to]);
        this.setTilesActive(true);
        this.setGlow(0);
        a.onDone?.();
      }
    }
  }

  // jump straight to a state (undo / restart)
  setState(name) {
    this.animating = null;
    this.state = name;
    for (const p of this.pieces) p.obj.position.copy(p.positions[name]);
    this.setTilesActive(true);
    this.setGlow(0);
  }

  setGlow(v) {
    for (const m of this.mats) {
      if (!m.emissive) continue;
      m.emissive.copy(this.glowColor);
      m.emissiveIntensity = v;
    }
  }

  // run the morph to state `to`
  morph(to, { duration = 1.25, delay = 0.25, stagger = 0.09, overshoot = false, onDone = null } = {}) {
    this.setTilesActive(false);
    for (const p of this.pieces) p.from = p.obj.position.clone();
    this.animating = { to, t: 0, duration, delay, stagger, overshoot, onDone };
    this.solvedOnce.add(to);
    this.onMorph?.(to);
  }
}

// Helper to make an "assemble" set: pieces scattered by k * viewDir from home.
export function assembleSet({ id, pieces, view, requires, reveal, tolerance, magnet, bob = 0.12, hint }) {
  const dir = view.clone().normalize();
  const ps = pieces.map(({ obj, tiles = [], k, home }) => {
    const h = (home ?? obj.position).clone();
    return {
      obj, tiles,
      positions: { home: h, scattered: h.clone().addScaledVector(dir, k) },
      bobDir: dir,
    };
  });
  return new MorphSet({
    id, pieces: ps, state: 'scattered', tolerance, magnet, bob,
    triggers: [{ to: 'home', view: dir, requires, reveal, hint }],
  });
}

// Watches all morph sets, drives the camera magnet, feedback and firing.
export class IllusionDirector {
  constructor(game) {
    this.game = game;
    this.sets = [];
    this.best = null;
    this.locking = null;
  }

  add(set) { this.sets.push(set); return set; }
  clear() { this.sets.length = 0; this.best = null; this.locking = null; }

  get busy() { return !!this.locking || this.sets.some((s) => s.animating); }

  update(dt, t, active = true) {
    const rig = this.game.rig;
    for (const s of this.sets) s.update(dt, t, rig);
    if (!active) {
      rig.magnet = null;
      this.best = null;
      this.closeness = 0;
      this.game.onAlignment?.(0, null);
      return;
    }
    if (this.locking) {
      // safety: never stay locked if a camera animation was interrupted
      if (t - this.locking.t0 > 6 && !rig.anim) this.locking = null;
      else return;
    }
    // find the closest eligible trigger
    let best = null;
    const vd = rig.viewDir(new THREE.Vector3());
    for (const s of this.sets) {
      for (const tr of s.eligible()) {
        if (this.game.blockMorph?.(s, tr)) continue;
        const ang = vd.angleTo(tr.view);
        if (!best || ang < best.ang) best = { set: s, tr, ang };
      }
    }
    this.best = best;
    const glowSets = new Set();
    let closeness = 0;
    if (best && best.ang < best.set.magnet) {
      closeness = 1 - best.ang / best.set.magnet;
      rig.magnet = { dir: best.tr.view, radius: best.set.magnet };
      glowSets.add(best.set);
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      best.set.setGlow(closeness * closeness * (0.35 + 0.25 * pulse));
      if (best.ang < best.set.tolerance && !this.game.player.busy) {
        best.set.dwell += dt;
        if (best.set.dwell > 0.28) this.fire(best.set, best.tr);
      } else {
        best.set.dwell = 0;
      }
    } else {
      rig.magnet = null;
    }
    for (const s of this.sets) if (!glowSets.has(s) && !s.animating) { s.setGlow(0); s.dwell = 0; }
    this.closeness = closeness;
    this.game.onAlignment?.(closeness, best);
  }

  fire(set, tr) {
    const g = this.game;
    const rig = g.rig;
    this.locking = { set, tr, t0: g.time };
    set.dwell = 0;
    g.onLock?.(set, tr);
    // snap exactly onto the view, hold a beat, then reveal while pieces slide
    rig.animateTo({
      dir: tr.view, duration: 0.25, lock: true,
      onDone: () => {
        set.setGlow(0.6);
        set.morph(tr.to, {
          duration: tr.duration ?? 1.3,
          delay: 0.35,
          stagger: tr.stagger ?? 0.1,
          onDone: () => {
            g.graph.rebuild();
            g.onMorphDone?.(set, tr);
          },
        });
        const rv = tr.reveal ?? { yaw: 24, pitch: 10 };
        g.after(0.45, () => {
          const a = rig.anglesFor(tr.view);
          rig.animateTo({
            yaw: a.yaw + THREE.MathUtils.degToRad(rv.yaw),
            pitch: THREE.MathUtils.clamp(a.pitch + THREE.MathUtils.degToRad(rv.pitch), rig.pitchMin + 0.05, rig.pitchMax - 0.05),
            zoom: rv.zoom ?? null,
            duration: 2.2, lock: true,
            onDone: () => { this.locking = null; },
          });
        });
      },
    });
  }
}
