// Unified keyboard / mouse / gamepad (DualSense, standard mapping) input.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.device = 'kbm';
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, down: false, button: -1, dragging: false, sx: 0, sy: 0, dx: 0, dy: 0, wheel: 0, moved: false };
    this.click = null; // {x, y} pixels, set for one frame on a non-drag click
    this.pad = null;
    this.padButtons = [];
    this.padPrev = [];
    this.padAxes = [0, 0, 0, 0];
    this.held = {};
    this.sensitivity = 1;
    this.invertY = false;
    this.enabled = true;
    this.listeners = [];

    const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); this.listeners.push([el, ev, fn, opt]); };
    on(window, 'keydown', (e) => {
      if (e.repeat) { this.keys.add(e.code); return; }
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
      this.device = 'kbm';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => { this.keys.clear(); this.mouse.down = false; this.mouse.dragging = false; });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'pointerdown', (e) => {
      this.device = 'kbm';
      this.mouse.down = true;
      this.mouse.button = e.button;
      this.mouse.sx = this.mouse.x = e.clientX;
      this.mouse.sy = this.mouse.y = e.clientY;
      this.mouse.dragging = false;
      canvas.setPointerCapture?.(e.pointerId);
    });
    on(canvas, 'pointermove', (e) => {
      const m = this.mouse;
      const px = m.x, py = m.y;
      m.x = e.clientX; m.y = e.clientY;
      m.moved = true;
      if (m.down) {
        if (!m.dragging && Math.hypot(m.x - m.sx, m.y - m.sy) > 6) m.dragging = true;
        if (m.dragging) { m.dx += m.x - px; m.dy += m.y - py; }
      }
    });
    on(canvas, 'pointerup', (e) => {
      const m = this.mouse;
      if (m.down && !m.dragging && m.button === 0) this.click = { x: e.clientX, y: e.clientY };
      m.down = false;
      m.dragging = false;
      canvas.releasePointerCapture?.(e.pointerId);
    });
    on(canvas, 'wheel', (e) => { this.mouse.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    on(window, 'gamepadconnected', () => { this.device = 'pad'; });
  }

  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    this.pad = pad;
    this.padPrev = this.padButtons;
    if (pad) {
      this.padButtons = pad.buttons.map((b) => b.value);
      this.padAxes = [0, 1, 2, 3].map((i) => pad.axes[i] ?? 0);
      const anyBtn = this.padButtons.some((v, i) => v > 0.5 && !(this.padPrev[i] > 0.5));
      const anyAxis = this.padAxes.some((a) => Math.abs(a) > 0.4);
      if (anyBtn || anyAxis) this.device = 'pad';
    } else {
      this.padButtons = [];
      this.padAxes = [0, 0, 0, 0];
    }
  }

  btn(i) { return (this.padButtons[i] ?? 0) > 0.5; }
  btnPressed(i) { return (this.padButtons[i] ?? 0) > 0.5 && !((this.padPrev[i] ?? 0) > 0.5); }
  key(...codes) { return codes.some((c) => this.keys.has(c) || this.pressedKeys.has(c)); }
  keyPressed(...codes) { return codes.some((c) => this.pressedKeys.has(c)); }

  stick(ix, iy) {
    const x = this.padAxes[ix], y = this.padAxes[iy];
    const m = Math.hypot(x, y);
    const dz = 0.2;
    if (m < dz) return { x: 0, y: 0 };
    const s = (m - dz) / (1 - dz) / m;
    return { x: x * s, y: y * s };
  }

  // screen-space movement intent (x right, y up), magnitude 0..1
  move() {
    let x = 0, y = 0;
    if (this.key('KeyA')) x -= 1;
    if (this.key('KeyD')) x += 1;
    if (this.key('KeyW')) y += 1;
    if (this.key('KeyS')) y -= 1;
    const s = this.stick(0, 1);
    x += s.x; y -= s.y;
    if (this.btn(14)) x -= 1;
    if (this.btn(15)) x += 1;
    if (this.btn(12)) y += 1;
    if (this.btn(13)) y -= 1;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }

  // camera orbit deltas in radians for this frame
  look(dt) {
    let yaw = 0, pitch = 0;
    const kRate = 1.6 * this.sensitivity;
    if (this.key('ArrowLeft', 'KeyQ')) yaw -= kRate * dt;
    if (this.key('ArrowRight', 'KeyE')) yaw += kRate * dt;
    if (this.key('ArrowUp')) pitch += kRate * 0.7 * dt;
    if (this.key('ArrowDown')) pitch -= kRate * 0.7 * dt;
    const s = this.stick(2, 3);
    // response curve: gentle near the centre for fine alignment, quick at the rim
    const cx = s.x * (0.35 + 0.65 * Math.abs(s.x)), cy = s.y * (0.35 + 0.65 * Math.abs(s.y));
    yaw += cx * 1.9 * this.sensitivity * dt;
    pitch -= cy * 1.3 * this.sensitivity * dt * (this.invertY ? -1 : 1);
    const m = this.mouse;
    if (m.dx || m.dy) {
      yaw -= m.dx * 0.0045 * this.sensitivity;
      pitch += m.dy * 0.0038 * this.sensitivity * (this.invertY ? -1 : 1);
    }
    return { yaw, pitch };
  }

  zoom(dt) {
    let f = 1;
    if (this.mouse.wheel) f *= Math.exp(this.mouse.wheel * 0.0012);
    if (this.key('Minus', 'NumpadSubtract')) f *= Math.exp(1.2 * dt);
    if (this.key('Equal', 'NumpadAdd')) f *= Math.exp(-1.2 * dt);
    const l2 = this.padButtons[6] ?? 0, r2 = this.padButtons[7] ?? 0;
    f *= Math.exp((l2 - r2) * 1.4 * dt);
    return f;
  }

  // edge-triggered actions
  pressed(action) {
    switch (action) {
      case 'interact': return this.keyPressed('Space', 'Enter', 'NumpadEnter') || this.btnPressed(0);
      case 'confirm': return this.keyPressed('Space', 'Enter', 'NumpadEnter') || this.btnPressed(0);
      case 'back': return this.keyPressed('Escape', 'Backspace') || this.btnPressed(1);
      case 'undo': return this.keyPressed('KeyZ', 'Backspace') || this.btnPressed(2);
      case 'hint': return this.keyPressed('KeyH') || this.btnPressed(3);
      case 'pause': return this.keyPressed('Escape', 'KeyP') || this.btnPressed(9);
      case 'recenter': return this.keyPressed('KeyC') || this.btnPressed(11);
      case 'up': return this.keyPressed('ArrowUp', 'KeyW') || this.btnPressed(12) || this.stickEdge('up');
      case 'down': return this.keyPressed('ArrowDown', 'KeyS') || this.btnPressed(13) || this.stickEdge('down');
      case 'left': return this.keyPressed('ArrowLeft', 'KeyA') || this.btnPressed(14) || this.stickEdge('left');
      case 'right': return this.keyPressed('ArrowRight', 'KeyD') || this.btnPressed(15) || this.stickEdge('right');
      case 'any': return this.pressedKeys.size > 0 || this.padButtons.some((v, i) => v > 0.5 && !(this.padPrev[i] > 0.5)) || !!this.click;
    }
    return false;
  }

  holding(action) {
    if (action === 'restart') return this.key('KeyR') || this.btn(8);
    return false;
  }

  stickEdge(dir) {
    const s = this.stick(0, 1);
    const st = this._stickState ?? (this._stickState = { dir: null, t: 0 });
    let d = null;
    if (Math.abs(s.x) > 0.6 || Math.abs(s.y) > 0.6) {
      if (Math.abs(s.x) > Math.abs(s.y)) d = s.x > 0 ? 'right' : 'left';
      else d = s.y > 0 ? 'down' : 'up';
    }
    if (this._stickFrame !== this.frame) {
      this._stickFrame = this.frame;
      const now = performance.now();
      st.fire = null;
      if (d && d !== st.dir) { st.fire = d; st.t = now + 380; }
      else if (d && now > st.t) { st.fire = d; st.t = now + 140; }
      st.dir = d;
    }
    return st.fire === dir;
  }

  rumble(strong = 0.3, weak = 0.3, ms = 80) {
    try {
      const a = this.pad?.vibrationActuator;
      if (a && a.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak });
    } catch (e) { /* not supported */ }
  }

  endFrame() {
    this.pressedKeys.clear();
    this.click = null;
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.mouse.moved = false;
    this.frame = (this.frame ?? 0) + 1;
  }
}
