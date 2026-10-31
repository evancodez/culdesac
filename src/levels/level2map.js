// Layout of No. 2 — Mow Day, shared by the level and tools/solve2.mjs.
// Rows run north (z = -5) to south (z = 9); columns are x = 0..9.
//   .  tall grass            _  sunken-garden floor (tall grass, y = -2)
//   P  patio (start area)    S  start (patio)        s  stepping stone
//   M  mower (on mown grass) m  mown grass
//   G gnome  B birdbath  F flamingo  T tree  f flower bed   (obstacles on grass)
//   b  birdbath on the sunken floor
//   H  house  A  garage apron: the mower parks itself in the garage from here (goal)
//   (space) void.   The floating lawn strip docks at x = 6, z = -2..-1.
export const MAP2 = [
  '    HHHHH ', // -5
  '    HHHHH ', // -4
  '    TfAfT ', // -3
  '          ', // -2
  '          ', // -1
  '..........', // 0
  '..........', // 1
  '.T.....ss.', // 2
  's..____..F', // 3
  's..____...', // 4
  '...____...', // 5
  '...____...', // 6
  '.........s', // 7
  'PM...G...s', // 8
  'SP....ssB.', // 9
];
export const Z0 = -5;
export const BRIDGE = { x: 6, z0: -2, z1: -1 };

export const OBSTACLE = { G: 'gnome', B: 'birdbath', F: 'flamingo', T: 'tree', f: 'flowers', b: 'birdbath' };

export function parseMap(rows) {
  const cells = [];
  rows.forEach((row, j) => {
    const z = Z0 + j;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ' ') continue;
      const c = { x, z, ch, top: 0, kind: 'grass', obstacle: null };
      if (ch === '_' || ch === 'b') c.top = -2;
      if (ch === 'P' || ch === 'S') c.kind = 'patio';
      if (ch === 's') c.kind = 'stone';
      if (ch === 'm' || ch === 'M') c.kind = 'mown';
      if (ch === 'A') c.kind = 'apron';
      if (ch === 'H') { c.kind = 'grass'; c.house = true; }
      if (OBSTACLE[ch]) c.obstacle = OBSTACLE[ch];
      cells.push(c);
    }
  });
  return cells;
}

export function findChar(rows, ch) {
  const out = [];
  rows.forEach((row, j) => {
    for (let x = 0; x < row.length; x++) if (row[x] === ch) out.push({ x, z: Z0 + j });
  });
  return out;
}

// fill a Terrain with the layout; returns cells
export function fillTerrain(T, rows) {
  const cells = parseMap(rows);
  for (const c of cells) {
    T.fill(c.x, c.x, c.z, c.z, {
      top: c.top, bottom: c.z <= -3 ? -3.5 : -4.5, kind: c.kind,
      blocked: !!c.obstacle || !!c.house, data: { ch: c.ch },
    });
  }
  return cells;
}

export function fillBridge(T) {
  T.fill(BRIDGE.x, BRIDGE.x, BRIDGE.z0, BRIDGE.z1, { top: 0, bottom: -1.2, kind: 'grass' });
}
