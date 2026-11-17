// Rotor side of the movement, as seen with the caseback removed: main plate,
// bridges, balance cock with regulator, going train, escapement, automatic
// device, oscillating weight and the movement holder ring. Crown wheel, ratchet
// and click belong to keyless.ts, which keeps the winding. Geometry comes from
// data.ts; every outline is built in the watch frame (plan point [x, z], y up)
// and every turning part is a mesh whose origin sits on its axis.
//
// Draw calls: the plate with the holder ring (also seen from the dial side),
// then for the rotor side one mesh per independently moving part, two static
// meshes (bridges, small steel parts) and two instanced meshes (screws,
// jewels). All metal shares one material: colour, pattern, roughness and
// metalness come per vertex, so finishes cost no extra draw calls.

import * as THREE from 'three';
import type { WatchMaterials } from '../materials';
import {
  BACK_SIDE, BODY_BACK_Y, ENGRAVINGS, FINISHES, JEWELS, SCREWS, STEM_Y, TAU,
  balanceAngle, centreWheelAngle, escapeWheelAngle, fourthWheelAngle, palletAngle, reverserAngle,
  stopLeverEngagement, thirdWheelAngle,
  type Gear, type MovementState, type Plan,
} from './data';
import { patchUndersideEnvironment } from './underside';

export interface BackSide {
  /** Everything, in the watch frame: `plate` and `rotorSide`. */
  group: THREE.Group;
  /** Main plate and movement holder ring: their dial-side faces show with the dial lifted off. */
  plate: THREE.Object3D;
  /** Everything only seen from the back. Hide it, and stop calling update(), while the back is closed. */
  rotorSide: THREE.Group;
  update(s: MovementState): void;
}

// ── Look (the layout is data.ts's) ─────────────────────────────────────────

/** Anglage (polished chamfer) along the visible edge of plate bridges. */
const BEVEL = 0.06;
/** Côtes de Genève: stripe width, stripes parallel to the part's own X axis. */
const COTES_WIDTH = 2.2;
/** Visual strip width of the hairspring; the real 0.035 mm vanishes at viewing distance. */
const HAIRSPRING_STRIP = 0.045;
const HAIRSPRING_POINTS_PER_TURN = 48;
/** Time constant (s) with which the balance amplitude builds up after a start. */
const AMPLITUDE_EASE = 0.6;

// ── Finishes ────────────────────────────────────────────────────────────────

const POLISH = 0;
const COTES = 1;
const PERLAGE = 2;
const CIRCULAR = 3;
const SATIN = 4;

interface Finish { readonly c: readonly [number, number, number]; readonly p: number; readonly r: number; readonly m: number }

function finish(hex: number, pattern: number, rough: number, metal = 1): Finish {
  const c = new THREE.Color(hex);
  return { c: [c.r, c.g, c.b], p: pattern, r: rough, m: metal };
}

const F = {
  plate: finish(FINISHES.rhodium.color, PERLAGE, 0.36),
  plateWall: finish(0xb9bdc2, SATIN, 0.42),
  bridge: finish(FINISHES.rhodium.color, COTES, 0.3),
  bridgeWall: finish(0xbfc3c8, SATIN, 0.36),
  anglage: finish(0xe2e5e8, POLISH, 0.1),
  recess: finish(0xb4b8bd, CIRCULAR, 0.32),
  polished: finish(FINISHES.polishedSteel.color, POLISH, 0.12),
  steelFace: finish(0xd0d4d8, CIRCULAR, 0.22),
  steelWall: finish(0xc4c8cc, POLISH, 0.16),
  dark: finish(0x2e3238, SATIN, 0.5),
  gilt: finish(FINISHES.gilt.color, CIRCULAR, 0.28),
  giltPolish: finish(0xe0c070, POLISH, 0.16),
  giltWall: finish(0xc9a452, SATIN, 0.3),
  engraving: finish(0xd8b45a, SATIN, 0.38),
  copper: finish(0xa8673f, CIRCULAR, 0.32),
  copperWall: finish(0x94583a, SATIN, 0.34),
  seal: finish(0xc98a68, CIRCULAR, 0.3),
  ruby: finish(0x9a1027, POLISH, 0.08, 0),
  hairspring: finish(FINISHES.hairspring.color, SATIN, 0.3),
  rotor: finish(FINISHES.rotor.color, COTES, 0.28),
  rotorHub: finish(FINISHES.rotor.color, CIRCULAR, 0.26),
  rotorRing: finish(0xe0e3e6, POLISH, 0.1),
  heavy: finish(FINISHES.heavyMetal.color, SATIN, FINISHES.heavyMetal.roughness),
  heavyWall: finish(0x7d828a, SATIN, 0.4),
  casing: finish(FINISHES.casingRing.color, CIRCULAR, FINISHES.casingRing.roughness, FINISHES.casingRing.metalness),
  screw: finish(0xffffff, CIRCULAR, 0.2),
  screwSlot: finish(0x30343a, SATIN, 0.5),
} as const;

const BLUED = new THREE.Color(FINISHES.blued.color);

// ── Mesh builder ────────────────────────────────────────────────────────────

class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly fin: number[] = [];
  readonly idx: number[] = [];

  get count(): number { return this.pos.length / 3; }

  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, f: Finish): number {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(x, y, z);
    this.nrm.push(nx / l, ny / l, nz / l);
    this.col.push(f.c[0], f.c[1], f.c[2]);
    this.fin.push(f.p, f.r, f.m);
    return this.pos.length / 3 - 1;
  }

  /** Winds the triangle to face the way its vertex normals point. */
  tri(a: number, b: number, c: number): void {
    const P = this.pos, N = this.nrm;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * gx + gy * gy + gz * gz < 1e-16) return;
    const facing = gx * (N[a * 3] + N[b * 3] + N[c * 3]) + gy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1])
      + gz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (facing >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }

  quad(a: number, b: number, c: number, d: number): void { this.tri(a, b, c); this.tri(a, c, d); }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('lunaFinish', new THREE.Float32BufferAttribute(this.fin, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// ── Plan geometry ───────────────────────────────────────────────────────────

type Pt = [number, number];
type Loop = Pt[];
interface Region { outer: Loop; holes: Loop[] }
type Sdf = (x: number, z: number) => number;

const sub2 = (a: Plan, b: Plan): Pt => [a[0] - b[0], a[1] - b[1]];
const angleTo = (a: Plan, b: Plan): number => Math.atan2(b[1] - a[1], b[0] - a[0]);
const at = (c: Plan, r: number, a: number): Pt => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
const ORIGIN: Plan = [0, 0];

function loopArea(l: Loop): number {
  let s = 0;
  for (let i = 0, n = l.length; i < n; i++) {
    const a = l[i], b = l[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Counter-clockwise in (x, z) for outlines, clockwise for holes: the solid lies on the left. */
function oriented(l: Loop, ccw: boolean): Loop {
  return (loopArea(l) > 0) === ccw ? l : l.slice().reverse();
}

function contains(l: Loop, p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
    const a = l[i], b = l[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function circleLoop(c: Plan, r: number, ccw = true, maxStep = 0.18): Loop {
  const n = Math.max(12, Math.ceil(TAU * r / maxStep));
  const l: Loop = [];
  for (let i = 0; i < n; i++) l.push(at(c, r, i / n * TAU));
  return ccw ? l : l.reverse();
}

/** Rounds the corners of a polygon: each corner is cut back by up to `radius`
 * along its edges and replaced by a quadratic arc. `pick` limits it to some corners. */
function roundCorners(poly: readonly Plan[], radius: number, segs = 4, pick?: (i: number) => boolean): Loop {
  const out: Loop = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    if (pick && !pick(i)) { out.push([p[0], p[1]]); continue; }
    const a = poly[(i + n - 1) % n], b = poly[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const r = Math.min(radius, la * 0.45, lb * 0.45);
    const pa: Pt = [p[0] + (a[0] - p[0]) * r / la, p[1] + (a[1] - p[1]) * r / la];
    const pb: Pt = [p[0] + (b[0] - p[0]) * r / lb, p[1] + (b[1] - p[1]) * r / lb];
    for (let k = 0; k <= segs; k++) {
      const t = k / segs, s = 1 - t;
      out.push([s * s * pa[0] + 2 * s * t * p[0] + t * t * pb[0], s * s * pa[1] + 2 * s * t * p[1] + t * t * pb[1]]);
    }
  }
  return out;
}

/** Moves every vertex by `w` into the solid (to the left of the loop), mitred. */
function inset(l: Loop, w: number): Loop {
  const n = l.length;
  const left: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = l[i], b = l[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    left.push([-dz / len, dx / len]);
  }
  return l.map((p, i): Pt => {
    const l1 = left[(i + n - 1) % n], l2 = left[i];
    let mx = l1[0] + l2[0], mz = l1[1] + l2[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { mx = l2[0]; mz = l2[1]; } else { mx /= ml; mz /= ml; }
    const k = w / Math.max(0.35, mx * l2[0] + mz * l2[1]);
    return [p[0] + mx * k, p[1] + mz * k];
  });
}

// Signed distance functions in plan (negative inside).

const sdCircle = (c: Plan, r: number): Sdf => {
  const cx = c[0], cz = c[1];
  return (x, z) => Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz)) - r;
};

function sdBox(x0: number, x1: number, z0: number, z1: number): Sdf {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  return (x, z) => {
    const dx = Math.abs(x - cx) - hx, dz = Math.abs(z - cz) - hz;
    const ox = dx > 0 ? dx : 0, oz = dz > 0 ? dz : 0;
    return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(dx, dz), 0);
  };
}

/** Exact polygon distance near the polygon, a lower bound (the box distance) far from it. */
function sdPolygon(poly: readonly Plan[]): Sdf {
  const n = poly.length;
  const xs = Float64Array.from(poly, p => p[0]), zs = Float64Array.from(poly, p => p[1]);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]); z0 = Math.min(z0, zs[i]); z1 = Math.max(z1, zs[i]); }
  return (x, z) => {
    const bx = Math.max(x0 - x, x - x1, 0), bz = Math.max(z0 - z, z - z1, 0);
    if (bx > 0.6 || bz > 0.6) return Math.sqrt(bx * bx + bz * bz);
    let d = (x - xs[0]) ** 2 + (z - zs[0]) ** 2;
    let s = 1;
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const ex = xs[j] - xs[i], ez = zs[j] - zs[i], wx = x - xs[i], wz = z - zs[i];
      const t = Math.min(1, Math.max(0, (wx * ex + wz * ez) / (ex * ex + ez * ez)));
      const qx = wx - ex * t, qz = wz - ez * t;
      d = Math.min(d, qx * qx + qz * qz);
      const c0 = z >= zs[i], c1 = z < zs[j], c2 = ex * wz > ez * wx;
      if ((c0 && c1 && c2) || (!c0 && !c1 && !c2)) s = -s;
    }
    return s * Math.sqrt(d);
  };
}

function sdCapsule(a: Plan, b: Plan, r: number): Sdf {
  const ex = b[0] - a[0], ez = b[1] - a[1], ee = ex * ex + ez * ez;
  return (x, z) => {
    const wx = x - a[0], wz = z - a[1];
    const t = Math.min(1, Math.max(0, (wx * ex + wz * ez) / ee));
    const qx = wx - ex * t, qz = wz - ez * t;
    return Math.sqrt(qx * qx + qz * qz) - r;
  };
}

const union = (...f: Sdf[]): Sdf => (x, z) => { let v = Infinity; for (const g of f) v = Math.min(v, g(x, z)); return v; };

const minus = (a: Sdf, ...cut: Sdf[]): Sdf => (x, z) => { let v = a(x, z); for (const g of cut) v = Math.max(v, -g(x, z)); return v; };

// ── Contours of a field (marching squares) ─────────────────────────────────

interface Grid { ox: number; oz: number; step: number; nx: number; nz: number }

function gridOver(x0: number, z0: number, x1: number, z1: number, step: number): Grid {
  return { ox: x0 - step, oz: z0 - step, step, nx: Math.ceil((x1 - x0) / step) + 3, nz: Math.ceil((z1 - z0) / step) + 3 };
}

function sample(g: Grid, sdf: Sdf): Float32Array {
  const f = new Float32Array(g.nx * g.nz);
  for (let j = 0; j < g.nz; j++) {
    const z = g.oz + j * g.step;
    for (let i = 0; i < g.nx; i++) f[j * g.nx + i] = sdf(g.ox + i * g.step, z);
  }
  return f;
}

/** Circle distance on a grid (negated with `outside`: radius minus distance). */
function circleField(g: Grid, c: Plan, r: number, into?: Float32Array): Float32Array {
  const { nx, nz, ox, oz, step } = g;
  const f = into ?? new Float32Array(nx * nz).fill(Infinity);
  for (let j = 0; j < nz; j++) {
    const dz = oz + j * step - c[1], dz2 = dz * dz;
    for (let i = 0, k = j * nx; i < nx; i++, k++) {
      const dx = ox + i * step - c[0];
      const v = Math.sqrt(dx * dx + dz2) - r;
      if (v < f[k]) f[k] = v;
    }
  }
  return f;
}

/** Capsule distance, folded into `into` by min. */
function capsuleField(g: Grid, a: Plan, b: Plan, r: number, into: Float32Array): Float32Array {
  const { nx, nz, ox, oz, step } = g;
  const ex = b[0] - a[0], ez = b[1] - a[1], ee = ex * ex + ez * ez;
  for (let j = 0; j < nz; j++) {
    const wz = oz + j * step - a[1];
    for (let i = 0, k = j * nx; i < nx; i++, k++) {
      const wx = ox + i * step - a[0];
      const t = Math.min(1, Math.max(0, (wx * ex + wz * ez) / ee));
      const qx = wx - ex * t, qz = wz - ez * t;
      const v = Math.sqrt(qx * qx + qz * qz) - r;
      if (v < into[k]) into[k] = v;
    }
  }
  return into;
}

/** Polygon distance on a grid, exact within `band` of the outline and clamped to ±band
 * elsewhere, which is all that min/max composition and contouring need. The sign comes
 * from scanlines, the distance is stamped edge by edge. */
function polygonField(g: Grid, poly: readonly Plan[], band = 4 * g.step): Float32Array {
  const { nx, nz, ox, oz, step } = g;
  const f = new Float32Array(nx * nz).fill(band);
  const n = poly.length;
  for (let e = 0; e < n; e++) {
    const a = poly[e], b = poly[(e + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1], ee = ex * ex + ez * ez || 1e-12;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - band - ox) / step));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0]) + band - ox) / step));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - band - oz) / step));
    const j1 = Math.min(nz - 1, Math.ceil((Math.max(a[1], b[1]) + band - oz) / step));
    for (let j = j0; j <= j1; j++) {
      const wz = oz + j * step - a[1];
      for (let i = i0; i <= i1; i++) {
        const wx = ox + i * step - a[0];
        const t = Math.min(1, Math.max(0, (wx * ex + wz * ez) / ee));
        const qx = wx - ex * t, qz = wz - ez * t;
        const d = Math.sqrt(qx * qx + qz * qz);
        const k = j * nx + i;
        if (d < f[k]) f[k] = d;
      }
    }
  }
  const xs: number[] = [];
  for (let j = 0; j < nz; j++) {
    const z = oz + j * step;
    xs.length = 0;
    for (let e = 0; e < n; e++) {
      const a = poly[e], b = poly[(e + 1) % n];
      if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k] - ox) / step)), to = Math.min(nx - 1, Math.floor((xs[k + 1] - ox) / step));
      for (let i = from; i <= to; i++) f[j * nx + i] = -f[j * nx + i];
    }
  }
  return f;
}

/** Element-wise max of fields; a negated field is passed as { neg: field }. */
function combine(...parts: (Float32Array | { neg: Float32Array })[]): Float32Array {
  const first = parts[0];
  const out = first instanceof Float32Array ? first.slice() : first.neg.map(v => -v);
  for (let k = 1; k < parts.length; k++) {
    const p = parts[k];
    if (p instanceof Float32Array) { for (let i = 0; i < out.length; i++) if (p[i] > out[i]) out[i] = p[i]; }
    else { const q = p.neg; for (let i = 0; i < out.length; i++) if (-q[i] > out[i]) out[i] = -q[i]; }
  }
  return out;
}

function fieldMin(...parts: Float32Array[]): Float32Array {
  const out = parts[0].slice();
  for (let k = 1; k < parts.length; k++) { const p = parts[k]; for (let i = 0; i < out.length; i++) if (p[i] < out[i]) out[i] = p[i]; }
  return out;
}

/** Closed outlines of the region field < 0, the solid on the left of each. */
function march(g: Grid, field: Float32Array): Loop[] {
  const { nx, nz, ox, oz, step } = g;
  const f = field;
  for (let i = 0; i < nx; i++) { f[i] = Math.max(f[i], step); f[(nz - 1) * nx + i] = Math.max(f[(nz - 1) * nx + i], step); }
  for (let j = 0; j < nz; j++) { f[j * nx] = Math.max(f[j * nx], step); f[j * nx + nx - 1] = Math.max(f[j * nx + nx - 1], step); }
  // Only the box around the region is scanned.
  const neg = new Uint8Array(nx * nz);
  let i0 = nx, i1 = -1, j0 = nz, j1 = -1;
  for (let j = 0; j < nz; j++) {
    for (let i = 0, k = j * nx; i < nx; i++, k++) {
      if (f[k] < 0) {
        neg[k] = 1;
        if (i < i0) i0 = i;
        if (i > i1) i1 = i;
        if (j < j0) j0 = j;
        if (j > j1) j1 = j;
      }
    }
  }
  if (i1 < 0) return [];
  const H = (nx - 1) * nz;
  const next = new Map<number, number>();
  const e = [0, 0, 0, 0], v = [0, 0, 0, 0], kind = [0, 0, 0, 0], edge = [0, 0, 0, 0];
  for (let j = Math.max(0, j0 - 1); j <= Math.min(nz - 2, j1); j++) {
    for (let i = Math.max(0, i0 - 1); i <= Math.min(nx - 2, i1); i++) {
      const k0 = j * nx + i;
      const code = neg[k0] | (neg[k0 + 1] << 1) | (neg[k0 + nx + 1] << 2) | (neg[k0 + nx] << 3);
      if (code === 0 || code === 15) continue;
      v[0] = f[k0]; v[1] = f[k0 + 1]; v[2] = f[k0 + nx + 1]; v[3] = f[k0 + nx];
      e[0] = j * (nx - 1) + i; e[1] = H + j * nx + i + 1; e[2] = (j + 1) * (nx - 1) + i; e[3] = H + j * nx + i;
      let n = 0;
      for (let k = 0; k < 4; k++) {
        const a = v[k] < 0, b = v[(k + 1) & 3] < 0;
        if (a !== b) { kind[n] = a ? 1 : 0; edge[n] = e[k]; n++; }
      }
      if (n === 2) {
        if (kind[0] === 1) next.set(edge[0], edge[1]); else next.set(edge[1], edge[0]);
      } else {
        const joined = v[0] + v[1] + v[2] + v[3] < 0;
        for (let k = 0; k < 4; k++) if (kind[k] === 1) next.set(edge[k], edge[joined ? (k + 1) & 3 : (k + 3) & 3]);
      }
    }
  }
  const point = (id: number): Pt => {
    if (id < H) {
      const j = Math.floor(id / (nx - 1)), i = id - j * (nx - 1);
      const a = f[j * nx + i], b = f[j * nx + i + 1];
      return [ox + (i + a / (a - b)) * step, oz + j * step];
    }
    const k = id - H, j = Math.floor(k / nx), i = k - j * nx;
    const a = f[j * nx + i], b = f[(j + 1) * nx + i];
    return [ox + i * step, oz + (j + a / (a - b)) * step];
  };
  const loops: Loop[] = [];
  for (const start of next.keys()) {
    if (!next.has(start)) continue;
    const loop: Loop = [];
    for (let id: number | undefined = start; id !== undefined && next.has(id);) {
      loop.push(point(id));
      const to: number | undefined = next.get(id);
      next.delete(id);
      id = to;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Douglas–Peucker on a closed loop. */
function simplify(loop: Loop, tol: number): Loop {
  const n = loop.length;
  if (n < 8) return loop;
  let far = 0, best = -1;
  for (let i = 1; i < n; i++) {
    const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = loop[a], pb = loop[b % n];
    const ex = pb[0] - pa[0], ez = pb[1] - pa[1], el = Math.hypot(ex, ez) || 1e-9;
    let worst = -1, at2 = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((loop[i][0] - pa[0]) * ez - (loop[i][1] - pa[1]) * ex) / el;
      if (d > worst) { worst = d; at2 = i; }
    }
    if (worst > tol) { keep[at2] = 1; stack.push([a, at2], [at2, b]); }
  }
  const out: Loop = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(loop[i]);
  return out;
}

function regionsOf(loops: Loop[]): Region[] {
  const outers: { l: Loop; a: number; holes: Loop[] }[] = [];
  const holes: { l: Loop; a: number }[] = [];
  for (const l of loops) {
    const a = loopArea(l);
    if (Math.abs(a) < 2e-4) continue;
    if (a > 0) outers.push({ l, a, holes: [] }); else holes.push({ l, a: -a });
  }
  for (const h of holes) {
    let host: (typeof outers)[number] | null = null;
    for (const o of outers) if (o.a > h.a && contains(o.l, h.l[0]) && (!host || o.a < host.a)) host = o;
    host?.holes.push(h.l);
  }
  return outers.map(o => ({ outer: o.l, holes: o.holes }));
}

function contourField(g: Grid, field: Float32Array, tol = 0.004): Region[] {
  return regionsOf(march(g, field).map(l => simplify(l, tol)));
}

function contour(sdf: Sdf, box: readonly [number, number, number, number], step: number, tol = 0.004): Region[] {
  const g = gridOver(box[0], box[1], box[2], box[3], step);
  return contourField(g, sample(g, sdf), tol);
}

function boundsOf(poly: readonly Plan[], margin: number): [number, number, number, number] {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  return [x0 - margin, z0 - margin, x1 + margin, z1 + margin];
}

// ── Solids from plan regions ────────────────────────────────────────────────

/** Flat face of a region at height y, facing up (ny 1) or down (-1). */
function cap(mb: MeshBuilder, outer: Loop, holes: readonly Loop[], y: number, ny: 1 | -1, f: Finish, map?: (p: Pt) => Pt): void {
  const contourV = outer.map(p => new THREE.Vector2(p[0], p[1]));
  const holeV = holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
  const faces = THREE.ShapeUtils.triangulateShape(contourV, holeV);
  const base = mb.count;
  for (const list of [contourV, ...holeV]) {
    for (const p of list) {
      const q = map ? map([p.x, p.y]) : [p.x, p.y];
      mb.v(q[0], y, q[1], 0, ny, 0, f);
    }
  }
  for (const [a, b, c] of faces) mb.tri(base + a, base + b, base + c);
}

/** Upright wall along a loop; the outward normal is on the right of the loop. Smooth below ~35° per vertex. */
function wall(mb: MeshBuilder, l: Loop, yb: number, yt: number, f: Finish): void {
  const n = l.length;
  const en: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = l[i], b = l[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    en.push([dz / len, -dx / len]);
  }
  const blend = (p: Pt, q: Pt): Pt => {
    if (p[0] * q[0] + p[1] * q[1] < 0.82) return p;
    const x = p[0] + q[0], z = p[1] + q[1], len = Math.hypot(x, z) || 1;
    return [x / len, z / len];
  };
  for (let i = 0; i < n; i++) {
    const a = l[i], b = l[(i + 1) % n];
    const na = blend(en[i], en[(i + n - 1) % n]), nb = blend(en[i], en[(i + 1) % n]);
    const i0 = mb.v(a[0], yb, a[1], na[0], 0, na[1], f);
    const i1 = mb.v(b[0], yb, b[1], nb[0], 0, nb[1], f);
    const i2 = mb.v(b[0], yt, b[1], nb[0], 0, nb[1], f);
    const i3 = mb.v(a[0], yt, a[1], na[0], 0, na[1], f);
    mb.quad(i0, i1, i2, i3);
  }
}

/** Polished chamfer from the inset loop on the face (y0) to the loop itself at y0 + w. */
function chamfer(mb: MeshBuilder, inner: Loop, outer: Loop, y0: number, w: number, f: Finish): void {
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = outer[j][0] - outer[i][0], ez = outer[j][1] - outer[i][1], len = Math.hypot(ex, ez) || 1;
    const nx = ez / len, nz = -ex / len;
    const a = mb.v(inner[i][0], y0, inner[i][1], nx, -1, nz, f);
    const b = mb.v(inner[j][0], y0, inner[j][1], nx, -1, nz, f);
    const c = mb.v(outer[j][0], y0 + w, outer[j][1], nx, -1, nz, f);
    const d = mb.v(outer[i][0], y0 + w, outer[i][1], nx, -1, nz, f);
    mb.quad(a, b, c, d);
  }
}

interface ExtrudeOptions {
  bottom?: Finish;
  top?: Finish;
  wall?: Finish;
  bevel?: number;
  bevelFinish?: Finish;
  /** Loops smaller than this (mm²) get no wall and no bevel (jewel and screw holes). */
  minLoop?: number;
}

/** A plate between y0 (visible bottom face) and y1. */
function extrude(mb: MeshBuilder, regions: readonly Region[], y0: number, y1: number, o: ExtrudeOptions): void {
  for (const reg of regions) {
    const loops = [reg.outer, ...reg.holes];
    const big = loops.map(l => Math.abs(loopArea(l)) >= (o.minLoop ?? 0));
    const w = o.bevel ?? 0;
    const capLoops = loops.map((l, k) => (w > 0 && big[k] ? inset(l, w) : l));
    if (o.bottom) cap(mb, capLoops[0], capLoops.slice(1), y0, -1, o.bottom);
    if (o.top) cap(mb, reg.outer, reg.holes, y1, 1, o.top);
    loops.forEach((l, k) => {
      if (!big[k]) return;
      if (w > 0 && o.bevelFinish) chamfer(mb, capLoops[k], l, y0, w, o.bevelFinish);
      if (o.wall) wall(mb, l, y0 + (w > 0 ? w : 0), y1, o.wall);
    });
  }
}

/** Flat ring (or disc when r0 = 0) about c at height y. */
function ring(mb: MeshBuilder, c: Plan, r0: number, r1: number, y: number, ny: 1 | -1, f: Finish, segs = 48): void {
  const base = mb.count;
  for (let i = 0; i <= segs; i++) {
    const a = i / segs * TAU, cs = Math.cos(a), sn = Math.sin(a);
    mb.v(c[0] + r0 * cs, y, c[1] + r0 * sn, 0, ny, 0, f);
    mb.v(c[0] + r1 * cs, y, c[1] + r1 * sn, 0, ny, 0, f);
  }
  for (let i = 0; i < segs; i++) mb.quad(base + i * 2, base + i * 2 + 2, base + i * 2 + 3, base + i * 2 + 1);
}

/** Cylinder wall about c, facing out (or in). */
function tube(mb: MeshBuilder, c: Plan, r: number, y0: number, y1: number, f: Finish, outward = true, segs = 32): void {
  const base = mb.count, s = outward ? 1 : -1;
  for (let i = 0; i <= segs; i++) {
    const a = i / segs * TAU, cs = Math.cos(a), sn = Math.sin(a);
    mb.v(c[0] + r * cs, y0, c[1] + r * sn, s * cs, 0, s * sn, f);
    mb.v(c[0] + r * cs, y1, c[1] + r * sn, s * cs, 0, s * sn, f);
  }
  for (let i = 0; i < segs; i++) mb.quad(base + i * 2, base + i * 2 + 2, base + i * 2 + 3, base + i * 2 + 1);
}

/** Conical band between (r0, y0) and (r1, y1) about c. */
function cone(mb: MeshBuilder, c: Plan, r0: number, y0: number, r1: number, y1: number, f: Finish, segs = 48): void {
  const base = mb.count;
  const dr = r1 - r0, dy = y1 - y0;
  // Normal of the profile, turned to face downwards (towards the caseback).
  let nr = dy, ny = -dr;
  if (ny > 0) { nr = -nr; ny = -ny; }
  for (let i = 0; i <= segs; i++) {
    const a = i / segs * TAU, cs = Math.cos(a), sn = Math.sin(a);
    mb.v(c[0] + r0 * cs, y0, c[1] + r0 * sn, nr * cs, ny, nr * sn, f);
    mb.v(c[0] + r1 * cs, y1, c[1] + r1 * sn, nr * cs, ny, nr * sn, f);
  }
  for (let i = 0; i < segs; i++) mb.quad(base + i * 2, base + i * 2 + 2, base + i * 2 + 3, base + i * 2 + 1);
}

// ── Gears ───────────────────────────────────────────────────────────────────

/** Watch-type tooth outline: radial flanks below the pitch circle, an ogive above. */
function gearLoop(g: Gear, phase: number, fine = true, c: Plan = ORIGIN): Loop {
  const p = TAU / g.teeth, mid = (g.pitchR + g.tipR) / 2;
  const out: Loop = [];
  for (let k = 0; k < g.teeth; k++) {
    const a = phase + k * p;
    if (fine) {
      out.push(at(c, g.rootR, a - 0.3 * p), at(c, g.pitchR, a - 0.235 * p), at(c, mid, a - 0.17 * p),
        at(c, g.tipR, a - 0.06 * p), at(c, g.tipR, a + 0.06 * p), at(c, mid, a + 0.17 * p),
        at(c, g.pitchR, a + 0.235 * p), at(c, g.rootR, a + 0.3 * p));
    } else {
      out.push(at(c, g.rootR, a - 0.28 * p), at(c, g.pitchR, a - 0.22 * p), at(c, g.tipR, a), at(c, g.pitchR, a + 0.22 * p), at(c, g.rootR, a + 0.28 * p));
    }
  }
  return out;
}

/** Windows between `n` straight spokes, from the hub to the inside of the rim. */
function spokeWindows(n: number, rimR: number, hubR: number, width: number, phase: number): Loop[] {
  const out: Loop[] = [];
  const dOut = Math.asin(width / 2 / rimR), dIn = Math.asin(Math.min(0.9, width / 2 / hubR));
  for (let k = 0; k < n; k++) {
    const a0 = phase + k * TAU / n, a1 = a0 + TAU / n;
    const w: Plan[] = [];
    const so = Math.max(3, Math.ceil((a1 - a0) * rimR / 0.22));
    for (let s = 0; s <= so; s++) w.push(at(ORIGIN, rimR, a0 + dOut + (a1 - a0 - 2 * dOut) * s / so));
    const si = Math.max(2, Math.ceil((a1 - a0) * hubR / 0.22));
    for (let s = 0; s <= si; s++) w.push(at(ORIGIN, hubR, a1 - dIn - (a1 - a0 - 2 * dIn) * s / si));
    const corners = new Set([0, so, so + 1, so + si + 1]);
    out.push(oriented(roundCorners(w, 0.09, 3, i => corners.has(i)), false));
  }
  return out;
}

interface WheelSpec {
  gear: Gear;
  phase: number;
  y0: number;
  y1: number;
  face: Finish;
  wall: Finish;
  fine?: boolean;
  spokes?: number;
  rim?: number;
  hubR?: number;
  spokeW?: number;
  boreR?: number;
  holes?: Loop[];
}

/** A wheel built about its own axis (local origin); bottom face towards the caseback. */
function wheel(mb: MeshBuilder, w: WheelSpec): void {
  const holes: Loop[] = [];
  if (w.spokes) holes.push(...spokeWindows(w.spokes, w.gear.rootR - (w.rim ?? 0.3), w.hubR ?? 0.55, w.spokeW ?? 0.2, w.phase + 0.3));
  if (w.boreR) holes.push(circleLoop(ORIGIN, w.boreR, false, 0.1));
  if (w.holes) holes.push(...w.holes.map(h => oriented(h, false)));
  extrude(mb, [{ outer: gearLoop(w.gear, w.phase, w.fine ?? true), holes }], w.y0, w.y1, { bottom: w.face, wall: w.wall });
}

// ── Engraving: letters as geometry ──────────────────────────────────────────

const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "Nimbus Sans", "DejaVu Sans", sans-serif';

/** Outlines of a line of capitals, `cap` mm high, in text space: x along the baseline, y up. */
function textRegions(text: string, cap: number, tracking = 0.08): { regions: Region[]; width: number } {
  const capPx = 56;
  const ppm = capPx / cap;
  const measureCanvas = document.createElement('canvas');
  const mc = measureCanvas.getContext('2d');
  if (!mc) return { regions: [], width: 0 };
  mc.font = `700 100px ${FONT_FAMILY}`;
  const asc = mc.measureText('H').actualBoundingBoxAscent;
  const fontPx = capPx * 100 / (asc > 40 && asc < 95 ? asc : 72);
  const font = `700 ${fontPx.toFixed(1)}px ${FONT_FAMILY}`;
  mc.font = font;
  const track = tracking * capPx;
  const glyphs = [...text].map(ch => ({ ch, w: mc.measureText(ch).width }));
  const widthPx = glyphs.reduce((s, g) => s + g.w, 0) + track * (glyphs.length - 1);
  const pad = 8;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(widthPx + pad * 2);
  canvas.height = Math.ceil(capPx * 1.5 + pad * 2);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { regions: [], width: 0 };
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  const baseline = pad + capPx * 1.2;
  let x = pad;
  for (const g of glyphs) { ctx.fillText(g.ch, x, baseline); x += g.w + track; }
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const grid: Grid = { ox: 0, oz: 0, step: 1, nx: canvas.width, nz: canvas.height };
  const field = new Float32Array(grid.nx * grid.nz);
  for (let i = 0; i < field.length; i++) field[i] = 0.5 - img[i * 4] / 255;
  // Canvas rows run downwards: flip into text space (y up), which also flips the winding back.
  const loops = march(grid, field).map(l => simplify(l, 0.45).map((p): Pt => [(p[0] - pad) / ppm, (baseline - p[1]) / ppm]));
  return { regions: regionsOf(loops.map(l => l.slice().reverse())), width: widthPx / ppm };
}

/** Straight text read from below (screen right = +x, up = +z when turned by `angle` 0). */
function placeStraight(centre: Plan, angle: number, width: number): (p: Pt) => Pt {
  const ux = Math.cos(angle), uz = Math.sin(angle);
  return ([u, v]) => {
    const s = u - width / 2;
    return [centre[0] + s * ux - v * uz, centre[1] + s * uz + v * ux];
  };
}

/** Text along an arc about c, centred on plan angle `mid`, letters upright towards c: the tops of the
 * capitals on radius R - capH, their baselines on R. Seen from the back with `mid` at the bottom of the
 * picture they read upright. */
function placeArcInward(c: Plan, R: number, mid: number, width: number): (p: Pt) => Pt {
  return ([u, v]) => {
    const a = mid + (u - width / 2) / R;
    return [c[0] + (R - v) * Math.cos(a), c[1] + (R - v) * Math.sin(a)];
  };
}

function engrave(mb: MeshBuilder, text: string, capH: number, y: number, place: (width: number) => (p: Pt) => Pt, f: Finish, tracking?: number): void {
  const { regions, width } = textRegions(text, capH, tracking);
  const map = place(width);
  for (const r of regions) cap(mb, r.outer, r.holes, y, -1, f, map);
}

// ── Material ────────────────────────────────────────────────────────────────

const MOVEMENT_VARYINGS = /* glsl */`
  varying vec3 vMvPos;
  varying vec3 vMvNrm;
  varying vec3 vMvX;
  varying vec3 vMvZ;
  varying vec3 vMvFin;
`;

const MOVEMENT_VERTEX = /* glsl */`
  vMvPos = position;
  vMvNrm = normal;
  mat3 mvToView = mat3( modelViewMatrix );
  #ifdef USE_INSTANCING
    mvToView = mvToView * mat3( instanceMatrix );
  #endif
  vMvX = mvToView[ 0 ];
  vMvZ = mvToView[ 2 ];
  vMvFin = lunaFinish;
`;

/** Patterns in the part's own plan coordinates: côtes de Genève (1), perlage (2), circular graining (3). */
const MOVEMENT_PATTERNS = /* glsl */`
  {
    float mvPat = floor( vMvFin.x + 0.5 );
    float mvFlat = smoothstep( 0.55, 0.85, abs( vMvNrm.y ) );
    vec3 mvX = normalize( vMvX );
    vec3 mvZ = normalize( vMvZ );
    vec2 mvP = vMvPos.xz;
    if ( mvPat > 0.5 && mvPat < 1.5 ) {
      float s = mvP.y / ${COTES_WIDTH.toFixed(3)};
      float f = fract( s ) - 0.5;
      float k = floor( s );
      float along = fract( mvP.x / ${(COTES_WIDTH * 0.42).toFixed(3)} + k * 0.37 ) - 0.5;
      float arc = length( vec2( along, f * 1.25 + 0.55 ) );
      float grain = fract( sin( floor( arc * 34.0 ) * 91.7 + k * 13.1 ) * 43758.5453 ) - 0.5;
      normal = normalize( normal + mvFlat * ( mvZ * ( f * 0.55 ) + mvX * ( grain * 0.06 ) ) );
      roughnessFactor = clamp( roughnessFactor * ( 1.0 + mvFlat * ( 0.3 * grain - 0.05 ) ), 0.04, 1.0 );
    } else if ( mvPat > 1.5 && mvPat < 2.5 ) {
      float best = -1e9;
      vec2 bd = vec2( 0.0 );
      float j0 = floor( mvP.y / 0.8227 + 0.5 );
      for ( int dj = -1; dj <= 1; dj ++ ) {
        float j = j0 + float( dj );
        float off = mod( j, 2.0 ) * 0.475;
        float i0 = floor( ( mvP.x - off ) / 0.95 + 0.5 );
        for ( int di = -1; di <= 1; di ++ ) {
          float i = i0 + float( di );
          vec2 d = mvP - vec2( i * 0.95 + off, j * 0.8227 );
          float order = j * 4096.0 + i;
          if ( dot( d, d ) < 0.49 && order > best ) { best = order; bd = d; }
        }
      }
      vec2 rd = bd / 0.7;
      float n = fract( sin( floor( length( rd ) * 20.0 ) * 12.9898 + best * 0.731 ) * 43758.5453 ) - 0.5;
      normal = normalize( normal + mvFlat * ( mvX * rd.x + mvZ * rd.y ) * ( 0.24 + 0.1 * n ) );
      roughnessFactor = clamp( roughnessFactor * ( 1.0 + mvFlat * n * 0.35 ), 0.04, 1.0 );
    } else if ( mvPat > 2.5 && mvPat < 3.5 ) {
      float r = max( length( mvP ), 1e-4 );
      vec2 rd = mvP / r;
      float n = fract( sin( floor( r * 46.0 ) * 12.9898 ) * 43758.5453 ) - 0.5;
      normal = normalize( normal + mvFlat * ( mvX * rd.x + mvZ * rd.y ) * ( n * 0.14 ) );
      roughnessFactor = clamp( roughnessFactor * ( 1.0 + mvFlat * n * 0.3 ), 0.04, 1.0 );
    }
  }
`;

function makeMetal(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 1, roughness: 0.3 });
  material.name = 'Werk · Metall';
  material.onBeforeCompile = shader => {
    const v = shader.vertexShader, fr = shader.fragmentShader;
    const ok = v.includes('#include <common>') && v.includes('#include <project_vertex>')
      && fr.includes('#include <roughnessmap_fragment>') && fr.includes('#include <metalnessmap_fragment>')
      && fr.includes('#include <normal_fragment_maps>') && fr.includes('#include <lights_fragment_end>');
    if (!ok) return;
    shader.vertexShader = v
      .replace('#include <common>', `#include <common>\nattribute vec3 lunaFinish;\n${MOVEMENT_VARYINGS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${MOVEMENT_VERTEX}`);
    shader.fragmentShader = fr
      .replace('#include <common>', `#include <common>\n${MOVEMENT_VARYINGS}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vMvFin.y;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMvFin.z;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${MOVEMENT_PATTERNS}`)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular *= 0.35;');
    patchUndersideEnvironment(shader);
  };
  material.customProgramCacheKey = () => 'luna-movement-metal';
  return material;
}

function makeRuby(): THREE.MeshPhysicalMaterial {
  // No transmission: it would add a full extra render pass for a few jewels.
  const ruby = new THREE.MeshPhysicalMaterial({
    color: FINISHES.ruby.color, metalness: 0, roughness: FINISHES.ruby.roughness, clearcoat: FINISHES.ruby.clearcoat,
    clearcoatRoughness: 0.04, vertexColors: true, sheen: 0.4, sheenColor: 0xff5a6a, sheenRoughness: 0.4,
  });
  ruby.name = 'Werk · Rubin';
  ruby.onBeforeCompile = shader => patchUndersideEnvironment(shader);
  ruby.customProgramCacheKey = () => 'luna-movement-ruby';
  return ruby;
}

// ── Layout shortcuts ────────────────────────────────────────────────────────

const B = BACK_SIDE;
const BALANCE = B.balance.axis;
const PALLET = B.palletFork.axis;
const ESCAPE = B.escapeWheel.axis;
const THIRD = B.thirdWheel.axis;
const BARREL = B.barrel.axis;
const ROTOR = B.rotor;
const BRIDGE_FACE = B.trainBridge.y.bottom;
const COCK_FACE = B.balanceCock.arm.y.bottom;
const ENGRAVE_PROUD = 0.008;
const SETTING_FACE = COCK_FACE - 0.05;
const CAP_JEWEL_Y = SETTING_FACE + 0.03;
const CAP_JEWEL_R = 0.5;

const same = (a: Plan, b: Plan): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
/** Jewels set straight into bridges and plates: (axis, radius, face, sink radius). Barrel jewel lies under the ratchet. */
const SET_JEWELS = JEWELS.backSide.filter(j => !same(j.at, BALANCE) && !same(j.at, BARREL));

function rotorEnvelopeY(r: number): number {
  const e = ROTOR.envelope;
  return r <= e.coneFromR ? e.flatY : e.flatY + (r - e.coneFromR) * (e.edgeY - e.flatY) / (e.edgeR - e.coneFromR);
}

// ── Main plate ──────────────────────────────────────────────────────────────

function* buildPlate(mb: MeshBuilder): Generator<void, void, void> {
  const P = B.plate;
  const g = gridOver(-12.9, -12.9, 12.9, 12.9, 0.075);
  const fork = B.palletFork;
  const palletBridge = roundCorners(B.palletBridge.pocket, 0.35);
  const disc = circleField(g, ORIGIN, P.r);
  const rimIn = circleField(g, ORIGIN, P.rim.innerR).map(v => -v);
  const train = polygonField(g, palletBridge).map(v => v - 0.08);
  for (const [c, r] of [[ORIGIN, 3.78], [THIRD, 3.62], [ESCAPE, 2.45], [PALLET, 0.6], [BALANCE, 0.9]] as const) circleField(g, c, r, train);
  for (const tip of [fork.forkTip, fork.entryStone, fork.exitStone]) capsuleField(g, PALLET, tip, tip === fork.forkTip ? 0.55 : 0.45, train);
  const teeth = circleField(g, BARREL, P.barrelPocket.teethR);
  const drum = circleField(g, BARREL, P.barrelPocket.drumR);
  const ch = P.stemChannel;
  const channel = sample(g, sdBox(ch.fromX, ch.toX, -ch.halfWidth, ch.halfWidth));
  const slot = sample(g, sdBox(ch.toX - 0.05, P.flange.outerR + 0.5, -P.stemSlotHalf, P.stemSlotHalf));
  const keyless = polygonField(g, P.keylessPocket.outline);
  yield;

  const yA = P.backFaceY, yA1 = P.backFaceY + 0.05, yB = P.trainPocketTop, yC = P.keylessPocket.floorY, yD = P.barrelPocket.drumTop;
  const layerA = combine(disc, { neg: fieldMin(train, teeth, channel) });
  const layerB1 = combine(disc, { neg: fieldMin(train, teeth, channel, slot) });
  const layerB2 = combine(disc, { neg: fieldMin(drum, channel, slot) });
  const layerC = combine(disc, { neg: fieldMin(drum, keyless, channel) });
  const layerD = combine(disc, { neg: fieldMin(keyless, channel) });
  const rim = combine(disc, rimIn, { neg: keyless });

  const walls = (field: Float32Array, y0: number, y1: number): void =>
    extrude(mb, contourField(g, field.slice()), y0, y1, { wall: F.plateWall });
  const face = (field: Float32Array, y: number, ny: 1 | -1): void => {
    for (const r of contourField(g, field.slice())) cap(mb, r.outer, r.holes, y, ny, F.plate);
  };
  walls(layerA, yA, yA1);
  walls(layerB1, yA1, yB);
  walls(layerB2, yB, yC);
  walls(layerC, yC, yD);
  walls(layerD, yD, P.dialFaceY);
  walls(rim, P.dialFaceY, P.rim.top);
  yield;
  face(layerA, yA, -1);
  face(combine(layerB2, fieldMin(train, teeth)), yB, -1);
  face(combine(layerC, slot), yC, -1);
  face(combine(layerD, drum), yD, -1);
  face(combine(layerA, slot), yA1, 1);
  face(combine(layerB2, keyless), yC, 1);
  face(combine(layerD, { neg: rimIn }), P.dialFaceY, 1);
  face(rim, P.rim.top, 1);

  // Case-fitting flange.
  const fl = P.flange;
  ring(mb, ORIGIN, fl.innerR - 0.01, fl.outerR, fl.y.bottom, -1, F.plateWall, 160);
  ring(mb, ORIGIN, fl.innerR - 0.01, fl.outerR, fl.y.top, 1, F.plateWall, 160);
  tube(mb, ORIGIN, fl.outerR, fl.y.bottom, fl.y.top, F.anglage, true, 160);
}

// ── Bridges, cock, framework (one static mesh, côtes de Genève) ─────────────

/** Holes for the jewels set into a face at height `face`, as one field. */
function jewelHoles(g: Grid, face: number, extra: readonly [Plan, number][] = []): Float32Array {
  const f = new Float32Array(g.nx * g.nz).fill(Infinity);
  for (const j of SET_JEWELS) if (Math.abs(j.y - face) < 0.01) circleField(g, j.at, j.chaton, f);
  for (const [c, r] of extra) circleField(g, c, r, f);
  return f;
}

function* buildBridges(mb: MeshBuilder): Generator<void, void, void> {
  const plate = { bottom: F.bridge, wall: F.bridgeWall, bevel: BEVEL, bevelFinish: F.anglage, minLoop: 1.5 };

  const train = roundCorners(B.trainBridge.outline, 0.45, 3);
  const gT = gridOver(...boundsOf(train, 0.3), 0.045);
  extrude(mb, contourField(gT, combine(polygonField(gT, train), { neg: jewelHoles(gT, BRIDGE_FACE) })),
    B.trainBridge.y.bottom, B.trainBridge.y.top, plate);
  yield;

  const bb = B.barrelBridge;
  const barrel = roundCorners(bb.outline, 0.5, 3);
  const kc = bb.keylessChannel;
  const g = gridOver(...boundsOf(barrel, 0.3), 0.045);
  const poly = polygonField(g, barrel);
  const recess = circleField(g, bb.crownWheelRecess.center, bb.crownWheelRecess.r);
  const channel = sample(g, sdBox(kc.fromX, kc.toX + 2, -kc.halfWidth, kc.halfWidth));
  const holes = jewelHoles(g, BRIDGE_FACE);
  extrude(mb, contourField(g, combine(poly, { neg: fieldMin(recess, holes) })), bb.y.bottom, bb.crownWheelRecess.bottomY, plate);
  extrude(mb, contourField(g, combine(poly, { neg: channel })), bb.crownWheelRecess.bottomY, bb.y.top, { wall: F.bridgeWall });
  for (const r of contourField(g, combine(poly, recess, { neg: channel }))) {
    cap(mb, r.outer, r.holes, bb.crownWheelRecess.bottomY, -1, F.recess);
  }
  yield;

  const pallet = roundCorners(B.palletBridge.outline, 0.3, 3);
  const gP = gridOver(...boundsOf(pallet, 0.3), 0.03);
  extrude(mb, contourField(gP, combine(polygonField(gP, pallet), { neg: jewelHoles(gP, B.palletBridge.y.bottom) })),
    B.palletBridge.y.bottom, B.palletBridge.y.top, { ...plate, bevel: 0.04 });

  // Balance cock: foot on the plate, a riser, the arm over the balance with its boss.
  const ck = B.balanceCock;
  const foot = roundCorners(ck.foot.outline, 0.5, 3);
  const arm = roundCorners(ck.arm.outline, 0.4, 3);
  const gC = gridOver(...boundsOf([...arm, ...foot, [BALANCE[0] - 1.3, BALANCE[1]]], 0.3), 0.035);
  const footF = polygonField(gC, foot);
  const armF = combine(circleField(gC, BALANCE, ck.bossR, polygonField(gC, arm)), { neg: circleField(gC, BALANCE, B.shockSetting.r) });
  extrude(mb, contourField(gC, footF.slice()), ck.foot.y.bottom, ck.foot.y.top, plate);
  extrude(mb, contourField(gC, combine(footF, armF)), ck.arm.y.top, ck.foot.y.bottom, { wall: F.bridgeWall });
  extrude(mb, contourField(gC, armF.slice()), ck.arm.y.bottom, ck.arm.y.top, plate);
  yield;

  // Automatic device framework, over the centre.
  const fw = B.automatic.framework;
  const frame = roundCorners(fw.outline, 0.6, 3);
  const gF = gridOver(...boundsOf(frame, 0.3), 0.04);
  extrude(mb, contourField(gF, combine(polygonField(gF, frame), { neg: jewelHoles(gF, fw.y.bottom, [[ORIGIN, fw.bearingHoleR]]) })),
    fw.y.bottom, fw.y.top, plate);
  yield;

  // Engravings, neutral text only.
  const { balanceCock: onCock, automaticFramework: onFramework } = ENGRAVINGS;
  engrave(mb, onCock.text, 0.3, COCK_FACE - ENGRAVE_PROUD, w => placeStraight(onCock.at, 0, w), F.engraving, 0.1);
  engrave(mb, onFramework.text, 0.4, fw.y.bottom - ENGRAVE_PROUD, w => placeStraight(onFramework.at, 0, w), F.engraving, 0.1);
  regulatorScale(mb);
}

/** Fan of index lines around the fine-adjustment eccentric, with + and - at its ends. */
function regulatorScale(mb: MeshBuilder): void {
  const tip = B.regulator.pointerTip;
  const dir = angleTo(BALANCE, tip);
  const y = COCK_FACE - ENGRAVE_PROUD;
  const bar = (c: Plan, a: number, half: number, w: number): void => {
    const ux = Math.cos(a), uz = Math.sin(a);
    const l: Loop = [
      [c[0] - ux * half + uz * w, c[1] - uz * half - ux * w], [c[0] + ux * half + uz * w, c[1] + uz * half - ux * w],
      [c[0] + ux * half - uz * w, c[1] + uz * half + ux * w], [c[0] - ux * half - uz * w, c[1] - uz * half + ux * w],
    ];
    cap(mb, oriented(l, true), [], y, -1, F.engraving);
  };
  for (let k = -5; k <= 5; k++) {
    const a = dir + k * 0.24;
    const long = k % 5 === 0 ? 0.12 : k === 0 ? 0.1 : 0.07;
    bar(at(tip, 0.47 + long / 2, a), a, long / 2 + 0.07, 0.018);
  }
  const plus = at(tip, 0.78, dir - 1.45), minusAt = at(tip, 0.78, dir + 1.4);
  bar(plus, 0, 0.11, 0.025);
  bar(plus, Math.PI / 2, 0.11, 0.025);
  bar(minusAt, 0, 0.11, 0.025);
}

// ── Small static steel parts and the movement holder ring ───────────────────

function buildSteel(mb: MeshBuilder): void {
  buildRegulator(mb);
  buildShockSetting(mb);

  // Jewel sinks: polished cones from the face down to the stone.
  for (const j of SET_JEWELS) cone(mb, j.at, j.chaton, j.y, j.r + 0.01, j.y + 0.03, F.polished, 32);

  // Inner race of the rotor bearing: fixed to the framework by the rotor screw.
  const race = ROTOR.bearing;
  ring(mb, ORIGIN, 0.74, race.raceInnerR, race.y.bottom, -1, F.steelFace, 40);
  tube(mb, ORIGIN, race.raceInnerR, race.y.bottom, race.y.bottom + 0.1, F.steelWall, true, 40);

  // Barrel: turns once in seven hours, which no one can see; built still.
  const bg = B.barrel.gear;
  const drum = new MeshBuilder();
  wheel(drum, { gear: bg, phase: 0, y0: B.barrel.teethY.bottom, y1: B.barrel.teethY.top, face: F.steelFace, wall: F.steelWall, fine: false });
  tube(drum, ORIGIN, bg.rootR - 0.25, B.barrel.teethY.top, B.barrel.drumY.top, F.steelWall, true, 64);
  append(mb, drum, BARREL);

  // Automatic train under its framework (still: hidden except for slivers).
  const a = B.automatic;
  const hidden: [Plan, Gear, number, Finish, Finish][] = [
    [a.auxReverser.axis, a.auxReverser.gear, a.auxReverser.y.bottom, F.copper, F.copperWall],
    [a.reduction.axis, a.reduction.gear, a.reduction.y.bottom, F.gilt, F.giltWall],
    [a.ratchetDriver.axis, a.ratchetDriver.gear, a.ratchetDriver.y.bottom, F.gilt, F.giltWall],
  ];
  for (const [axis, gear, y0, face, side] of hidden) {
    const w = new MeshBuilder();
    wheel(w, { gear, phase: 0, y0, y1: y0 + 0.06, face, wall: side, fine: false, boreR: 0.12 });
    append(mb, w, axis);
  }
  const dp = new MeshBuilder();
  wheel(dp, { gear: a.ratchetDriver.pinion, phase: 0, y0: a.ratchetDriver.pinionY.bottom, y1: a.ratchetDriver.pinionY.top, face: F.steelFace, wall: F.steelWall, fine: false });
  append(mb, dp, a.ratchetDriver.axis);
}

function append(into: MeshBuilder, part: MeshBuilder, offset: Plan): void {
  const base = into.count;
  for (let i = 0; i < part.pos.length; i += 3) {
    into.pos.push(part.pos[i] + offset[0], part.pos[i + 1], part.pos[i + 2] + offset[1]);
  }
  into.nrm.push(...part.nrm);
  into.col.push(...part.col);
  into.fin.push(...part.fin);
  for (const i of part.idx) into.idx.push(i + base);
}

/** Movement holder ring between the movement and the case; a stem bore at three o'clock. */
function buildCasingRing(mb: MeshBuilder): void {
  const c = B.casingRing;
  const f = F.casing;
  const segs = 180;
  ring(mb, ORIGIN, c.boreR, c.outerR, c.y.bottom, -1, f, segs);
  ring(mb, ORIGIN, c.flangeSeatR, c.outerR, c.y.top, 1, f, segs);
  ring(mb, ORIGIN, c.boreR, c.flangeSeatR, c.seatY, 1, f, segs);
  tube(mb, ORIGIN, c.flangeSeatR, c.seatY, c.y.top, f, false, segs);
  // Inner wall below the seat, with the stem bore: a window round three o'clock is unrolled and cut.
  const half = 1.2 / c.boreR;
  const base = mb.count;
  const n = segs;
  const a0 = half, a1 = TAU - half;
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n, cs = Math.cos(a), sn = Math.sin(a);
    mb.v(c.boreR * cs, c.y.bottom, c.boreR * sn, -cs, 0, -sn, f);
    mb.v(c.boreR * cs, c.seatY, c.boreR * sn, -cs, 0, -sn, f);
  }
  for (let i = 0; i < n; i++) mb.quad(base + i * 2, base + i * 2 + 2, base + i * 2 + 3, base + i * 2 + 1);
  const s = c.boreR * half;
  const windowLoop: Loop = [[-s, c.y.bottom], [s, c.y.bottom], [s, c.seatY], [-s, c.seatY]];
  const hole = circleLoop([0, STEM_Y], c.stemHoleR, false, 0.08);
  cap(mb, windowLoop, [hole], 0, 1, f);
  // The cap was laid flat as (arc length, y); wrap it onto the bore.
  for (let i = base + (n + 1) * 2; i < mb.count; i++) {
    const u = mb.pos[i * 3], y = mb.pos[i * 3 + 2], a = u / c.boreR;
    mb.pos[i * 3] = c.boreR * Math.cos(a); mb.pos[i * 3 + 1] = y; mb.pos[i * 3 + 2] = c.boreR * Math.sin(a);
    mb.nrm[i * 3] = -Math.cos(a); mb.nrm[i * 3 + 1] = 0; mb.nrm[i * 3 + 2] = -Math.sin(a);
  }
  fixWinding(mb, base + (n + 1) * 2);
  // Bore through the ring along +x.
  const bb = mb.count, bs = 20;
  for (let i = 0; i <= bs; i++) {
    const a = i / bs * TAU, y = STEM_Y + c.stemHoleR * Math.cos(a), z = c.stemHoleR * Math.sin(a);
    mb.v(Math.sqrt(c.boreR ** 2 - z * z), y, z, 0, -Math.cos(a), -Math.sin(a), f);
    mb.v(Math.sqrt(c.outerR ** 2 - z * z), y, z, 0, -Math.cos(a), -Math.sin(a), f);
  }
  for (let i = 0; i < bs; i++) mb.quad(bb + i * 2, bb + i * 2 + 2, bb + i * 2 + 3, bb + i * 2 + 1);
}

/** Re-winds the triangles that index vertices from `from` on, after their positions were moved. */
function fixWinding(mb: MeshBuilder, from: number): void {
  const idx = mb.idx;
  const keep: number[] = [];
  const redo: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    if (idx[i] >= from && idx[i + 1] >= from && idx[i + 2] >= from) redo.push(idx[i], idx[i + 1], idx[i + 2]);
    else keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  idx.length = 0;
  idx.push(...keep);
  for (let i = 0; i < redo.length; i += 3) mb.tri(redo[i], redo[i + 1], redo[i + 2]);
}

/** Stud carrier, regulator head with curb pins, regulator pointer with its fork and the eccentric. */
function buildRegulator(mb: MeshBuilder): void {
  const y = COCK_FACE;
  const hs = B.hairspring;
  const studA = hs.studAngle;
  const flat = (sdf: Sdf, y0: number, y1: number, box: [number, number, number, number], face = F.steelFace): void =>
    extrude(mb, contour(sdf, box, 0.03), y0, y1, { bottom: face, wall: F.steelWall });
  const around = (r: number): [number, number, number, number] => [BALANCE[0] - r, BALANCE[1] - r, BALANCE[0] + r, BALANCE[1] + r];

  // Stud carrier: ring on the boss, an arm out to the stud on the outer coil.
  const stud = at(BALANCE, hs.outerR + 0.13, studA);
  flat(union(minus(sdCircle(BALANCE, 1.6), sdCircle(BALANCE, 1.3)), sdCapsule(at(BALANCE, 1.45, studA), stud, 0.17)),
    y - 0.025, y, around(2.6));
  const post = new MeshBuilder();
  extrude(post, [{ outer: oriented(roundCorners([[-0.16, -0.14], [0.16, -0.14], [0.16, 0.14], [-0.16, 0.14]], 0.05, 2), true), holes: [] }],
    y - 0.03, hs.y.top + 0.01, { bottom: F.polished, wall: F.steelWall });
  append(mb, post, stud);

  // Regulator head: ring with a short arm carrying the two curb pins either side of the outer coil.
  const pinsA = studA + 0.32;
  flat(union(minus(sdCircle(BALANCE, 1.45), sdCircle(BALANCE, 1.18)), sdCapsule(at(BALANCE, 1.3, pinsA), at(BALANCE, hs.outerR + 0.2, pinsA), 0.13)),
    y - 0.05, y - 0.025, around(2.6));
  for (const dr of [-0.075, 0.075]) {
    const p = at(BALANCE, hs.outerR + dr, pinsA);
    ring(mb, p, 0, 0.035, y - 0.05, -1, F.polished, 10);
    tube(mb, p, 0.035, y - 0.05, hs.y.top + 0.01, F.polished, true, 10);
  }

  // Pointer: ring round the shock setting, a tapering tail and a fork over the eccentric.
  const tip = B.regulator.pointerTip;
  const dir = angleTo(BALANCE, tip);
  const reach = Math.hypot(...sub2(tip, BALANCE));
  const tail: Loop = oriented([
    at(at(BALANCE, 1.2, dir), 0.2, dir - Math.PI / 2), at(at(BALANCE, reach - 0.28, dir), 0.13, dir - Math.PI / 2),
    at(at(BALANCE, reach - 0.28, dir), 0.13, dir + Math.PI / 2), at(at(BALANCE, 1.2, dir), 0.2, dir + Math.PI / 2),
  ], true);
  const prong = (side: number): Sdf => sdCapsule(at(at(BALANCE, reach - 0.3, dir), 0.2 * side, dir + Math.PI / 2),
    at(at(BALANCE, reach + 0.3, dir), 0.2 * side, dir + Math.PI / 2), 0.06);
  flat(union(minus(sdCircle(BALANCE, 1.4), sdCircle(BALANCE, 1.13)), sdPolygon(tail), prong(1), prong(-1),
    sdCapsule(at(BALANCE, reach - 0.36, dir - 0.05), at(BALANCE, reach - 0.36, dir + 0.05), 0.12)),
  y - 0.075, y - 0.05, [BALANCE[0] - 1.6, Math.min(BALANCE[1], tip[1]) - 1.6, tip[0] + 0.6, Math.max(BALANCE[1], tip[1]) + 1.6], F.polished);

  // Fine-adjustment eccentric: a small slotted head between the prongs.
  const ecc = new MeshBuilder();
  slottedHead(ecc, 0.15, 0.035, y, y - 0.06, F.polished);
  append(mb, ecc, tip);
}

/** Upper shock setting on the cock: polished setting, cap jewel (instanced ruby) and a lyre spring. */
function buildShockSetting(mb: MeshBuilder): void {
  const r = B.shockSetting.r;
  ring(mb, BALANCE, CAP_JEWEL_R + 0.1, r, SETTING_FACE, -1, F.steelFace, 48);
  tube(mb, BALANCE, r, SETTING_FACE, COCK_FACE + 0.05, F.polished, true, 48);
  cone(mb, BALANCE, CAP_JEWEL_R + 0.1, SETTING_FACE, CAP_JEWEL_R, CAP_JEWEL_Y, F.polished, 40);
  // Lyre: two arcs either side of the jewel, joined at the foot, with tips pressing on the jewel.
  const lyre = minus(
    union(
      minus(sdCircle(BALANCE, 0.8), sdCircle(BALANCE, 0.69)),
      sdCapsule(at(BALANCE, 0.74, -Math.PI / 2 - 0.5), at(BALANCE, 0.45, -Math.PI / 2 - 0.25), 0.045),
      sdCapsule(at(BALANCE, 0.74, -Math.PI / 2 + 0.5), at(BALANCE, 0.45, -Math.PI / 2 + 0.25), 0.045),
    ),
    sdBox(BALANCE[0] - 0.28, BALANCE[0] + 0.28, BALANCE[1] - 1.0, BALANCE[1] - 0.5),
    sdBox(BALANCE[0] - 0.18, BALANCE[0] + 0.18, BALANCE[1] + 0.5, BALANCE[1] + 1.0),
  );
  extrude(mb, contour(lyre, [BALANCE[0] - 0.9, BALANCE[1] - 0.9, BALANCE[0] + 0.9, BALANCE[1] + 0.9], 0.016), SETTING_FACE - 0.025, SETTING_FACE,
    { bottom: F.polished, wall: F.steelWall });
}

// ── Screws and jewels (instanced) ───────────────────────────────────────────

/** Slotted head about the local origin from y0 (seat) to y1, slot along local x. */
function slottedHead(mb: MeshBuilder, r: number, slot: number, y0: number, y1: number, f: Finish, edge = 0.12): void {
  const h = y1 - y0, top = r * (1 - edge);
  const ny = h < 0 ? -1 : 1;
  tube(mb, ORIGIN, r, y0, y0 + h * 0.86, f, true, 28);
  cone(mb, ORIGIN, r, y0 + h * 0.86, top, y1, f, 28);
  const slotBox = sdBox(-r - 0.1, r + 0.1, -slot, slot);
  for (const reg of contour(minus(sdCircle(ORIGIN, top), slotBox), [-r, -r, r, r], r / 40, r / 400)) cap(mb, reg.outer, reg.holes, y1, ny, f);
  const sx = Math.sqrt(top * top - slot * slot), floor = y1 - h * 0.5;
  const slotLoop: Loop = [[-sx, -slot], [sx, -slot], [sx, slot], [-sx, slot]];
  cap(mb, slotLoop, [], floor, ny, F.screwSlot);
  wall(mb, slotLoop.slice().reverse(), Math.min(floor, y1), Math.max(floor, y1), F.screwSlot);
}

/** Unit screw head: radius 1, standing from y 0 to y -1, slot along local x. */
function screwGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  slottedHead(mb, 1, 0.13, 0, -1, F.screw);
  return mb.geometry();
}

function buildScrews(metal: THREE.Material): THREE.InstancedMesh {
  const list = SCREWS.backSide;
  const mesh = new THREE.InstancedMesh(screwGeometry(), metal, list.length);
  mesh.name = 'Schrauben (gebläut)';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((sc, i) => {
    const h = Math.abs(sc.rise) > 0 ? Math.abs(sc.rise) : 0.03;
    // Heads standing towards the dial (rise > 0) are mirrored upwards.
    s.set(sc.headR, sc.rise > 0 ? -h : h, sc.headR);
    p.set(sc.at[0], sc.seatY - (sc.rise === 0 ? 0.004 : 0), sc.at[1]);
    q.setFromAxisAngle(up, -sc.slot);
    mesh.setMatrixAt(i, m.compose(p, q, s));
    mesh.setColorAt(i, BLUED);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Unit ruby: radius 1, a slight dome towards -y, the pivot hole dark. */
function rubyGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const segs = 28;
  const red = F.ruby, hole = finish(0x2a0408, POLISH, 0.2, 0);
  const rings: [number, number, Finish][] = [[0, -0.02, hole], [0.2, -0.02, hole], [0.24, -0.035, red], [0.6, -0.03, red], [1, 0, red]];
  for (let k = 0; k < rings.length - 1; k++) {
    const [r0, y0, f0] = rings[k], [r1, y1] = rings[k + 1];
    const base = mb.count;
    for (let i = 0; i <= segs; i++) {
      const a = i / segs * TAU, cs = Math.cos(a), sn = Math.sin(a);
      const slope = (y1 - y0) / Math.max(1e-3, r1 - r0);
      mb.v(r0 * cs, y0, r0 * sn, slope * cs, -1, slope * sn, f0);
      mb.v(r1 * cs, y1, r1 * sn, slope * cs, -1, slope * sn, f0);
    }
    for (let i = 0; i < segs; i++) mb.quad(base + i * 2, base + i * 2 + 2, base + i * 2 + 3, base + i * 2 + 1);
  }
  return mb.geometry();
}

function buildJewels(ruby: THREE.Material): THREE.InstancedMesh {
  const list: { at: Plan; r: number; y: number }[] = SET_JEWELS.map(j => ({ at: j.at, r: j.r, y: j.y + 0.03 }));
  list.push({ at: BALANCE, r: CAP_JEWEL_R, y: CAP_JEWEL_Y });
  const mesh = new THREE.InstancedMesh(rubyGeometry(), ruby, list.length);
  mesh.name = 'Lagersteine';
  const m = new THREE.Matrix4();
  list.forEach((j, i) => mesh.setMatrixAt(i, m.makeScale(j.r, 1, j.r).setPosition(j.at[0], j.y, j.at[1])));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// ── Moving parts ────────────────────────────────────────────────────────────

/** Balance: gilt rim, three arms, staff, hairspring collet, roller with the impulse pin. */
function buildBalance(): MeshBuilder {
  const b = B.balance;
  const mb = new MeshBuilder();
  const pinAngle = angleTo(BALANCE, PALLET);
  const segs = 96;
  ring(mb, ORIGIN, b.rimInnerR + 0.03, b.rimOuterR - 0.03, b.y.bottom, -1, F.giltPolish, segs);
  cone(mb, ORIGIN, b.rimOuterR - 0.03, b.y.bottom, b.rimOuterR, b.y.bottom + 0.03, F.giltPolish, segs);
  cone(mb, ORIGIN, b.rimInnerR + 0.03, b.y.bottom, b.rimInnerR, b.y.bottom + 0.03, F.giltPolish, segs);
  tube(mb, ORIGIN, b.rimOuterR, b.y.bottom + 0.03, b.y.top, F.giltWall, true, segs);
  tube(mb, ORIGIN, b.rimInnerR, b.y.bottom + 0.03, b.y.top, F.giltWall, false, segs);
  const arms: Sdf[] = [];
  for (let k = 0; k < b.arms; k++) {
    const a = pinAngle + Math.PI / 3 + k * TAU / b.arms;
    arms.push(sdCapsule(at(ORIGIN, 0.3, a), at(ORIGIN, b.rimInnerR + 0.1, a), b.armWidth / 2));
  }
  extrude(mb, contour(minus(union(...arms, sdCircle(ORIGIN, b.hubR + 0.08)), sdCircle(ORIGIN, b.staff.r + 0.02)), [-b.rimInnerR - 0.3, -b.rimInnerR - 0.3, b.rimInnerR + 0.3, b.rimInnerR + 0.3], 0.03),
    b.armY.bottom, b.armY.top, { bottom: F.gilt, wall: F.giltWall });
  // Staff and collet of the hairspring.
  tube(mb, ORIGIN, b.staff.r, b.staff.y.bottom, B.palletFork.y.top, F.polished, true, 12);
  ring(mb, ORIGIN, 0, b.staff.r, b.staff.y.bottom, -1, F.polished, 12);
  const hs = B.hairspring;
  ring(mb, ORIGIN, b.staff.r, hs.innerR, hs.y.bottom, -1, F.steelFace, 20);
  tube(mb, ORIGIN, hs.innerR, hs.y.bottom, hs.y.top, F.steelWall, true, 20);
  ring(mb, ORIGIN, b.staff.r, b.hubR, b.armY.bottom - 0.04, -1, F.polished, 20);
  tube(mb, ORIGIN, b.hubR, b.armY.bottom - 0.04, b.armY.bottom, F.polished, true, 20);
  // Roller and impulse pin (ruby), pointing at the fork at rest.
  ring(mb, ORIGIN, b.staff.r, b.roller.r, b.roller.y.bottom, -1, F.steelFace, 28);
  tube(mb, ORIGIN, b.roller.r, b.roller.y.bottom, b.roller.y.top, F.steelWall, true, 28);
  const pin = at(ORIGIN, b.roller.impulsePin.at, pinAngle);
  ring(mb, pin, 0, b.roller.impulsePin.r, b.roller.y.bottom - 0.06, -1, F.ruby, 10);
  tube(mb, pin, b.roller.impulsePin.r, b.roller.y.bottom - 0.06, B.palletFork.y.top, F.ruby, true, 10);
  return mb;
}

interface Hairspring { mesh: THREE.Mesh; set(angle: number): void }

/** Flat Archimedean spiral: the inner end turns with the balance, the outer end
 * is held at the stud, so the coils between them breathe. */
function buildHairspring(metal: THREE.Material): Hairspring {
  const hs = B.hairspring;
  const n = hs.turns * HAIRSPRING_POINTS_PER_TURN;
  const w = HAIRSPRING_STRIP / 2;
  const mb = new MeshBuilder();
  const radius = new Float32Array(n + 1), base = new Float32Array(n + 1), free = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    radius[i] = hs.innerR + (hs.outerR - hs.innerR) * t;
    base[i] = hs.studAngle - TAU * hs.turns * (1 - t);
    free[i] = 1 - t;
    const cs = Math.cos(base[i]), sn = Math.sin(base[i]), ri = radius[i] - w, ro = radius[i] + w;
    mb.v(ri * cs, hs.y.bottom, ri * sn, 0, -1, 0, F.hairspring);
    mb.v(ro * cs, hs.y.bottom, ro * sn, 0, -1, 0, F.hairspring);
    mb.v(ro * cs, hs.y.bottom, ro * sn, cs, 0, sn, F.hairspring);
    mb.v(ro * cs, hs.y.top, ro * sn, cs, 0, sn, F.hairspring);
    mb.v(ri * cs, hs.y.bottom, ri * sn, -cs, 0, -sn, F.hairspring);
    mb.v(ri * cs, hs.y.top, ri * sn, -cs, 0, -sn, F.hairspring);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 6, b = a + 6;
    mb.quad(a, a + 1, b + 1, b);
    mb.quad(a + 2, b + 2, b + 3, a + 3);
    mb.quad(a + 4, b + 4, b + 5, a + 5);
  }
  const geometry = mb.geometry();
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  position.setUsage(THREE.DynamicDrawUsage);
  normal.setUsage(THREE.DynamicDrawUsage);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (hs.y.bottom + hs.y.top) / 2, 0), hs.outerR + 0.1);
  const mesh = new THREE.Mesh(geometry, metal);
  mesh.name = 'Spirale';
  mesh.position.set(BALANCE[0], 0, BALANCE[1]);
  const P = position.array as Float32Array, N = normal.array as Float32Array;
  const state = { shown: 0 };
  return {
    mesh,
    set(angle: number): void {
      if (Math.abs(angle - state.shown) < 1e-4) return;
      state.shown = angle;
      for (let i = 0; i <= n; i++) {
        const a = base[i] - angle * free[i];
        const cs = Math.cos(a), sn = Math.sin(a), ri = radius[i] - w, ro = radius[i] + w;
        const k = i * 18;
        P[k] = ri * cs; P[k + 2] = ri * sn;
        P[k + 3] = ro * cs; P[k + 5] = ro * sn;
        P[k + 6] = ro * cs; P[k + 8] = ro * sn;
        P[k + 9] = ro * cs; P[k + 11] = ro * sn;
        P[k + 12] = ri * cs; P[k + 14] = ri * sn;
        P[k + 15] = ri * cs; P[k + 17] = ri * sn;
        N[k + 6] = cs; N[k + 8] = sn; N[k + 9] = cs; N[k + 11] = sn;
        N[k + 12] = -cs; N[k + 14] = -sn; N[k + 15] = -cs; N[k + 17] = -sn;
      }
      position.needsUpdate = true;
      normal.needsUpdate = true;
    },
  };
}

/** Escape wheel: 20 club teeth leaning the way it turns, four spokes, pinion and arbor. */
function buildEscapeWheel(phase: number): MeshBuilder {
  const e = B.escapeWheel;
  const mb = new MeshBuilder();
  const p = TAU / e.teeth;
  const outline: Loop = [];
  for (let k = 0; k < e.teeth; k++) {
    const a = phase + k * p;
    outline.push(
      at(ORIGIN, e.rootR, a - 0.1 * p), at(ORIGIN, e.tipR - 0.05, a - 0.27 * p), at(ORIGIN, e.tipR, a - 0.3 * p),
      at(ORIGIN, e.tipR - 0.14, a - 0.02 * p), at(ORIGIN, e.rootR + 0.22, a + 0.22 * p), at(ORIGIN, e.rootR, a + 0.45 * p),
      at(ORIGIN, e.rootR - 0.02, a + 0.68 * p),
    );
  }
  const holes = spokeWindows(e.spokes, e.rimInnerR, 0.38, 0.17, phase);
  extrude(mb, [{ outer: oriented(outline, true), holes }], e.y.bottom, e.y.top, { bottom: { ...F.steelFace, p: POLISH, r: 0.14 }, wall: F.steelWall });
  wheel(mb, { gear: e.pinion, phase, y0: e.pinionY.bottom, y1: e.pinionY.top, face: F.steelFace, wall: F.steelWall, fine: false });
  tube(mb, ORIGIN, 0.09, e.arborY.bottom, e.y.bottom, F.polished, true, 10);
  return mb;
}

/** Pallet fork with its two ruby stones, in the frame of its own axis. */
function buildPalletFork(): MeshBuilder {
  const pf = B.palletFork;
  const mb = new MeshBuilder();
  const rel = (p: Plan): Pt => sub2(p, PALLET);
  const tip = rel(pf.forkTip), esc = rel(ESCAPE);
  const len = Math.hypot(tip[0], tip[1]);
  const u: Pt = [tip[0] / len, tip[1] / len], v: Pt = [-u[1], u[0]];
  const local = (s: number, t: number): Pt => [u[0] * s + v[0] * t, u[1] * s + v[1] * t];
  const [sl, sw] = [pf.stoneSize[0], pf.stoneSize[1]];
  const stones: Sdf[] = [];
  const arms: Sdf[] = [];
  for (const stone of [pf.entryStone, pf.exitStone]) {
    const s0 = rel(stone);
    const dx = s0[0] - esc[0], dz = s0[1] - esc[1], dl = Math.hypot(dx, dz);
    const d: Pt = [dx / dl, dz / dl];
    const a = s0, b: Pt = [s0[0] + d[0] * sl, s0[1] + d[1] * sl];
    const box: Loop = [
      [a[0] - d[1] * sw / 2, a[1] + d[0] * sw / 2], [b[0] - d[1] * sw / 2, b[1] + d[0] * sw / 2],
      [b[0] + d[1] * sw / 2, b[1] - d[0] * sw / 2], [a[0] + d[1] * sw / 2, a[1] - d[0] * sw / 2],
    ];
    stones.push(sdPolygon(oriented(box, true)));
    arms.push(sdCapsule([0, 0], [s0[0] + d[0] * sl * 0.75, s0[1] + d[1] * sl * 0.75], 0.15));
  }
  const head = sdPolygon(oriented([local(len - 0.6, -0.3), local(len, -0.32), local(len, 0.32), local(len - 0.6, 0.3)], true));
  const slot = sdBox(-0.11, 0.11, -0.32, 0.32);
  const slotAt: Sdf = (x, z) => slot(x * u[1] - z * u[0], x * u[0] + z * u[1] - len);
  const lever = sdCapsule([0, 0], local(len - 0.5, 0), 0.12);
  const body = minus(union(...arms, lever, head, sdCircle([0, 0], 0.32)), ...stones, slotAt);
  const box = boundsOf([[0, 0], tip, rel(pf.entryStone), rel(pf.exitStone)], 0.8);
  extrude(mb, contour(body, box, 0.025), pf.y.bottom, pf.y.top, { bottom: F.steelFace, wall: F.steelWall });
  extrude(mb, contour(union(...stones), box, 0.02), pf.y.bottom, pf.y.top, { bottom: F.ruby, wall: F.ruby });
  tube(mb, ORIGIN, 0.08, B.palletBridge.y.bottom, pf.y.bottom, F.polished, true, 10);
  return mb;
}

function buildTrainWheel(gear: Gear, y0: number, y1: number, spokes: number, arbor: { bottom: number; top: number }): MeshBuilder {
  const mb = new MeshBuilder();
  wheel(mb, { gear, phase: 0, y0, y1, face: F.gilt, wall: F.giltWall, spokes, rim: 0.32, hubR: 0.55, spokeW: 0.22 });
  tube(mb, ORIGIN, 0.12, arbor.bottom, y0, F.polished, true, 12);
  ring(mb, ORIGIN, 0, 0.12, arbor.bottom, -1, F.polished, 12);
  return mb;
}

function buildReverser(): MeshBuilder {
  const rv = B.automatic.reverser;
  const mb = new MeshBuilder();
  const holes: Loop[] = [];
  for (let k = 0; k < 5; k++) holes.push(circleLoop(at(ORIGIN, 0.82, k * TAU / 5), 0.26, false, 0.06));
  wheel(mb, { gear: rv.gear, phase: 0, y0: rv.y.bottom, y1: rv.y.top, face: F.copper, wall: F.copperWall, boreR: 0.14, holes });
  return mb;
}

/** Oscillating weight on its ball bearing, built in its own frame (heavy side towards local +z). */
function* buildRotor(): Generator<void, MeshBuilder, void> {
  const R = ROTOR.rim.outerR, rc = ROTOR.cornerR;
  const mb = new MeshBuilder();
  // Half disc with rounded ends: the exact distance to the eroded segment, minus the rounding.
  const Rp = R - rc, c = rc, xc = Math.sqrt(Rp * Rp - c * c), aMin = Math.asin(c / Rp);
  const halfDisc: Sdf = (x, z) => {
    const len = Math.hypot(x, z);
    if (len <= Rp && z >= c) return -Math.min(Rp - len, z - c) - rc;
    let d = Math.min(Math.hypot(x - xc, z - c), Math.hypot(x + xc, z - c));
    const a = Math.atan2(z, x);
    if (a >= aMin && a <= Math.PI - aMin) d = Math.min(d, Math.abs(len - Rp));
    if (Math.abs(x) <= xc && z < c) d = Math.min(d, c - z);
    return d - rc;
  };
  const hub = sdCircle(ORIGIN, ROTOR.hubR + 0.3);
  const k = 0.8;
  const body: Sdf = (x, z) => {
    const a = halfDisc(x, z), b = hub(x, z), h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k / 4;
  };
  const solid = minus(body, sdCircle(ORIGIN, ROTOR.plateHoleR));
  const box: [number, number, number, number] = [-R - 0.2, -ROTOR.hubR - 0.6, R + 0.2, R + 0.2];
  const g = gridOver(box[0], box[1], box[2], box[3], 0.06);
  const field = sample(g, solid);
  const r = circleField(g, ORIGIN, 0);
  yield;
  const band = (r0: number, r1: number): Region[] => {
    const f = field.slice();
    for (let i = 0; i < f.length; i++) f[i] = Math.max(f[i], r0 - r[i], r[i] - r1);
    return contourField(g, f, 0.003);
  };
  const e = ROTOR.envelope;
  const slope = (e.edgeY - e.flatY) / (e.edgeR - e.coneFromR);
  const surface = (regions: Region[], fin: Finish): void => {
    for (const reg of regions) {
      const base = mb.count;
      cap(mb, reg.outer, reg.holes, e.flatY, -1, fin);
      for (let i = base; i < mb.count; i++) {
        const x = mb.pos[i * 3], z = mb.pos[i * 3 + 2], rr = Math.hypot(x, z);
        if (rr > e.coneFromR) {
          mb.pos[i * 3 + 1] = rotorEnvelopeY(rr);
          const l = Math.hypot(slope, 1);
          mb.nrm[i * 3] = slope * x / rr / l; mb.nrm[i * 3 + 1] = -1 / l; mb.nrm[i * 3 + 2] = slope * z / rr / l;
        }
      }
    }
  };
  // The cone is laid in polar strips: a flat triangulation lifted onto it would leave the surface along
  // its long chords, and the polished band shows every such facet.
  // The outer row lies on the boundary itself: points within 1 µm count as inside.
  const inside = (x: number, z: number): boolean => solid(x, z) <= 1e-3;
  const edgeAngle = (rr: number): number => {
    let lo = 0, hi = Math.PI / 2;
    if (inside(rr, 0)) return 0;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inside(rr * Math.cos(mid), rr * Math.sin(mid))) hi = mid; else lo = mid;
    }
    return hi;
  };
  const coneStrip = (r0: number, r1: number, fin: Finish): void => {
    const rows = Math.max(1, Math.ceil((r1 - r0) / 0.25));
    const cols = Math.ceil(Math.PI * r1 / 0.25);
    const l = Math.hypot(slope, 1);
    const base = mb.count;
    for (let i = 0; i <= rows; i++) {
      const rr = r0 + (r1 - r0) * i / rows;
      const a0 = edgeAngle(rr), a1 = Math.PI - a0;
      for (let j = 0; j <= cols; j++) {
        const a = a0 + (a1 - a0) * j / cols, cs = Math.cos(a), sn = Math.sin(a);
        mb.v(rr * cs, rotorEnvelopeY(rr), rr * sn, slope * cs / l, -1 / l, slope * sn / l, fin);
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const k = base + i * (cols + 1) + j;
        mb.quad(k, k + 1, k + cols + 2, k + cols + 1);
      }
    }
  };
  const { hub: hubRing, middle: midRing } = ROTOR.rings;
  surface(band(0, hubRing[0]), F.rotorHub);
  surface(band(hubRing[0], hubRing[1]), F.rotorRing);
  surface(band(hubRing[1], midRing[0]), F.rotor);
  surface(band(midRing[0], midRing[1]), F.rotorRing);
  surface(band(midRing[1], e.coneFromR), F.rotor);
  coneStrip(e.coneFromR, ROTOR.rim.innerR, F.rotorRing);
  coneStrip(ROTOR.rim.innerR, R, F.heavy);
  yield;

  // Edge walls: their foot follows the cone, their top steps up to the rim's inner face.
  const walls = contourField(g, field.slice(), 0.003);
  for (const reg of walls) {
    for (const loop of [reg.outer, ...reg.holes]) {
      const pts: Loop = [];
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        const ra = Math.hypot(a[0], a[1]), rb = Math.hypot(b[0], b[1]);
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.3));
        pts.push(a);
        const cuts: number[] = [];
        for (const rr of [e.coneFromR, ROTOR.rim.innerR]) {
          if ((ra - rr) * (rb - rr) < 0) cuts.push((rr - ra) / (rb - ra));
        }
        for (let s = 1; s < steps; s++) cuts.push(s / steps);
        cuts.sort((p, q) => p - q);
        for (const t of cuts) pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const ra = Math.hypot(a[0], a[1]), rb = Math.hypot(b[0], b[1]);
        const ex = b[0] - a[0], ez = b[1] - a[1], len = Math.hypot(ex, ez);
        if (len < 1e-6) continue;
        const nx = ez / len, nz = -ex / len;
        const heavy = (ra + rb) / 2 > ROTOR.rim.innerR;
        const top = heavy ? ROTOR.rim.innerFaceY : ROTOR.plate.y.top;
        const f = heavy ? F.heavyWall : F.rotorRing;
        const i0 = mb.v(a[0], rotorEnvelopeY(ra), a[1], nx, 0, nz, f);
        const i1 = mb.v(b[0], rotorEnvelopeY(rb), b[1], nx, 0, nz, f);
        const i2 = mb.v(b[0], top, b[1], nx, 0, nz, f);
        const i3 = mb.v(a[0], top, a[1], nx, 0, nz, f);
        mb.quad(i0, i1, i2, i3);
      }
    }
  }

  yield;
  // Engraving on the flat of the weight.
  const yText = e.flatY - ENGRAVE_PROUD;
  const [outerText, innerText] = ENGRAVINGS.rotor;
  // The weight comes to rest with its heavy side at the bottom of the picture: the letters stand on
  // the inner side of their band so that they read upright there.
  engrave(mb, outerText, 0.72, yText, w => placeArcInward(ORIGIN, 8.15 + 0.72, Math.PI / 2, w), F.engraving, 0.16);
  engrave(mb, innerText, 0.5, yText, w => placeArcInward(ORIGIN, 5.6 + 0.5, Math.PI / 2, w), F.engraving, 0.2);

  // Ball bearing: knurled outer race and shield turn with the weight; the inner race is fixed (steel mesh).
  const bearing = ROTOR.bearing;
  const knurlR = ROTOR.raceKnurlR;
  const knurl = gearLoop({ teeth: 40, module: 0.06, pitchR: knurlR - 0.06, tipR: knurlR, rootR: knurlR - 0.13 }, 0, false);
  const raceY = e.flatY + 0.02;
  extrude(mb, [{ outer: knurl, holes: [circleLoop(ORIGIN, bearing.raceOuterR, false, 0.1)] }], raceY, ROTOR.plate.y.top, { bottom: F.gilt, wall: F.giltWall, minLoop: 100 });
  tube(mb, ORIGIN, bearing.raceOuterR, raceY, raceY + 0.04, F.giltWall, false, 48);
  ring(mb, ORIGIN, bearing.raceInnerR, bearing.raceOuterR, raceY + 0.04, -1, F.seal, 48);
  tube(mb, ORIGIN, bearing.raceInnerR, raceY + 0.04, raceY + 0.1, F.dark, false, 48);
  wall(mb, knurl, raceY, ROTOR.plate.y.top, F.giltWall);
  tube(mb, ORIGIN, 2.1, ROTOR.plate.y.top, BODY_BACK_Y + 0.25, F.giltWall, true, 40);
  const rg = B.automatic.rotorGear;
  wheel(mb, { gear: rg.gear, phase: 0, y0: rg.y.bottom, y1: rg.y.top, face: F.gilt, wall: F.giltWall, fine: false, boreR: 1.9 });
  return mb;
}

// ── Assembly ────────────────────────────────────────────────────────────────

/** The rotor side of the movement, built at once. */
export function makeBackSide(materials: WatchMaterials): BackSide {
  const build = buildBackSide(materials);
  let slice = build.next();
  while (!slice.done) slice = build.next();
  return slice.value;
}

/** The same build in slices of a few tens of milliseconds, one per `next()`. */
export function* buildBackSide(_materials: WatchMaterials): Generator<void, BackSide, void> {
  const group = new THREE.Group();
  group.name = 'Werk · Rotorseite';
  const rotorSide = new THREE.Group();
  rotorSide.name = 'Werk · nur von hinten';
  const metal = makeMetal();
  const ruby = makeRuby();
  const add = (name: string, mb: MeshBuilder, axis?: Plan, parent: THREE.Group = rotorSide): THREE.Mesh => {
    const mesh = new THREE.Mesh(mb.geometry(), metal);
    mesh.name = name;
    if (axis) mesh.position.set(axis[0], 0, axis[1]);
    parent.add(mesh);
    return mesh;
  };

  const plateBuilder = new MeshBuilder();
  yield* buildPlate(plateBuilder);
  buildCasingRing(plateBuilder);
  const plate = add('Werkplatte (Perlage), Werkhaltering', plateBuilder, undefined, group);
  yield;
  const bridges = new MeshBuilder();
  yield* buildBridges(bridges);
  add('Brücken, Unruhkloben, Automatikgestell (Genfer Streifen)', bridges);
  yield;
  const steel = new MeshBuilder();
  buildSteel(steel);
  add('Stahlteile, Rücker, Lagerring', steel);
  rotorSide.add(buildScrews(metal), buildJewels(ruby));
  yield;

  const balance = add(B.balance.name, buildBalance(), BALANCE);
  const hairspring = buildHairspring(metal);
  rotorSide.add(hairspring.mesh);
  const escapeLock = angleTo(ESCAPE, B.palletFork.entryStone) + 0.35 * TAU / B.escapeWheel.teeth;
  const escape = add(B.escapeWheel.name, buildEscapeWheel(escapeLock), ESCAPE);
  const pallet = add(B.palletFork.name, buildPalletFork(), PALLET);
  yield;
  const fw = B.fourthWheel, tw = B.thirdWheel, cw = B.centreWheel;
  const fourth = add(fw.name, buildTrainWheel(fw.gear, fw.y.bottom, fw.y.top, fw.spokes, { bottom: fw.arborY.bottom, top: fw.y.bottom }), ORIGIN);
  const third = add(tw.name, buildTrainWheel(tw.gear, tw.y.bottom, tw.y.top, tw.spokes, { bottom: tw.arborY.bottom, top: tw.y.bottom }), THIRD);
  const centre = add(cw.name, buildTrainWheel(cw.gear, cw.y.bottom, cw.y.top, cw.spokes, { bottom: fw.y.top + 0.02, top: cw.y.bottom }), ORIGIN);
  const reverser = add(B.automatic.reverser.name, buildReverser(), B.automatic.reverser.axis);
  yield;
  const rotor = add(ROTOR.name, yield* buildRotor(), ROTOR.axis);
  group.add(rotorSide);

  // Kept between frames in one object: doubles in object fields are updated in place.
  const st = { amplitude: 0, swing: 0 };

  return {
    group,
    plate,
    rotorSide,
    update(s: MovementState): void {
      const dt = Math.min(0.1, Math.max(0, s.dt));
      rotor.rotation.y = s.rotor;
      reverser.rotation.y = reverserAngle(s.rotor);

      // Going train and escapement follow the running time (displaySeconds only advances while
      // the balance runs). The balance swings while running and stays where it stopped.
      if (s.running) {
        const target = stopLeverEngagement(s.crownPull) < 0.5 ? B.balance.amplitude : 0;
        st.amplitude += (target - st.amplitude) * (1 - Math.exp(-dt / AMPLITUDE_EASE));
        st.swing = balanceAngle(s.seconds, st.amplitude);
      } else {
        st.amplitude = 0;
      }
      balance.rotation.y = st.swing;
      hairspring.set(st.swing);
      escape.rotation.y = escapeWheelAngle(s.seconds);
      pallet.rotation.y = palletAngle(s.seconds);
      fourth.rotation.y = fourthWheelAngle(s.seconds);
      third.rotation.y = thirdWheelAngle(s.seconds);
      centre.rotation.y = centreWheelAngle(s.seconds);
    },
  };
}
