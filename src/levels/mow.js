// Lawnmower rules (shared by the level and the offline puzzle solver).
// A kicked mower drives straight until something stops it, mowing every tile
// it crosses. It follows the surface: over a lip and down a wall, across the
// floor of a sunken garden and up the other side.
import * as THREE from 'three';

export const MOWABLE = new Set(['grass', 'mown', 'stone', 'path', 'apron']);

// direction a mower moves when pushed from `from` into `mowerTile`
export function pushDir(graph, from, mowerTile) {
  const nb = graph.neighbor(from, mowerTile);
  if (!nb) return null;
  const d = mowerTile.pos.clone().sub(nb.mid);
  d.addScaledVector(mowerTile.normal, -d.dot(mowerTile.normal));
  if (d.lengthSq() < 1e-6) return null;
  return d.normalize().multiplyScalar(1);
}

// returns [{ tile, mid, dir }] for each tile entered
export function mowerRun(graph, from, dir, blocked = () => false) {
  const out = [];
  let cur = from;
  let d = dir.clone();
  const seen = new Set();
  for (let i = 0; i < 120; i++) {
    const s = graph.step(cur, d);
    if (!s) break;
    const t = s.tile;
    if (!t.active || t.blocked || !MOWABLE.has(t.kind) || blocked(t)) break;
    const key = t.id + ':' + Math.round(s.dir.x) + ',' + Math.round(s.dir.y) + ',' + Math.round(s.dir.z);
    if (seen.has(key)) break;
    seen.add(key);
    out.push(s);
    cur = t;
    d = s.dir;
  }
  return out;
}
