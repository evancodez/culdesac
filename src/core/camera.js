// Orthographic orbit camera. Orientation = frame * yaw * pitch, where `frame`
// is a gravity frame that can roll (the world turns over when you walk onto
// the underside). Alignment "magnets" gently pull the view onto illusion angles.
import * as THREE from 'three';

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();

export const deg = (d) => (d * Math.PI) / 180;
const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function dirFromYawPitch(yawDeg, pitchDeg) {
  const y = deg(yawDeg), p = deg(pitchDeg);
  return new THREE.Vector3(Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y));
}

export class CameraRig {
  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    this.yaw = deg(40);
    this.pitch = deg(34);
    this.goalYaw = this.yaw;
    this.goalPitch = this.pitch;
    this.zoom = 8;
    this.goalZoom = 8;
    this.zoomMin = 4;
    this.zoomMax = 14;
    this.pitchMin = deg(6);
    this.pitchMax = deg(89.6);
    this.dist = 80;
    this.target = new THREE.Vector3();
    this.goalTarget = new THREE.Vector3();
    this.frame = new THREE.Quaternion();
    this.goalFrame = new THREE.Quaternion();
    this.aspect = 1;
    this.anim = null;
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.magnet = null; // { dir: Vector3, radius: rad }
    this.userActive = 0; // seconds since last user orbit input (counts up)
    this.followRate = 2.5;
    this.idleDrift = 0;
  }

  resize(w, h) {
    this.aspect = w / h;
    this.applyProjection();
  }

  applyProjection() {
    const z = this.zoom;
    const a = this.aspect;
    // keep the diorama readable on tall screens
    const hz = a < 1 ? z / Math.max(a, 0.55) : z;
    this.camera.left = -hz * a;
    this.camera.right = hz * a;
    this.camera.top = hz;
    this.camera.bottom = -hz;
    this.camera.updateProjectionMatrix();
  }

  set({ yaw, pitch, zoom, target, frame }) {
    if (yaw != null) this.yaw = this.goalYaw = deg(yaw);
    if (pitch != null) this.pitch = this.goalPitch = deg(pitch);
    if (zoom != null) this.zoom = this.goalZoom = zoom;
    if (target) { this.target.copy(target); this.goalTarget.copy(target); }
    if (frame) { this.frame.copy(frame); this.goalFrame.copy(frame); }
    this.anim = null;
  }

  orientation(out = new THREE.Quaternion(), yaw = this.yaw, pitch = this.pitch, frame = this.frame) {
    out.copy(frame);
    _q.setFromAxisAngle(Y, yaw);
    out.multiply(_q);
    _q.setFromAxisAngle(X, -pitch);
    out.multiply(_q);
    return out;
  }

  // unit vector from target toward the camera, in world space
  viewDir(out = new THREE.Vector3()) {
    this.orientation(_q2);
    return out.set(0, 0, 1).applyQuaternion(_q2);
  }

  // yaw/pitch (radians, in current frame) that look along world direction `dir`
  anglesFor(dir) {
    const f = _v.copy(dir).applyQuaternion(_q.copy(this.goalFrame).invert());
    return { yaw: Math.atan2(f.x, f.z), pitch: Math.asin(THREE.MathUtils.clamp(f.y, -1, 1)) };
  }

  angleTo(dir) {
    return this.viewDir(_v).angleTo(dir);
  }

  orbit(dYaw, dPitch) {
    if (this.anim?.lock) return;
    this.goalYaw += dYaw;
    this.goalPitch = THREE.MathUtils.clamp(this.goalPitch + dPitch, this.pitchMin, this.pitchMax);
    if (Math.abs(dYaw) + Math.abs(dPitch) > 1e-5) this.userActive = 0;
  }

  zoomBy(f) {
    this.goalZoom = THREE.MathUtils.clamp(this.goalZoom * f, this.zoomMin, this.zoomMax);
  }

  // animate to a view; `lock` blocks user input meanwhile
  animateTo({ dir = null, yaw = null, pitch = null, zoom = null, duration = 1.2, lock = true, onDone = null }) {
    let ty = this.goalYaw, tp = this.goalPitch;
    if (dir) {
      const a = this.anglesFor(dir);
      ty = a.yaw; tp = a.pitch;
    }
    if (yaw != null) ty = yaw;
    if (pitch != null) tp = pitch;
    ty = this.yaw + wrap(ty - this.yaw);
    this.anim = {
      t: 0, duration, lock, onDone,
      y0: this.yaw, p0: this.pitch, z0: this.zoom,
      y1: ty, p1: tp, z1: zoom ?? this.goalZoom,
    };
  }

  shake(amp = 0.08, t = 0.35) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, t);
  }

  update(dt) {
    this.userActive += dt;
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const k = ease(Math.min(1, a.t / a.duration));
      this.yaw = this.goalYaw = a.y0 + (a.y1 - a.y0) * k;
      this.pitch = this.goalPitch = a.p0 + (a.p1 - a.p0) * k;
      this.zoom = this.goalZoom = a.z0 + (a.z1 - a.z0) * k;
      if (a.t >= a.duration) {
        this.anim = null;
        a.onDone?.();
      }
    } else {
      // alignment magnet: stronger the closer we are, and when the user lets go
      if (this.magnet) {
        const { dir, radius } = this.magnet;
        const ang = this.angleTo(dir);
        if (ang < radius) {
          const a = this.anglesFor(dir);
          const closeness = 1 - ang / radius;
          const idle = this.userActive > 0.12 ? 1 : 0.35;
          const k = (1.2 + 7 * closeness * closeness) * idle;
          const f = 1 - Math.exp(-k * dt);
          this.goalYaw += wrap(a.yaw - this.goalYaw) * f;
          this.goalPitch += (a.pitch - this.goalPitch) * f;
        }
      }
      this.goalPitch = THREE.MathUtils.clamp(this.goalPitch, this.pitchMin, this.pitchMax);
      this.yaw = damp(this.yaw, this.goalYaw, 14, dt);
      this.pitch = damp(this.pitch, this.goalPitch, 14, dt);
      this.zoom = damp(this.zoom, this.goalZoom, 8, dt);
    }
    this.target.x = damp(this.target.x, this.goalTarget.x, this.followRate, dt);
    this.target.y = damp(this.target.y, this.goalTarget.y, this.followRate, dt);
    this.target.z = damp(this.target.z, this.goalTarget.z, this.followRate, dt);
    this.frame.slerp(this.goalFrame, 1 - Math.exp(-2.6 * dt));

    this.orientation(this.camera.quaternion);
    const off = _v.set(0, 0, 1).applyQuaternion(this.camera.quaternion).multiplyScalar(this.dist);
    this.camera.position.copy(this.target).add(off);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const s = this.shakeAmp * Math.max(0, this.shakeT) * 3;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }
    this.applyProjection();
    this.camera.updateMatrixWorld(true);
  }

  // NDC (x,y in -1..1) of a world point
  project(p, out = new THREE.Vector3()) {
    return out.copy(p).project(this.camera);
  }
}
