// DOM overlay: title, menus, level cards, prompts with device-aware glyphs, hints.
import { audio } from './core/audio.js';
import { LEVELS } from './game.js';

const $ = (s) => document.querySelector(s);

const PAD = {
  LS: '<span class="g pad stick">L</span>', RS: '<span class="g pad stick">R</span>',
  X: '<span class="g pad face x">✕</span>', O: '<span class="g pad face o">○</span>',
  SQ: '<span class="g pad face sq">□</span>', TRI: '<span class="g pad face tri">△</span>',
  OPT: '<span class="g pad wide">Options</span>', CREATE: '<span class="g pad wide">Create</span>',
  L2: '<span class="g pad wide">L2</span>', R2: '<span class="g pad wide">R2</span>',
  DPAD: '<span class="g pad wide">D-pad</span>',
};
const KEY = (k) => `<span class="g key">${k}</span>`;
const KB = {
  MOVE: KEY('W') + KEY('A') + KEY('S') + KEY('D'), CLICK: '<span class="g mouse">click</span>', DRAG: '<span class="g mouse">drag</span>',
  WHEEL: '<span class="g mouse">scroll</span>', SPACE: KEY('Space'), Z: KEY('Z'), H: KEY('H'), R: KEY('R'), ESC: KEY('Esc'),
  ARROWS: KEY('←') + KEY('→') + KEY('↑') + KEY('↓'),
};

// tokens like {move} {look} {interact} {undo} {hint} {restart} {pause} {zoom}
function glyphs(text, device) {
  const pad = device === 'pad';
  const map = {
    move: pad ? PAD.LS : `${KB.MOVE} or ${KB.CLICK}`,
    look: pad ? PAD.RS : `${KB.DRAG} or ${KB.ARROWS}`,
    interact: pad ? PAD.X : KB.SPACE,
    undo: pad ? PAD.SQ : KB.Z,
    hint: pad ? PAD.TRI : KB.H,
    restart: pad ? `hold ${PAD.CREATE}` : `hold ${KB.R}`,
    pause: pad ? PAD.OPT : KB.ESC,
    zoom: pad ? `${PAD.L2} ${PAD.R2}` : KB.WHEEL,
    confirm: pad ? PAD.X : KEY('Enter'),
  };
  return text.replace(/\{(\w+)\}/g, (_, k) => map[k] ?? k);
}

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      title: $('#title'), menu: $('#title .menu'), card: $('#card'), prompt: $('#prompt'), toast: $('#toast'),
      hint: $('#hint-arrow'), hud: $('#hud'), pause: $('#pause'), settings: $('#settings'), controls: $('#controls'),
      houses: $('#houses'), ending: $('#ending'), restart: $('#restart-ring'), press: $('#press'),
    };
    this.stack = []; // open menus (for keyboard/pad navigation)
    this.focus = 0;
    this.promptKey = null;
    this.promptText = '';
    this.device = 'kbm';
    this.toastT = 0;
    this.titleStage = 'press';
    this.bindMenus();
  }

  get subMenuOpen() { return this.stack.length > 1; }

  bindMenus() {
    const g = this.game;
    const click = (sel, fn) => document.querySelectorAll(sel).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); audio.init(); audio.uiSelect(); fn(b); }));
    click('[data-act="begin"]', () => g.startGame(g.saveData.finished ? 0 : (g.saveData.unlocked ?? 0)));
    click('[data-act="houses"]', () => this.open('houses'));
    click('[data-act="settings"]', () => this.open('settings'));
    click('[data-act="controls"]', () => this.open('controls'));
    click('[data-act="back"]', () => this.close());
    click('[data-act="resume"]', () => g.pause(false));
    click('[data-act="restart"]', () => g.restartLevel());
    click('[data-act="title"]', () => g.toTitle());
    click('[data-act="again"]', () => { this.el.ending.classList.remove('show'); this.stack = []; g.toTitle(); });
    // settings
    document.querySelectorAll('#settings input').forEach((inp) => {
      const k = inp.dataset.key;
      const s = g.settings;
      if (inp.type === 'checkbox') inp.checked = !!s[k];
      else inp.value = s[k];
      inp.addEventListener('input', () => {
        s[k] = inp.type === 'checkbox' ? inp.checked : parseFloat(inp.value);
        g.applySettings();
      });
    });
    this.el.title.addEventListener('click', () => { if (this.titleStage === 'press') this.titleAdvance(); });
  }

  // ---------------------------------------------------------------- menus
  open(name) {
    const el = this.el[name];
    if (name === 'houses') this.fillHouses();
    el.classList.add('show');
    this.stack.push(name);
    this.focus = 0;
    this.highlight();
  }

  close() {
    const name = this.stack.pop();
    if (name) this.el[name].classList.remove('show');
    audio.uiBack();
    if (name === 'pause') { this.game.pause(false); return; }
    this.focus = 0;
    this.highlight();
    if (!this.stack.length && this.game.state === 'title') this.titleStage = 'menu';
  }

  buttons() {
    const top = this.stack[this.stack.length - 1];
    const el = top ? this.el[top] : this.titleStage === 'menu' ? this.el.title : null;
    if (!el) return [];
    return [...el.querySelectorAll('button:not([disabled]), input')];
  }

  highlight() {
    const bs = this.buttons();
    document.querySelectorAll('.focus').forEach((b) => b.classList.remove('focus'));
    if (!bs.length) return;
    this.focus = (this.focus + bs.length) % bs.length;
    bs[this.focus].classList.add('focus');
  }

  fillHouses() {
    const box = this.el.houses.querySelector('.list');
    box.innerHTML = '';
    LEVELS.forEach((L, i) => {
      const meta = L.meta;
      const b = document.createElement('button');
      const locked = i > (this.game.saveData.unlocked ?? 0);
      b.disabled = locked;
      b.innerHTML = `<span class="no">No. ${meta.number}</span><span class="nm">${locked ? '· · ·' : meta.title}</span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); audio.uiSelect(); this.stack.forEach((n) => this.el[n].classList.remove('show')); this.stack = []; this.el.pause.classList.remove('show'); this.game.startGame(i); });
      box.appendChild(b);
    });
  }

  navigate() {
    const inp = this.game.input;
    const bs = this.buttons();
    if (!bs.length) return;
    if (inp.pressed('up') || inp.pressed('left') && bs[this.focus]?.type !== 'range') { this.keyNav = true; this.focus--; audio.uiMove(); this.highlight(); }
    if (inp.pressed('down') || inp.pressed('right') && bs[this.focus]?.type !== 'range') { this.keyNav = true; this.focus++; audio.uiMove(); this.highlight(); }
    const cur = bs[this.focus];
    if (cur?.type === 'range') {
      const step = parseFloat(cur.step || 0.05);
      if (inp.pressed('left')) { cur.value = parseFloat(cur.value) - step; cur.dispatchEvent(new Event('input')); }
      if (inp.pressed('right')) { cur.value = parseFloat(cur.value) + step; cur.dispatchEvent(new Event('input')); }
    }
    if (inp.pressed('confirm')) {
      if (cur?.type === 'checkbox') { cur.checked = !cur.checked; cur.dispatchEvent(new Event('input')); }
      else cur?.click();
    }
    if (inp.pressed('back') && this.stack.length) this.close();
  }

  // ---------------------------------------------------------------- title
  showTitle() {
    this.el.title.classList.add('show');
    this.el.title.classList.remove('menu-open');
    this.titleStage = 'press';
    const g = this.game;
    const begin = this.el.title.querySelector('[data-act="begin"]');
    const u = g.saveData.unlocked ?? 0;
    begin.textContent = g.saveData.finished ? 'Walk again' : u > 0 ? 'Continue' : 'Begin';
  }

  titleAdvance() {
    audio.init();
    audio.setMood('title', { fade: 2 });
    audio.uiSelect();
    this.titleStage = 'menu';
    this.el.title.classList.add('menu-open');
    this.focus = 0;
    this.highlight();
  }

  hideTitle() {
    this.el.title.classList.remove('show', 'menu-open');
    this.stack.forEach((n) => this.el[n].classList.remove('show'));
    this.stack = [];
    this.titleStage = 'hidden';
  }

  showPause() {
    this.el.pause.classList.add('show');
    this.stack = ['pause'];
    this.focus = 0;
    this.highlight();
  }

  hidePause() {
    this.stack.forEach((n) => this.el[n].classList.remove('show'));
    this.el.pause.classList.remove('show');
    this.stack = [];
  }

  showEnding() {
    this.el.ending.classList.add('show');
    this.stack = ['ending'];
    this.focus = 0;
    this.highlight();
  }

  // ---------------------------------------------------------------- level
  setLevel(L) {
    this.clearPrompts();
    this.el.hud.classList.toggle('undoable', !!L.undoable);
  }

  levelCard(L) {
    const m = L.constructor.meta;
    const c = this.el.card;
    c.querySelector('.no').textContent = `No. ${m.number}`;
    c.querySelector('.nm').textContent = m.title;
    c.querySelector('.qt').textContent = m.quote;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
    clearTimeout(this.cardT);
    this.cardT = setTimeout(() => c.classList.remove('show'), 5200);
  }

  chapterEnd() {
    this.el.card.classList.remove('show');
  }

  prompt(key, text, { sticky = false } = {}) {
    if (this.promptKey === key && this.promptText === text) return;
    this.promptKey = key;
    this.promptText = text;
    this.renderPrompt();
    this.el.prompt.classList.add('show');
  }

  hidePrompt(key = null) {
    if (key && this.promptKey !== key) return;
    this.promptKey = null;
    this.el.prompt.classList.remove('show');
  }

  clearPrompts() { this.hidePrompt(); }

  renderPrompt() {
    if (!this.promptKey) return;
    this.el.prompt.innerHTML = glyphs(this.promptText, this.device);
  }

  toast(text, secs = 3) {
    this.el.toast.innerHTML = glyphs(text, this.device);
    this.el.toast.classList.add('show');
    this.toastT = secs;
  }

  restartProgress(k) {
    this.el.restart.style.setProperty('--k', Math.min(1, k));
    this.el.restart.classList.toggle('show', k > 0.02);
  }

  updateHintArrow(a) {
    const h = this.el.hint;
    if (!a) { h.classList.remove('show'); return; }
    h.classList.add('show');
    // arrow shows which way to swing the view (stick / arrow keys); mouse drags the opposite way
    let x = a.x, y = a.y;
    if (this.device !== 'pad') { x = -x; y = y; }
    const ang = Math.atan2(-y, x);
    h.querySelector('.arrow').style.transform = a.close ? 'scale(0.6)' : `rotate(${ang}rad)`;
    h.querySelector('.lbl').innerHTML = a.close ? 'almost…' : glyphs(this.device === 'pad' ? 'swing the view {look}' : 'drag the view this way', this.device);
  }

  update(dt) {
    const g = this.game;
    const dev = g.input.device;
    if (dev !== this.device) {
      this.device = dev;
      document.body.dataset.device = dev;
      this.renderPrompt();
      this.highlight();
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.el.toast.classList.remove('show');
    }
    // title "press any key"
    if (g.state === 'title' && this.titleStage === 'press' && g.input.pressed('any') && !this.stack.length) {
      this.titleAdvance();
      return;
    }
    if (g.state === 'title' && this.titleStage === 'menu' && g.input.pressed('back') && !this.stack.length) {
      this.titleStage = 'press';
      this.el.title.classList.remove('menu-open');
      return;
    }
    if ((g.state === 'title' && this.titleStage === 'menu') || g.state === 'pause' || g.state === 'ending' || this.stack.length) this.navigate();
  }
}
