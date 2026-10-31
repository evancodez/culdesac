// Offline solver / generator for No. 2 (Mow Day).
//   node tools/solve2.mjs            solve the shipped MAP2 and print the solution
//   node tools/solve2.mjs search N   random-search N layouts and print the best
import { Terrain } from '../src/core/terrain.js';
import { TileGraph } from '../src/core/tiles.js';
import { MAP2, fillTerrain, fillBridge, findChar } from '../src/levels/level2map.js';
import { mowerRun, pushDir, MOWABLE } from '../src/levels/mow.js';

function buildGraph(rows, docked = true) {
  const graph = new TileGraph();
  const T = new Terrain({ tileMinY: -6 });
  fillTerrain(T, rows);
  T.build({ graph, meshes: false });
  if (docked) {
    const B = new Terrain({ tileMinY: -6 });
    fillBridge(B);
    B.build({ graph, meshes: false });
  }
  graph.rebuild();
  return graph;
}

const name = (t) => !t ? 'garage' : `${t.face}(${Math.round(t.pos.x * 2) / 2},${Math.round(t.pos.y * 2) / 2},${Math.round(t.pos.z * 2) / 2})`;

export function solve(rows, { maxKicks = 12, docked = true } = {}) {
  const graph = buildGraph(rows, docked);
  const tiles = graph.tiles;
  const idx = new Map(tiles.map((t, i) => [t, i]));
  const grassIdx = new Map();
  tiles.forEach((t) => { if (t.kind === 'grass') grassIdx.set(t, grassIdx.size); });
  const S = findChar(rows, 'S')[0], M = findChar(rows, 'M')[0], D = findChar(rows, 'A')[0];
  const start = graph.at(S.x, 0, S.z, 'top');
  const mower0 = graph.at(M.x, 0, M.z, 'top');
  const goal = graph.at(D.x, 0, D.z, 'top');
  const walk = (t, mown, m) => t !== m && t.active && !t.blocked && (t.walkable || (t.kind === 'grass' && (mown >> BigInt(grassIdx.get(t))) & 1n));
  const region = (p, mown, m) => {
    const seen = new Set([p]);
    const q = [p];
    while (q.length) {
      const c = q.shift();
      for (const n of c.neighbors) if (!seen.has(n.tile) && walk(n.tile, mown, m)) { seen.add(n.tile); q.push(n.tile); }
    }
    return seen;
  };
  const rep = (R) => { let b = Infinity; for (const t of R) b = Math.min(b, idx.get(t)); return b; };
  const key = (m, mown, R) => `${m ? idx.get(m) : 'x'}|${mown.toString(36)}|${rep(R)}`;
  const R0 = region(start, 0n, mower0);
  const startState = { m: mower0, mown: 0n, p: start, R: R0, prev: null, move: null, depth: 0 };
  const seen = new Set([key(mower0, 0n, R0)]);
  let frontier = [startState];
  let statesAtDepth = [1];
  for (let depth = 0; depth <= maxKicks; depth++) {
    const next = [];
    for (const s of frontier) {
      if (!s.m && s.R.has(goal)) return { solution: s, graph, states: seen.size, statesAtDepth };
      if (!s.m) continue;
      for (const q of s.R) {
        for (const n of q.neighbors) {
          if (n.tile !== s.m) continue;
          const dir = pushDir(graph, q, s.m);
          if (!dir) continue;
          const path = mowerRun(graph, s.m, dir, (t) => t === q);
          if (!path.length) continue;
          let mown = s.mown;
          for (const st of path) if (grassIdx.has(st.tile)) mown |= 1n << BigInt(grassIdx.get(st.tile));
          if (grassIdx.has(s.m)) mown |= 1n << BigInt(grassIdx.get(s.m));
          let nm = path[path.length - 1].tile;
          if (nm.kind === 'apron') nm = null;
          const R = region(q, mown, nm);
          const k = key(nm, mown, R);
          if (seen.has(k)) continue;
          seen.add(k);
          const walls = path.filter((st) => st.tile.face === 'wall').length;
          next.push({ m: nm, mown, p: q, R, prev: s, move: { from: q, to: nm, len: path.length, walls }, depth: depth + 1 });
        }
      }
    }
    statesAtDepth.push(next.length);
    frontier = next;
    if (!frontier.length) break;
  }
  return { solution: null, graph, states: seen.size, statesAtDepth };
}

function describe(res) {
  const out = [];
  let s = res.solution;
  while (s && s.move) { out.unshift(s.move); s = s.prev; }
  return out.map((m, i) => `  kick ${i + 1}: stand ${name(m.from)} -> mower stops ${name(m.to)} (${m.len} tiles${m.walls ? `, ${m.walls} on walls` : ''})`).join('\n');
}

function randomLayout(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rows = MAP2.map((row) => row.split(''));
  const set = (x, z, ch) => { rows[z + 5][x] = ch; };
  const get = (x, z) => rows[z + 5]?.[x];
  // mower next to the patio
  const mc = [[2, 9], [1, 8], [0, 7], [2, 8]][Math.floor(r() * 4)];
  set(mc[0], mc[1], 'M');
  const nObs = 3 + Math.floor(r() * 6);
  const kinds = ['G', 'B', 'F', 'T', 'f'];
  for (let i = 0; i < nObs; i++) {
    const x = Math.floor(r() * 10), z = Math.floor(r() * 10);
    if (get(x, z) !== '.') continue;
    set(x, z, kinds[Math.floor(r() * kinds.length)]);
  }
  if (r() < 0.6) {
    const x = 3 + Math.floor(r() * 4), z = 3 + Math.floor(r() * 4);
    set(x, z, 'b');
  }
  const nStones = 3 + Math.floor(r() * 7);
  for (let i = 0; i < nStones; i++) {
    const x = Math.floor(r() * 10), z = Math.floor(r() * 10);
    if (get(x, z) === '.') set(x, z, 's');
  }
  return rows.map((row) => row.join(''));
}

const [, , cmd, arg] = process.argv;
const isMain = process.argv[1] && import.meta.url.endsWith('/solve2.mjs') && process.argv[1].endsWith('solve2.mjs');
if (!isMain) {
  // imported
} else if (cmd === 'search') {
  const N = parseInt(arg ?? '300', 10);
  const results = [];
  for (let i = 0; i < N; i++) {
    const rows = randomLayout(1000 + i);
    const res = solve(rows, { maxKicks: 10 });
    if (!res.solution) continue;
    const moves = [];
    let s = res.solution;
    while (s && s.move) { moves.unshift(s.move); s = s.prev; }
    const k = moves.length;
    const wallKicks = moves.filter((m) => m.walls > 0).length;
    // does the undocked bridge change anything? (always needed: goal is across the gap)
    const score = k * 2 + wallKicks * 2 + (moves[moves.length - 1].walls > 0 ? 1 : 0) - (res.statesAtDepth[1] <= 1 ? 2 : 0);
    results.push({ seed: 1000 + i, rows, k, wallKicks, score, res, moves });
  }
  results.sort((a, b) => b.score - a.score);
  for (const r of results.slice(0, 6)) {
    console.log(`seed ${r.seed}: kicks=${r.k} wallKicks=${r.wallKicks} score=${r.score} states=${r.res.states} branching=${r.res.statesAtDepth.slice(0, 4).join(',')}`);
    console.log(r.rows.map((x) => '    ' + JSON.stringify(x) + ',').join('\n'));
    console.log(describe(r.res));
    console.log();
  }
  console.log(`${results.length}/${N} solvable`);
} else {
  const res = solve(MAP2, { maxKicks: 14 });
  if (!res.solution) { console.log('UNSOLVABLE', res.states, 'states'); process.exit(1); }
  console.log(`solved in ${res.solution.depth} kicks (${res.states} states, branching ${res.statesAtDepth.join(',')})`);
  console.log(describe(res));
  const und = solve(MAP2, { maxKicks: 14, docked: false });
  console.log(und.solution ? 'WARNING: solvable without docking the lawn strip' : 'needs the lawn strip docked: ok');
}
