// The walker: a small figure in a mustard raincoat holding a red balloon.
// Moves tile to tile; when a step crosses a bent edge it pivots over it, so
// gravity follows the path.
import * as THREE from 'three';
import { patchMaterial } from './materials.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

function mat(color, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o });
  patchMaterial(m, { mist: true });
  return m;
}

function capsule(r, len, m) {
  const g = new THREE.CapsuleGeometry(r, len, 6, 12);
  g.translate(0, -len / 2 - r, 0); // pivot at the top
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

export function quatFromUpForward(up, fwd, out = new THREE.Quaternion()) {
  const u = _v.copy(up).normalize();
  const f = _v2.copy(fwd).addScaledVector(u, -fwd.dot(u));
  if (f.lengthSq() < 1e-6) f.set(0, 0, 1).addScaledVector(u, -u.z);
  if (f.lengthSq() < 1e-6) f.set(1, 0, 0);
  f.normalize();
  const r = new THREE.Vector3().crossVectors(u, f);
  _m.makeBasis(r, u, f);
  return out.setFromRotationMatrix(_m);
}

export function buildFigure({ coat = '#f2c14e', pants = '#2b3046', skin = '#f1cfb4', boots = '#7a3b2e' } = {}) {
  const root = new THREE.Group();
  const M = {
    coat: mat(coat, { roughness: 0.55 }),
    pants: mat(pants),
    skin: mat(skin, { roughness: 0.8 }),
    boots: mat(boots, { roughness: 0.6 }),
    eye: mat('#1b1b22', { roughness: 0.3 }),
    cheek: mat('#f19a8f', { roughness: 0.9 }),
  };
  const body = new THREE.Group();
  body.position.y = 0.2;
  root.add(body);
  // legs
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.045, 0.2, 0);
  legR.position.set(0.045, 0.2, 0);
  for (const leg of [legL, legR]) {
    const l = capsule(0.032, 0.12, M.pants);
    leg.add(l);
    const boot = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 8), M.boots);
    boot.scale.set(0.9, 0.6, 1.25);
    boot.position.set(0, -0.178, 0.012);
    boot.castShadow = true;
    leg.add(boot);
    root.add(leg);
  }
  // coat (a soft bell)
  const pts = [];
  const prof = [[0.0, 0.0], [0.105, 0.0], [0.11, 0.02], [0.098, 0.1], [0.085, 0.18], [0.07, 0.235], [0.03, 0.26], [0.0, 0.262]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const coatMesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), M.coat);
  coatMesh.castShadow = true;
  coatMesh.scale.set(1, 1, 0.86);
  body.add(coatMesh);
  // buttons
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), M.eye);
    b.position.set(0, 0.06 + i * 0.05, 0.088 - i * 0.008);
    body.add(b);
  }
  // head
  const head = new THREE.Group();
  head.position.y = 0.33;
  body.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 14), M.skin);
  face.castShadow = true;
  head.add(face);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.098, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), M.coat);
  hood.rotation.x = -0.55;
  hood.position.set(0, 0.008, -0.014);
  hood.castShadow = true;
  head.add(hood);
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.012, 8, 24), M.coat);
  brim.position.set(0, 0.0, 0.03);
  brim.rotation.x = -0.35;
  head.add(brim);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), M.eye);
    e.position.set(0.03 * s, -0.004, 0.079);
    e.scale.set(1, 1.3, 0.6);
    head.add(e);
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), M.cheek);
    c.position.set(0.048 * s, -0.03, 0.068);
    c.scale.set(1, 0.6, 0.4);
    head.add(c);
  }
  // arms
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.088, 0.22, 0);
  armR.position.set(0.088, 0.22, 0);
  for (const [arm, s] of [[armL, -1], [armR, 1]]) {
    const a = capsule(0.026, 0.1, M.coat);
    arm.add(a);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), M.skin);
    hand.position.y = -0.155;
    arm.add(hand);
    arm.rotation.z = 0.18 * s;
    body.add(arm);
  }
  const handR = new THREE.Object3D();
  handR.position.y = -0.16;
  armR.add(handR);
  return { root, body, head, legL, legR, armL, armR, handR };
}

export class Character {
  constructor(scene) {
    this.scene = scene;
    const f = buildFigure();
    this.fig = f;
    this.root = new THREE.Group();
    this.root.add(f.root);
    scene.add(this.root);
    this.tile = null;
    this.move = null; // active step
    this.up = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(0, 0, 1);
    this.walkPhase = 0;
    this.speed = 3.4; // tiles / s
    this.anim = null; // 'kick' | 'cheer' | 'bump'
    this.animT = 0;
    this.idleT = 0;
    this.visible = true;
    this.lookAt = null;

    // balloon lives in world space so it can lag behind
    const bm = new THREE.MeshPhysicalMaterial({ color: '#e3262f', roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.3, sheen: 0.3 });
    patchMaterial(bm, { mist: true });
    this.balloon = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 18), bm);
    ball.scale.set(1, 1.18, 1);
    ball.castShadow = true;
    ball.userData.keepColor = true;
    this.balloon.add(ball);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.035, 8), bm);
    knot.position.y = -0.15;
    knot.userData.keepColor = true;
    this.balloon.add(knot);
    scene.add(this.balloon);
    this.balloonPos = new THREE.Vector3();
    this.balloonVel = new THREE.Vector3();
    this.balloonUp = new THREE.Vector3(0, 1, 0);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 12), 3));
    this.string = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: '#f4efe6', transparent: true, opacity: 0.85 }));
    this.string.frustumCulled = false;
    scene.add(this.string);
    this.handWorld = new THREE.Vector3();
  }

  dispose() {
    this.scene.remove(this.root, this.balloon, this.string);
  }

  place(tile) {
    this.tile = tile;
    this.move = null;
    this.up.copy(tile.up);
    tile.footPos(this.root.position);
    if (Math.abs(this.forward.dot(this.up)) > 0.9) this.forward.set(0, 0, 1);
    quatFromUpForward(this.up, this.forward, this.root.quaternion);
    this.root.updateMatrixWorld(true);
    this.fig.handR.getWorldPosition(this.handWorld);
    this.balloonPos.copy(this.handWorld).addScaledVector(this.up, 0.6);
    this.balloonVel.set(0, 0, 0);
    this.balloonUp.copy(this.up);
  }

  get busy() { return !!this.move; }

  // begin a step to a neighbouring tile
  stepTo(next, mid) {
    const from = this.tile;
    const wrap = from.up.dot(next.up) < 0.99;
    const a = from.footPos(new THREE.Vector3());
    const b = next.footPos(new THREE.Vector3());
    const len = wrap ? a.distanceTo(mid) + mid.distanceTo(b) : a.distanceTo(b);
    this.move = {
      from, to: next, a, b, mid: mid.clone(), wrap, t: 0,
      dur: Math.max(0.12, len / this.speed) * (wrap ? 1.25 : 1),
      upA: from.up.clone(), upB: next.up.clone(),
    };
    return this.move.dur;
  }

  play(name) {
    this.anim = name;
    this.animT = 0;
  }

  // follow a moving tile (e.g. a platform that slides while we stand on it)
  stickToTile() {
    if (!this.move && this.tile) {
      this.tile.updateWorld();
      this.tile.footPos(this.root.position);
    }
  }

  update(dt, t) {
    const f = this.fig;
    let moving = false;
    if (this.move) {
      const m = this.move;
      m.t += dt / m.dur;
      const k = Math.min(1, m.t);
      moving = true;
      let fwd;
      if (m.wrap) {
        if (k < 0.5) {
          this.root.position.lerpVectors(m.a, m.mid, k * 2);
          fwd = _v.copy(m.mid).sub(m.a);
        } else {
          this.root.position.lerpVectors(m.mid, m.b, (k - 0.5) * 2);
          fwd = _v.copy(m.b).sub(m.mid);
        }
        const s = THREE.MathUtils.smoothstep(k, 0.3, 0.7);
        _q.setFromUnitVectors(m.upA, m.upB);
        const qa = new THREE.Quaternion();
        qa.slerp(_q, s);
        this.up.copy(m.upA).applyQuaternion(qa);
      } else {
        this.root.position.lerpVectors(m.a, m.b, k);
        fwd = _v.copy(m.b).sub(m.a);
      }
      if (fwd.lengthSq() > 1e-6) this.forward.copy(fwd).normalize();
      this.walkPhase += dt * this.speed * Math.PI * 1.9;
      if (k >= 1) {
        this.tile = m.to;
        this.up.copy(m.to.up);
        this.move = null;
        this.onArrive?.(m.to, m.from);
      }
    } else if (this.tile) {
      this.stickToTile();
      this.up.copy(this.tile.up);
    }

    // orientation
    let fwdTarget = this.forward;
    if (!moving && this.lookAt) {
      const d = _v2.copy(this.lookAt).sub(this.root.position);
      d.addScaledVector(this.up, -d.dot(this.up));
      if (d.lengthSq() > 0.01) fwdTarget = d.normalize();
    }
    const targetQ = quatFromUpForward(this.up, fwdTarget, new THREE.Quaternion());
    this.root.quaternion.slerp(targetQ, 1 - Math.exp(-(moving ? 18 : 8) * dt));
    if (!moving && fwdTarget !== this.forward) this.forward.lerp(fwdTarget, 1 - Math.exp(-8 * dt)).normalize();

    // limbs
    const sw = moving ? Math.sin(this.walkPhase) : 0;
    const amp = moving ? 0.75 : 0;
    const blend = 1 - Math.exp(-14 * dt);
    const lerpR = (o, axis, v) => { o.rotation[axis] += (v - o.rotation[axis]) * blend; };
    this.idleT += dt;
    let legL = sw * amp, legR = -sw * amp, armL = -sw * 0.6, armR = sw * 0.35 - 0.2;
    let bodyY = 0.2 + (moving ? Math.abs(Math.cos(this.walkPhase)) * 0.018 : Math.sin(this.idleT * 2.2) * 0.004);
    let lean = moving ? 0.12 : 0;
    let headTilt = moving ? 0 : Math.sin(this.idleT * 0.7) * 0.12;
    let armRz = 0.18, armLz = -0.18;
    if (this.anim) {
      this.animT += dt;
      const a = this.animT;
      if (this.anim === 'kick') {
        const p = Math.sin(Math.min(1, a / 0.35) * Math.PI);
        legR = -1.3 * p;
        lean = -0.15 * p;
        armL = 0.5 * p; armR = -0.5 * p;
        if (a > 0.4) this.anim = null;
      } else if (this.anim === 'cheer') {
        const p = Math.min(1, a / 0.3);
        armLz = -2.6 * p; armRz = 2.6 * p; armL = 0; armR = 0;
        bodyY += Math.abs(Math.sin(a * 7)) * 0.05 * (a < 1.2 ? 1 : 0);
        headTilt = 0.15;
      } else if (this.anim === 'bump') {
        const p = Math.sin(Math.min(1, a / 0.25) * Math.PI);
        lean = -0.25 * p;
        if (a > 0.3) this.anim = null;
      } else if (this.anim === 'look') {
        headTilt = -0.4;
        armR = -0.4;
        if (a > 1.6) this.anim = null;
      }
    }
    lerpR(f.legL, 'x', legL);
    lerpR(f.legR, 'x', legR);
    lerpR(f.armL, 'x', armL);
    lerpR(f.armR, 'x', armR);
    lerpR(f.armL, 'z', armLz);
    lerpR(f.armR, 'z', armRz);
    lerpR(f.body, 'x', lean);
    lerpR(f.head, 'z', headTilt);
    f.body.position.y += (bodyY - f.body.position.y) * blend;

    this.root.visible = this.visible;
    this.balloon.visible = this.string.visible = this.visible;
    this.root.updateMatrixWorld(true);
    this.updateBalloon(dt, t);
  }

  updateBalloon(dt, t) {
    this.fig.handR.getWorldPosition(this.handWorld);
    this.balloonUp.lerp(this.up, 1 - Math.exp(-3 * dt)).normalize();
    const rest = _v.copy(this.handWorld).addScaledVector(this.balloonUp, 0.62);
    rest.x += Math.sin(t * 0.9) * 0.05;
    rest.z += Math.cos(t * 0.7) * 0.05;
    const k = 38, c = 5.5;
    const acc = _v2.copy(rest).sub(this.balloonPos).multiplyScalar(k).addScaledVector(this.balloonVel, -c);
    this.balloonVel.addScaledVector(acc, dt);
    this.balloonPos.addScaledVector(this.balloonVel, dt);
    // keep the string length sane
    const d = this.balloonPos.clone().sub(this.handWorld);
    const L = d.length();
    if (L > 0.75) this.balloonPos.copy(this.handWorld).addScaledVector(d, 0.75 / L);
    this.balloon.position.copy(this.balloonPos);
    const dirUp = d.normalize();
    this.balloon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirUp.lerp(this.balloonUp, 0.4).normalize());
    // string: gentle curve from hand to balloon knot
    const knot = this.balloonPos.clone().addScaledVector(this.balloon.up.clone().applyQuaternion(this.balloon.quaternion), -0.165);
    const pos = this.string.geometry.getAttribute('position');
    const ctrl = this.handWorld.clone().lerp(knot, 0.5).addScaledVector(this.balloonVel, -0.04);
    for (let i = 0; i < 12; i++) {
      const s = i / 11;
      const a = this.handWorld.clone().lerp(ctrl, s);
      const b = ctrl.clone().lerp(knot, s);
      a.lerp(b, s);
      pos.setXYZ(i, a.x, a.y, a.z);
    }
    pos.needsUpdate = true;
  }
}
