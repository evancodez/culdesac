/**
 * Cul-de-sac — procedural audio engine (Web Audio only, no files).
 *
 * Mood: slow, hazy dream-pop (lush detuned pads, glassy plucks, soft drum machine,
 * Farfisa-ish organ) over quiet suburban ambience.
 *
 * Usage:
 *   import { audio } from './core/audio.js';
 *   window.addEventListener('pointerdown', () => audio.init(), { once: true });
 *   audio.setMood('title');
 *
 * Every public method is safe before init() and never throws. Volume / mood / pause /
 * blend calls made before init() are remembered and applied when init() runs;
 * one-shot SFX before init() (or while the context is suspended) are dropped.
 */

const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext || null : null;

const TICK_MS = 25;
const LOOKAHEAD = 0.12;
const MUSIC_VOICE_CAP = 56; // generative notes / ambience events are skipped above this
const MAX_VOICES = 110; // one-shot SFX are skipped above this

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = (v) => clamp(Number.isFinite(v) ? v : 0, 0, 1);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const chance = (p) => Math.random() < p;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const mod12 = (x) => ((x % 12) + 12) % 12;
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}
/** MIDI note with pitch class `pc` nearest to `target`. */
function nearestMidi(pc, target) {
  const below = target - mod12(target - pc);
  return target - below > 6 ? below + 12 : below;
}
/** Stack pitch classes upward (cycling through `pcs`) from about `start`, min interval `gap`. */
function stackUp(pcs, start, count, gap = 3) {
  const out = [];
  let m = nearestMidi(pcs[0], start);
  if (m < start - 2) m += 12;
  out.push(m);
  for (let k = 1; out.length < count; k++) {
    let n = m + mod12(pcs[k % pcs.length] - m);
    if (n - m < gap) n += 12;
    out.push(n);
    m = n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// harmony data
// ---------------------------------------------------------------------------
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
/** chord: pcs ordered root, 3rd, 5th, 7th, 9th, 11th... (order matters for voicing). */
function C(name, root, iv, bass) {
  const r = PC[root];
  return { name, root: r, bass: bass != null ? PC[bass] : r, pcs: iv.map((i) => (r + i) % 12) };
}
function key(tonic, mode) {
  const t = PC[tonic];
  return { tonic: t, minor: mode === 'minor', scale: (mode === 'minor' ? MINOR : MAJOR).map((i) => (t + i) % 12) };
}

const DMAJ9 = C('Dmaj9', 'D', [0, 4, 7, 11, 14]);
const BM11 = C('Bm11', 'B', [0, 3, 7, 10, 14, 17]);
const GMAJ7S11 = C('Gmaj7#11', 'G', [0, 4, 7, 11, 18]);
const EM9 = C('Em9', 'E', [0, 3, 7, 10, 14]);

/**
 * Mood definitions. Levels are linear gains; `amb` amounts are 0..1 (calibrated inside).
 * bars: bars per chord (16 sixteenth-steps per bar).
 */
const MOODS = {
  title: {
    bpm: 66,
    ...key('D', 'major'),
    prog: [DMAJ9, BM11, GMAJ7S11, EM9],
    bars: [2, 2, 2, 2],
    pad: { level: 0.15, cutoff: 1250, wave: 'sawtooth', lo: 52, hi: 76, attack: 2.2, release: 3 },
    pluck: { level: 0.085, density: 0.2, lo: 69, hi: 88, decay: 2.8, fill: 0.06, dly: 0.45 },
    bass: { level: 0.13, moves: 0.1, center: 40 },
    amb: { air: 0.7, birds: 0.22 },
  },
  morning: {
    bpm: 70,
    ...key('D', 'major'),
    prog: [C('Dmaj7', 'D', [0, 4, 7, 11]), C('F#m7', 'F#', [0, 3, 7, 10]), C('Gmaj9', 'G', [0, 4, 7, 11, 14]), C('A6', 'A', [0, 4, 7, 9])],
    bars: [2, 2, 2, 2],
    pad: { level: 0.13, cutoff: 1600, wave: 'sawtooth', lo: 54, hi: 77, attack: 1.6, release: 2.6 },
    pluck: { level: 0.08, density: 0.4, lo: 66, hi: 88, decay: 2.0, fill: 0.15, dly: 0.35 },
    bass: { level: 0.14, moves: 0.35, center: 41 },
    melody: { level: 0.05, p: 0.45, lo: 69, hi: 86 },
    amb: { air: 0.8, birds: 1 },
  },
  noon: {
    bpm: 72,
    ...key('F', 'major'),
    prog: [C('Fmaj7', 'F', [0, 4, 7, 11]), C('Am7', 'A', [0, 3, 7, 10]), C('Bbmaj7', 'Bb', [0, 4, 7, 11]), C('C6', 'C', [0, 4, 7, 9])],
    bars: [2, 2, 2, 2],
    pad: { level: 0.12, cutoff: 2000, wave: 'sawtooth', lo: 53, hi: 77, attack: 1.4, release: 2.4 },
    pluck: { level: 0.075, density: 0.36, lo: 65, hi: 89, decay: 1.7, fill: 0.15, dly: 0.3 },
    bass: { level: 0.15, moves: 0.4, center: 41 },
    melody: { level: 0.04, p: 0.3, lo: 69, hi: 84 },
    drums: 'soft',
    amb: { air: 0.8, insects: 1, sprinkler: 1 },
  },
  dusk: {
    bpm: 66,
    ...key('Ab', 'major'),
    prog: [C('Abmaj7', 'Ab', [0, 4, 7, 11]), C('Cm7', 'C', [0, 3, 7, 10]), C('Dbmaj9', 'Db', [0, 4, 7, 11, 14]), C('Eb7sus4', 'Eb', [0, 5, 7, 10])],
    bars: [2, 2, 2, 2],
    pad: { level: 0.15, cutoff: 1350, wave: 'sawtooth', lo: 51, hi: 75, attack: 2.0, release: 3 },
    pluck: { level: 0.08, density: 0.24, lo: 63, hi: 87, decay: 3.2, fill: 0.08, dly: 0.5 },
    bass: { level: 0.13, moves: 0.2, center: 41 },
    melody: { level: 0.04, p: 0.2, lo: 68, hi: 82 },
    amb: { air: 0.35, wind: 0.8, crickets: 1 },
  },
  underside: {
    bpm: 66,
    ...key('F', 'minor'),
    prog: [C('Fm(add9)', 'F', [0, 3, 7, 14]), C('Dbmaj7', 'Db', [0, 4, 7, 11]), C('Abmaj7', 'Ab', [0, 4, 7, 11]), C('Eb/G', 'Eb', [0, 4, 7], 'G')],
    bars: [2, 2, 2, 2],
    // chord index offset so that, when blended with 'dusk', simultaneous chords agree:
    // Abmaj7|Abmaj7, Cm7|Eb/G, Dbmaj9|Fm(add9), Eb7sus4|Dbmaj7
    chordOffset: 2,
    pad: { level: 0.08, cutoff: 850, wave: 'triangle', lo: 48, hi: 70, attack: 2.5, release: 3 },
    pluck: { level: 0.06, density: 0.12, lo: 60, hi: 80, decay: 3.5, fill: 0, dly: 0.55, dark: true },
    bass: { level: 0.16, moves: 0.1, center: 37, sub: true },
    organ: { level: 0.05, lo: 55, hi: 72 },
    drums: 'heavy',
    swells: 0.65,
    amb: { drone: 1, wind: 0.3 },
  },
  ending: {
    bpm: 68,
    ...key('D', 'major'),
    prog: [DMAJ9, BM11, GMAJ7S11, EM9, C('A9sus4', 'A', [0, 5, 7, 10, 14])],
    bars: [2, 2, 2, 1, 1],
    pad: { level: 0.17, cutoff: 1700, wave: 'sawtooth', lo: 52, hi: 79, attack: 1.8, release: 3 },
    pluck: { level: 0.085, density: 0.34, lo: 66, hi: 90, decay: 2.6, fill: 0.12, dly: 0.4 },
    bass: { level: 0.15, moves: 0.3, center: 40 },
    melody: { level: 0.05, p: 0.55, lo: 69, hi: 88 },
    amb: { air: 0.6, birds: 0.5 },
  },
};
const isPair = (n) => n === 'dusk' || n === 'underside';

/** Voice-led pad voicing: open stacks, rotation chosen to move little from `prev`. */
function voiceChord(chord, prev, lo, hi) {
  let pcs = chord.pcs.slice();
  if (pcs.length > 5) pcs = pcs.filter((_, i) => i !== 2); // drop the 5th of 11th chords
  if (pcs.length >= 4 && chance(0.4)) pcs = pcs.slice(1); // bass has the root
  pcs = pcs.slice(0, 5);
  const prevMean = prev ? prev.reduce((a, b) => a + b, 0) / prev.length : (lo + hi) / 2;
  const prevTop = prev ? prev[prev.length - 1] : hi - 4;
  let best = null;
  let bestScore = Infinity;
  for (let r = 0; r < pcs.length; r++) {
    const order = pcs.slice(r).concat(pcs.slice(0, r));
    for (const s of [lo + 1, lo + 5]) {
      const notes = [];
      let m = nearestMidi(order[0], s);
      if (m < lo) m += 12;
      notes.push(m);
      for (let k = 1; k < order.length; k++) {
        let n = m + mod12(order[k] - m);
        if (n - m < (m >= 62 ? 2 : 3)) n += 12;
        notes.push(n);
        m = n;
      }
      const top = notes[notes.length - 1];
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
      const score =
        Math.abs(mean - prevMean) * 2 + Math.abs(top - prevTop) + Math.max(0, top - hi) * 4 + Math.max(0, top - notes[0] - 19) * 2 + rand(0, 3);
      if (score < bestScore) {
        bestScore = score;
        best = notes;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// buffers
// ---------------------------------------------------------------------------
/** Seamlessly looping mono noise buffer: 'white' | 'pink' | 'brown'. */
function makeNoiseBuffer(ctx, seconds, kind) {
  const sr = ctx.sampleRate;
  const len = Math.max(1024, Math.floor(sr * seconds));
  const xf = Math.min(Math.floor(sr * 0.05), Math.floor(len / 4));
  const tmp = new Float32Array(len + xf);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < tmp.length; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      tmp[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      tmp[i] = last * 3.5;
    } else tmp[i] = w;
  }
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    if (i < xf) {
      const a = i / xf;
      d[i] = tmp[i] * Math.sqrt(a) + tmp[len + i] * Math.sqrt(1 - a);
    } else d[i] = tmp[i];
  }
  return buf;
}

/** Stereo decaying-noise impulse response, darkening as it decays. */
function makeImpulse(ctx, seconds = 4.2) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * 0.02);
  const rise = Math.floor(sr * 0.08);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      if (i < pre) {
        d[i] = 0;
        continue;
      }
      const k = i - pre;
      const x = i / len;
      const a = 0.07 + 0.83 * Math.pow(1 - x, 1.6);
      lp += a * (Math.random() * 2 - 1 - lp);
      const env = Math.exp((-6.4 * k) / sr / seconds) * (k < rise ? k / rise : 1) * (x > 0.94 ? (1 - x) / 0.06 : 1);
      d[i] = (lp * env) / Math.sqrt(a / (2 - a));
    }
  }
  return buf;
}

const STEP = {
  grass: { type: 'bandpass', f: 2800, q: 0.8, dur: 0.12, atk: 0.012, level: 0.11, bursts: 2 },
  mown: { type: 'highpass', f: 3200, q: 0.6, dur: 0.07, atk: 0.006, level: 0.07, bursts: 1 },
  stone: { type: 'bandpass', f: 1700, q: 1.3, dur: 0.06, atk: 0.003, level: 0.08, bursts: 1, body: { f: 170, level: 0.09, dur: 0.06 } },
  wood: { type: 'bandpass', f: 950, q: 1.6, dur: 0.07, atk: 0.003, level: 0.06, bursts: 1, body: { f: 220, type: 'triangle', level: 0.12, dur: 0.09 } },
  road: { type: 'bandpass', f: 800, q: 0.7, dur: 0.08, atk: 0.004, level: 0.085, bursts: 2, body: { f: 120, level: 0.07, dur: 0.05 } },
};

// ---------------------------------------------------------------------------
// MoodLayer: one generative music + ambience bed with its own clock and buses.
// Output goes through a blend stage (dusk/underside pair) and a fade stage (mood crossfade).
// ---------------------------------------------------------------------------
class MoodLayer {
  constructor(engine, name, opts = {}) {
    const e = engine;
    const c = e.ctx;
    const now = c.currentTime;
    const cfg = MOODS[name];
    this.e = e;
    this.name = name;
    this.cfg = cfg;
    this.persist = []; // nodes to disconnect on dispose
    this.sources = []; // persistent sources to stop on dispose
    this.dying = false;
    this.dead = false;
    this.dieAt = Infinity;
    this.dyingAt = 0;
    this.fadeDur = 0;
    this.blendW = opts.blend != null ? opts.blend : 1;
    this.dormant = this.blendW <= 0.002;

    this.out = {};
    this._blendG = [];
    this._fadeG = [];
    const dst = { mDry: e.musicDry, mRev: e.musicRev, mDly: e.musicDly, aDry: e.ambDry, aRev: e.ambRev };
    for (const k of Object.keys(dst)) {
      const a = e._g(this.blendW);
      const b = e._g(0);
      a.connect(b);
      b.connect(dst[k]);
      this.out[k] = a;
      this._blendG.push(a);
      this._fadeG.push(b);
    }

    // clock
    this.stepDur = 60 / cfg.bpm / 4;
    this.starts = [];
    let acc = 0;
    for (const b of cfg.bars) {
      this.starts.push(acc);
      acc += b * 16;
    }
    this.cycle = acc;
    const off = cfg.chordOffset || 0;
    const sync = opts.syncTo && !opts.syncTo.dead ? opts.syncTo : null;
    if (sync && sync.cycle === this.cycle) {
      this.step = sync.step;
      this.nextT = Math.max(sync.nextT, now + 0.02);
    } else {
      this.step = off ? this.starts[(cfg.prog.length - off) % cfg.prog.length] : 0;
      this.nextT = now + 0.08;
    }
    this.startStep = this.step;
    this._needChord = true;
    this.chord = cfg.prog[0];
    this.voicing = null;
    this.pluckPlan = null;
    this.melPlan = null;
    this._barMute = false;
    this._leslieFast = false;

    this._buildChannels(now);
    this._buildAmbience(now);
    this.fadeIn(opts.fade != null ? opts.fade : 3);
  }

  // ----- output stages
  fadeIn(fade) {
    const now = this.e.ctx.currentTime;
    for (const g of this._fadeG) g.gain.setTargetAtTime(1, now, Math.max(0.005, fade / 4));
  }

  fadeOut(fade) {
    if (this.dying) return;
    const now = this.e.ctx.currentTime;
    this.dying = true;
    this.dyingAt = now;
    this.fadeDur = fade;
    for (const g of this._fadeG) g.gain.setTargetAtTime(0, now, Math.max(0.005, fade / 5));
    this.dieAt = now + fade * 1.6 + 0.5;
  }

  setBlend(w, tc) {
    if (Math.abs(w - this.blendW) < 0.0005) return;
    const wasDormant = this.dormant;
    this.blendW = w;
    this.dormant = w <= 0.002;
    const now = this.e.ctx.currentTime;
    for (const g of this._blendG) g.gain.setTargetAtTime(w, now, Math.max(0.005, tc));
    if (wasDormant && !this.dormant) this._needChord = true;
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    const t = this.e.ctx.currentTime;
    for (const s of this.sources) {
      try {
        s.stop(t + 0.05);
      } catch (_) {
        /* already stopped */
      }
    }
    const all = this.persist.concat(this._blendG, this._fadeG);
    setTimeout(() => {
      for (const n of all) {
        try {
          n.disconnect();
        } catch (_) {
          /* ignore */
        }
      }
    }, 250);
  }

  // ----- channels (persistent per-instrument buses with fixed send levels)
  _chan(dry, rev, dly, head, tail, ambient) {
    const e = this.e;
    const input = head || e._g(1);
    const node = tail || input;
    const D = ambient ? this.out.aDry : this.out.mDry;
    const R = ambient ? this.out.aRev : this.out.mRev;
    const send = (amt, dst) => {
      if (!(amt > 0) || !dst) return;
      if (amt === 1) {
        node.connect(dst);
        return;
      }
      const g = e._g(amt);
      node.connect(g);
      g.connect(dst);
      this.persist.push(g);
    };
    send(dry, D);
    send(rev, R);
    if (!ambient) send(dly, this.out.mDly);
    this.persist.push(input);
    if (node !== input) this.persist.push(node);
    return input;
  }

  _lfo(param, rate, depth, now, type = 'sine') {
    const e = this.e;
    const o = e._o(type, rate);
    const g = e._g(depth);
    o.connect(g);
    g.connect(param);
    o.start(now);
    this.sources.push(o);
    this.persist.push(o, g);
    return o;
  }

  _buildChannels(now) {
    const e = this.e;
    const cfg = this.cfg;
    this.ch = {};
    if (cfg.pad) {
      const f = e._f('lowpass', cfg.pad.cutoff, 0.7);
      this._lfo(f.frequency, rand(0.05, 0.09), cfg.pad.cutoff * 0.35, now);
      this.ch.pad = this._chan(1, 0.6, 0.06, f, f);
    }
    this.ch.pluck = this._chan(0.75, 0.45, cfg.pluck ? cfg.pluck.dly : 0.3);
    this.ch.bass = this._chan(1, 0.08, 0);
    this.ch.melody = this._chan(0.7, 0.5, 0.45);
    if (cfg.organ) {
      // Leslie-ish: tremolo + autopan sharing one rotor LFO, plus pitch vibrato hub
      const inp = e._g(1);
      const trem = e._g(0.72);
      const pan = e._pan(0);
      const lp = e._f('lowpass', 2300, 0.6);
      inp.connect(trem);
      trem.connect(pan);
      pan.connect(lp);
      this.persist.push(trem, pan);
      this.leslie = e._o('sine', 0.8);
      const tg = e._g(0.24);
      this.leslie.connect(tg);
      tg.connect(trem.gain);
      if (pan.pan) {
        const pg = e._g(0.5);
        this.leslie.connect(pg);
        pg.connect(pan.pan);
        this.persist.push(pg);
      }
      this.leslie.start(now);
      this.sources.push(this.leslie);
      this.persist.push(this.leslie, tg);
      // vibrato hub: voices connect organVib -> osc.detune (depth in cents)
      this.organVib = e._g(9);
      const vib = e._o('sine', 6.1);
      vib.connect(this.organVib);
      vib.start(now);
      this.sources.push(vib);
      this.persist.push(vib, this.organVib);
      this.ch.organ = this._chan(0.9, 0.45, 0.1, inp, lp);
    }
    if (cfg.drums) {
      const heavy = cfg.drums === 'heavy';
      this.ch.kick = this._chan(1, heavy ? 0.3 : 0.1, 0);
      this.ch.snare = this._chan(0.6, 0.9, 0.12);
      this.ch.hat = this._chan(0.7, 0.35, 0.12);
    }
    if (cfg.swells) this.ch.swell = this._chan(0.6, 0.9, 0.15);
    this.ch.amb = this._chan(1, 0.25, 0, null, null, true);
    this.ch.birds = this._chan(0.9, 0.4, 0, null, null, true);
  }

  _buildAmbience(now) {
    const e = this.e;
    const a = this.cfg.amb || {};
    const P = (...n) => this.persist.push(...n);
    const loop = (kind) => {
      const s = e.ctx.createBufferSource();
      s.buffer = e.noise[kind];
      s.loop = true;
      s.start(now, Math.random() * (s.buffer.duration - 0.5));
      this.sources.push(s);
      P(s);
      return s;
    };
    if (a.air) {
      // distant suburban air / far traffic: low brown noise with slow swells
      const s = loop('brown');
      const f = e._f('lowpass', 380, 0.5);
      const g = e._g(a.air * 0.1);
      s.connect(f);
      f.connect(g);
      g.connect(this.ch.amb);
      P(f, g);
      this._lfo(g.gain, 0.037, a.air * 0.035, now);
    }
    if (a.wind) {
      const s = loop('pink');
      const f = e._f('bandpass', 520, 0.8);
      const g = e._g(a.wind * 0.22);
      const p = e._pan(0);
      s.connect(f);
      f.connect(g);
      g.connect(p);
      p.connect(this.ch.amb);
      P(f, g, p);
      this._lfo(f.frequency, 0.047, 260, now);
      this._lfo(g.gain, 0.083, a.wind * 0.12, now);
      if (p.pan) this._lfo(p.pan, 0.029, 0.55, now);
    }
    if (a.insects) {
      // distant cicada-ish hum: two narrow noise bands, amplitude-pulsed
      const s = loop('white');
      for (const [fq, am, sw, pn] of [
        [4700, 38, 0.061, 0.4],
        [6100, 47, 0.043, -0.45],
      ]) {
        const bp = e._f('bandpass', fq, 7);
        const amg = e._g(0.5);
        const swg = e._g(a.insects * 0.07);
        const p = e._pan(pn);
        s.connect(bp);
        bp.connect(amg);
        amg.connect(swg);
        swg.connect(p);
        p.connect(this.ch.amb);
        P(bp, amg, swg, p);
        this._lfo(amg.gain, am, 0.45, now);
        this._lfo(swg.gain, sw, a.insects * 0.05, now);
      }
    }
    if (a.drone) {
      // underside: low wind rumble + moaning resonant band + beating tonic drone
      const s = loop('brown');
      const f = e._f('lowpass', 170, 0.6);
      const g = e._g(a.drone * 0.32);
      s.connect(f);
      f.connect(g);
      g.connect(this.ch.amb);
      P(f, g);
      this._lfo(g.gain, 0.05, a.drone * 0.1, now);
      const s2 = loop('pink');
      const bp = e._f('bandpass', 280, 5);
      const g2 = e._g(a.drone * 0.35);
      s2.connect(bp);
      bp.connect(g2);
      g2.connect(this.ch.amb);
      P(bp, g2);
      this._lfo(bp.frequency, 0.031, 110, now);
      const f0 = mtof(nearestMidi(this.cfg.tonic, 29));
      const og = e._g(a.drone * 0.045);
      og.connect(this.ch.amb);
      P(og);
      for (const fr of [f0, f0 * 2 + 0.31, f0 * 3 - 0.22]) {
        const o = e._o('sine', fr);
        o.connect(og);
        o.start(now);
        this.sources.push(o);
        P(o);
      }
    }
    if (a.crickets) {
      // crickets "start" one by one as dusk settles
      this.cricketBus = e._g(0);
      this.cricketBus.connect(this.ch.amb);
      this.cricketBus.gain.setValueAtTime(0, now);
      this.cricketBus.gain.setTargetAtTime(a.crickets * 0.022, now + 1.5, 7);
      P(this.cricketBus);
      this.crickets = [];
      for (let k = 0; k < 3; k++) {
        const o = e._o('sine', rand(4300, 5300));
        const g = e._g(0);
        const p = e._pan(rand(-0.8, 0.8));
        o.connect(g);
        g.connect(p);
        p.connect(this.cricketBus);
        o.start(now);
        this.sources.push(o);
        P(o, g, p);
        this.crickets.push({ g, t: now + 2 + k * rand(2, 6), period: rand(0.55, 0.9), pulses: randi(2, 4), amp: rand(0.5, 1) });
      }
    }
    this.birdT = a.birds ? now + rand(0.8, 3) : Infinity;
    this.sprinkT = a.sprinkler ? now + rand(4, 10) : Infinity;
  }

  // ----- sequencing
  _locate(step) {
    const pos = ((step % this.cycle) + this.cycle) % this.cycle;
    let i = this.starts.length - 1;
    while (i > 0 && this.starts[i] > pos) i--;
    const len = this.cfg.bars[i] * 16;
    return { pos, i, posIn: pos - this.starts[i], len, prog: (i + (this.cfg.chordOffset || 0)) % this.cfg.prog.length };
  }

  tick(horizon, now) {
    if (this.dead) return;
    if (this.nextT < now - 0.25) {
      // main thread stalled: skip ahead silently instead of bursting late notes
      const behind = Math.ceil((now - this.nextT) / this.stepDur);
      for (let k = 0; k < behind; k++) {
        this.step++;
        if (this._locate(this.step).posIn === 0) this._needChord = true;
      }
      this.nextT += behind * this.stepDur;
      this._needChord = true;
    }
    while (this.nextT < horizon) {
      this._step(this.step, this.nextT);
      this.nextT += this.stepDur;
      this.step++;
    }
    if (!this.dormant) this._ambience(horizon, now);
  }

  _step(step, t) {
    const e = this.e;
    const cfg = this.cfg;
    const loc = this._locate(step);
    const musical = !this.dormant && (!this.dying || t < this.dyingAt + this.fadeDur * 0.5);
    if (loc.posIn === 0 || this._needChord) {
      const remaining = loc.len - loc.posIn;
      this._needChord = false;
      this._newChord(loc, t, remaining, musical && !this.dying && (loc.posIn === 0 || remaining >= 6));
    }
    if (!musical || e.voices > MUSIC_VOICE_CAP) return;
    const sd = this.stepDur;
    const pl = this.pluckPlan && this.pluckPlan[loc.posIn];
    if (pl) e._pluck(this.ch.pluck, pl.midi, t + rand(-0.004, 0.012), pl.vel * cfg.pluck.level, cfg.pluck);
    const ml = this.melPlan && this.melPlan[loc.posIn];
    if (ml) e._melody(this.ch.melody, ml.midi, t + rand(0, 0.015), ml.dur * sd, cfg.melody.level);
    if (cfg.drums) this._drums(loc, t);
    if (cfg.swells && loc.posIn === loc.len - 8 && chance(cfg.swells)) {
      const next = cfg.prog[(loc.prog + 1) % cfg.prog.length];
      const notes = stackUp(next.pcs.slice(0, 3), 62, 3);
      e._swell(this.ch.swell, notes, t, 8 * sd, 0.05);
    }
  }

  _newChord(loc, t, remaining, play) {
    const e = this.e;
    const cfg = this.cfg;
    const ch = cfg.prog[loc.prog];
    this.chord = ch;
    this.voicing = voiceChord(ch, this.voicing, cfg.pad.lo, cfg.pad.hi);
    this._planPlucks(loc.len);
    this._planMelody(loc.len);
    e._onChord(this, t);
    if (!play) return;
    const sd = this.stepDur;
    const dur = remaining * sd;
    if (cfg.pad.level > 0) e._pad(this.ch.pad, this.voicing, t, dur, cfg.pad);
    if (cfg.bass) {
      const root = nearestMidi(ch.bass, cfg.bass.center || 40);
      if (remaining >= 32 && chance(cfg.bass.moves)) {
        const fifthPc = (ch.root + 7) % 12;
        const second = ch.pcs.includes(fifthPc) && ch.bass === ch.root ? root + 7 : root + 12;
        e._bass(this.ch.bass, root, t, 16 * sd - 0.05, cfg.bass);
        e._bass(this.ch.bass, second, t + 16 * sd, dur - 16 * sd - 0.05, cfg.bass);
      } else {
        e._bass(this.ch.bass, root, t, dur - 0.05, cfg.bass);
      }
    }
    if (cfg.organ) {
      const o = cfg.organ;
      const notes = [];
      for (const m of this.voicing) {
        let x = m;
        while (x < o.lo) x += 12;
        while (x > o.hi) x -= 12;
        if (!notes.includes(x)) notes.push(x);
      }
      const upper = notes.slice(0, 4);
      upper.push(nearestMidi(cfg.tonic, o.lo - 7)); // tonic pedal drone underneath
      e._organ(this, upper, t, dur, o.level);
      if (this.leslie && chance(0.3)) {
        this._leslieFast = !this._leslieFast;
        this.leslie.frequency.setTargetAtTime(this._leslieFast ? 5.8 : 0.8, t, 1.4);
      }
    }
  }

  _planPlucks(len) {
    const p = this.cfg.pluck;
    this.pluckPlan = null;
    if (!p || !(p.level > 0) || chance(0.1)) return; // occasional whole-chord rest
    const pcs = new Set(this.chord.pcs);
    const pool = [];
    for (let m = p.lo; m <= p.hi; m++) if (pcs.has(m % 12)) pool.push(m);
    if (!pool.length) return;
    const w = Math.min(pool.length, randi(4, 6));
    const s0 = randi(0, pool.length - w);
    let seg = pool.slice(s0, s0 + w);
    const mode = pick(['up', 'up', 'down', 'updown', 'random', 'skip']);
    if (mode === 'down') seg.reverse();
    else if (mode === 'updown') seg = seg.concat(seg.slice(1, -1).reverse());
    else if (mode === 'random') shuffle(seg);
    else if (mode === 'skip') seg = seg.flatMap((m, k) => (k + 2 < seg.length ? [m, seg[k + 2]] : [m]));
    const plan = new Array(len).fill(null);
    const bars = Math.max(1, len / 16);
    const restBar = chance(0.22) ? randi(0, bars - 1) : -1;
    let k = 0;
    for (let pos = 0; pos < len; pos += 2) {
      const bar = Math.floor(pos / 16);
      const inBar = pos % 16;
      let pr = p.density * (inBar === 0 ? 2 : inBar % 4 === 0 ? 1.25 : 0.75);
      if (bar === restBar) pr *= 0.12;
      if (Math.random() < pr) plan[pos] = { midi: seg[k++ % seg.length], vel: inBar === 0 ? rand(0.85, 1) : rand(0.5, 0.85) };
    }
    if (len >= 16 && chance(p.fill)) {
      const top = pool.slice(-3);
      for (let j = 0; j < 3; j++) plan[len - 3 + j] = { midi: top[Math.min(j, top.length - 1)], vel: 0.4 + j * 0.12 };
    }
    this.pluckPlan = plan;
  }

  _planMelody(len) {
    const m = this.cfg.melody;
    this.melPlan = null;
    if (!m || !(m.level > 0) || len < 16 || !chance(m.p)) return;
    const sc = new Set(this.cfg.scale);
    const cp = new Set(this.chord.pcs);
    const notes = [];
    for (let x = m.lo; x <= m.hi; x++) if (sc.has(x % 12)) notes.push(x);
    const chordIdx = [];
    notes.forEach((x, i) => {
      if (cp.has(x % 12)) chordIdx.push(i);
    });
    if (!chordIdx.length) return;
    const plan = new Array(len).fill(null);
    let pos = pick([4, 6, 8, 12, 16, 20].filter((s) => s < len - 6));
    let idx = pick(chordIdx);
    const n = randi(3, 5);
    for (let j = 0; j < n && pos < len - 1; j++) {
      const last = j === n - 1 || pos + 6 >= len;
      if (last) idx = chordIdx.reduce((b, ci) => (Math.abs(ci - idx) < Math.abs(b - idx) ? ci : b), chordIdx[0]);
      const d = pick([2, 3, 4, 4, 6]);
      plan[pos] = { midi: notes[idx], dur: Math.min(d + (last ? 4 : 0), len - pos) };
      if (last) break;
      pos += d;
      idx = clamp(idx + pick([-2, -1, -1, 1, 1, 2, 3]), 0, notes.length - 1);
    }
    this.melPlan = plan;
  }

  _drums(loc, t) {
    if (this.step - this.startStep < 32) return; // groove enters after two bars
    const e = this.e;
    const inBar = loc.pos % 16;
    if (inBar === 0) this._barMute = chance(0.07); // the odd breath
    if (this._barMute) return;
    const h = () => t + rand(-0.004, 0.006);
    if (this.cfg.drums === 'soft') {
      if (inBar === 0) e._kick(this.ch.kick, t, 0.95, false);
      else if (inBar === 8) e._kick(this.ch.kick, t, 0.75, false);
      else if (inBar === 10 && chance(0.25)) e._kick(this.ch.kick, t, 0.45, false);
      if (inBar === 4 || inBar === 12) e._snare(this.ch.snare, h(), rand(0.6, 0.8), 'brush');
      else if (inBar === 15 && chance(0.12)) e._snare(this.ch.snare, h(), 0.22, 'brush');
      if (inBar % 2 === 0) e._hat(this.ch.hat, h(), inBar % 4 === 2 ? rand(0.55, 0.7) : rand(0.3, 0.4));
      else if (chance(0.22)) e._hat(this.ch.hat, h(), rand(0.15, 0.25));
    } else {
      // heavy, half-time, hypnotic
      if (inBar === 0) e._kick(this.ch.kick, t, 1, true);
      else if (inBar === 11 && chance(0.35)) e._kick(this.ch.kick, t, 0.55, true);
      if (inBar === 8) e._snare(this.ch.snare, h(), rand(0.65, 0.8), 'clap');
      if (inBar === 4 || inBar === 12) e._hat(this.ch.hat, h(), 0.3);
      else if (inBar % 2 === 0 && chance(0.3)) e._hat(this.ch.hat, h(), 0.16);
    }
  }

  _ambience(horizon, now) {
    const e = this.e;
    const a = this.cfg.amb || {};
    if (a.birds) {
      if (this.birdT < now - 0.5) this.birdT = now + rand(0.2, 2);
      while (this.birdT < horizon) {
        e._bird(this.ch.birds, this.birdT);
        this.birdT += rand(1.4, 5.5) / a.birds;
      }
    }
    if (a.sprinkler) {
      if (this.sprinkT < now - 0.5) this.sprinkT = now + rand(2, 8);
      while (this.sprinkT < horizon) {
        e._sprinkler(this.ch.amb, this.sprinkT, a.sprinkler);
        this.sprinkT += rand(11, 26);
      }
    }
    if (this.crickets) {
      for (const k of this.crickets) {
        if (k.t < now - 0.3) k.t = now + rand(0.05, 0.6);
        while (k.t < horizon) {
          const g = k.g.gain;
          for (let j = 0; j < k.pulses; j++) {
            const p = k.t + j * 0.045;
            g.setValueAtTime(0, p);
            g.linearRampToValueAtTime(k.amp, p + 0.006);
            g.setValueAtTime(k.amp, p + 0.022);
            g.linearRampToValueAtTime(0, p + 0.03);
          }
          k.t += chance(0.07) ? rand(2.5, 6) : k.period * rand(0.94, 1.06);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// AudioEngine
// ---------------------------------------------------------------------------
class AudioEngine {
  constructor() {
    this.ctx = null;
    this._built = false;
    this._vol = { master: 0.8, music: 0.7, sfx: 0.8, amb: 1 };
    this._paused = false;
    this._requestedMood = null;
    this._requestedFade = 3;
    this._activeMood = null;
    this._lastMusicMood = 'title';
    this._blend = 0;
    this._align = 0;
    this.layers = [];
    this.pair = null;
    this._pairFadeEnd = 0;
    this.voices = 0;
    this.shim = null;
    this._mowers = new Map();
    this._timer = null;
    this._warned = new Set();
    this._lastStepT = -1;
    this._lastUiT = -1;
    this._gestureArmed = false;
  }

  /** Final output node (post master volume) — handy for meters. Null before init(). */
  get output() {
    return this.master || null;
  }

  // ===== lifecycle ==========================================================
  /** Call from a user gesture. Creates or resumes the AudioContext. Idempotent. */
  init() {
    try {
      if (!AC) return Promise.resolve(false);
      if (!this.ctx) {
        try {
          this.ctx = new AC({ latencyHint: 'interactive' });
        } catch (_) {
          this.ctx = new AC();
        }
        this._build();
        this._applyVolumes(0.01);
        this._applyPause(0.01);
        this._timer = setInterval(() => this._tick(), TICK_MS);
        if (this._requestedMood) this._applyMood(this._requestedMood, Math.min(this._requestedFade, 2.5));
      }
      return this._resume();
    } catch (e) {
      this._warnOnce('init', e);
      return Promise.resolve(false);
    }
  }

  _resume() {
    const c = this.ctx;
    if (!c || c.state === 'closed') return Promise.resolve(false);
    if (c.state === 'running') return Promise.resolve(true);
    let p = null;
    try {
      p = c.resume();
    } catch (_) {
      p = null;
    }
    this._armGestureResume();
    return Promise.resolve(p).then(
      () => c.state === 'running',
      () => false
    );
  }

  _armGestureResume() {
    if (this._gestureArmed || typeof window === 'undefined') return;
    this._gestureArmed = true;
    const evs = ['pointerdown', 'keydown', 'touchend'];
    const off = () => {
      evs.forEach((ev) => window.removeEventListener(ev, h, true));
      this._gestureArmed = false;
    };
    const h = () => {
      const c = this.ctx;
      if (!c || c.state === 'running' || c.state === 'closed') return off();
      try {
        c.resume().then(() => {
          if (c.state === 'running') off();
        }, () => {});
      } catch (_) {
        /* ignore */
      }
    };
    evs.forEach((ev) => window.addEventListener(ev, h, true));
  }

  _warnOnce(where, e) {
    if (this._warned.has(where)) return;
    this._warned.add(where);
    try {
      console.warn('[audio] ' + where + ':', e);
    } catch (_) {
      /* ignore */
    }
  }

  // ===== node helpers =======================================================
  _g(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }
  _o(type, f, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    if (detune) o.detune.value = detune;
    return o;
  }
  _f(type, f, q = 0.7) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = Math.min(f, this.ctx.sampleRate * 0.45);
    b.Q.value = q;
    return b;
  }
  _pan(v = 0) {
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(v, -1, 1);
      return p;
    }
    return this.ctx.createGain(); // no panning support: pass-through (callers check .pan)
  }
  _noise(kind, t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise[kind] || this.noise.white;
    s.loop = true;
    s.start(t, Math.random() * (s.buffer.duration - 0.6));
    if (dur) s.stop(t + dur);
    return s;
  }
  /** Count a voice; when `src` ends, disconnect `nodes` and run `after`. */
  _track(src, nodes, after) {
    this.voices++;
    src.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch (_) {
          /* ignore */
        }
      }
      if (after) {
        try {
          after();
        } catch (_) {
          /* ignore */
        }
      }
    };
  }
  _set(param, v, tc) {
    param.setTargetAtTime(v, this.ctx.currentTime, Math.max(0.001, tc));
  }

  // ===== graph ==============================================================
  _build() {
    const c = this.ctx;
    this.noise = { white: makeNoiseBuffer(c, 3, 'white'), pink: makeNoiseBuffer(c, 4, 'pink'), brown: makeNoiseBuffer(c, 5, 'brown') };

    // master: warmth lowpass -> compressor -> master volume -> out
    this.masterIn = this._g(1);
    this.warmth = this._f('lowpass', 9000, 0.5);
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 14;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.012;
    this.comp.release.value = 0.28;
    this.master = this._g(this._vol.master);
    this.masterIn.connect(this.warmth);
    this.warmth.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(c.destination);

    // world bus (music + ambience + fx returns): duck -> pause muffle -> master
    this.worldIn = this._g(1);
    this.duck = this._g(1);
    this.pauseLP = this._f('lowpass', 18000, 0.6);
    this.pauseGain = this._g(1);
    this.worldIn.connect(this.duck);
    this.duck.connect(this.pauseLP);
    this.pauseLP.connect(this.pauseGain);
    this.pauseGain.connect(this.masterIn);

    // big hall reverb
    this.reverbIn = this._g(1);
    const revHP = this._f('highpass', 160, 0.5);
    this.reverb = c.createConvolver();
    this.reverb.buffer = makeImpulse(c, 4.2);
    this.reverbOut = this._g(0.55);
    this.reverbIn.connect(revHP);
    revHP.connect(this.reverb);
    this.reverb.connect(this.reverbOut);
    this.reverbOut.connect(this.worldIn);

    // stereo ping-pong delay with darkening feedback
    this.delayIn = this._g(1);
    const dHP = this._f('highpass', 280, 0.5);
    this.dL = c.createDelay(3);
    this.dR = c.createDelay(3);
    const fb = this._g(0.42);
    const fbLP = this._f('lowpass', 2800, 0.5);
    const pL = this._pan(-0.75);
    const pR = this._pan(0.75);
    this.delayOut = this._g(0.7);
    const dRev = this._g(0.35);
    this.delayIn.connect(dHP);
    dHP.connect(this.dL);
    this.dL.connect(this.dR);
    this.dR.connect(fb);
    fb.connect(fbLP);
    fbLP.connect(this.dL);
    this.dL.connect(pL);
    this.dR.connect(pR);
    pL.connect(this.delayOut);
    pR.connect(this.delayOut);
    this.delayOut.connect(this.worldIn);
    this.delayOut.connect(dRev);
    dRev.connect(this.reverbIn);
    const dt = (60 / 66) * 0.75;
    this.dL.delayTime.value = dt;
    this.dR.delayTime.value = dt;

    // music: gentle tape wow/flutter on the dry sum
    this.musicDry = this._g(1);
    this.wobble = c.createDelay(0.1);
    this.wobble.delayTime.value = 0.014;
    for (const [rate, depth] of [
      [0.21, 0.0018],
      [4.7, 0.00004],
    ]) {
      const o = this._o('sine', rate);
      const g = this._g(depth);
      o.connect(g);
      g.connect(this.wobble.delayTime);
      o.start();
    }
    this.musicDry.connect(this.wobble);
    this.wobble.connect(this.worldIn);
    this.musicRev = this._g(1);
    this.musicRev.connect(this.reverbIn);
    this.musicDly = this._g(1);
    this.musicDly.connect(this.delayIn);
    this.ambDry = this._g(1);
    this.ambDry.connect(this.worldIn);
    this.ambRev = this._g(1);
    this.ambRev.connect(this.reverbIn);
    this.sfxDry = this._g(1);
    this.sfxDry.connect(this.masterIn);
    this.sfxRev = this._g(1);
    this.sfxRev.connect(this.reverbIn);
    this.sfxDly = this._g(1);
    this.sfxDly.connect(this.delayIn);

    const chan = (dry, rev, dly) => {
      const input = this._g(1);
      const send = (amt, dst) => {
        if (!(amt > 0)) return;
        if (amt === 1) return input.connect(dst);
        const g = this._g(amt);
        input.connect(g);
        g.connect(dst);
      };
      send(dry, this.sfxDry);
      send(rev, this.sfxRev);
      send(dly, this.sfxDly);
      return input;
    };
    this.sfxCh = {
      ui: chan(1, 0.08, 0),
      step: chan(1, 0.1, 0),
      soft: chan(1, 0.22, 0),
      lush: chan(1, 0.6, 0.28),
      whoosh: chan(1, 0.5, 0.05),
      shimmer: chan(0.9, 0.55, 0.3),
    };
    this._built = true;
  }

  _applyVolumes(tc) {
    const v = this._vol;
    this._set(this.master.gain, v.master, tc);
    this._set(this.musicDry.gain, v.music, tc);
    this._set(this.musicRev.gain, v.music, tc);
    this._set(this.musicDly.gain, v.music, tc);
    const a = v.sfx * v.amb;
    this._set(this.ambDry.gain, a, tc);
    this._set(this.ambRev.gain, a, tc);
    this._set(this.sfxDry.gain, v.sfx, tc);
    this._set(this.sfxRev.gain, v.sfx, tc);
    this._set(this.sfxDly.gain, v.sfx, tc);
  }

  _applyPause(tc) {
    const p = this._paused;
    const open = Math.min(18000, this.ctx.sampleRate * 0.45);
    this._set(this.pauseLP.frequency, p ? 600 : open, p ? tc : tc * 1.6);
    this._set(this.pauseGain.gain, p ? 0.5 : 1, tc);
  }

  _setVol(k, v) {
    try {
      const x = Number(v);
      if (!Number.isFinite(x)) return;
      this._vol[k] = clamp(x, 0, 1);
      if (this._built) this._applyVolumes(0.06);
    } catch (e) {
      this._warnOnce('volume', e);
    }
  }

  // ===== scheduler ==========================================================
  _tick() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    try {
      const now = c.currentTime;
      const hidden = typeof document !== 'undefined' && document.hidden;
      const horizon = now + (hidden ? 1.5 : LOOKAHEAD);
      for (const L of this.layers) L.tick(horizon, now);
      for (let i = this.layers.length - 1; i >= 0; i--) {
        const L = this.layers[i];
        if (L.dying && now > L.dieAt) {
          L.dispose();
          this.layers.splice(i, 1);
        }
      }
      const s = this.shim;
      if (s && s.zeroSince != null && now - s.zeroSince > 2.5) this._shimStop();
    } catch (e) {
      this._warnOnce('tick', e);
    }
  }

  // ===== moods ==============================================================
  _applyMood(name, fade) {
    const now = this.ctx.currentTime;
    fade = Math.max(0.05, fade);
    if (isPair(name) && this.pair) {
      // moving within the dusk/underside pair: just slide the blend
      this._activeMood = name;
      this._blend = name === 'underside' ? 1 : 0;
      this._applyBlend(fade / 4);
      return;
    }
    if (name === this._activeMood) return;
    for (const L of this.layers) if (!L.dying) L.fadeOut(fade);
    this.pair = null;
    this._activeMood = name;
    if (name === 'silence') return;
    this._lastMusicMood = name;
    if (isPair(name)) {
      this.pair = { dusk: null, underside: null };
      this._pairFadeEnd = now + fade;
      this._blend = name === 'underside' ? 1 : 0;
      this._applyBlend(0.01, fade);
    } else {
      this.layers.push(new MoodLayer(this, name, { fade }));
    }
    const dt = (60 / MOODS[name].bpm) * 0.75;
    this.dL.delayTime.setTargetAtTime(dt, now, Math.min(1, fade / 3));
    this.dR.delayTime.setTargetAtTime(dt, now, Math.min(1, fade / 3));
  }

  _applyBlend(tc, fadeIn) {
    if (!this.pair) return;
    const x = this._blend;
    const w = { dusk: Math.cos((x * Math.PI) / 2), underside: Math.sin((x * Math.PI) / 2) };
    for (const name of ['dusk', 'underside']) {
      const wn = w[name] < 0.002 ? 0 : w[name];
      let L = this.pair[name];
      if (!L) {
        if (wn <= 0) continue;
        const other = this.pair[name === 'dusk' ? 'underside' : 'dusk'];
        const fade = fadeIn != null ? fadeIn : Math.max(0.4, this._pairFadeEnd - this.ctx.currentTime);
        L = new MoodLayer(this, name, { fade, blend: 0, syncTo: other });
        this.layers.push(L);
        this.pair[name] = L;
      }
      L.setBlend(wn, tc);
    }
  }

  _dominant() {
    let best = null;
    let bw = -1;
    for (const L of this.layers) {
      if (L.dying || L.dead) continue;
      if (L.blendW > bw) {
        bw = L.blendW;
        best = L;
      }
    }
    return best;
  }

  /** Current harmonic context: { scale, chord, tonic, minor }. */
  _harmony() {
    const L = this._dominant();
    if (L && L.chord) return { scale: L.cfg.scale, chord: L.chord, tonic: L.cfg.tonic, minor: L.cfg.minor };
    const cfg = MOODS[this._lastMusicMood] || MOODS.title;
    return { scale: cfg.scale, chord: cfg.prog[0], tonic: cfg.tonic, minor: cfg.minor };
  }

  _onChord(L, t) {
    if (this.shim && L === this._dominant()) this._shimRetune(t);
  }

  // ===== public: mix ========================================================
  setMasterVolume(v) {
    this._setVol('master', v);
  }
  setMusicVolume(v) {
    this._setVol('music', v);
  }
  setSfxVolume(v) {
    this._setVol('sfx', v);
  }
  /** Ambience beds (birds, insects, wind...). Effective level = sfxVolume * ambienceVolume. */
  setAmbienceVolume(v) {
    this._setVol('amb', v);
  }

  setMood(name, opts) {
    try {
      if (name !== 'silence' && !MOODS[name]) return;
      const fade = opts && Number.isFinite(opts.fade) ? clamp(opts.fade, 0, 30) : 3;
      this._requestedMood = name;
      this._requestedFade = fade;
      if (!this._built) return;
      this._applyMood(name, fade);
    } catch (e) {
      this._warnOnce('setMood', e);
    }
  }

  /** 0 = dusk, 1 = underside. Only audible while mood is 'dusk' or 'underside'. */
  setUndersideBlend(x) {
    try {
      const v = Number(x);
      if (!Number.isFinite(v)) return;
      this._blend = clamp(v, 0, 1);
      if (this._built && this.pair) this._applyBlend(0.06);
    } catch (e) {
      this._warnOnce('setUndersideBlend', e);
    }
  }

  setPaused(p) {
    try {
      this._paused = !!p;
      if (this._built) this._applyPause(0.12);
    } catch (e) {
      this._warnOnce('setPaused', e);
    }
  }

  /** Debug snapshot. */
  getState() {
    const c = this.ctx;
    return {
      state: c ? c.state : 'uninitialized',
      time: c ? +c.currentTime.toFixed(2) : 0,
      mood: this._activeMood || this._requestedMood,
      blend: +this._blend.toFixed(3),
      alignment: +this._align.toFixed(3),
      paused: this._paused,
      voices: this.voices,
      layers: this.layers.map((L) => L.name + (L.dying ? '(out)' : '') + (L.dormant ? '(dormant)' : '') + ':' + (L.chord ? L.chord.name : '')),
      shimmer: !!this.shim,
      mowers: this._mowers.size,
    };
  }

  // ===== instruments ========================================================
  _pad(dest, notes, t, dur, o) {
    const atk = o.attack || 1.6;
    const rel = o.release || 2.8;
    const hold = Math.max(dur, atk);
    const end = t + hold + rel;
    const per = notes.length > 4 ? 2 : 3;
    const peak = (o.level * 1.8) / Math.sqrt(notes.length * per);
    const env = this._g(0);
    const pl = this._pan(-0.55);
    const pr = this._pan(0.55);
    pl.connect(env);
    pr.connect(env);
    env.connect(dest);
    const nodes = [env, pl, pr];
    let last = null;
    for (const m of notes) {
      const f = mtof(m);
      for (let k = 0; k < per; k++) {
        const type = k === 2 ? 'triangle' : o.wave || 'sawtooth';
        const det = k === 0 ? -rand(5, 9) : k === 1 ? rand(5, 9) : rand(-2, 2);
        const osc = this._o(type, f, det);
        osc.connect(k === 0 ? pl : k === 1 ? pr : env);
        osc.start(t);
        osc.stop(end);
        nodes.push(osc);
        last = osc;
      }
    }
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + atk);
    env.gain.setValueAtTime(peak, t + hold);
    env.gain.setTargetAtTime(0, t + hold, rel / 5);
    this._track(last, nodes);
  }

  /** Glass pluck: sine + octave triangle + faint inharmonic tine, exponential decay. */
  _pluck(dest, midi, t, amp, o) {
    if (this.voices > MAX_VOICES) return;
    const f = mtof(midi);
    const dec = (o && o.decay) || 2;
    const end = t + dec;
    const pan = this._pan(rand(-0.5, 0.5));
    pan.connect(dest);
    const e1 = this._g(0);
    e1.connect(pan);
    const o1 = this._o('sine', f);
    o1.connect(e1);
    e1.gain.setValueAtTime(0, t);
    e1.gain.linearRampToValueAtTime(amp, t + 0.005);
    e1.gain.setTargetAtTime(0, t + 0.005, dec / 6);
    o1.start(t);
    o1.stop(end);
    const nodes = [pan, e1, o1];
    if (!(o && o.dark)) {
      for (const [ratio, type, g, tc] of [
        [2, 'triangle', 0.28, dec / 14],
        [4.03, 'sine', 0.1, 0.05],
      ]) {
        if (f * ratio > 14000) continue;
        const ox = this._o(type, f * ratio, rand(-4, 4));
        const ex = this._g(0);
        ox.connect(ex);
        ex.connect(pan);
        ex.gain.setValueAtTime(0, t);
        ex.gain.linearRampToValueAtTime(amp * g, t + 0.003);
        ex.gain.setTargetAtTime(0, t + 0.003, tc);
        ox.start(t);
        ox.stop(end);
        nodes.push(ox, ex);
      }
    }
    this._track(o1, nodes);
  }

  _bass(dest, midi, t, dur, o) {
    if (dur <= 0.05) return;
    const f = mtof(midi);
    const rel = 0.9;
    const end = t + dur + rel;
    const env = this._g(0);
    env.connect(dest);
    const o1 = this._o('sine', f);
    o1.connect(env);
    o1.start(t);
    o1.stop(end);
    const nodes = [env, o1];
    if (!o.sub) {
      const o2 = this._o('triangle', f * 2, 4);
      const g2 = this._g(0.18);
      o2.connect(g2);
      g2.connect(env);
      o2.start(t);
      o2.stop(end);
      nodes.push(o2, g2);
    }
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(o.level, t + 0.08);
    env.gain.setValueAtTime(o.level, t + Math.max(0.08, dur * 0.4));
    env.gain.linearRampToValueAtTime(o.level * 0.8, t + Math.max(0.09, dur));
    env.gain.setTargetAtTime(0, t + Math.max(0.09, dur), rel / 5);
    this._track(o1, nodes);
  }

  /** Soft flute-ish lead with delayed vibrato. */
  _melody(dest, midi, t, dur, level) {
    const f = mtof(midi);
    const end = t + dur + 0.7;
    const pan = this._pan(rand(-0.3, 0.3));
    const env = this._g(0);
    env.connect(pan);
    pan.connect(dest);
    const o1 = this._o('triangle', f);
    const o2 = this._o('sine', f * 2, 3);
    const g2 = this._g(0.2);
    const vib = this._o('sine', rand(4.5, 5.5));
    const vg = this._g(0);
    vib.connect(vg);
    vg.connect(o1.detune);
    vg.connect(o2.detune);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(9, t + Math.min(0.5, dur));
    o1.connect(env);
    o2.connect(g2);
    g2.connect(env);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.07);
    env.gain.linearRampToValueAtTime(level * 0.75, t + Math.max(0.08, dur));
    env.gain.setTargetAtTime(0, t + Math.max(0.08, dur), 0.12);
    for (const s of [o1, o2, vib]) {
      s.start(t);
      s.stop(end);
    }
    this._track(o1, [o1, o2, g2, vib, vg, env, pan]);
  }

  /** Farfisa-ish combo organ chord (square + octave saw), vibrato from the layer hub. */
  _organ(L, notes, t, dur, level) {
    const atk = 0.09;
    const rel = 0.5;
    const hold = Math.max(dur, atk);
    const end = t + hold + rel + 0.1;
    const env = this._g(0);
    env.connect(L.ch.organ);
    const peak = level / Math.sqrt(notes.length);
    const nodes = [env];
    const oscs = [];
    let last = null;
    for (const m of notes) {
      const f = mtof(m);
      const a = this._o('square', f, rand(-3, 3));
      const b = this._o('sawtooth', f * 2, rand(-4, 4));
      const gb = this._g(0.22);
      a.connect(env);
      b.connect(gb);
      gb.connect(env);
      L.organVib.connect(a.detune);
      L.organVib.connect(b.detune);
      a.start(t);
      b.start(t);
      a.stop(end);
      b.stop(end);
      nodes.push(a, b, gb);
      oscs.push(a, b);
      last = b;
    }
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + atk);
    env.gain.setValueAtTime(peak, t + hold);
    env.gain.setTargetAtTime(0, t + hold, rel / 4);
    this._track(last, nodes, () => {
      for (const o of oscs) {
        try {
          L.organVib.disconnect(o.detune);
        } catch (_) {
          /* hub already gone */
        }
      }
    });
  }

  _kick(dest, t, vel, heavy) {
    const f0 = heavy ? 95 : 125;
    const f1 = heavy ? 34 : 46;
    const o = this._o('sine', f0);
    const env = this._g(0);
    o.connect(env);
    env.connect(dest);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + (heavy ? 0.22 : 0.1));
    const amp = vel * (heavy ? 0.5 : 0.36);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + 0.004);
    env.gain.setTargetAtTime(0, t + 0.01, heavy ? 0.2 : 0.09);
    o.start(t);
    o.stop(t + (heavy ? 1.4 : 0.7));
    this._track(o, [o, env]);
  }

  _snare(dest, t, vel, kind) {
    const clap = kind === 'clap';
    const n = this._noise('white', t, clap ? 1 : 0.55);
    const bp = this._f('bandpass', clap ? 1300 : 2400, clap ? 1.1 : 0.7);
    const env = this._g(0);
    n.connect(bp);
    bp.connect(env);
    env.connect(dest);
    const a = vel * (clap ? 0.22 : 0.12);
    const nodes = [n, bp, env];
    if (clap) {
      env.gain.setValueAtTime(0, t);
      for (const d of [0, 0.011, 0.023]) {
        env.gain.setValueAtTime(a, t + d);
        env.gain.setTargetAtTime(a * 0.15, t + d + 0.001, 0.004);
      }
      env.gain.setValueAtTime(a * 0.8, t + 0.034);
      env.gain.setTargetAtTime(0, t + 0.035, 0.12);
    } else {
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(a, t + 0.012);
      env.gain.setTargetAtTime(0, t + 0.014, 0.07);
      const o = this._o('triangle', 185);
      const eg = this._g(0);
      o.connect(eg);
      eg.connect(dest);
      eg.gain.setValueAtTime(0, t);
      eg.gain.linearRampToValueAtTime(0.05 * vel, t + 0.004);
      eg.gain.setTargetAtTime(0, t + 0.006, 0.03);
      o.start(t);
      o.stop(t + 0.55);
      nodes.push(o, eg);
    }
    this._track(n, nodes);
  }

  _hat(dest, t, vel) {
    const n = this._noise('white', t, 0.2);
    const hp = this._f('highpass', 6500, 0.7);
    const env = this._g(0);
    const pan = this._pan(0.25);
    n.connect(hp);
    hp.connect(env);
    env.connect(pan);
    pan.connect(dest);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.06, t + 0.008);
    env.gain.setTargetAtTime(0, t + 0.01, 0.028);
    this._track(n, [n, hp, env, pan]);
  }

  /** Reversed swell: exponential rise into the next chord, cut at the downbeat. */
  _swell(dest, notes, t, dur, level) {
    const end = t + dur + 0.1;
    const env = this._g(0);
    env.connect(dest);
    const nodes = [env];
    for (const m of notes) {
      const o = this._o('triangle', mtof(m), rand(-6, 6));
      o.connect(env);
      o.start(t);
      o.stop(end);
      nodes.push(o);
    }
    const n = this._noise('pink', t, dur + 0.1);
    const bp = this._f('bandpass', 500, 1.2);
    const ng = this._g(1.2);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(env);
    nodes.push(n, bp, ng);
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(3500, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level / Math.sqrt(notes.length), t + dur);
    env.gain.linearRampToValueAtTime(0, t + dur + 0.06);
    this._track(n, nodes);
  }

  /** FM bird call: tweets, trill or two-note whistle. */
  _bird(dest, t) {
    if (this.voices > MUSIC_VOICE_CAP) return;
    const kind = randi(0, 2);
    const n = kind === 1 ? 1 : randi(2, 6);
    const car = this._o('sine', 3000);
    const mod = this._o('sine', rand(25, 70));
    const mg = this._g(kind === 1 ? rand(300, 700) : rand(0, 150));
    mod.connect(mg);
    mg.connect(car.frequency);
    const env = this._g(0);
    const hp = this._f('highpass', 1500, 0.7);
    const pan = this._pan(rand(-0.85, 0.85));
    car.connect(env);
    env.connect(hp);
    hp.connect(pan);
    pan.connect(dest);
    const amp = rand(0.012, 0.035);
    const base = rand(2600, 4800);
    const g = env.gain;
    const fr = car.frequency;
    let tt = t;
    g.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const len = kind === 1 ? rand(0.35, 0.7) : rand(0.04, 0.12);
      let f0;
      let f1;
      if (kind === 0) {
        f0 = base * rand(1.05, 1.25);
        f1 = base * rand(0.6, 0.8);
      } else if (kind === 1) {
        f0 = base;
        f1 = base * rand(0.9, 1.1);
      } else {
        f0 = base * (i % 2 ? 0.85 : 1);
        f1 = f0 * (i % 2 ? 1.12 : 1.18);
      }
      fr.setValueAtTime(f0, tt);
      fr.exponentialRampToValueAtTime(f1, tt + len);
      g.setValueAtTime(0, tt);
      g.linearRampToValueAtTime(amp, tt + Math.min(0.012, len * 0.3));
      g.linearRampToValueAtTime(0, tt + len);
      tt += len + (kind === 0 ? rand(0.03, 0.09) : rand(0.08, 0.2));
    }
    car.start(t);
    mod.start(t);
    car.stop(tt + 0.05);
    mod.stop(tt + 0.05);
    this._track(car, [car, mod, mg, env, hp, pan]);
  }

  /** Far-off impact sprinkler: tch-tch-tch... then the quick ratchet return. */
  _sprinkler(dest, t, level) {
    if (this.voices > MUSIC_VOICE_CAP) return;
    const ticks = randi(14, 26);
    const rate = rand(6.5, 8.5);
    const ret = rand(0.6, 1.0);
    const total = ticks / rate + ret + 0.3;
    const n = this._noise('white', t, total);
    const bp = this._f('bandpass', rand(3000, 4200), 1.4);
    const env = this._g(0);
    const pan = this._pan(rand(0.4, 0.9) * (chance(0.5) ? 1 : -1));
    n.connect(bp);
    bp.connect(env);
    env.connect(pan);
    pan.connect(dest);
    const a = 0.05 * level;
    const g = env.gain;
    let tt = t;
    g.setValueAtTime(0, t);
    for (let i = 0; i < ticks; i++) {
      g.setValueAtTime(a * rand(0.6, 1), tt);
      g.setTargetAtTime(0, tt + 0.002, 0.012);
      tt += (1 / rate) * rand(0.95, 1.05);
    }
    const rn = Math.floor(ret * 26);
    for (let i = 0; i < rn; i++) {
      g.setValueAtTime(a * 0.45, tt);
      g.setTargetAtTime(0, tt + 0.001, 0.006);
      tt += 1 / 26;
    }
    this._track(n, [n, bp, env, pan]);
  }

  /** Bell / glass: near-harmonic additive partials, higher partials decay faster. */
  _bell(dest, midi, t, amp, dec, panV = 0) {
    const f = mtof(midi);
    const pan = this._pan(panV);
    pan.connect(dest);
    const nodes = [pan];
    let last = null;
    for (const [r, g, df] of [
      [1, 1, 1],
      [2, 0.42, 0.55],
      [3, 0.18, 0.3],
      [4.16, 0.1, 0.16],
      [5.43, 0.05, 0.1],
    ]) {
      if (f * r > 15000) continue;
      const o = this._o('sine', f * r, rand(-3, 3));
      const e = this._g(0);
      o.connect(e);
      e.connect(pan);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(amp * g, t + (r === 1 ? 0.006 : 0.002));
      e.gain.setTargetAtTime(0, t + 0.006, (dec * df) / 5);
      o.start(t);
      o.stop(t + dec + 0.1);
      nodes.push(o, e);
      last = o;
    }
    if (last) this._track(last, nodes);
  }

  /** Warm soft note (triangle + sine octave), slow attack. */
  _softNote(dest, midi, t, dur, amp, atk = 0.25) {
    const f = mtof(midi);
    const pan = this._pan(rand(-0.4, 0.4));
    const env = this._g(0);
    env.connect(pan);
    pan.connect(dest);
    const o1 = this._o('triangle', f, rand(-5, 5));
    const o2 = this._o('sine', f * 2, rand(-3, 3));
    const g2 = this._g(0.25);
    o1.connect(env);
    o2.connect(g2);
    g2.connect(env);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + atk);
    env.gain.setTargetAtTime(0, t + atk + 0.05, dur / 5);
    const end = t + atk + dur + 0.1;
    o1.start(t);
    o2.start(t);
    o1.stop(end);
    o2.stop(end);
    this._track(o1, [o1, o2, g2, env, pan]);
  }

  _blip(dest, midi, t, amp, dec, type = 'sine') {
    const o = this._o(type, mtof(midi));
    const env = this._g(0);
    const pan = this._pan(rand(-0.15, 0.15));
    o.connect(env);
    env.connect(pan);
    pan.connect(dest);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + 0.004);
    env.gain.setTargetAtTime(0, t + 0.005, dec / 5);
    o.start(t);
    o.stop(t + dec + 0.05);
    this._track(o, [o, env, pan]);
  }

  /**
   * Filtered-noise whoosh. opts: kind, type, q, peakAt (0..1), f2 (end freq),
   * pan0/pan1 (sweep), reverse (exponential rise then cut).
   */
  _whoosh(dest, t, dur, f0, f1, amp, opts = {}) {
    const n = this._noise(opts.kind || 'pink', t, dur + 0.1);
    const f = this._f(opts.type || 'bandpass', f0, opts.q || 0.9);
    const env = this._g(0);
    const pan = this._pan(opts.pan0 || 0);
    n.connect(f);
    f.connect(env);
    env.connect(pan);
    pan.connect(dest);
    const pk = opts.peakAt != null ? opts.peakAt : 0.4;
    f.frequency.setValueAtTime(f0, t);
    if (opts.f2) {
      f.frequency.exponentialRampToValueAtTime(f1, t + dur * pk);
      f.frequency.exponentialRampToValueAtTime(opts.f2, t + dur);
    } else {
      f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    }
    if (opts.reverse) {
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(amp, t + dur * 0.94);
      env.gain.linearRampToValueAtTime(0, t + dur);
    } else {
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp, t + dur * pk);
      env.gain.linearRampToValueAtTime(0, t + dur);
    }
    if (pan.pan && opts.pan1 != null) {
      pan.pan.setValueAtTime(clamp(opts.pan0 || 0, -1, 1), t);
      pan.pan.linearRampToValueAtTime(clamp(opts.pan1, -1, 1), t + dur);
    }
    this._track(n, [n, f, env, pan]);
  }

  /** Low thump / pop: pitch-dropping sine + a lowpassed noise tick. */
  _pop(dest, t, amp, f0 = 120, f1 = 50, dec = 0.06) {
    const o = this._o('sine', f0);
    const e = this._g(0);
    o.connect(e);
    e.connect(dest);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dec * 1.6);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(amp, t + 0.004);
    e.gain.setTargetAtTime(0, t + 0.006, dec);
    const n = this._noise('white', t);
    const lp = this._f('lowpass', 900, 0.7);
    const ne = this._g(0);
    n.connect(lp);
    lp.connect(ne);
    ne.connect(dest);
    ne.gain.setValueAtTime(0, t);
    ne.gain.linearRampToValueAtTime(amp * 0.35, t + 0.003);
    ne.gain.setTargetAtTime(0, t + 0.004, 0.015);
    const end = t + dec * 7 + 0.05;
    o.start(t);
    o.stop(end);
    n.stop(end);
    this._track(o, [o, e, n, lp, ne]);
  }

  /** Briefly dip the music/ambience bus so a signature SFX can bloom. */
  _duck(t, amount, hold, release) {
    const g = this.duck.gain;
    g.setTargetAtTime(amount, t, 0.04);
    g.setTargetAtTime(1, t + hold, release / 4);
  }

  // ===== alignment shimmer ==================================================
  _shimPitches() {
    const pcs = this._harmony().chord.pcs;
    const order = [];
    for (const pc of [pcs[1], pcs[2], pcs[4] != null ? pcs[4] : pcs[3], pcs[0]]) {
      if (pc != null && !order.includes(pc)) order.push(pc);
    }
    while (order.length < 2) order.push(pcs[0]);
    return stackUp(order, 76, 4, 2);
  }

  _shimStart(now) {
    const s = { last: -1, zeroSince: null, voices: [], srcs: [], nodes: [] };
    s.gain = this._g(0);
    s.lp = this._f('lowpass', 700, 0.4);
    s.trem = this._g(0.82);
    s.trem.connect(s.lp);
    s.lp.connect(s.gain);
    s.gain.connect(this.sfxCh.shimmer);
    const pl = this._pan(-0.5);
    const pr = this._pan(0.5);
    pl.connect(s.trem);
    pr.connect(s.trem);
    const tl = this._o('sine', 5.2);
    const tg = this._g(0.16);
    tl.connect(tg);
    tg.connect(s.trem.gain);
    const cl = this._o('sine', 0.19);
    const cg = this._g(6); // slow chorus, cents
    cl.connect(cg);
    s.cg = cg;
    s.srcs.push(tl, cl);
    s.nodes.push(s.gain, s.lp, s.trem, pl, pr, tl, tg, cl, cg);
    this._shimPitches().forEach((m, i) => {
      const f = mtof(m);
      const beat = 0.35 + i * 0.22; // slow beating against the partner
      const a = this._o('sine', f);
      const b = this._o('triangle', f + beat);
      const ga = this._g(0.25);
      const gb = this._g(0.12);
      a.connect(ga);
      b.connect(gb);
      const side = i % 2 ? pr : pl;
      ga.connect(side);
      gb.connect(side);
      cg.connect(b.detune);
      s.voices.push({ a, b, beat });
      s.srcs.push(a, b);
      s.nodes.push(a, b, ga, gb);
    });
    for (const o of s.srcs) o.start(now);
    this.shim = s;
    return s;
  }

  _shimRetune(t) {
    const s = this.shim;
    if (!s) return;
    const p = this._shimPitches();
    s.voices.forEach((v, i) => {
      const f = mtof(p[i % p.length]);
      v.a.frequency.setTargetAtTime(f, t, 0.25);
      v.b.frequency.setTargetAtTime(f + v.beat, t, 0.25);
    });
  }

  _shimStop() {
    const s = this.shim;
    this.shim = null;
    if (!s) return;
    const t = this.ctx.currentTime + 0.05;
    for (const o of s.srcs) {
      try {
        o.stop(t);
      } catch (_) {
        /* ignore */
      }
    }
    setTimeout(() => {
      for (const n of s.nodes) {
        try {
          n.disconnect();
        } catch (_) {
          /* ignore */
        }
      }
    }, 200);
  }

  /** 0..1 every frame. Shimmering consonant cluster; silent and torn down at 0. */
  setAlignment(closeness) {
    try {
      const v = Number(closeness);
      const x = Number.isFinite(v) ? clamp(v, 0, 1) : 0;
      this._align = x;
      if (!this._built || this.ctx.state !== 'running') return;
      let s = this.shim;
      if (!s) {
        if (x <= 0.0005) return;
        s = this._shimStart(this.ctx.currentTime);
      }
      if (x === s.last) return;
      if (x > 0.0005 && Math.abs(x - s.last) < 0.003) return;
      s.last = x;
      const now = this.ctx.currentTime;
      s.gain.gain.setTargetAtTime(0.075 * Math.pow(x, 1.5), now, 0.09);
      s.lp.frequency.setTargetAtTime(700 + 8000 * x * x, now, 0.12);
      s.zeroSince = x <= 0.0005 ? now : null;
    } catch (e) {
      this._warnOnce('setAlignment', e);
    }
  }

  // ===== SFX ================================================================
  _sfx(name, fn, essential) {
    const c = this.ctx;
    if (!this._built || !c || c.state !== 'running') return;
    if (!essential && this.voices > MAX_VOICES) return;
    try {
      fn(c.currentTime + 0.005);
    } catch (e) {
      this._warnOnce(name, e);
    }
  }

  /** surface: 'grass' | 'mown' | 'stone' | 'wood' | 'road' */
  step(surface) {
    this._sfx('step', (t) => {
      if (t - this._lastStepT < 0.06) return;
      this._lastStepT = t;
      const S = STEP[surface] || STEP.grass;
      const n = this._noise('white', t, S.dur + 0.06);
      const f = this._f(S.type, S.f * rand(0.85, 1.18), S.q * rand(0.85, 1.15));
      const env = this._g(0);
      const pan = this._pan(rand(-0.15, 0.15));
      n.connect(f);
      f.connect(env);
      env.connect(pan);
      pan.connect(this.sfxCh.step);
      const a = S.level * rand(0.75, 1);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(a, t + S.atk);
      env.gain.setTargetAtTime(0, t + S.atk, S.dur / 4);
      if (S.bursts > 1) {
        const t2 = t + rand(0.028, 0.05);
        env.gain.setValueAtTime(a * rand(0.4, 0.65), t2);
        env.gain.setTargetAtTime(0, t2 + 0.002, S.dur / 5);
      }
      const nodes = [n, f, env, pan];
      if (S.body) {
        const fb = S.body.f * rand(0.88, 1.12);
        const o = this._o(S.body.type || 'sine', fb);
        const eg = this._g(0);
        o.connect(eg);
        eg.connect(pan);
        o.frequency.setValueAtTime(fb, t);
        o.frequency.exponentialRampToValueAtTime(fb * 0.7, t + S.body.dur);
        eg.gain.setValueAtTime(0, t);
        eg.gain.linearRampToValueAtTime(S.body.level * rand(0.8, 1), t + 0.003);
        eg.gain.setTargetAtTime(0, t + 0.004, S.body.dur / 4);
        o.start(t);
        o.stop(t + S.dur + 0.06);
        nodes.push(o, eg);
      }
      this._track(n, nodes);
    });
  }

  /** Player kicks a lawnmower: soft thump + faint metallic deck ring. */
  kick() {
    this._sfx('kick', (t) => {
      const ch = this.sfxCh.soft;
      this._pop(ch, t, 0.34, 150, 55, 0.07);
      for (const [f, a] of [
        [640, 0.018],
        [1013, 0.012],
        [1580, 0.007],
      ]) {
        const o = this._o('triangle', f * rand(0.97, 1.03));
        const e = this._g(0);
        o.connect(e);
        e.connect(ch);
        e.gain.setValueAtTime(0, t + 0.004);
        e.gain.linearRampToValueAtTime(a, t + 0.007);
        e.gain.setTargetAtTime(0, t + 0.008, 0.09);
        o.start(t);
        o.stop(t + 0.7);
        this._track(o, [o, e]);
      }
    });
  }

  /** Soft blocked thud. */
  bump() {
    this._sfx('bump', (t) => {
      this._pop(this.sfxCh.soft, t, 0.24, 105, 50, 0.055);
    });
  }

  // ----- lawnmower ----------------------------------------------------------
  _mowerEngineStart(id, t) {
    const old = this._mowers.get(id);
    if (old && !old.stopping) return old;
    const out = this._g(0);
    const pan = this._pan(0);
    const lp = this._f('lowpass', 850, 1.6);
    const am = this._g(0.65);
    const saw = this._o('sawtooth', 27);
    const sq = this._o('square', 54.3);
    const sqg = this._g(0.35);
    const noise = this._noise('white', t);
    const nbp = this._f('bandpass', 1500, 0.9);
    const ng = this._g(0.18);
    const chug = this._o('square', 13.5);
    const chg = this._g(0.3);
    const wob = this._o('sine', 0.4);
    const wg = this._g(1.6);
    const flt = this._o('sine', 0.9);
    const fg = this._g(260);
    saw.connect(lp);
    sq.connect(sqg);
    sqg.connect(lp);
    lp.connect(am);
    noise.connect(nbp);
    nbp.connect(ng);
    ng.connect(am);
    am.connect(out);
    out.connect(pan);
    pan.connect(this.sfxCh.soft);
    chug.connect(chg);
    chg.connect(am.gain);
    wob.connect(wg);
    wg.connect(saw.frequency);
    wg.connect(sq.frequency);
    flt.connect(fg);
    fg.connect(lp.frequency);
    // spin up
    saw.frequency.setValueAtTime(14, t);
    saw.frequency.exponentialRampToValueAtTime(27, t + 0.7);
    sq.frequency.setValueAtTime(28, t);
    sq.frequency.exponentialRampToValueAtTime(54.3, t + 0.7);
    chug.frequency.setValueAtTime(7, t);
    chug.frequency.exponentialRampToValueAtTime(13.5, t + 0.7);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.1, t + 0.35);
    const srcs = [saw, sq, noise, chug, wob, flt];
    for (const s of srcs) if (s !== noise) s.start(t);
    const m = {
      stopping: false,
      readyAt: t + 0.75,
      saw,
      sq,
      chug,
      out,
      srcs,
      nodes: [out, pan, lp, am, saw, sq, sqg, noise, nbp, ng, chug, chg, wob, wg, flt, fg],
    };
    this._mowers.set(id, m);
    return m;
  }

  _mowerEngineStop(id, t, quick) {
    const m = this._mowers.get(id);
    if (!m || m.stopping) return;
    m.stopping = true;
    this._mowers.delete(id);
    const ts = Math.max(t, m.readyAt);
    const dur = quick ? 0.6 : 1.5;
    m.saw.frequency.setTargetAtTime(9, ts, dur / 3);
    m.sq.frequency.setTargetAtTime(18, ts, dur / 3);
    m.chug.frequency.setTargetAtTime(4, ts, dur / 3);
    m.out.gain.setTargetAtTime(0, ts, dur / 4);
    const end = ts + dur + 0.3;
    for (const s of m.srcs) s.stop(end);
    this._track(m.saw, m.nodes);
  }

  /** Ignition (pull-cord zip + coughs), then the engine loop spins up (same as mowerRun(true)). */
  mowerStart(id = 0) {
    this._sfx(
      'mowerStart',
      (t) => {
        const ch = this.sfxCh.soft;
        this._whoosh(ch, t, 0.32, 500, 2600, 0.05, { kind: 'white', q: 2.5, peakAt: 0.7 });
        for (const [dt, v] of [
          [0.36, 0.7],
          [0.5, 0.5],
          [0.6, 0.9],
        ]) {
          this._pop(ch, t + dt, v * 0.16, 110, 45, 0.05);
        }
        this._mowerEngineStart(id, t + 0.62);
      },
      true
    );
  }

  /** Engine loop on/off. false winds it down over ~1.5 s. */
  mowerRun(on, id = 0) {
    this._sfx(
      'mowerRun',
      (t) => {
        if (on) this._mowerEngineStart(id, t);
        else this._mowerEngineStop(id, t, false);
      },
      true
    );
  }

  /** Thunk + sputter; stops the engine loop if running. */
  mowerStop(id = 0) {
    this._sfx(
      'mowerStop',
      (t) => {
        const ch = this.sfxCh.soft;
        this._pop(ch, t, 0.3, 95, 38, 0.08);
        for (const [dt, v] of [
          [0.14, 0.5],
          [0.27, 0.32],
          [0.46, 0.18],
        ]) {
          this._pop(ch, t + dt, v * 0.18, 130, 55, 0.04);
        }
        this._mowerEngineStop(id, t, true);
      },
      true
    );
  }

  // ----- signature / world SFX ---------------------------------------------
  /** The illusion snaps into alignment: bright bell chord in key + airy whoosh + sub bloom. */
  lock() {
    this._sfx('lock', (t) => {
      const h = this._harmony();
      const ch = this.sfxCh.lush;
      this._duck(t, 0.55, 0.35, 2.2);
      const notes = stackUp(h.chord.pcs, 72, 5);
      notes.forEach((m, i) => this._bell(ch, m, t + i * 0.045, 0.1 * (1 - i * 0.08), 4.2, -0.5 + i * 0.25));
      for (let i = 0; i < 3; i++) this._pluck(ch, notes[(i + 2) % notes.length] + 12, t + 0.22 + i * 0.09, 0.03, { decay: 2.4 });
      this._whoosh(this.sfxCh.whoosh, t, 0.95, 500, 7000, 0.07, { peakAt: 0.3, pan0: -0.4, pan1: 0.4 });
      this._bass(this.sfxCh.soft, nearestMidi(h.chord.root, 38), t, 0.7, { level: 0.12, sub: true });
    });
  }

  /** Rising shimmering swell lasting `duration` seconds while pieces slide into place. */
  morph(duration) {
    this._sfx('morph', (t) => {
      const d = clamp(Number.isFinite(duration) ? duration : 1.5, 0.25, 12);
      const h = this._harmony();
      const ch = this.sfxCh.lush;
      const env = this._g(0);
      const lp = this._f('lowpass', 500, 1.2);
      const trem = this._g(1);
      env.connect(lp);
      lp.connect(trem);
      trem.connect(ch);
      const tl = this._o('sine', 6.5);
      const tg = this._g(0);
      tl.connect(tg);
      tg.connect(trem.gain);
      const end = t + d + 1.8;
      const nodes = [env, lp, trem, tl, tg];
      for (const m of stackUp(h.chord.pcs, 62, 4)) {
        const a = this._o('triangle', mtof(m), rand(-6, 6));
        const b = this._o('sine', mtof(m) * 2, rand(-4, 4));
        const gb = this._g(0.3);
        a.connect(env);
        b.connect(gb);
        gb.connect(env);
        a.start(t);
        b.start(t);
        a.stop(end);
        b.stop(end);
        nodes.push(a, b, gb);
      }
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.05, t + d);
      env.gain.setTargetAtTime(0, t + d, 0.3);
      lp.frequency.setValueAtTime(400, t);
      lp.frequency.exponentialRampToValueAtTime(5000, t + d);
      tg.gain.setValueAtTime(0, t);
      tg.gain.linearRampToValueAtTime(0.3, t + d);
      tl.start(t);
      tl.stop(end);
      this._track(tl, nodes);
      this._whoosh(this.sfxCh.whoosh, t, d + 0.25, 700, 6500, 0.035, { peakAt: 0.92 });
      // ascending glass arpeggio across the morph
      const pcs = new Set(h.chord.pcs);
      const pool = [];
      for (let m = 67; m <= 91; m++) if (pcs.has(m % 12)) pool.push(m);
      const count = clamp(Math.round(d * 4), 3, 16);
      for (let i = 0; i < count; i++) {
        const m = pool[Math.min(pool.length - 1, Math.floor((i * pool.length) / count))];
        this._pluck(ch, m, t + d * (i / count) * 0.95, 0.02 + 0.025 * (i / count), { decay: 1.8 });
      }
    });
  }

  /** Paper unrolling / page turn: crinkly noise sweep + tonal glide to the octave. */
  fold() {
    this._sfx('fold', (t) => {
      const d = 0.62;
      const n = this._noise('white', t, d + 0.12);
      const bp = this._f('bandpass', 350, 1.6);
      const env = this._g(0);
      const pan = this._pan(-0.4);
      n.connect(bp);
      bp.connect(env);
      env.connect(pan);
      pan.connect(this.sfxCh.whoosh);
      bp.frequency.setValueAtTime(350, t);
      bp.frequency.exponentialRampToValueAtTime(3600, t + d);
      env.gain.setValueAtTime(0, t);
      for (let tt = t + 0.01; tt < t + d; tt += rand(0.012, 0.028)) {
        const prog = (tt - t) / d;
        env.gain.linearRampToValueAtTime(0.12 * Math.sin(Math.PI * Math.min(1, prog * 1.1)) * rand(0.35, 1), tt);
      }
      env.gain.linearRampToValueAtTime(0, t + d + 0.05);
      if (pan.pan) {
        pan.pan.setValueAtTime(-0.4, t);
        pan.pan.linearRampToValueAtTime(0.4, t + d);
      }
      this._track(n, [n, bp, env, pan]);
      const h = this._harmony();
      const m0 = nearestMidi(h.chord.pcs[0], 67);
      const o = this._o('triangle', mtof(m0));
      const og = this._g(0);
      o.connect(og);
      og.connect(this.sfxCh.lush);
      o.frequency.setValueAtTime(mtof(m0), t);
      o.frequency.exponentialRampToValueAtTime(mtof(m0 + 12), t + d * 0.8);
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(0.03, t + 0.08);
      og.gain.setTargetAtTime(0, t + d * 0.8, 0.12);
      o.start(t);
      o.stop(t + d + 0.8);
      this._track(o, [o, og]);
      this._pop(this.sfxCh.soft, t + d, 0.05, 200, 90, 0.03);
    });
  }

  /** Camera flips upside down: deep slow whoosh panning across + sub drop. */
  flip() {
    this._sfx('flip', (t) => {
      const d = 1.9;
      this._whoosh(this.sfxCh.whoosh, t, d, 160, 1300, 0.18, { kind: 'pink', type: 'lowpass', q: 0.8, peakAt: 0.45, f2: 180, pan0: -0.8, pan1: 0.8 });
      const o = this._o('sine', 75);
      const e = this._g(0);
      o.connect(e);
      e.connect(this.sfxCh.soft);
      o.frequency.setValueAtTime(75, t + 0.15);
      o.frequency.exponentialRampToValueAtTime(27, t + 1.7);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(0.32, t + 0.45);
      e.gain.setTargetAtTime(0, t + 0.9, 0.35);
      o.start(t);
      o.stop(t + 2.8);
      this._track(o, [o, e]);
      this._duck(t, 0.75, 1, 1.5);
    });
  }

  /** Soft wooden creak + a warm chord in key. */
  door() {
    this._sfx('door', (t) => {
      const d = rand(0.6, 0.85);
      const o = this._o('sawtooth', 70);
      const bp = this._f('bandpass', 1100, 5);
      const bp2 = this._f('bandpass', 2300, 4);
      const env = this._g(0);
      const pan = this._pan(rand(-0.3, 0.3));
      o.connect(bp);
      o.connect(bp2);
      bp.connect(env);
      bp2.connect(env);
      env.connect(pan);
      pan.connect(this.sfxCh.soft);
      let f = rand(55, 75);
      for (let tt = t; tt < t + d; tt += rand(0.018, 0.045)) {
        f = clamp(f + rand(-12, 15), 40, 130);
        o.frequency.setValueAtTime(f, tt);
      }
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.12, t + 0.06);
      env.gain.linearRampToValueAtTime(0.075, t + d * 0.6);
      env.gain.linearRampToValueAtTime(0, t + d);
      o.start(t);
      o.stop(t + d + 0.05);
      this._track(o, [o, bp, bp2, env, pan]);
      const h = this._harmony();
      stackUp(h.chord.pcs, 57, 4).forEach((m, i) => this._softNote(this.sfxCh.lush, m, t + 0.25 + i * 0.06, 2.6, 0.04, 0.3));
    });
  }

  /** Gentle resolving cadence (IV -> I in the current key). */
  levelComplete() {
    this._sfx('levelComplete', (t) => {
      const h = this._harmony();
      const k = h.tonic;
      const sub = (h.minor ? [5, 8, 0, 3] : [5, 9, 0, 4]).map((x) => (k + x) % 12);
      const home = (h.minor ? [0, 3, 7, 2, 10] : [0, 4, 7, 11, 2]).map((x) => (k + x) % 12);
      const ch = this.sfxCh.lush;
      this._duck(t, 0.7, 2.2, 2.5);
      const step = 0.17;
      stackUp(sub, 64, 4).forEach((m, i) => this._pluck(ch, m, t + i * step, 0.05, { decay: 2.2 }));
      const t2 = t + 4 * step + 0.12;
      stackUp(home, 67, 5).forEach((m, i) => this._bell(ch, m, t2 + i * 0.14, 0.05, 3.5, -0.4 + i * 0.2));
      const t3 = t2 + 5 * 0.14;
      stackUp(home, 55, 4).forEach((m) => this._softNote(ch, m, t3 - 0.2, 3.5, 0.028, 0.4));
      this._bass(this.sfxCh.soft, nearestMidi(k, 40), t3 - 0.1, 2.0, { level: 0.1 });
    });
  }

  // ----- UI -----------------------------------------------------------------
  _pent(h) {
    const s = h.scale;
    return h.minor ? [s[0], s[2], s[3], s[4], s[6]] : [s[0], s[1], s[2], s[4], s[5]];
  }

  uiMove() {
    this._sfx('uiMove', (t) => {
      if (t - this._lastUiT < 0.03) return;
      this._lastUiT = t;
      this._blip(this.sfxCh.ui, nearestMidi(pick(this._pent(this._harmony())), 86), t, 0.045, 0.09);
    });
  }

  uiSelect() {
    this._sfx('uiSelect', (t) => {
      const h = this._harmony();
      const r = nearestMidi(h.tonic, 79);
      this._blip(this.sfxCh.ui, r, t, 0.05, 0.25);
      this._blip(this.sfxCh.ui, r + 7, t + 0.07, 0.045, 0.4);
      this._blip(this.sfxCh.ui, r + 19, t + 0.07, 0.012, 0.3, 'triangle');
    });
  }

  uiBack() {
    this._sfx('uiBack', (t) => {
      const r = nearestMidi(this._harmony().tonic, 79);
      this._blip(this.sfxCh.ui, r + 7, t, 0.05, 0.2, 'triangle');
      this._blip(this.sfxCh.ui, r, t + 0.07, 0.045, 0.3, 'triangle');
    });
  }

  /** Short reversed whoosh + reversed tone. */
  undo() {
    this._sfx('undo', (t) => {
      const d = 0.34;
      this._whoosh(this.sfxCh.whoosh, t, d, 2600, 700, 0.08, { kind: 'white', reverse: true, q: 1.2 });
      const m = nearestMidi(this._harmony().chord.pcs[0], 76);
      const o = this._o('sine', mtof(m));
      const e = this._g(0);
      o.connect(e);
      e.connect(this.sfxCh.lush);
      o.frequency.setValueAtTime(mtof(m) * 1.03, t);
      o.frequency.exponentialRampToValueAtTime(mtof(m), t + d);
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(0.04, t + d * 0.94);
      e.gain.linearRampToValueAtTime(0, t + d);
      o.start(t);
      o.stop(t + d + 0.05);
      this._track(o, [o, e]);
    });
  }

  /** Two soft notes from the current chord. */
  hint() {
    this._sfx('hint', (t) => {
      const pcs = this._harmony().chord.pcs;
      const a = nearestMidi(pcs[2] != null ? pcs[2] : pcs[0], 74);
      let b = nearestMidi(pcs[1], a + 4);
      if (b <= a) b += 12;
      this._bell(this.sfxCh.lush, a, t, 0.035, 1.8, -0.2);
      this._bell(this.sfxCh.lush, b, t + 0.28, 0.035, 2.2, 0.2);
    });
  }
}

export const audio = new AudioEngine();
export default audio;
export { AudioEngine, MOODS };
