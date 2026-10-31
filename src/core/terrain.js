// Grid terrain: columns of earth on an integer grid. Each cell has a top height,
// a bottom height and surface kinds. build() turns it into tiles (top faces,
// side walls, undersides) and merged meshes (velvet shell grass, strata earth,
// sidewalk slabs, roads, porches...).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Tile } from './tiles.js';
import {
  grassMaterial, strataMaterial, texturedMaterial, lit,
  roadTexture, sidewalkTexture, plankTexture, brickTexture, stoneTexture,
} from './materials.js';

const DIRS = [
  { name: 'e', dx: 1, dz: 0 },
  { name: 'w', dx: -1, dz: 0 },
  { name: 's', dx: 0, dz: 1 },
  { name: 'n', dx: 0, dz: -1 },
];

class QuadBatch {
  constructor(withCut = false) {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.cut = withCut ? [] : null;
    this.idx = [];
    this.count = 0;
  }
  // corners in CCW order seen from the normal side
  quad(c, n, uvs = null, cut = 0) {
    const base = this.count;
    for (let i = 0; i < 4; i++) {
      this.pos.push(c[i].x, c[i].y, c[i].z);
      this.nrm.push(n.x, n.y, n.z);
      const u = uvs ? uvs[i] : [i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0];
      this.uv.push(u[0], u[1]);
      if (this.cut) this.cut.push(cut);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.count += 4;
    return base;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.cut) g.setAttribute('aCut', new THREE.Float32BufferAttribute(this.cut, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// order a tile's corners counter-clockwise when viewed from its normal
function ccw(tile) {
  const c = tile.lcorners;
  const e1 = c[1].clone().sub(c[0]);
  const e2 = c[2].clone().sub(c[0]);
  const n = e1.cross(e2);
  return n.dot(tile.ln) >= 0 ? [c[0], c[1], c[2], c[3]] : [c[0], c[3], c[2], c[1]];
}

export class Terrain {
  constructor(opts = {}) {
    this.cells = new Map();
    this.grass = opts.grass ?? {};
    this.tileMinY = opts.tileMinY ?? -5; // walls below this become plain mist quads, no tiles
    this.shells = opts.shells ?? 14;
    this.roadStyle = opts.roadStyle ?? 'yellow';
    this.opartUnder = opts.opartUnder ?? false;
    this.tiles = [];
    this.meshes = [];
    this.grassMesh = null;
  }

  k(x, z) { return x + ',' + z; }
  get(x, z) { return this.cells.get(this.k(x, z)); }

  fill(x0, x1, z0, z1, props) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        this.cells.set(this.k(x, z), { x, z, top: 0, bottom: -4, kind: 'grass', ...props });
    return this;
  }

  paint(x0, x1, z0, z1, props) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
        const c = this.get(x, z);
        if (c) Object.assign(c, typeof props === 'function' ? props(c) : props);
      }
    return this;
  }

  carve(x0, x1, z0, z1) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.cells.delete(this.k(x, z));
    return this;
  }

  // ---------------------------------------------------------------------------
  build({ graph = null, parent = null, group = null, opart = null, castShadow = true, meshes = true }) {
    const tiles = [];
    const mk = (o) => {
      const t = new Tile({ ...o, group });
      t.terrain = this;
      tiles.push(t);
      if (graph) graph.add(t);
      return t;
    };
    const deep = []; // {corners, normal, kind}

    for (const c of this.cells.values()) {
      // top
      if (c.kind !== 'none') {
        mk({
          center: new THREE.Vector3(c.x, c.top, c.z),
          normal: new THREE.Vector3(0, 1, 0),
          tangent: new THREE.Vector3(1, 0, 0),
          kind: c.kind, data: { road: c.road, ...(c.data ?? {}) }, cell: c, face: 'top',
          blocked: !!c.blocked,
        });
      }
      // underside
      if (c.under) {
        mk({
          center: new THREE.Vector3(c.x, c.bottom, c.z),
          normal: new THREE.Vector3(0, -1, 0),
          tangent: new THREE.Vector3(1, 0, 0),
          kind: c.under, data: { road: c.underRoad, ...(c.underData ?? {}) }, cell: c, face: 'under',
          blocked: !!c.underBlocked,
        });
      }
      // walls
      for (const d of DIRS) {
        const n = this.get(c.x + d.dx, c.z + d.dz);
        const segs = [];
        if (!n) segs.push([c.bottom, c.top, 'outer']);
        else {
          if (n.top < c.top) segs.push([Math.max(n.top, c.bottom), c.top, 'inner']);
          if (n.bottom > c.bottom) segs.push([c.bottom, Math.min(n.bottom, c.top), 'under']);
        }
        const nrm = new THREE.Vector3(d.dx, 0, d.dz);
        for (const [y0, y1, where] of segs) {
          if (y1 <= y0) continue;
          let kind = where === 'inner' ? c.innerWall ?? 'grass' : c.outerWall ?? 'soil';
          if (c.walls && c.walls[d.name]) kind = c.walls[d.name];
          // unit tiles for the upper part, one tall quad for the deep part
          const tileFloor = Math.max(y0, this.tileMinY);
          for (let y = y1; y - 1 >= tileFloor - 1e-6; y--) {
            mk({
              center: new THREE.Vector3(c.x + d.dx * 0.5, y - 0.5, c.z + d.dz * 0.5),
              normal: nrm, tangent: new THREE.Vector3(0, 1, 0), kind, cell: c, face: 'wall',
              data: { dir: d.name },
            });
          }
          const count = tileFloor <= y1 ? Math.floor(y1 - tileFloor + 1e-6) : 0;
          const dt = y1 - count; // bottom of the lowest unit tile (or the top if none)
          if (dt > y0) {
            const px = c.x + d.dx * 0.5, pz = c.z + d.dz * 0.5;
            const side = new THREE.Vector3(-d.dz, 0, d.dx).multiplyScalar(0.5);
            deep.push({
              kind,
              normal: nrm,
              corners: [
                new THREE.Vector3(px, y0, pz).sub(side),
                new THREE.Vector3(px, y0, pz).add(side),
                new THREE.Vector3(px, dt, pz).add(side),
                new THREE.Vector3(px, dt, pz).sub(side),
              ],
            });
          }
        }
      }
    }
    this.tiles.push(...tiles);
    if (meshes) this.buildMeshes(tiles, deep, parent, opart, castShadow);
    return tiles;
  }

  buildMeshes(tiles, deep, parent, opart, castShadow) {
    // underside: lawns and walls swirl; walkable paving stays plain so the way stays readable
    const PLAIN = new Set(['road', 'sidewalk', 'porch', 'path', 'apron', 'bridge']);
    const isOp = (t) => (opart ? opart(t) : this.opartUnder && t.face === 'under' && !PLAIN.has(t.kind));
    const buckets = new Map();
    const bucket = (name, withCut = false) => {
      if (!buckets.has(name)) buckets.set(name, new QuadBatch(withCut));
      return buckets.get(name);
    };
    const boxes = new Map(); // material key -> geometries
    const addBox = (name, tile, w, h, d, inset = 0) => {
      // box sitting on the tile, oriented by the tile frame
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Matrix4().makeBasis(tile.lt1, tile.ln, tile.lt1.clone().cross(tile.ln));
      m.setPosition(tile.lc.clone().addScaledVector(tile.ln, h / 2 + inset));
      g.applyMatrix4(m);
      // world-ish uvs for top face so textures tile nicely
      const uv = g.getAttribute('uv');
      const pos = g.getAttribute('position');
      for (let i = 0; i < uv.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(pos, i);
        uv.setXY(i, p.x * 0.5 + p.y * 0.5, p.z * 0.5 + p.y * 0.25);
      }
      if (!boxes.has(name)) boxes.set(name, []);
      boxes.get(name).push(g);
    };

    for (const t of tiles) {
      const op = isOp(t) ? ':op' : '';
      const c = ccw(t);
      switch (t.kind) {
        case 'grass':
        case 'mown': {
          const b = bucket('grass' + op, true);
          t.data.grassBatch = 'grass' + op;
          t.data.grassVert = b.quad(c, t.ln, null, t.kind === 'mown' ? 1 : 0);
          break;
        }
        case 'stone': {
          const b = bucket('grass' + op, true);
          t.data.grassBatch = 'grass' + op;
          t.data.grassVert = b.quad(c, t.ln, null, 1);
          const g = new THREE.CylinderGeometry(0.36, 0.4, 0.07, 18);
          const m = new THREE.Matrix4().makeBasis(t.lt1, t.ln, t.lt1.clone().cross(t.ln));
          m.setPosition(t.lc.clone().addScaledVector(t.ln, 0.035));
          g.applyMatrix4(m);
          const name = 'stone' + op;
          if (!boxes.has(name)) boxes.set(name, []);
          boxes.get(name).push(g);
          break;
        }
        case 'soil':
          bucket('soil' + op).quad(c, t.ln);
          break;
        case 'sidewalk':
          bucket('seam' + op).quad(c, t.ln);
          addBox('sidewalk' + op, t, 0.95, 0.075, 0.95);
          break;
        case 'path':
          bucket('seam' + op).quad(c, t.ln);
          addBox('path' + op, t, 0.92, 0.06, 0.92);
          break;
        case 'apron':
          bucket('seam' + op).quad(c, t.ln);
          addBox('sidewalk' + op, t, 0.98, 0.06, 0.98);
          break;
        case 'porch':
        case 'wood':
        case 'door':
          addBox('porch' + op, t, 1.0, 0.1, 1.0, -0.0);
          break;
        case 'patio':
        case 'brick':
          addBox('brick' + op, t, 1.0, 0.06, 1.0);
          break;
        case 'road':
        case 'bridge': {
          const r = t.data.road ?? {};
          const style = r.style ?? this.roadStyle;
          const name = `road:${style}:${r.a ?? ''}:${r.b ?? ''}${op}`;
          const A = new THREE.Vector3(...(r.axis ?? [1, 0, 0])).normalize();
          const B = new THREE.Vector3().crossVectors(t.ln, A);
          const uvs = c.map((p) => {
            const d = p.clone().sub(t.lc);
            return [0.5 + d.dot(A), 0.5 + d.dot(B)];
          });
          const lifted = c.map((p) => p.clone().addScaledVector(t.ln, 0.01));
          bucket(name).quad(lifted, t.ln, uvs);
          break;
        }
        default:
          bucket('soil' + op).quad(c, t.ln);
      }
    }
    for (const d of deep) {
      const c = d.corners;
      const n = c[1].clone().sub(c[0]).cross(c[2].clone().sub(c[0]));
      const cc = n.dot(d.normal) >= 0 ? c : [c[0], c[3], c[2], c[1]];
      bucket(d.kind === 'grass' ? 'deepgrass' : 'soil').quad(cc, d.normal);
    }

    const add = (mesh, shadow = true) => {
      mesh.castShadow = castShadow && shadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };

    for (const [name, b] of buckets) {
      const op = name.endsWith(':op');
      const base = name.replace(':op', '');
      const geo = b.geometry();
      if (base === 'grass') {
        const mat = grassMaterial(this.grass, { opart: op });
        // base layer (opaque, casts shadow)
        const baseGeo = geo.clone();
        baseGeo.setAttribute('aCut', geo.getAttribute('aCut'));
        baseGeo.setAttribute('aShell', new THREE.Float32BufferAttribute(new Float32Array(b.count), 1));
        const baseMesh = add(new THREE.Mesh(baseGeo, mat));
        // shells
        const n = this.shells;
        const shellGeo = new THREE.InstancedBufferGeometry();
        shellGeo.index = geo.index;
        for (const a of ['position', 'normal', 'uv']) shellGeo.setAttribute(a, geo.getAttribute(a));
        shellGeo.setAttribute('aCut', geo.getAttribute('aCut'));
        const sh = new Float32Array(n);
        for (let i = 0; i < n; i++) sh[i] = (i + 1) / n;
        shellGeo.setAttribute('aShell', new THREE.InstancedBufferAttribute(sh, 1));
        shellGeo.instanceCount = n;
        shellGeo.boundingSphere = geo.boundingSphere.clone();
        shellGeo.boundingSphere.radius += 1;
        const shells = new THREE.Mesh(shellGeo, mat);
        shells.castShadow = false;
        shells.receiveShadow = true;
        parent.add(shells);
        this.meshes.push(shells);
        const entry = { geo, cut: geo.getAttribute('aCut'), mat, base: baseMesh, shells };
        this.grassBatches = this.grassBatches ?? {};
        this.grassBatches[name] = entry;
        if (!op) this.grassMesh = entry;
      } else if (base === 'deepgrass') {
        add(new THREE.Mesh(geo, lit('#1f3d27')), false);
      } else if (base === 'soil') {
        add(new THREE.Mesh(geo, strataMaterial({ opart: op })));
      } else if (base === 'seam') {
        add(new THREE.Mesh(geo, lit('#8f7c74', { opart: op, opMode: 2 })));
      } else if (base.startsWith('road')) {
        const [, style, a, bb] = base.split(':');
        const tex = roadTexture(style, a || null, bb || null);
        add(new THREE.Mesh(geo, texturedMaterial(tex, { opart: op, opMode: 3, roughness: 0.95 })));
      }
    }
    for (const [name, geos] of boxes) {
      const op = name.endsWith(':op');
      const base = name.replace(':op', '');
      const geo = mergeGeometries(geos);
      let mat;
      if (base === 'sidewalk') mat = texturedMaterial(sidewalkTexture(), { opart: op, opMode: 2 });
      else if (base === 'path') mat = texturedMaterial(stoneTexture(), { opart: op, opMode: 2 });
      else if (base === 'porch') mat = texturedMaterial(plankTexture(), { opart: op, opMode: 1 });
      else if (base === 'brick') mat = texturedMaterial(brickTexture(), { opart: op, opMode: 2 });
      else if (base === 'stone') mat = texturedMaterial(stoneTexture(), { opart: op, opMode: 2 });
      else mat = lit('#cccccc', { opart: op });
      add(new THREE.Mesh(geo, mat));
    }
  }

  // mow / un-mow a grass tile (animated by caller via value 0..1)
  setCut(tile, v) {
    const b = this.grassBatches?.[tile.data.grassBatch];
    if (!b || tile.data.grassVert == null) return;
    const i0 = tile.data.grassVert;
    for (let i = 0; i < 4; i++) b.cut.setX(i0 + i, v);
    b.cut.needsUpdate = true;
  }

  getCut(tile) {
    const b = this.grassBatches?.[tile.data.grassBatch];
    if (!b || tile.data.grassVert == null) return 0;
    return b.cut.getX(tile.data.grassVert);
  }
}
