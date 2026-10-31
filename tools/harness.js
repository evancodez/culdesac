// Dev-only test helpers: in the console, `await import('/tools/harness.js')`, then use window.T.
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = {
  get g() { return window.__game; },
  at(x, y, z, f = 'top') { return this.g.graph.at(x, y, z, f); },
  go(x, y, z, f = 'top') {
    const g = this.g;
    const t = this.at(x, y, z, f);
    if (!t) return 'no tile';
    const p = g.graph.path(g.player.tile, t, (q) => q.walkable && !q.occupant);
    if (!p) return 'no path';
    g.walkQueue = p.slice(1);
    return 'walking ' + (p.length - 1);
  },
  quiet() {
    const g = this.g;
    return !g.director.locking && !g.director.busy && !g.player.busy && !g.walkQueue.length && !g.level.busy && !g.rig.anim;
  },
  async idle(max = 12000) {
    const t0 = performance.now();
    while (performance.now() - t0 < max) { if (this.quiet()) return true; await sleep(100); }
    return false;
  },
  look(yaw, pitch) { this.g.rig.set({ yaw, pitch }); return 'ok'; },
  // push the mower from the tile at (fx,fy,fz) into the neighbour at (x,y,z)
  kick(fx, fy, fz, x, y, z, ff = 'top', f = 'top') {
    const g = this.g;
    const from = this.at(fx, fy, fz, ff), to = this.at(x, y, z, f);
    if (g.player.tile !== from) return 'not standing there: ' + this.where();
    const nb = g.graph.neighbor(from, to);
    if (!nb) return 'not adjacent';
    g.tryStep(to, nb.mid);
    return 'kicked';
  },
  where() { const t = this.g.player.tile; return t ? `${t.face} ${t.pos.x.toFixed(1)},${t.pos.y.toFixed(1)},${t.pos.z.toFixed(1)}` : 'none'; },
  sets() { return this.g.director.sets.map((s) => s.id + ':' + s.state + (s.animating ? '*' : '')).join(' '); },
  status() { const g = this.g; return JSON.stringify({ where: this.where(), sets: this.sets(), state: g.state, level: g.levelIndex, t: +g.time.toFixed(1) }); },
};
window.T = T;
window.sleep = sleep;
export default T;
