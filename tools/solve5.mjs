// Solver / generator for No. 5 (Night Mow).
//   node tools/solve5.mjs            solve the shipped layout
//   node tools/solve5.mjs search N   random-search layouts
import { Terrain } from '../src/core/terrain.js';
import { TileGraph } from '../src/core/tiles.js';
import { TOP5, UNDER5, BOTTOM5, fillTerrain5, fillStrip5, find5 } from '../src/levels/level5map.js';
import { mowerRun, pushDir } from '../src/levels/mow.js';

export function build5(top, under, docked) {
  const graph = new TileGraph();
  const T = new Terrain({ tileMinY: -9 });
  fillTerrain5(T, top, under);
  T.build({ graph, meshes: false });
  if (docked) { const S = new Terrain({ tileMinY: -9 }); fillStrip5(S); S.build({ graph, meshes: false }); }
  graph.rebuild();
  return graph;
}

export function solve5(top = TOP5, under = UNDER5, { maxKicks = 12, docked = true } = {}) {
  const graph = build5(top, under, docked);
  const tiles = graph.tiles;
  const idx = new Map(tiles.map((t, i) => [t, i]));
  const gi = new Map();
  tiles.forEach((t) => { if (t.kind === 'grass') gi.set(t, gi.size); });
  const S = find5(top, 'S'), M = find5(top, 'M'), A = find5(under, 'A');
  const start = graph.at(S.x, 0, S.z, 'top');
  const m0 = graph.at(M.x, 0, M.z, 'top');
  const goal = graph.at(A.x, BOTTOM5, A.z, 'under');
  const walk = (t, mown, m) => t !== m && t.active && !t.blocked && (t.walkable || (t.kind === 'grass' && (mown >> BigInt(gi.get(t))) & 1n));
  const region = (p, mown, m) => {
    const seen = new Set([p]); const q = [p];
    while (q.length) { const c = q.shift(); for (const n of c.neighbors) if (!seen.has(n.tile) && walk(n.tile, mown, m)) { seen.add(n.tile); q.push(n.tile); } }
    return seen;
  };
  const rep = (R) => { let b = Infinity; for (const t of R) b = Math.min(b, idx.get(t)); return b; };
  const key = (m, mown, R) => `${m ? idx.get(m) : 'x'}|${mown.toString(36)}|${rep(R)}`;
  const R0 = region(start, 0n, m0);
  const seen = new Set([key(m0, 0n, R0)]);
  let frontier = [{ m: m0, mown: 0n, R: R0, prev: null, move: null, depth: 0 }];
  const per = [1];
  for (let d = 0; d <= maxKicks; d++) {
    const next = [];
    for (const s of frontier) {
      if (!s.m && s.R.has(goal)) return { solution: s, states: seen.size, per };
      if (!s.m) continue;
      for (const q of s.R) for (const n of q.neighbors) {
        if (n.tile !== s.m) continue;
        const dir = pushDir(graph, q, s.m);
        if (!dir) continue;
        const path = mowerRun(graph, s.m, dir, (t) => t === q);
        if (!path.length) continue;
        let mown = s.mown;
        for (const st of [{ tile: s.m }, ...path]) if (gi.has(st.tile)) mown |= 1n << BigInt(gi.get(st.tile));
        let nm = path[path.length - 1].tile;
        if (nm.kind === 'apron') nm = null;
        const R = region(q, mown, nm);
        const k = key(nm, mown, R);
        if (seen.has(k)) continue;
        seen.add(k);
        const wraps = path.filter((st, i) => i > 0 && st.tile.face !== path[i - 1].tile.face).length;
        next.push({ m: nm, mown, R, prev: s, move: { from: q, to: nm, len: path.length, wraps }, depth: d + 1 });
      }
    }
    per.push(next.length);
    frontier = next;
    if (!frontier.length) break;
  }
  return { solution: null, states: seen.size, per };
}

export function moves(res) {
  const out = []; let s = res.solution;
  while (s && s.move) { out.unshift(s.move); s = s.prev; }
  return out;
}
const nm = (t) => (!t ? 'GARAGE' : `${t.face}(${t.pos.x},${t.pos.y},${t.pos.z})`);

function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function randomLayout(seed) {
  const r = rnd(seed);
  const top = TOP5.map((row) => row.replace(/[GBFTs]/g, '.').split(''));
  const under = UNDER5.map((row) => row.replace(/[GBFTsHA]/g, '.').split(''));
  const zr = 2 + Math.floor(r() * 2), ax = 5 + Math.floor(r() * 2);
  under[zr][ax] = 'A'; under[zr][ax - 1] = 'H';
  const put = (g, n, chars) => { for (let i = 0; i < n; i++) { const x = Math.floor(r() * 8), z = Math.floor(r() * 6); if (g[z][x] === '.') g[z][x] = chars[Math.floor(r() * chars.length)]; } };
  put(top, 2 + Math.floor(r() * 4), 'GBFT');
  put(under, 2 + Math.floor(r() * 4), 'GBFT');
  put(top, 2 + Math.floor(r() * 5), 's');
  put(under, 1 + Math.floor(r() * 4), 's');
  return { top: top.map((x) => x.join('')), under: under.map((x) => x.join('')) };
}

const isMain = process.argv[1]?.endsWith('solve5.mjs');
if (isMain) {
  const [, , cmd, arg] = process.argv;
  if (cmd === 'search') {
    const res = []; let solvable = 0;
    for (let i = 0; i < parseInt(arg ?? '300', 10); i++) {
      const L = randomLayout(5000 + i);
      const r = solve5(L.top, L.under, { maxKicks: 10 });
      if (!r.solution) continue;
      const mv = moves(r);
      solvable++;
      if (solve5(L.top, L.under, { maxKicks: 10, docked: false }).solution) continue; // strip must matter
      const wraps = mv.reduce((a, m) => a + (m.wraps > 0 ? 1 : 0), 0);
      res.push({ seed: 5000 + i, L, k: mv.length, wraps, score: mv.length * 2 + wraps * 2 + (r.per[1] > 2 ? 1 : 0), mv, r });
    }
    res.sort((a, b) => b.score - a.score);
    for (const x of res.slice(0, 4)) {
      console.log(`seed ${x.seed} kicks=${x.k} wrapKicks=${x.wraps} states=${x.r.states} per=${x.r.per.slice(0, 5)}`);
      console.log('TOP  ', JSON.stringify(x.L.top));
      console.log('UNDER', JSON.stringify(x.L.under));
      x.mv.forEach((m, i) => console.log(`  kick ${i + 1}: ${nm(m.from)} -> ${nm(m.to)} len ${m.len} wraps ${m.wraps}`));
    }
    console.log(res.length, 'good layouts of', solvable, 'solvable');
  } else {
    const r = solve5();
    if (!r.solution) { console.log('UNSOLVABLE', r.states); process.exit(1); }
    console.log(`solved in ${r.solution.depth} kicks (${r.states} states, per depth ${r.per.join(',')})`);
    moves(r).forEach((m, i) => console.log(`  kick ${i + 1}: stand ${nm(m.from)} -> mower stops ${nm(m.to)} (${m.len} tiles, ${m.wraps} edge wraps)`));
    console.log(solve5(TOP5, UNDER5, { docked: false }).solution ? 'WARNING: strip not needed' : 'needs the floating strip: ok');
  }
}
