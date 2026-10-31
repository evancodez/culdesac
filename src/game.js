import * as THREE from 'three';
import { Renderer } from './core/post.js';
import { CameraRig, deg } from './core/camera.js';
import { Input } from './core/input.js';
import { TileGraph, SOUND } from './core/tiles.js';
import { Character } from './core/character.js';
import { IllusionDirector } from './core/illusion.js';
import { FX } from './core/fx.js';
import { G } from './core/materials.js';
import { audio } from './core/audio.js';
import { UI } from './ui.js';
import { Level0 } from './levels/level0.js';
import { Level1 } from './levels/level1.js';
import { Level2 } from './levels/level2.js';
import { Level3 } from './levels/level3.js';
import { Level4 } from './levels/level4.js';
import { Level5 } from './levels/level5.js';

export const LEVELS = [Level0, Level1, Level2, Level4, Level3, Level5];
const STORE = 'culdesac.v1';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) ?? {}; } catch { return {}; }
}
function save(d) {
  try { localStorage.setItem(STORE, JSON.stringify(d)); } catch { /* private mode */ }
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.post = new Renderer(canvas);
    this.rig = new CameraRig();
    this.input = new Input(canvas);
    this.director = new IllusionDirector(this);
    this.scene = new THREE.Scene();
    this.fx = new FX(this.scene);
    this.graph = new TileGraph();
    this.timers = [];
    this.tweens = [];
    this.state = 'boot';
    this.time = 0;
    this.undoStack = [];
    this.walkQueue = [];
    this.bumpT = 0;
    this.restartHold = 0;
    this.idleTime = 0;
    this.frameUp = new THREE.Vector3(0, 1, 0);
    this.saveData = { unlocked: 0, settings: {}, ...load() };
    this.settings = { master: 0.85, music: 0.7, sfx: 0.85, sensitivity: 1, invertY: false, motion: true, ...this.saveData.settings };
    this.ui = new UI(this);
    this.applySettings();
    this.perf = { acc: 0, frames: 0, slow: 0 };
    this.marker = this.makeMarker();
    this.raycaster = new THREE.Raycaster();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // ------------------------------------------------------------------ utils
  after(t, fn) { this.timers.push({ t, fn }); }
  tween(obj, key, to, dur, { ease: e = ease, onDone = null } = {}) {
    this.tweens = this.tweens.filter((tw) => !(tw.obj === obj && tw.key === key));
    this.tweens.push({ obj, key, from: obj[key], to, dur, t: 0, e, onDone });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.post.resize(w, h);
    this.rig.resize(w, h);
  }

  applySettings() {
    const s = this.settings;
    audio.setMasterVolume(s.master);
    audio.setMusicVolume(s.music);
    audio.setSfxVolume(s.sfx);
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.saveData.settings = s;
    save(this.saveData);
  }

  makeMarker() {
    const g = new THREE.RingGeometry(0.3, 0.38, 40);
    const m = new THREE.MeshBasicMaterial({ color: '#fff7e8', transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 5;
    return mesh;
  }

  // ------------------------------------------------------------------ levels
  disposeScene() {
    const s = this.scene;
    if (!s) return;
    s.traverse((o) => {
      if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose?.();
    });
    if (s.environment) s.environment.dispose();
  }

  loadLevel(i, { attract = false } = {}) {
    this.disposeScene();
    this.scene = new THREE.Scene();
    this.graph = new TileGraph();
    this.fx.motes = [];
    this.fx.attach(this.scene);
    this.director.clear();
    this.timers = this.timers.filter((t) => t.keep);
    this.levelIndex = i;
    this.undoStack = [];
    this.walkQueue = [];
    this.frameUp.set(0, 1, 0);
    const L = new LEVELS[i](this);
    this.level = L;
    L.build();
    this.graph.rebuild();
    this.player = new Character(this.scene);
    this.player.place(L.start);
    this.player.onArrive = (tile, from) => this.onArrive(tile, from);
    this.scene.add(this.marker);
    const c = L.cameraStart;
    this.rig.pitchMin = deg(L.cameraLimits.pitchMin);
    this.rig.pitchMax = deg(L.cameraLimits.pitchMax);
    this.rig.zoomMin = L.cameraLimits.zoomMin ?? 4.5;
    this.rig.zoomMax = L.cameraLimits.zoomMax ?? 13;
    this.rig.set({ yaw: c.yaw, pitch: c.pitch, zoom: c.zoom, target: c.target ?? L.start.pos, frame: new THREE.Quaternion() });
    this.attract = attract;
    this.hintTimer = 0;
    this.hintShown = false;
    this.ui.setLevel(L);
    if (!attract) {
      audio.setMood(L.mood, { fade: 3 });
      L.begin?.();
    }
  }

  // ------------------------------------------------------------------ flow
  boot() {
    this.loadLevel(1, { attract: true });
    this.state = 'title';
    this.ui.showTitle();
    this.post.u.uFade.value = 1;
    this.tween(this.post.u.uFade, 'value', 0, 2.5);
    let last = performance.now();
    if (/[?&]tick/.test(location.search)) {
      // dev: drive frames with a timer (for testing in a hidden window)
      setInterval(() => { const now = performance.now(); this.frame(Math.min(0.05, (now - last) / 1000)); last = now; }, 16);
      return;
    }
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  startGame(index) {
    audio.init();
    this.ui.hideTitle();
    this.state = 'transition';
    const go = () => {
      this.loadLevel(index);
      this.state = 'play';
      this.ui.levelCard(this.level);
      this.transitionIn();
    };
    if (this.attract && index === this.levelIndex) {
      // the title backdrop is already level 1: just fly into the start view
      this.attract = false;
      this.state = 'play';
      audio.setMood(this.level.mood, { fade: 3 });
      const c = this.level.cameraStart;
      this.rig.animateTo({ yaw: deg(c.yaw), pitch: deg(c.pitch), zoom: c.zoom, duration: 2.2, lock: true });
      this.rig.goalTarget.copy(c.target ?? this.level.start.pos);
      this.ui.levelCard(this.level);
      this.level.begin?.();
    } else {
      this.transitionOut(go);
    }
  }

  transitionOut(then, dur = 1.3) {
    const u = this.post.u;
    if (!this.settings.motion) {
      this.tween(u.uFade, 'value', 1, 0.6, { onDone: then });
      return;
    }
    this.tween(u.uOp, 'value', 1, dur);
    this.tween(u.uSlice, 'value', 0.7, dur * 0.6, { onDone: () => this.tween(u.uSlice, 'value', 0, dur * 0.4) });
    this.after(dur + 0.15, then);
  }

  transitionIn(dur = 1.6) {
    const u = this.post.u;
    u.uFade.value = this.settings.motion ? 0 : u.uFade.value;
    this.tween(u.uFade, 'value', 0, 0.8);
    if (this.settings.motion) {
      u.uOp.value = 1;
      u.uSlice.value = 0.5;
      this.tween(u.uOp, 'value', 0, dur);
      this.tween(u.uSlice, 'value', 0, dur * 0.7);
    }
  }

  completeLevel() {
    if (this.level.done) return;
    this.level.done = true;
    this.state = 'complete';
    const i = this.levelIndex;
    this.saveData.unlocked = Math.max(this.saveData.unlocked ?? 0, Math.min(LEVELS.length - 1, i + 1));
    if (i === LEVELS.length - 1) this.saveData.finished = true;
    save(this.saveData);
    this.ui.clearPrompts();
    this.player.play('cheer');
    this.input.rumble(0.4, 0.6, 300);
    audio.door();
    const door = this.level.doorInfo?.();
    if (door?.open) door.open();
    else if (door?.pivot) this.tween(door.pivot.rotation, 'y', -1.7, 1.2);
    if (door?.glow) door.glow.visible = true;
    if (door?.target) this.player.lookAt = door.target;
    this.rig.animateTo({ zoom: Math.max(4.5, this.rig.zoom * 0.7), duration: 3, lock: true });
    this.after(1.5, () => {
      audio.levelComplete();
      if (door?.target) {
        // step into the light
        const p = this.player;
        const from = p.root.position.clone();
        const to = door.target.clone();
        const o = { k: 0 };
        this.tween(o, 'k', 1, 0.8, { onDone: () => { p.visible = false; } });
        this.tweens[this.tweens.length - 1].onStep = () => {
          p.root.position.lerpVectors(from, to, o.k);
          p.root.scale.setScalar(1 - o.k * 0.25);
        };
      }
    });
    this.after(3.0, () => {
      this.ui.chapterEnd(this.level);
      this.transitionOut(() => {
        if (i + 1 < LEVELS.length) {
          this.loadLevel(i + 1);
          this.state = 'play';
          this.ui.levelCard(this.level);
          this.transitionIn();
        } else {
          this.ending();
        }
      }, 1.8);
    });
  }

  ending() {
    this.loadLevel(LEVELS.indexOf(Level3), { attract: true });
    this.level.endingView?.();
    this.state = 'ending';
    audio.setMood('ending', { fade: 4 });
    this.transitionIn(2.5);
    this.ui.showEnding();
  }

  toTitle() {
    this.ui.hidePause();
    this.transitionOut(() => {
      this.loadLevel(1, { attract: true });
      this.state = 'title';
      audio.setMood('title', { fade: 3 });
      this.ui.showTitle();
      this.transitionIn();
    }, 0.9);
  }

  restartLevel() {
    this.ui.hidePause();
    const i = this.levelIndex;
    this.state = 'transition';
    this.transitionOut(() => {
      this.loadLevel(i);
      this.state = 'play';
      this.transitionIn(1.0);
    }, 0.7);
  }

  pause(on) {
    if (on && this.state === 'play') {
      this.state = 'pause';
      audio.setPaused(true);
      this.ui.showPause();
    } else if (!on && this.state === 'pause') {
      this.state = 'play';
      audio.setPaused(false);
      this.ui.hidePause();
    }
  }

  // ------------------------------------------------------------------ frame
  frame(dt) {
    const inp = this.input;
    inp.poll();
    this.time += dt;
    G.uTime.value = this.time;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      if (!tm) continue; // a callback may have replaced the list (level load)
      if (this.state === 'pause' && !tm.keep) continue;
      tm.t -= dt;
      if (tm.t <= 0) { const k = this.timers.indexOf(tm); if (k >= 0) this.timers.splice(k, 1); tm.fn(); }
    }
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.obj[tw.key] = tw.from + (tw.to - tw.from) * tw.e(k);
      tw.onStep?.();
      if (k >= 1) { this.tweens.splice(i, 1); tw.onDone?.(); }
    }

    this.ui.update(dt);
    if (document.body.dataset.state !== this.state) document.body.dataset.state = this.state;

    if (this.state === 'play') this.updatePlay(dt);
    else if (this.state === 'pause') {
      if (inp.pressed('pause') || (inp.pressed('back') && !this.ui.subMenuOpen)) this.pause(false);
    } else if (this.state === 'title' || this.state === 'ending') {
      // slow drift around the diorama
      this.rig.orbit(dt * 0.06, 0);
      this.rig.userActive = 0;
    }

    if (this.state !== 'pause') {
      this.director.update(dt, this.time, this.state === 'play');
      this.level?.update(dt, this.time);
      this.player?.update(dt, this.time);
      this.followCamera(dt);
    }
    this.rig.update(this.state === 'pause' ? 0 : dt);
    this.updateSky();
    const ppu = (window.innerHeight * this.post.pixelRatio) / (this.rig.camera.top - this.rig.camera.bottom);
    this.fx.update(this.state === 'pause' ? 0 : dt, this.time, ppu);
    this.post.render(this.scene, this.rig.camera, this.time);
    this.adaptPerformance(dt);
    inp.endFrame();
  }

  updateSky() {
    const sky = this.level?.sky;
    if (!sky) return;
    const q = this.rig.camera.quaternion;
    const u = sky.material.uniforms;
    u.uCamF.value.set(0, 0, -1).applyQuaternion(q);
    u.uCamR.value.set(1, 0, 0).applyQuaternion(q);
    u.uCamU.value.set(0, 1, 0).applyQuaternion(q);
    u.uAspect.value = this.rig.aspect;
  }

  followCamera(dt) {
    const L = this.level;
    if (!L || !this.player) return;
    const p = this.player.root.position;
    if (this.attract) { this.rig.goalTarget.copy(L.attractFocus ?? L.sunCenter ?? p); return; }
    const focus = L.cameraFocus ? L.cameraFocus(p) : p;
    if (!this.rig.anim?.lockTarget) this.rig.goalTarget.copy(focus);
  }

  adaptPerformance(dt) {
    const pf = this.perf;
    pf.acc += dt;
    pf.frames++;
    if (pf.acc > 2.5) {
      const avg = pf.acc / pf.frames;
      const pr = this.post.pixelRatio;
      const maxPr = Math.min(window.devicePixelRatio, 2);
      if (avg > 1 / 45 && pr > 1) this.post.setPixelRatio(Math.max(1, pr - 0.25));
      else if (avg < 1 / 58 && pr < maxPr) this.post.setPixelRatio(Math.min(maxPr, pr + 0.25));
      pf.acc = 0;
      pf.frames = 0;
    }
  }

  // ------------------------------------------------------------------ play
  updatePlay(dt) {
    const inp = this.input;
    const L = this.level;
    const P = this.player;
    if (inp.pressed('pause')) { this.pause(true); return; }

    // camera
    const look = inp.look(dt);
    if (look.yaw || look.pitch) this.rig.orbit(look.yaw, look.pitch);
    const zf = inp.zoom(dt);
    if (zf !== 1) this.rig.zoomBy(zf);
    if (inp.pressed('recenter')) {
      const c = L.cameraStart;
      this.rig.animateTo({ yaw: deg(c.yaw), pitch: deg(c.pitch), duration: 0.8, lock: false });
    }

    // restart (hold)
    if (inp.holding('restart')) {
      this.restartHold += dt;
      this.ui.restartProgress(this.restartHold / 0.9);
      if (this.restartHold > 0.9) { this.restartHold = 0; this.ui.restartProgress(0); this.restartLevel(); return; }
    } else if (this.restartHold > 0) { this.restartHold = 0; this.ui.restartProgress(0); }

    if (inp.pressed('undo')) this.undo();
    if (inp.pressed('hint')) this.showHint(true);

    const locked = !!this.director.locking || L.busy;
    // movement
    const mv = inp.move();
    const mvMag = Math.hypot(mv.x, mv.y);
    if (mvMag > 0.3) this.walkQueue.length = 0;
    if (!locked && !P.busy) {
      if (mvMag > 0.3) {
        const choice = this.pickNeighborByScreen(mv);
        if (choice) this.tryStep(choice.tile, choice.mid);
      } else if (this.walkQueue.length) {
        const next = this.walkQueue.shift();
        const nb = this.graph.neighbor(P.tile, next);
        if (nb) this.tryStep(next, nb.mid, true);
        else this.walkQueue.length = 0;
      }
    }

    // click / hover
    if (inp.click && !locked) this.handleClick(inp.click);
    this.updateMarker(dt);

    if (inp.pressed('interact')) L.interact?.(P.tile);

    // hints
    this.hintTimer += dt;
    const anyInput = mvMag > 0 || look.yaw || look.pitch || inp.click;
    if (anyInput) this.idleTime = 0; else this.idleTime += dt;
    if (this.hintTimer > (L.hintDelay ?? 60) && this.director.best) this.showHint(false);
    else this.ui.updateHintArrow(this.hintArrow());

    // gravity frame follows the player in levels that ask for it
    if (L.followGravity && P.tile) {
      const up = P.move ? P.move.upB : P.tile.up;
      if (up.dot(this.frameUp) < 0.99) {
        const dq = new THREE.Quaternion().setFromUnitVectors(this.frameUp, up);
        this.rig.goalFrame.premultiply(dq);
        this.frameUp.copy(up);
        if (up.y < -0.5 || up.y > 0.5) L.onFrameFlip?.(up);
      }
    }
  }

  pickNeighborByScreen(mv) {
    const P = this.player;
    const t = P.tile;
    if (!t) return null;
    const a = this.rig.project(t.footPos(_v), new THREE.Vector3());
    const asp = this.rig.aspect;
    let best = null, bestDot = 0.5;
    for (const n of t.neighbors) {
      const b = this.rig.project(n.tile.footPos(_v2), new THREE.Vector3());
      let dx = (b.x - a.x) * asp, dy = b.y - a.y;
      const l = Math.hypot(dx, dy);
      if (l < 1e-4) continue;
      dx /= l; dy /= l;
      const d = dx * mv.x + dy * mv.y;
      // prefer walkable / kickable tiles when two are similar
      const usable = n.tile.walkable || n.tile.occupant?.kickable;
      const score = d + (usable ? 0.15 : 0);
      if (d > 0.5 && score > bestDot) { bestDot = score; best = n; }
    }
    return best;
  }

  tryStep(tile, mid, fromQueue = false) {
    const P = this.player;
    const L = this.level;
    if (tile.occupant?.kickable) {
      if (fromQueue) { this.walkQueue.length = 0; return; }
      this.pushUndo();
      const ok = L.kick(tile.occupant, P.tile, tile);
      P.play('kick');
      P.lookAt = tile.pos.clone();
      this.after(0.4, () => { if (P.lookAt === null || P.lookAt) P.lookAt = null; });
      if (!ok) this.undoStack.pop();
      audio.kick();
      this.input.rumble(0.5, 0.2, 90);
      return;
    }
    if (!tile.walkable || L.canEnter(tile) === false || tile.occupant) {
      this.walkQueue.length = 0;
      if (this.bumpT < this.time) {
        this.bumpT = this.time + 0.35;
        P.lookAt = tile.pos.clone();
        P.play('bump');
        this.after(0.3, () => { P.lookAt = null; });
        L.onBump?.(tile);
      }
      return;
    }
    this.pushUndo();
    P.lookAt = null;
    P.stepTo(tile, mid);
    L.onStepStart?.(tile, P.tile);
  }

  onArrive(tile, from) {
    audio.step(SOUND[tile.kind] ?? 'stone');
    if (tile.up.dot(from.up) < 0.99) this.fx.puff(tile.footPos(new THREE.Vector3()), tile.up, { n: 4 });
    this.level.onArrive(tile, from);
  }

  pushUndo() {
    if (!this.level.undoable) return;
    this.undoStack.push({ tile: this.player.tile, state: this.level.getState() });
    if (this.undoStack.length > 400) this.undoStack.shift();
  }

  undo() {
    if (!this.level.undoable || this.director.busy || this.level.busy) return;
    const s = this.undoStack.pop();
    if (!s) { this.ui.toast('Nothing to undo'); return; }
    this.walkQueue.length = 0;
    this.level.setState(s.state);
    this.graph.rebuild();
    this.player.place(s.tile);
    audio.undo();
    this.post.u.uSlice.value = 0.25;
    this.tween(this.post.u.uSlice, 'value', 0, 0.35);
  }

  // ------------------------------------------------------------------ picking
  rayFrom(px, py) {
    const ndc = new THREE.Vector2((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    return this.raycaster.ray;
  }

  pickTile(px, py, any = false) {
    const ray = this.rayFrom(px, py);
    let best = null, bt = Infinity;
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), p = new THREE.Vector3();
    for (const t of this.graph.tiles) {
      if (!t.active) continue;
      if (!any && !t.walkable && !t.occupant?.kickable) continue;
      const n = t.normal;
      const den = ray.direction.dot(n);
      if (den > -0.05) continue;
      const tt = _v.copy(t.pos).sub(ray.origin).dot(n) / den;
      if (tt < 0 || tt >= bt) continue;
      p.copy(ray.origin).addScaledVector(ray.direction, tt).sub(t.corners[0]);
      e1.copy(t.corners[1]).sub(t.corners[0]);
      e2.copy(t.corners[3]).sub(t.corners[0]);
      const u = p.dot(e1) / e1.lengthSq(), v = p.dot(e2) / e2.lengthSq();
      if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) continue;
      bt = tt; best = t;
    }
    if (!best) return null;
    // occlusion against solid terrain (and anything the level marks as an occluder)
    const occ = this.level.occluders?.() ?? [];
    if (occ.length) {
      const hits = this.raycaster.intersectObjects(occ, true);
      if (hits.length && hits[0].distance < bt - 0.35) return null;
    }
    return best;
  }

  handleClick(c) {
    const P = this.player;
    const t = this.pickTile(c.x, c.y);
    if (!t) return;
    if (t.occupant?.kickable) {
      const nb = this.graph.neighbor(P.tile, t);
      if (nb && !P.busy) this.tryStep(t, nb.mid);
      return;
    }
    const path = this.graph.path(P.tile, t, (x) => x.walkable && !x.occupant && this.level.canEnter(x) !== false);
    if (path && path.length > 1) {
      this.walkQueue = path.slice(1);
      this.pulseMarker(t);
    } else if (!path) {
      this.ui.toast('Can’t get there from here — yet');
    }
  }

  pulseMarker(t) {
    this.markerPulse = { tile: t, t: 0 };
  }

  updateMarker(dt) {
    const m = this.marker;
    let tile = null, alpha = 0;
    if (this.markerPulse) {
      this.markerPulse.t += dt;
      tile = this.markerPulse.tile;
      alpha = Math.max(0, 0.9 - this.markerPulse.t * 0.9);
      if (alpha <= 0) this.markerPulse = null;
    } else if (this.input.device === 'kbm' && !this.input.mouse.down) {
      const mm = this.input.mouse;
      if (mm.moved || this.time - (this.hoverT ?? 0) > 0.25) {
        this.hoverT = this.time;
        this.hoverTile = this.pickTile(mm.x, mm.y);
      }
      tile = this.hoverTile;
      alpha = tile && tile !== this.player.tile ? 0.4 : 0;
    }
    m.material.opacity += (alpha - m.material.opacity) * Math.min(1, dt * 14);
    if (tile) {
      tile.footPos(m.position).addScaledVector(tile.up, 0.02);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tile.up);
      const s = this.markerPulse ? 1 + this.markerPulse.t * 0.6 : 1;
      m.scale.setScalar(s);
    }
    m.visible = m.material.opacity > 0.01;
  }

  // ------------------------------------------------------------------ hints
  hintArrow() {
    const b = this.director.best;
    if (!b || !this.hintShown) return null;
    const a = this.rig.anglesFor(b.tr.view);
    let dy = a.yaw - this.rig.goalYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const dp = a.pitch - this.rig.goalPitch;
    const mag = Math.hypot(dy, dp);
    if (mag < deg(3)) return { x: 0, y: 0, close: true };
    return { x: dy / mag, y: dp / mag, close: false, mag };
  }

  showHint(manual) {
    const b = this.director.best;
    const L = this.level;
    this.hintTimer = 0;
    const text = L.hintText?.() ?? null;
    if (b) {
      this.hintShown = true;
      this.after(8, () => { this.hintShown = false; });
      audio.hint();
      if (text) this.ui.toast(text, 6);
    } else if (manual) {
      this.ui.toast(text ?? 'Walk on. Look around. If it looks connected, it is.', 5);
      audio.hint();
    }
  }

  // ------------------------------------------------------------------ illusion callbacks
  blockMorph(set, tr) {
    const P = this.player;
    if (P.busy) return true;
    for (const p of set.pieces) if (p.tiles.includes(P.tile)) return true;
    return this.level.blockMorph?.(set, tr) ?? false;
  }

  onAlignment(closeness, best) {
    audio.setAlignment(this.state === 'play' ? closeness : 0);
    if (closeness > 0.82 && this.time - (this.lastRumble ?? 0) > 0.18) {
      this.lastRumble = this.time;
      this.input.rumble(0.0, 0.12 * closeness, 50);
    }
    if (best && closeness > 0.3 && Math.random() < closeness * 0.35) {
      const p = best.set.pieces[Math.floor(Math.random() * best.set.pieces.length)];
      this.fx.sparkle(p.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0)), { n: 1, spread: 1.4, size: 0.12 });
    }
  }

  onLock(set, tr) {
    audio.lock();
    audio.morph(1.8);
    this.input.rumble(0.7, 0.9, 220);
    this.hintShown = false;
    this.hintTimer = 0;
    const u = this.post.u;
    u.uFlash.value = 0.22;
    this.tween(u.uFlash, 'value', 0, 0.7);
    for (const p of set.pieces) {
      const wp = p.obj.getWorldPosition(new THREE.Vector3());
      this.fx.sparkle(wp, { n: 8, spread: 1.2 });
    }
    this.level.onLock?.(set, tr);
  }

  onMorphDone(set, tr) {
    for (const p of set.pieces) {
      const wp = p.obj.getWorldPosition(new THREE.Vector3());
      this.fx.ring(wp.clone().add(new THREE.Vector3(0, 0.05, 0)), { size: 0.4, size1: 2.6 });
      this.fx.puff(wp, new THREE.Vector3(0, 1, 0), { n: 3 });
    }
    this.level.onMorphDone?.(set, tr);
  }
}
