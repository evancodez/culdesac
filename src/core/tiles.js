// Walkable surfaces as a graph of unit-square faces.
// Two faces are neighbours when they share an edge, regardless of orientation —
// so a path that bends over a cliff, down a wall and onto the underside of the
// world is just a chain of neighbouring tiles. Each tile carries its own "up"
// (gravity follows the path).
import * as THREE from 'three';

export const WALKABLE = new Set([
  'path', 'sidewalk', 'road', 'porch', 'patio', 'stone', 'mown', 'wood', 'bridge', 'door', 'brick', 'apron',
]);

// how far above the face the character's feet sit
export const LIFT = {
  sidewalk: 0.075, porch: 0.1, patio: 0.06, stone: 0.07, mown: 0.025, road: 0.012,
  path: 0.06, grass: 0.1, wood: 0.1, bridge: 0.012, brick: 0.06, door: 0.1, apron: 0.06,
};

export const SOUND = {
  grass: 'grass', mown: 'mown', sidewalk: 'stone', patio: 'stone', stone: 'stone', path: 'stone',
  porch: 'wood', wood: 'wood', door: 'wood', road: 'road', bridge: 'road', brick: 'stone', apron: 'stone',
};

const _m = new THREE.Matrix4();
let nextId = 1;

function anyPerp(n) {
  const a = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  return a.cross(n).normalize();
}

export class Tile {
  constructor(o) {
    this.id = o.id ?? 't' + nextId++;
    this.kind = o.kind ?? 'grass';
    this.group = o.group ?? null;
    this.lc = o.center.clone();
    this.ln = o.normal.clone().normalize();
    this.lu = (o.up ?? o.normal).clone().normalize();
    const t1 = (o.tangent ?? anyPerp(this.ln)).clone().normalize();
    const t2 = new THREE.Vector3().crossVectors(this.ln, t1).normalize();
    this.lt1 = t1;
    this.lt2 = t2;
    const h1 = t1.clone().multiplyScalar(0.5), h2 = t2.clone().multiplyScalar(0.5);
    this.lcorners = [
      this.lc.clone().sub(h1).sub(h2),
      this.lc.clone().add(h1).sub(h2),
      this.lc.clone().add(h1).add(h2),
      this.lc.clone().sub(h1).add(h2),
    ];
    this.pos = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.corners = this.lcorners.map(() => new THREE.Vector3());
    this.neighbors = [];
    this.active = o.active ?? true;
    this.blocked = o.blocked ?? false; // a prop or obstacle sits on it
    this.occupant = null; // e.g. the mower
    this.data = o.data ?? {};
    this.cell = o.cell ?? null;
    this.face = o.face ?? 'top';
    this.updateWorld();
  }

  get walkable() {
    return this.active && !this.blocked && WALKABLE.has(this.kind);
  }

  get lift() {
    return LIFT[this.kind] ?? 0.02;
  }

  footPos(out = new THREE.Vector3()) {
    return out.copy(this.up).multiplyScalar(this.lift).add(this.pos);
  }

  updateWorld() {
    if (this.group) {
      this.group.updateWorldMatrix(true, false);
      _m.copy(this.group.matrixWorld);
      this.pos.copy(this.lc).applyMatrix4(_m);
      this.normal.copy(this.ln).transformDirection(_m);
      this.up.copy(this.lu).transformDirection(_m);
      for (let i = 0; i < 4; i++) this.corners[i].copy(this.lcorners[i]).applyMatrix4(_m);
    } else {
      this.pos.copy(this.lc);
      this.normal.copy(this.ln);
      this.up.copy(this.lu);
      for (let i = 0; i < 4; i++) this.corners[i].copy(this.lcorners[i]);
    }
  }
}

const key = (v) => `${Math.round(v.x * 50)},${Math.round(v.y * 50)},${Math.round(v.z * 50)}`;

export class TileGraph {
  constructor() {
    this.tiles = [];
    this.byId = new Map();
    this.version = 0;
  }

  add(tile) {
    this.tiles.push(tile);
    this.byId.set(tile.id, tile);
    return tile;
  }

  remove(tile) {
    const i = this.tiles.indexOf(tile);
    if (i >= 0) this.tiles.splice(i, 1);
    this.byId.delete(tile.id);
  }

  get(id) {
    return this.byId.get(id);
  }

  rebuild() {
    const edges = new Map();
    for (const t of this.tiles) {
      t.updateWorld();
      t.neighbors.length = 0;
      if (!t.active) continue;
      const ks = t.corners.map(key);
      for (let i = 0; i < 4; i++) {
        const a = ks[i], b = ks[(i + 1) % 4];
        const ek = a < b ? a + '|' + b : b + '|' + a;
        let list = edges.get(ek);
        if (!list) edges.set(ek, (list = []));
        list.push({ t, i });
      }
    }
    for (const list of edges.values()) {
      if (list.length < 2) continue;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const A = list[i], B = list[j];
          if (A.t === B.t) continue;
          if (A.t.normal.dot(B.t.normal) < -0.5) continue; // back to back
          const mid = A.t.corners[A.i].clone().add(A.t.corners[(A.i + 1) % 4]).multiplyScalar(0.5);
          A.t.neighbors.push({ tile: B.t, mid });
          B.t.neighbors.push({ tile: A.t, mid: mid.clone() });
        }
      }
    }
    // when several faces share an edge (e.g. a docked pillar flush against a pit wall),
    // keep only the most natural continuation per edge: coplanar beats wrapping.
    for (const t of this.tiles) {
      if (t.neighbors.length < 2) continue;
      const byEdge = new Map();
      for (const n of t.neighbors) {
        const k = key(n.mid);
        if (!byEdge.has(k)) byEdge.set(k, []);
        byEdge.get(k).push(n);
      }
      const keep = [];
      for (const group of byEdge.values()) {
        if (group.length === 1) { keep.push(group[0]); continue; }
        const coplanar = group.filter((n) => n.tile.normal.dot(t.normal) > 0.99);
        if (coplanar.length) { keep.push(...coplanar); continue; }
        // prefer walkable wraps, then anything
        const w = group.filter((n) => WALKABLE.has(n.tile.kind));
        keep.push(...(w.length ? w : group));
      }
      t.neighbors = keep;
    }
    this.version++;
  }

  neighbor(t, other) {
    return t.neighbors.find((n) => n.tile === other) ?? null;
  }

  // The tile you reach by leaving `t` in tangent direction `dir` (world vector).
  // Returns { tile, mid, dir } where dir is the continued direction on the new tile.
  step(t, dir, filter = null) {
    const target = t.pos.clone().addScaledVector(dir, 0.5);
    let best = null;
    for (const n of t.neighbors) {
      if (n.mid.distanceToSquared(target) > 0.01) continue;
      if (filter && !filter(n.tile)) continue;
      const coplanar = n.tile.normal.dot(t.normal) > 0.99;
      const score = coplanar ? 2 : 1;
      if (!best || score > best.score) best = { ...n, score };
    }
    if (!best) return null;
    const nd = best.tile.pos.clone().sub(best.mid);
    nd.addScaledVector(best.tile.normal, -nd.dot(best.tile.normal)).normalize();
    return { tile: best.tile, mid: best.mid, dir: nd };
  }

  // breadth-first path over walkable tiles
  path(from, to, canEnter = (t) => t.walkable && !t.occupant) {
    if (from === to) return [from];
    const prev = new Map([[from, null]]);
    const q = [from];
    while (q.length) {
      const cur = q.shift();
      for (const n of cur.neighbors) {
        const nt = n.tile;
        if (prev.has(nt) || !canEnter(nt)) continue;
        prev.set(nt, cur);
        if (nt === to) {
          const out = [nt];
          let p = cur;
          while (p) { out.unshift(p); p = prev.get(p); }
          return out;
        }
        q.push(nt);
      }
    }
    return null;
  }

  reachable(from, canEnter = (t) => t.walkable && !t.occupant) {
    const seen = new Set([from]);
    const q = [from];
    while (q.length) {
      const cur = q.shift();
      for (const n of cur.neighbors) {
        if (seen.has(n.tile) || !canEnter(n.tile)) continue;
        seen.add(n.tile);
        q.push(n.tile);
      }
    }
    return seen;
  }

  // the top-facing tile at grid cell (x, z) closest to height y
  at(x, y, z, face = null) {
    let best = null, bd = 1e9;
    for (const t of this.tiles) {
      if (face && t.face !== face) continue;
      const d = (t.pos.x - x) ** 2 + (t.pos.y - y) ** 2 + (t.pos.z - z) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return bd < 0.05 ? best : null;
  }
}
