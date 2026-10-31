// Layout of No. 5 — Night Mow: a slab of lawn with grass on every face.
// The mower drives over any edge and keeps going on the far face, so a kick can
// wrap all the way around the world and come back. TOP is seen from above;
// UNDER uses the same x/z cells, seen from below. x = 0..7, z = 0..5.
//   .  tall grass   S start (patio)   P patio   M mower   s stone
//   G gnome  B birdbath  F flamingo  T tree   (obstacles)
//   A garage apron (goal, underside)   H garage block (underside)
//   (space) void: the slab is two halves; the floating lawn strip docks in the slot at x = 3
export const TOP5 = [
  'SP. ..B.',
  'PM. ...F',
  's.. ....',
  '.G. .sss',
  '... ....',
  '... ...s',
];
export const UNDER5 = [
  '... ....',
  '..B ....',
  '... ....',
  '... HA.s',
  '... ....',
  '... ..FT',
];
export const STRIP5 = [{ x: 3, z: 2 }, { x: 3, z: 3 }];
export const BOTTOM5 = -2;

const OBST = { G: 'gnome', B: 'birdbath', F: 'flamingo', T: 'tree', H: 'garage' };

function cellKind(ch) {
  if (ch === 'S' || ch === 'P') return 'patio';
  if (ch === 's') return 'stone';
  if (ch === 'M') return 'mown';
  if (ch === 'A') return 'apron';
  return 'grass';
}

export function cells5(top = TOP5, under = UNDER5) {
  const out = [];
  for (let z = 0; z < top.length; z++) {
    for (let x = 0; x < top[z].length; x++) {
      const t = top[z][x], u = under[z][x];
      if (t === ' ') continue;
      out.push({ x, z, t, u, top: cellKind(t), under: cellKind(u), tObs: OBST[t] ?? null, uObs: OBST[u] ?? null });
    }
  }
  return out;
}

export function fillTerrain5(T, top = TOP5, under = UNDER5) {
  const cs = cells5(top, under);
  for (const c of cs) {
    T.fill(c.x, c.x, c.z, c.z, {
      top: 0, bottom: BOTTOM5, kind: c.top, under: c.under, outerWall: 'grass',
      blocked: !!c.tObs, underBlocked: !!c.uObs, data: { ch: c.t }, underData: { ch: c.u },
    });
  }
  return cs;
}

export function fillStrip5(T) {
  for (const { x, z } of STRIP5) T.fill(x, x, z, z, { top: 0, bottom: BOTTOM5, kind: 'grass', under: 'grass', outerWall: 'grass' });
}

export function find5(grid, ch) {
  for (let z = 0; z < grid.length; z++) for (let x = 0; x < grid[z].length; x++) if (grid[z][x] === ch) return { x, z };
  return null;
}
