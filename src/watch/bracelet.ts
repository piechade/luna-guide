import * as THREE from 'three';
import { CASE_R, GROUND_Y, LUG_INNER_X, SPRING_BAR_Y, SPRING_BAR_Z } from './dimensions';
import type { WatchMaterials } from './materials';

// The bracelet is laid out in the side plane first (z towards six o'clock, y up):
// a line of pins runs from the end link down to the clasp, and every link is an
// outline in that plane extruded across x. Only the six o'clock half is built;
// the twelve o'clock half is its mirror image, apart from the last links at the
// clasp. The clasp closes the loop below, resting on GROUND_Y as if the watch
// sat on an invisible display cushion.
//
// Everything ends up in four merged meshes (four draw calls): satin, polished,
// pin heads and the shadowed depths of gaps and holes.

// ── Proportions in millimetres ─────────────────────────────────────────────

/** Seven rows: wide satin, narrow polished, medium satin, … */
const ROW_SHARE = [4.85, 1.4, 3.05, 1.4, 3.05, 1.4, 4.85];
/** Half the bracelet width at the lugs; leaves a hair of air to the lug walls. */
const HALF_WIDTH = LUG_INNER_X - 0.12;
/** Clearance between neighbouring rows. */
const ROW_GAP = 0.1;
/** Width at the clasp relative to the lugs (21 → 17 mm). */
const CLASP_TAPER = 0.8;

/** Every link holds two pins; neighbouring rows share them half a pitch apart. With this spacing
 * an odd pin, the kind on which the wide rows can end in a half link, falls on the clasp hinge. */
const PIN_SPACING = 3.6;
/** Clearance between two links of the same row. */
const LINK_GAP = 0.14;
/** A link reaches this far either side of its centre. Its ends stay within LINK_NOSE of their
 * own pin, so neighbours in a row never collide however they hinge. */
const LINK_HALF = PIN_SPACING - LINK_GAP / 2;
const LINK_NOSE = LINK_HALF - PIN_SPACING / 2;
/** Height of the domed top above the pin line and depth of the flatter underside below it. */
const LINK_TOP = 1.5;
const LINK_BOTTOM = 1.25;
/** Superellipse exponents of the top and the underside (2 = ellipse, larger = boxier). */
const TOP_POWER = 2.4;
const BOTTOM_POWER = 2.8;
/** Outline segments per quarter of a link, top and underside. */
const TOP_STEPS = 10;
const BOTTOM_STEPS = 5;
/** Segments of a rounded edge between a link's top and its flank. */
const FILLET_STEPS = 2;

/** First real pivot: the pin that passes through the fingers of the end link. */
const END_PIVOT = { z: SPRING_BAR_Z, y: SPRING_BAR_Y };
/** Slope of the rigid end link where it reaches that pin: it follows the horns down from the case. */
const END_LINK_ANGLE = rad(-45);
/** The end link seat follows the case flank between the horns (case.ts): CASE_R plus a hair of
 * air at the equator, drawn in by SEAT_BARREL × height² above and below. The link's top and
 * underside meet the case here. */
const SEAT_CLEARANCE = 0.06;
const SEAT_EQUATOR_Y = -0.6;
const SEAT_BARREL = 0.04;
/** Top of the seat: a hair below the edge of the case flank between the horns (y = 1.95), so
 * the end link starts flush with the horns and the polished chamfer of the case stays free. */
const SEAT_TOP_Y = 1.85;
/** The stubs of the narrow rows start a little lower, which keeps the rows legible at the case,
 * and join the outline of a link at this angle from its tip. */
const STUB_TOP_Y = SEAT_TOP_Y - 0.12;
const STUB_NOSE = rad(20);
const SEAT_BOTTOM_Y = -2.6;
/** Spring-bar notch in the underside of the end link at each outer corner: its length along the
 * end link, the loft stations it reaches in from the flank, and the bar whose tip shows in it. */
const NOTCH_LENGTH = 1.3;
const NOTCH_STATIONS = 3;
const SPRING_BAR_R = 0.42;

/** Heading of the bracelet where it leaves the end link (0 = towards six, −90° = straight down). */
const LEAVE_ANGLE = rad(-52);
/** The loop is a belt around two rollers (shoulder and lower corner) joined by a shallow side arc.
 * The radii set the length of the pin line, and with it which pin falls on the clasp hinge and
 * how far that pin lies from the middle of the clasp arc: change them only together. */
const SHOULDER_R = 13;
const SIDE_R = 55;
const CORNER_R = 19.07;

/** Pin-line radius of the shallow arc on which the loop rests, and how far either side of its
 * middle that arc reaches before the lower corner takes over. */
const CLASP_R = 52;
const CLASP_ARC = 19;
/** The taper to the clasp width is complete this far from the middle of that arc. */
const TAPER_END = 20;

/** The clasp hinge is the odd pin nearest this distance from the middle, towards six o'clock;
 * that centres the clasp, which reaches one link nose further and ends on the tip of its flap. */
const HINGE_OFFSET = 5.3;
/** Safety flap, a polished sheet lying on the links. Heights are measured outwards from the pin
 * line: outer face and thickness, half width of the centre tongue, corner radius of its tip. */
const FLAP_TOP = 1.8;
const FLAP_SHEET = 0.5;
const TONGUE_HALF = 3.7;
const TONGUE_CORNER = 0.55;
/** The flap covers the noses of the links that end below its tip and below its arms by this much. */
const FLAP_TUCK = 0.2;
/** The arms either side of the tongue start this far behind the hinge edge of the flap. */
const ARM_SETBACK = 0.6;
/** Lift tab on the hinge end of the flap: length, half width and height above the flap. */
const TAB_LENGTH = 3.1;
const TAB_HALF = 3.45;
const TAB_RISE = 0.4;
/** Cheeks that carry the flap on the hinge pin: thickness, air to the bracelet flank, lower
 * edge, and how far their rounded ears reach beyond the pin. */
const CHEEK = 0.75;
const CHEEK_GAP = 0.05;
const CHEEK_SKIRT = -0.9;
const EAR_REACH = 1.9;
/** Hinge barrel of the flap between the wide hinge links: radius and height of its axis. */
const BARREL_R = 0.72;
const BARREL_HEIGHT = 0.58;
/** Folded blade inside the loop: its two faces, length from its hinge, half width at the hinge
 * and at the far end, the fork cut out of the hinge end and the slot near the far end. */
const BLADE_OUTER = -1.4;
const BLADE_INNER = -1.95;
const BLADE_LENGTH = 22;
const BLADE_HALF = 4.4;
const BLADE_END_HALF = 3.4;
const FORK_LENGTH = 7;
const FORK_HALF = 2.9;
const SLOT_FROM_END = 1.6;
const SLOT_LENGTH = 3.2;
const SLOT_HALF = 1.7;

/** The shadow sheet on the pin line stops this far inside the bracelet flanks. */
const CORE_INSET = 0.6;

/** Texture coordinates are millimetres × this factor: u across the bracelet, v along it. */
const UV_SCALE = 0.1;
/** Roughness of the satin finish relative to the shared brushed steel. */
const SATIN_ROUGHNESS = 1.5;

// ── Small vector helpers ───────────────────────────────────────────────────

/** x, y, z and the distance along the bracelet (texture v); optionally the texture position
 * across the bracelet where that is not simply x. */
type Pt = [x: number, y: number, z: number, along: number, across?: number];
type Vec3 = [number, number, number];
/** A point of the side plane: [z, y], or of a local frame: [along, outward]. */
type Vec2 = [number, number];

function rad(degrees: number): number { return degrees * Math.PI / 180; }
const X_AXIS: Vec3 = [1, 0, 0];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3 | Pt, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const samePoint = (a: Pt, b: Pt): boolean => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-6;
const distance = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const cubic = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 => {
  const u = 1 - t;
  return [0, 1].map(i => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]) as Vec2;
};

// ── Mesh accumulation ──────────────────────────────────────────────────────

/** Collects vertices and triangles of everything that shares one material. */
class Surface {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly idx: number[] = [];

  vertex(p: Pt, n: Vec3): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push((p[4] ?? p[0]) * UV_SCALE, p[3] * UV_SCALE);
    return this.pos.length / 3 - 1;
  }

  /** Adds a triangle, wound so that it faces along its vertex normals; collapsed ones are dropped. */
  tri(a: number, b: number, c: number): void {
    const p = this.pos, n = this.nrm;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * fx + fy * fy + fz * fz < 1e-12) return;
    const facing = fx * (n[a * 3] + n[b * 3] + n[c * 3]) + fy * (n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1]) + fz * (n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]);
    if (facing >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }

  quad(a: number, b: number, c: number, d: number): void { this.tri(a, b, c); this.tri(a, c, d); }

  /** Appends a copy of everything built so far, mirrored to the twelve o'clock side. */
  mirrorZ(): void { this.addMirrored(this); }

  /** Appends the mirror image of another surface. */
  addMirrored(from: Surface): void {
    const count = from.pos.length / 3, triangles = from.idx.length, base = this.pos.length / 3;
    for (let i = 0; i < count; i++) {
      this.pos.push(from.pos[i * 3], from.pos[i * 3 + 1], -from.pos[i * 3 + 2]);
      this.nrm.push(from.nrm[i * 3], from.nrm[i * 3 + 1], -from.nrm[i * 3 + 2]);
      this.uv.push(from.uv[i * 2], from.uv[i * 2 + 1]);
    }
    for (let i = 0; i < triangles; i += 3) this.idx.push(from.idx[i] + base, from.idx[i + 2] + base, from.idx[i + 1] + base);
  }

  /** Height of the lowest vertex. */
  lowest(): number {
    let y = Infinity;
    for (let i = 1; i < this.pos.length; i += 3) y = Math.min(y, this.pos[i]);
    return y;
  }

  geometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

interface Finish {
  satin: Surface;
  polished: Surface;
  /** Pin heads. */
  dark: Surface;
  /** Depths of gaps and holes that no studio light reaches. */
  shadow: Surface;
}

function newFinish(): Finish {
  return { satin: new Surface(), polished: new Surface(), dark: new Surface(), shadow: new Surface() };
}

// ── Lofted solids with rounded edges ───────────────────────────────────────

/** One closed cross-section. Two coincident neighbours with different normals mark a sharp edge. */
interface Loop { p: Pt[]; n: Vec3[]; }

interface BodyFinish {
  /** Surface of the skin, optionally per outline segment (segment j joins points j and j+1). */
  face: Surface | ((segment: number) => Surface);
  /** Surface of the rounded end edges and the end caps. */
  edge: Surface;
  /** Edge radius at the first / last loop; 0 leaves the end open. */
  filletA?: number;
  filletB?: number;
  /** Scales the edge radius per outline point (0 keeps a point square). */
  rounding?: (point: number) => number;
  /** Loft direction; measured from the loops when omitted. */
  axis?: Vec3;
}

/** A ring of the finished skin; vertices are created per surface on first use. */
class Ring {
  private readonly ids = new Map<Surface, Int32Array>();
  constructor(readonly p: Pt[], readonly n: Vec3[]) {}
  id(surface: Surface, j: number): number {
    let ids = this.ids.get(surface);
    if (!ids) { ids = new Int32Array(this.p.length).fill(-1); this.ids.set(surface, ids); }
    if (ids[j] < 0) ids[j] = surface.vertex(this.p[j], this.n[j]);
    return ids[j];
  }
}

/** Skins a sequence of loops into a closed solid whose two ends are rounded over and capped. */
function addBody(loops: Loop[], f: BodyFinish): void {
  const count = loops[0].p.length, last = loops.length - 1;
  const axisA = f.axis ?? loftAxis(loops[0], loops[1]);
  const axisB = f.axis ?? loftAxis(loops[last - 1], loops[last]);
  const faceOf = (segment: number): Surface => f.face instanceof Surface ? f.face : f.face(segment);
  const rings: Ring[] = [];
  const edgeStrip: boolean[] = [];
  const add = (ring: Ring, edge: boolean): void => { if (rings.length) edgeStrip.push(edge); rings.push(ring); };
  const quarter = Math.PI / 2;
  if (f.filletA) for (let m = 0; m <= FILLET_STEPS; m++) add(filletRing(loops[0], axisA, 1, f.filletA, quarter * (1 - m / FILLET_STEPS), f.rounding), true);
  else add(new Ring(loops[0].p, loops[0].n), false);
  for (let k = 1; k < last; k++) add(new Ring(loops[k].p, loops[k].n), false);
  if (f.filletB) for (let m = 0; m <= FILLET_STEPS; m++) add(filletRing(loops[last], axisB, -1, f.filletB, quarter * m / FILLET_STEPS, f.rounding), m > 0);
  else add(new Ring(loops[last].p, loops[last].n), false);

  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i], b = rings[i + 1];
    for (let j = 0; j < count; j++) {
      const k = (j + 1) % count;
      if (samePoint(a.p[j], a.p[k]) && samePoint(b.p[j], b.p[k])) continue;
      const surface = edgeStrip[i] ? f.edge : faceOf(j);
      surface.quad(a.id(surface, j), a.id(surface, k), b.id(surface, k), b.id(surface, j));
    }
  }
  if (f.filletA) addCap(f.edge, rings[0], axisA, -1);
  if (f.filletB) addCap(f.edge, rings[rings.length - 1], axisB, 1);
}

function loftAxis(from: Loop, to: Loop): Vec3 {
  const sum: Vec3 = [0, 0, 0];
  from.p.forEach((p, j) => { const q = to.p[j]; sum[0] += q[0] - p[0]; sum[1] += q[1] - p[1]; sum[2] += q[2] - p[2]; });
  return normalize(sum);
}

/** One ring of a rounded end: `angle` runs from 90° at the cap to 0° where the skin starts. */
function filletRing(loop: Loop, axis: Vec3, inward: number, radius: number, angle: number, rounding?: (point: number) => number): Ring {
  const count = loop.p.length;
  const p: Pt[] = [], n: Vec3[] = [];
  for (let j = 0; j < count; j++) {
    const r = radius * (rounding ? rounding(j) : 1);
    const a = r > 0 ? angle : 0;
    // Retreat within the plane of the cap, also where the skin leans along the loft axis.
    const lean = insetDirection(loop, j), along = dot(lean, axis);
    const inset: Vec3 = [lean[0] - axis[0] * along, lean[1] - axis[1] * along, lean[2] - axis[2] * along];
    const drop = r * (1 - Math.cos(a)), shift = inward * r * (1 - Math.sin(a));
    const q = loop.p[j], m = loop.n[j];
    p.push([q[0] - inset[0] * drop + axis[0] * shift, q[1] - inset[1] * drop + axis[1] * shift, q[2] - inset[2] * drop + axis[2] * shift, q[3], q[4]]);
    const c = Math.cos(a), s = -inward * Math.sin(a);
    n.push(normalize([m[0] * c + axis[0] * s, m[1] * c + axis[1] * s, m[2] * c + axis[2] * s]));
  }
  return new Ring(p, n);
}

/** Direction in which an outline point retreats when its edge is rounded; mitred at sharp edges. */
function insetDirection(loop: Loop, j: number): Vec3 {
  const count = loop.p.length, n = loop.n[j];
  for (const k of [(j + 1) % count, (j + count - 1) % count]) {
    if (!samePoint(loop.p[j], loop.p[k])) continue;
    const m = loop.n[k], scale = 1 / (1 + Math.max(-0.6, dot(n, m)));
    return [(n[0] + m[0]) * scale, (n[1] + m[1]) * scale, (n[2] + m[2]) * scale];
  }
  return n;
}

function addCap(surface: Surface, ring: Ring, axis: Vec3, side: number): void {
  const count = ring.p.length;
  const pts: Pt[] = [];
  for (let j = 0; j < count; j++) if (!samePoint(ring.p[j], ring.p[(j + 1) % count])) pts.push(ring.p[j]);
  // Triangulate in a plane square to the loft axis.
  const u = normalize(cross(axis, Math.abs(axis[0]) < 0.9 ? X_AXIS : [0, 1, 0]));
  const w = cross(axis, u);
  const faces = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(dot(p, u), dot(p, w))), []);
  const normal: Vec3 = [axis[0] * side, axis[1] * side, axis[2] * side];
  const ids = pts.map(p => surface.vertex(p, normal));
  for (const [a, b, c] of faces) surface.tri(ids[a], ids[b], ids[c]);
}

/** Loops whose normals are measured on the lofted skin itself. Each station lists its smooth
 * runs clockwise as seen from +x (z to the right, y up); stations run from −x to +x. */
function loftLoops(stations: Pt[][][]): Loop[] {
  return stations.map((runs, k) => {
    const before = stations[Math.max(0, k - 1)], after = stations[Math.min(stations.length - 1, k + 1)];
    const loop: Loop = { p: [], n: [] };
    runs.forEach((run, r) => run.forEach((p, j) => {
      const a = run[Math.max(0, j - 1)], b = run[Math.min(run.length - 1, j + 1)];
      // Three-point tangent: exact on arcs even when the steps are uneven.
      const la = distance(p, a), lb = distance(b, p);
      const wa = la > 0 ? (lb > 0 ? lb / la : 1) : 0, wb = lb > 0 ? (la > 0 ? la / lb : 1) : 0;
      const along: Vec3 = [(p[0] - a[0]) * wa + (b[0] - p[0]) * wb, (p[1] - a[1]) * wa + (b[1] - p[1]) * wb, (p[2] - a[2]) * wa + (b[2] - p[2]) * wb];
      const p0 = before[r][j], p1 = after[r][j];
      loop.p.push(p);
      loop.n.push(normalize(cross(along, [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]])));
    }));
    return loop;
  });
}

// ── Outlines in a local frame ──────────────────────────────────────────────

/** A closed outline with outward normals, clockwise with `along` to the right and `outward` up. */
interface Outline { p: Vec2[]; n: Vec2[]; }

/** Maps an outline point and its normal from a local frame into the side plane. */
type Frame = (along: number, outward: number, nAlong: number, nOutward: number) => { y: number; z: number; ny: number; nz: number; along: number };

/** Polygon with every corner rounded; corners are [along, outward, radius], clockwise. */
function roundedOutline(corners: Array<[number, number, number]>, steps = 3): Outline {
  const out: Outline = { p: [], n: [] };
  const count = corners.length;
  corners.forEach(([ca, cb, r], i) => {
    const prev = corners[(i + count - 1) % count], next = corners[(i + 1) % count];
    const d1 = unit2(ca - prev[0], cb - prev[1]), d2 = unit2(next[0] - ca, next[1] - cb);
    // Outward is to the left of the direction of travel.
    const n1: Vec2 = [-d1[1], d1[0]], n2: Vec2 = [-d2[1], d2[0]];
    const turn = Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]);
    const convex = turn < 0 ? 1 : -1;
    const tangent = r * Math.tan(Math.abs(turn) / 2);
    const centre: Vec2 = [ca - d1[0] * tangent - convex * r * n1[0], cb - d1[1] * tangent - convex * r * n1[1]];
    const start = Math.atan2(n1[1], n1[0]);
    for (let s = 0; s <= steps; s++) {
      const a = start + turn * s / steps, n: Vec2 = [Math.cos(a), Math.sin(a)];
      out.p.push([centre[0] + convex * r * n[0], centre[1] + convex * r * n[1]]);
      out.n.push(s === 0 ? n1 : s === steps ? n2 : n);
    }
  });
  return out;
}

function unit2(a: number, b: number): Vec2 { const l = Math.hypot(a, b) || 1; return [a / l, b / l]; }

/** Splits long straight edges so that the outline can follow a bend. */
function subdivided(outline: Outline, maxStep: number): Outline {
  const out: Outline = { p: [], n: [] };
  const count = outline.p.length;
  for (let i = 0; i < count; i++) {
    const a = outline.p[i], b = outline.p[(i + 1) % count], n = outline.n[i], m = outline.n[(i + 1) % count];
    out.p.push(a); out.n.push(n);
    const flat = Math.abs(n[0] - m[0]) + Math.abs(n[1] - m[1]) < 1e-6;
    const pieces = flat ? Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxStep) : 1;
    for (let s = 1; s < pieces; s++) { out.p.push([a[0] + (b[0] - a[0]) * s / pieces, a[1] + (b[1] - a[1]) * s / pieces]); out.n.push(n); }
  }
  return out;
}

/** Two loops that extrude an outline across x between `lo` and `hi` (which may taper along the bracelet). */
function slab(outline: Outline, frame: Frame, lo: (along: number) => number, hi: (along: number) => number): Loop[] {
  const a: Loop = { p: [], n: [] }, b: Loop = { p: [], n: [] };
  outline.p.forEach(([u, v], i) => {
    const m = frame(u, v, outline.n[i][0], outline.n[i][1]);
    const n: Vec3 = [0, m.ny, m.nz];
    a.p.push([lo(m.along), m.y, m.z, m.along]); a.n.push(n);
    b.p.push([hi(m.along), m.y, m.z, m.along]); b.n.push(n);
  });
  return [a, b];
}

/** Point of the link outline and its outward normal. t = 0 is the tip beyond the far pin,
 * t > 0 runs over the domed top, t < 0 along the underside; ±π is the tip at the near pin.
 * `half` is the reach either side of the centre: shorter for the pieces that end a row. */
function linkPoint(t: number, half = LINK_HALF): { u: number; v: number; nu: number; nv: number } {
  const c = Math.cos(t), s = Math.sin(t);
  const height = s >= 0 ? LINK_TOP : LINK_BOTTOM, e = 2 / (s >= 0 ? TOP_POWER : BOTTOM_POWER);
  // Gradient of |u/a|^p + |v/h|^p, evaluated on the curve.
  const nu = Math.sign(c) * Math.abs(c) ** (2 - e) / half, nv = Math.sign(s) * Math.abs(s) ** (2 - e) / height;
  const l = Math.hypot(nu, nv);
  return { u: half * Math.sign(c) * Math.abs(c) ** e, v: height * Math.sign(s) * Math.abs(s) ** e, nu: nu / l, nv: nv / l };
}

/** Side outline of a link: a domed pillow whose ends roll down to the pin line. */
function linkOutline(half = LINK_HALF, topSteps = TOP_STEPS, bottomSteps = BOTTOM_STEPS): Outline {
  const out: Outline = { p: [], n: [] };
  const push = (t: number): void => { const q = linkPoint(t, half); out.p.push([q.u, q.v]); out.n.push([q.nu, q.nv]); };
  for (let i = 0; i < topSteps * 2; i++) push(Math.PI * (1 - i / (topSteps * 2)));
  for (let i = 0; i < bottomSteps * 2; i++) push(-Math.PI * i / (bottomSteps * 2));
  return out;
}

// ── The pin line ───────────────────────────────────────────────────────────

interface Pin { z: number; y: number; /** Distance along the bracelet from the end pivot. */ s: number; }

interface Layout {
  /** The pins of the six o'clock half, up to the second one after the hinge pin. */
  pins: Pin[];
  /** Length of the pin line from the end pivot to the middle of the clasp arc. */
  length: number;
  /** Height of the centre of the clasp arc. */
  claspCentreY: number;
  /** Index of the pin on which the clasp hinges. */
  hinge: number;
}

/** Shoulder arc, shallow side arc, lower corner arc and clasp arc, each tangent to the next;
 * pins are stepped along that line at a constant chord. */
function layOutPins(claspCentreY: number): Layout {
  const joinAngle = CLASP_ARC / CLASP_R;
  const join: Vec2 = [CLASP_R * Math.sin(joinAngle), claspCentreY - CLASP_R * Math.cos(joinAngle)];
  const joinHeading = -Math.PI + joinAngle;
  // The centre of a clockwise arc lies to the right of the heading.
  const centreOf = (from: Vec2, heading: number, r: number): Vec2 => [from[0] + r * Math.sin(heading), from[1] - r * Math.cos(heading)];
  const start: Vec2 = [END_PIVOT.z, END_PIVOT.y];
  const shoulder = centreOf(start, LEAVE_ANGLE, SHOULDER_R);
  const corner = centreOf(join, joinHeading, CORNER_R);
  // The side arc encloses both rollers: its centre is the inner intersection of two circles.
  const r1 = SIDE_R - SHOULDER_R, r2 = SIDE_R - CORNER_R;
  const gap = Math.hypot(corner[0] - shoulder[0], corner[1] - shoulder[1]);
  const foot = (r1 * r1 - r2 * r2 + gap * gap) / (2 * gap), rise = Math.sqrt(Math.max(0, r1 * r1 - foot * foot));
  const ez = (corner[0] - shoulder[0]) / gap, ey = (corner[1] - shoulder[1]) / gap;
  const side = [1, -1].map((sign): Vec2 => [shoulder[0] + foot * ez + sign * rise * ey, shoulder[1] + foot * ey - sign * rise * ez])
    .reduce((a, b) => a[0] < b[0] ? a : b);
  const touch = (c: Vec2, r: number, reach: number): Vec2 => [c[0] + r * (c[0] - side[0]) / reach, c[1] + r * (c[1] - side[1]) / reach];
  const shoulderEnd = touch(shoulder, SHOULDER_R, r1), cornerStart = touch(corner, CORNER_R, r2);

  const line: Vec2[] = [start];
  const arc = (c: Vec2, r: number, from: Vec2, to: Vec2): void => {
    const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
    let a1 = Math.atan2(to[1] - c[1], to[0] - c[0]);
    while (a1 > a0) a1 -= Math.PI * 2;
    const steps = Math.max(2, Math.ceil(r * (a0 - a1) / 0.05));
    for (let i = 1; i <= steps; i++) { const a = a0 + (a1 - a0) * i / steps; line.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  };
  arc(shoulder, SHOULDER_R, start, shoulderEnd);
  arc(side, SIDE_R, shoulderEnd, cornerStart);
  arc(corner, CORNER_R, cornerStart, join);
  const middle: Vec2 = [0, claspCentreY - CLASP_R];
  arc([0, claspCentreY], CLASP_R, join, middle);
  const middleIndex = line.length - 1;
  // The line runs on along the arc, so that pins can be stepped past its middle.
  arc([0, claspCentreY], CLASP_R, middle, [-join[0], join[1]]);
  const travelled = [0];
  for (let i = 1; i < line.length; i++) travelled.push(travelled[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const length = travelled[middleIndex];

  const pins: Pin[] = [{ z: start[0], y: start[1], s: 0 }];
  let i = 0;
  for (;;) {
    const prev = pins[pins.length - 1];
    const reach = (p: Vec2): number => Math.hypot(p[0] - prev.z, p[1] - prev.y);
    while (i + 1 < line.length && reach(line[i + 1]) < PIN_SPACING) i++;
    if (i + 1 >= line.length) break;
    const da = reach(line[i]), t = (PIN_SPACING - da) / (reach(line[i + 1]) - da);
    pins.push({ z: line[i][0] + (line[i + 1][0] - line[i][0]) * t, y: line[i][1] + (line[i + 1][1] - line[i][1]) * t, s: travelled[i] + (travelled[i + 1] - travelled[i]) * t });
  }
  const miss = (k: number): number => Math.abs(length - pins[k].s - HINGE_OFFSET);
  let hinge = 1;
  for (let k = 3; k + 2 < pins.length; k += 2) if (miss(k) < miss(hinge)) hinge = k;
  return { pins: pins.slice(0, hinge + 3), length, claspCentreY, hinge };
}

/** The pin line of a bracelet whose lowest point, on the clasp, rests on GROUND_Y. Where the
 * pins fall depends on the height of the clasp arc, and the clasp on the pins: the height is
 * settled in a few passes, each of which cuts the error by several orders of magnitude. */
function settleLayout(edges: number[]): Layout {
  let layout = layOutPins(GROUND_Y + CLASP_R + FLAP_TOP + TAB_RISE);
  for (let pass = 0; pass < 3; pass++) {
    const probe = newFinish();
    addClasp(probe, layout, edges);
    const lowest = Math.min(...Object.values(probe).map((surface: Surface) => surface.lowest()));
    layout = layOutPins(layout.claspCentreY + GROUND_Y - lowest);
  }
  return layout;
}

/** Width of the bracelet at distance s along the pin line, relative to its width at the lugs. */
function taper(layout: Layout, s: number): number {
  return 1 - (1 - CLASP_TAPER) * THREE.MathUtils.clamp(s / (layout.length - TAPER_END), 0, 1);
}

/** Rigid frame of a link (or of the end link): origin between its pins, `along` from pin to pin. */
function pinFrame(z: number, y: number, s: number, tz: number, ty: number): Frame {
  return (u, v, nu, nv) => ({ z: z + u * tz - v * ty, y: y + u * ty + v * tz, nz: nu * tz - nv * ty, ny: nu * ty + nv * tz, along: s + u });
}

// ── Links ──────────────────────────────────────────────────────────────────

/** Row boundaries across x at the lugs. */
function rowEdges(): number[] {
  const total = ROW_SHARE.reduce((a, b) => a + b, 0);
  const edges = [-HALF_WIDTH];
  for (const share of ROW_SHARE) edges.push(edges[edges.length - 1] + share / total * HALF_WIDTH * 2);
  return edges;
}

function isSatinRow(row: number): boolean { return row % 2 === 0; }

/** Edge radii of a row at its low-x and high-x side; the bracelet flanks are rounded more. */
function rowFillets(row: number): [number, number] {
  if (row === 0) return [0.5, 0.26];
  if (row === ROW_SHARE.length - 1) return [0.26, 0.5];
  return row % 2 ? [0.4, 0.4] : [0.24, 0.24];
}

function isWideRow(row: number): boolean { return row === 0 || row === ROW_SHARE.length - 1; }

/** Frame of the link that holds pins a and b. */
function linkFrame(a: Pin, b: Pin): Frame {
  return pinFrame((a.z + b.z) / 2, (a.y + b.y) / 2, (a.s + b.s) / 2, (b.z - a.z) / PIN_SPACING, (b.y - a.y) / PIN_SPACING);
}

/** Frame of a piece that lies on the clasp arc with its middle `offset` millimetres from the
 * middle of the arc towards six o'clock, heading for the clasp like the links before it. */
function arcFrame(layout: Layout, offset: number): Frame {
  const phi = offset / CLASP_R, sin = Math.sin(phi), cos = Math.cos(phi);
  return pinFrame(CLASP_R * sin, layout.claspCentreY - CLASP_R * cos, layout.length - offset, -cos, -sin);
}

/** One link of a row; `heads` are its pins whose ends show on a flank of the bracelet. */
function addLink(out: Finish, layout: Layout, edges: number[], row: number, outline: Outline, frame: Frame, heads: Pin[]): void {
  const lo = (s: number): number => edges[row] * taper(layout, s) + (row > 0 ? ROW_GAP / 2 : 0);
  const hi = (s: number): number => edges[row + 1] * taper(layout, s) - (row < ROW_SHARE.length - 1 ? ROW_GAP / 2 : 0);
  const [filletA, filletB] = rowFillets(row);
  addBody(slab(outline, frame, lo, hi), { face: isSatinRow(row) ? out.satin : out.polished, edge: out.polished, filletA, filletB, axis: X_AXIS });
  // Pin ends show on the two flanks of the bracelet: the polished end of the pin in the
  // shadowed mouth of its hole.
  const side = row === 0 ? -1 : 1;
  if (isWideRow(row)) for (const pin of heads) {
    const flank = side < 0 ? lo(pin.s) : hi(pin.s);
    addDisc(out.dark, flank + side * 0.03, pin.y, pin.z, side, 0.32);
    addDisc(out.polished, flank + side * 0.045, pin.y, pin.z, side, 0.23);
  }
}

/** The links that both halves have alike: all that end before the hinge pin of the clasp. */
function addLinks(out: Finish, layout: Layout, edges: number[]): void {
  const outline = linkOutline();
  const { pins, hinge } = layout;
  for (let k = 0; k + 1 < hinge; k++) addCore(out.shadow, pins[k], pins[k + 1], s => (HALF_WIDTH - CORE_INSET) * taper(layout, s));
  for (let row = 0; row < ROW_SHARE.length; row++) {
    // Narrow rows start on the end pivot, the wide and medium rows one pin later.
    for (let k = isSatinRow(row) ? 1 : 0; k + 1 < hinge; k += 2) addLink(out, layout, edges, row, outline, linkFrame(pins[k], pins[k + 1]), [pins[k], pins[k + 1]]);
  }
}

/** The last links at the clasp, where the halves differ. Towards six o'clock every row ends at
 * the hinge: the wide rows in a half link on the hinge pin, the rows between them on its axis,
 * where the hinge barrel of the flap takes over. Towards twelve o'clock the rows run on under
 * the flap, the wide ones up to the hinge; `twelve` receives those links as their mirror images
 * on the six o'clock side. */
function addClaspLinks(out: Finish, twelve: Finish, layout: Layout, edges: number[]): void {
  const { pins, hinge, length } = layout;
  const hingeAt = length - pins[hinge].s, before = length - pins[hinge - 1].s;
  const outline = linkOutline();
  for (let row = 0; row < ROW_SHARE.length; row++) {
    // The stretch of the arc that the last piece of the row covers.
    const from = isWideRow(row) ? hingeAt - LINK_NOSE : hingeAt;
    const to = (isSatinRow(row) ? hingeAt : before) + LINK_NOSE;
    const half = (to - from) / 2;
    const steps = THREE.MathUtils.clamp(Math.round(TOP_STEPS * half / LINK_HALF), 4, 6);
    addLink(out, layout, edges, row, linkOutline(half, steps, 3), arcFrame(layout, from + half), []);
    if (isWideRow(row)) {
      // The wide rows meet below the arms of the flap; the cheeks hide the pins there.
      addLink(twelve, layout, edges, row, outline, linkFrame(pins[hinge], pins[hinge + 1]), [pins[hinge]]);
      addLink(twelve, layout, edges, row, linkOutline(LINK_NOSE, 3, 2), arcFrame(layout, length - pins[hinge + 2].s), []);
    } else if (!isSatinRow(row)) addLink(twelve, layout, edges, row, outline, linkFrame(pins[hinge - 1], pins[hinge]), []);
  }
}

/** Dark sheet on the pin line between two pins. It hides inside the links and only shows in the
 * slits between them, where it stands in for the shadow and keeps the backdrop from showing through. */
function addCore(surface: Surface, a: Pin, b: Pin, halfWidth: (s: number) => number): void {
  const length = Math.hypot(b.z - a.z, b.y - a.y);
  const outward: Vec3 = [0, (b.z - a.z) / length, -(b.y - a.y) / length];
  for (const side of [1, -1]) {
    const n: Vec3 = [0, outward[1] * side, outward[2] * side];
    const corner = (pin: Pin, sign: number): number => surface.vertex([sign * halfWidth(pin.s), pin.y, pin.z, pin.s], n);
    surface.quad(corner(a, -1), corner(a, 1), corner(b, 1), corner(b, -1));
  }
}

// ── End link ───────────────────────────────────────────────────────────────

/** Where the seat that hugs the case flank lies at (x, y). */
function seatZ(x: number, y: number): number {
  const r = CASE_R + SEAT_CLEARANCE - SEAT_BARREL * (y - SEAT_EQUATOR_Y) ** 2;
  return Math.sqrt(r * r - x * x);
}

/** Frame of an imaginary link inside the end link; `pitches` = 0 ends on the end pivot. */
function endLinkFrame(pitches: number): Frame {
  const tz = Math.cos(END_LINK_ANGLE), ty = Math.sin(END_LINK_ANGLE);
  const back = PIN_SPACING * (0.5 + pitches);
  return pinFrame(END_PIVOT.z - back * tz, END_PIVOT.y - back * ty, -back, tz, ty);
}

/** Cross-section of a wide or medium finger at x: seat on the case, a top that flows out of
 * the case, and the far end of a link around the end pivot. */
function fingerSection(x: number): Pt[][] {
  const frame = endLinkFrame(0);
  const pt = (p: Vec2): Pt => [x, p[1], p[0], p[0] - END_PIVOT.z];
  const onLink = (t: number): { p: Vec2; heading: Vec2 } => {
    const q = linkPoint(t), m = frame(q.u, q.v, q.nu, q.nv);
    // Clockwise travel: the tangent is the normal turned a quarter to the right.
    return { p: [m.z, m.y], heading: [m.ny, -m.nz] };
  };
  const topStep = Math.PI / (TOP_STEPS * 2), bottomStep = Math.PI / (BOTTOM_STEPS * 2);
  const seatTop: Vec2 = [seatZ(x, SEAT_TOP_Y), SEAT_TOP_Y], seatBottom: Vec2 = [seatZ(x, SEAT_BOTTOM_Y), SEAT_BOTTOM_Y];
  const run: Pt[] = [];
  // Top: leaves the case almost level and joins the dome just before its crown.
  const crown = onLink(topStep * (TOP_STEPS - 1));
  const reach = Math.hypot(crown.p[0] - seatTop[0], crown.p[1] - seatTop[1]) * 0.36;
  // Leaves the case at the slope of the horn tops beside it.
  const leave = rad(-9);
  for (let i = 0; i < 6; i++) {
    run.push(pt(cubic(seatTop, [seatTop[0] + Math.cos(leave) * reach, seatTop[1] + Math.sin(leave) * reach],
      [crown.p[0] - crown.heading[0] * reach, crown.p[1] - crown.heading[1] * reach], crown.p, i / 6)));
  }
  for (let i = TOP_STEPS - 1; i > 0; i--) run.push(pt(onLink(topStep * i).p));
  for (let i = 0; i < BOTTOM_STEPS - 1; i++) run.push(pt(onLink(-bottomStep * i).p));
  // Underside: back from the link's belly to the case, flattening out.
  const belly = onLink(-bottomStep * (BOTTOM_STEPS - 1));
  const back = Math.hypot(seatBottom[0] - belly.p[0], seatBottom[1] - belly.p[1]) * 0.36;
  for (let i = 0; i <= 4; i++) {
    run.push(pt(cubic(belly.p, [belly.p[0] + belly.heading[0] * back, belly.p[1] + belly.heading[1] * back],
      [seatBottom[0] + back, seatBottom[1]], seatBottom, i / 4)));
  }
  return [run, seatRun(x, SEAT_BOTTOM_Y, SEAT_TOP_Y, pt)];
}

/** Cross-section of the short stub of a narrow row. It leaves the case almost at the height of
 * the fingers beside it, so the end link is one solid block at the case, and rolls down into
 * the tip of a link whose pin would lie one pitch inside the case. */
function stubSection(x: number): Pt[][] {
  const frame = endLinkFrame(1);
  const pt = (p: Vec2): Pt => [x, p[1], p[0], p[0] - END_PIVOT.z];
  const onLink = (t: number): { p: Vec2; heading: Vec2 } => {
    const q = linkPoint(t), m = frame(q.u, q.v, q.nu, q.nv);
    return { p: [m.z, m.y], heading: [m.ny, -m.nz] };
  };
  // Where the underside of that link dives into the seat.
  let inside = -Math.PI / 2, bottom = 0;
  for (let i = 0; i < 40; i++) {
    const mid = (inside + bottom) / 2, p = onLink(mid).p;
    if (p[0] < seatZ(x, p[1])) inside = mid; else bottom = mid;
  }
  const seatTop: Vec2 = [seatZ(x, STUB_TOP_Y), STUB_TOP_Y];
  const nose = onLink(STUB_NOSE);
  const reach = Math.hypot(nose.p[0] - seatTop[0], nose.p[1] - seatTop[1]) * 0.42;
  const leave = rad(-9);
  const run: Pt[] = [];
  for (let i = 0; i < 7; i++) {
    run.push(pt(cubic(seatTop, [seatTop[0] + Math.cos(leave) * reach, seatTop[1] + Math.sin(leave) * reach],
      [nose.p[0] - nose.heading[0] * reach, nose.p[1] - nose.heading[1] * reach], nose.p, i / 7)));
  }
  for (let i = 0; i <= 6; i++) run.push(pt(onLink(STUB_NOSE + (bottom - STUB_NOSE) * i / 6).p));
  return [run, seatRun(x, onLink(bottom).p[1], STUB_TOP_Y, pt)];
}

/** The concave face that sits against the case, from the underside up to the top edge. */
function seatRun(x: number, fromY: number, toY: number, pt: (p: Vec2) => Pt): Pt[] {
  const run: Pt[] = [];
  for (let i = 0; i <= 5; i++) { const y = fromY + (toY - fromY) * i / 5; run.push(pt([seatZ(x, y), y])); }
  return run;
}

/** Solid end link: wide and medium fingers reach to the end pivot, narrow rows end in short
 * stubs so that the first narrow links can swing on that pin. */
function addEndLink(out: Finish, edges: number[]): void {
  const back = PIN_SPACING * 1.2;
  addCore(out.shadow, { z: END_PIVOT.z - back * Math.cos(END_LINK_ANGLE), y: END_PIVOT.y - back * Math.sin(END_LINK_ANGLE), s: -back }, { ...END_PIVOT, s: 0 }, () => HALF_WIDTH - CORE_INSET);
  for (let row = 0; row < ROW_SHARE.length; row++) {
    const lo = edges[row] + (row > 0 ? ROW_GAP / 2 : 0), hi = edges[row + 1] - (row < ROW_SHARE.length - 1 ? ROW_GAP / 2 : 0);
    const stations = Math.max(3, Math.round((hi - lo) / 0.75) + 1);
    const sections: Pt[][][] = [];
    for (let i = 0; i < stations; i++) {
      const x = lo + (hi - lo) * i / (stations - 1);
      sections.push(isSatinRow(row) ? fingerSection(x) : stubSection(x));
    }
    const loops = loftLoops(sections);
    const [filletA, filletB] = rowFillets(row).map(r => Math.min(r, 0.3));
    const finish = { face: isSatinRow(row) ? out.satin : out.polished, edge: out.polished, axis: X_AXIS };
    if (isWideRow(row)) addWideFinger(out, loops, row === 0 ? -1 : 1, row === 0 ? filletA : filletB, row === 0 ? filletB : filletA);
    else addBody(loops, { ...finish, filletA, filletB });
  }
}

/** Wide finger of the end link on the flank `side`. Its outer corner is a body of its own with
 * a notch in the underside, which lays the spring bar open down to its axis. Where the two
 * bodies meet both stay open; only the end of the notch is closed there. */
function addWideFinger(out: Finish, loops: Loop[], side: number, flankFillet: number, innerFillet: number): void {
  const tz = Math.cos(END_LINK_ANGLE), ty = Math.sin(END_LINK_ANGLE), half = NOTCH_LENGTH / 2;
  // Position along the end link and height above its pin line, both measured from the spring bar.
  const along = (p: Pt): number => (p[2] - END_PIVOT.z) * tz + (p[1] - END_PIVOT.y) * ty;
  const above = (p: Pt): number => (p[1] - END_PIVOT.y) * tz - (p[2] - END_PIVOT.z) * ty;
  const at = (x: number, u: number, v: number): Pt => [x, END_PIVOT.y + u * ty + v * tz, END_PIVOT.z + u * tz - v * ty, u * tz - v * ty];
  // The segments of the underside that the two walls of the notch cut: the same in every section.
  const crossing = (u: number): number => loops[0].p.findIndex((p, j, all) =>
    j + 1 < all.length && above(p) < 0 && above(all[j + 1]) < 0 && (along(p) - u) * (along(all[j + 1]) - u) <= 0);
  const ia = crossing(half), ib = crossing(-half);
  // Every section gets a point on either wall, so that the two bodies share all their vertices where they meet.
  const sections = loops.map((loop): Loop => {
    const cut = (j: number, u: number): [Pt, Vec3] => {
      const a = loop.p[j], b = loop.p[j + 1], n = loop.n[j], m = loop.n[j + 1];
      const t = THREE.MathUtils.clamp((u - along(a)) / (along(b) - along(a)), 0, 1);
      return [[a[0], a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t],
        normalize([n[0] + (m[0] - n[0]) * t, n[1] + (m[1] - n[1]) * t, n[2] + (m[2] - n[2]) * t])];
    };
    const [a, an] = cut(ia, half), [b, bn] = cut(ib, -half);
    return {
      p: [...loop.p.slice(0, ia + 1), a, ...loop.p.slice(ia + 1, ib + 1), b, ...loop.p.slice(ib + 1)],
      n: [...loop.n.slice(0, ia + 1), an, ...loop.n.slice(ia + 1, ib + 1), bn, ...loop.n.slice(ib + 1)],
    };
  });
  const first = ia + 1, last = ib + 2;
  const wallA: Vec3 = [0, -ty, -tz], wallB: Vec3 = [0, ty, tz], ceiling: Vec3 = [0, -tz, ty];
  const split = side < 0 ? NOTCH_STATIONS : sections.length - 1 - NOTCH_STATIONS;
  const corner = (side < 0 ? sections.slice(0, split + 1) : sections.slice(split)).map((loop): Loop => {
    const a = loop.p[first], b = loop.p[last], a2 = at(a[0], half, 0), b2 = at(a[0], -half, 0);
    // Sharp edges list their point twice, once per face.
    return {
      p: [...loop.p.slice(0, first + 1), a, a2, a2, b2, b2, b, ...loop.p.slice(last)],
      n: [...loop.n.slice(0, first + 1), wallA, wallA, ceiling, ceiling, wallB, wallB, ...loop.n.slice(last)],
    };
  });
  const finish = { edge: out.polished, axis: X_AXIS };
  if (side < 0) {
    addBody(corner, { ...finish, face: segment => segment > first && segment < first + 6 ? out.dark : out.satin, filletA: flankFillet });
    addBody(sections.slice(split), { ...finish, face: out.satin, filletB: innerFillet });
  } else {
    addBody(sections.slice(0, split + 1), { ...finish, face: out.satin, filletA: innerFillet });
    addBody(corner, { ...finish, face: segment => segment > first && segment < first + 6 ? out.dark : out.satin, filletB: flankFillet });
  }
  // End wall of the notch: the piece of the section where the bodies meet that the notch lays open.
  const joint = sections[split].p, x = joint[0][0], flank = sections[side < 0 ? 0 : sections.length - 1].p[0][0];
  const wall = [at(x, half, 0), ...joint.slice(first, last + 1), at(x, -half, 0)].map(p => out.dark.vertex(p, [side, 0, 0]));
  for (let k = 1; k + 1 < wall.length; k++) out.dark.tri(wall[0], wall[k], wall[k + 1]);
  // Lower half of the spring bar, from the end of the notch to the horn.
  let before: number[] | undefined;
  for (let i = 0; i <= 6; i++) {
    const cos = Math.cos(Math.PI * i / 6), sin = -Math.sin(Math.PI * i / 6);
    const normal: Vec3 = [0, cos * ty + sin * tz, cos * tz - sin * ty];
    const ids = [x, flank + side * 0.1].map(end => out.polished.vertex(at(end, SPRING_BAR_R * cos, SPRING_BAR_R * sin), normal));
    if (before) out.polished.quad(before[0], before[1], ids[1], ids[0]);
    before = ids;
  }
}

// ── Clasp ──────────────────────────────────────────────────────────────────

/** Frame of the clasp: `along` runs around the clasp arc from its middle towards six o'clock. */
function claspFrame(centreY: number): Frame {
  return (s, v, ns, nv) => {
    const phi = s / CLASP_R, sin = Math.sin(phi), cos = Math.cos(phi), r = CLASP_R + v;
    return { z: r * sin, y: centreY - r * cos, nz: ns * cos + nv * sin, ny: ns * sin - nv * cos, along: s };
  };
}

function circleOutline(along: number, outward: number, r: number, steps: number): Outline {
  const out: Outline = { p: [], n: [] };
  for (let i = 0; i < steps; i++) {
    const a = -Math.PI * 2 * i / steps;
    out.p.push([along + r * Math.cos(a), outward + r * Math.sin(a)]);
    out.n.push([Math.cos(a), Math.sin(a)]);
  }
  return out;
}

/** Small disc on a face square to x: the end of a pin and the mouth of its hole. */
function addDisc(surface: Surface, x: number, y: number, z: number, side: number, r: number): void {
  const normal: Vec3 = [side, 0, 0];
  const centre = surface.vertex([x, y, z, 0], normal);
  const rim: number[] = [];
  const steps = 16;
  for (let i = 0; i < steps; i++) { const a = Math.PI * 2 * i / steps; rim.push(surface.vertex([x, y + r * Math.sin(a), z + r * Math.cos(a), 0], normal)); }
  for (let i = 0; i < steps; i++) surface.tri(centre, rim[i], rim[(i + 1) % steps]);
}

/** Folding clasp with a safety flap, as seen on the closed bracelet. The flap is a polished
 * sheet hinged on the six o'clock half: two cheeks with rounded ears carry it on the hinge pin
 * beside the last wide links, a lift tab is raised on its hinge end, and its arms and centre
 * tongue lie on the first links of the twelve o'clock half. The folded blade lies inside the loop. */
function addClasp(out: Finish, layout: Layout, edges: number[]): void {
  const frame = claspFrame(layout.claspCentreY);
  const bend = (s: number, x: number, v: number): Pt => { const m = frame(s, v, 0, 0); return [x, m.y, m.z, s]; };
  const bendNormal = (s: number, nx: number, nv: number): Vec3 => { const m = frame(s, 0, 0, nv); return [nx, m.ny, m.nz]; };
  const across = (outline: Outline, lo: number, hi: number, face: Surface, filletLo: number, filletHi = filletLo): void =>
    addBody(slab(subdivided(outline, 2.4), frame, () => lo, () => hi), { face, edge: out.polished, filletA: filletLo, filletB: filletHi, axis: X_AXIS });

  // Positions along the clasp arc, from its middle towards six o'clock. The twelve o'clock
  // links are mirror images: the narrow ones end below the arms, the medium ones below the tip.
  const { pins, hinge, length } = layout;
  const hingeAt = length - pins[hinge].s, before = length - pins[hinge - 1].s;
  const start = hingeAt - LINK_NOSE - 0.1;
  const armStart = start - ARM_SETBACK;
  const shoulder = LINK_NOSE - hingeAt - FLAP_TUCK;
  const tip = LINK_NOSE - before - FLAP_TUCK;
  const top = FLAP_TOP, under = top - FLAP_SHEET;

  // Tongue and the strip between the arms, in one piece; the corners of the tip are rounded.
  const corner = (s: number): number => {
    const d = Math.min(TONGUE_CORNER, tip + TONGUE_CORNER - s);
    return d > 0 ? TONGUE_CORNER - Math.sqrt(TONGUE_CORNER * TONGUE_CORNER - d * d) : 0;
  };
  // Corners without a radius only place a vertex, here where the rounding of the tip needs one.
  const tongue = subdivided(roundedOutline([
    [tip, under, 0.05], [tip, top, 0.12], [tip + TONGUE_CORNER / 2, top, 0], [tip + TONGUE_CORNER, top, 0],
    [start, top, 0.12], [start, under, 0.05], [tip + TONGUE_CORNER, under, 0], [tip + TONGUE_CORNER / 2, under, 0],
  ]), 2.4);
  addBody(slab(tongue, frame, s => corner(s) - TONGUE_HALF, s => TONGUE_HALF - corner(s)), { face: out.polished, edge: out.polished, filletA: 0.1, filletB: 0.1, axis: X_AXIS });
  across(roundedOutline([[start - TAB_LENGTH, top - 0.4, 0.05], [start - TAB_LENGTH, top + TAB_RISE, 0.3], [start, top + TAB_RISE, 0.3], [start, top - 0.4, 0.05]]), -TAB_HALF, TAB_HALF, out.polished, 0.3);

  // Arms and cheeks. A hairline is left between tongue and arms. The arms end inside the cheeks,
  // which stand a hair proud so that the two polished faces never coincide.
  const cheekIn = HALF_WIDTH * CLASP_TAPER + CHEEK_GAP, cheekOut = cheekIn + CHEEK, cheekTop = top + 0.02;
  const arm = roundedOutline([[shoulder, under, 0.05], [shoulder, top, 0.3], [armStart, top, 0.12], [armStart, under, 0.05]]);
  const cheek = roundedOutline([[shoulder - 0.02, CHEEK_SKIRT, 0.3], [shoulder - 0.02, cheekTop, 0.3], [hingeAt + EAR_REACH, cheekTop, 1.1], [hingeAt + EAR_REACH, CHEEK_SKIRT, 1.1]], 5);
  across(arm, TONGUE_HALF + 0.04, cheekIn + 0.3, out.polished, 0.1, 0);
  across(arm, -cheekIn - 0.3, -TONGUE_HALF - 0.04, out.polished, 0, 0.1);
  across(cheek, cheekIn, cheekOut, out.polished, 0.06, 0.2);
  across(cheek, -cheekOut, -cheekIn, out.polished, 0.2, 0.06);
  for (const side of [-1, 1]) {
    const head = bend(hingeAt, side * (cheekOut + 0.03), 0);
    addDisc(out.dark, head[0], head[1], head[2], side, 0.4);
    addDisc(out.polished, head[0] + side * 0.015, head[1], head[2], side, 0.28);
  }

  // Hinge barrel of the flap, between the wide hinge links and in front of the rows that end on the hinge axis.
  const barrelHalf = edges[ROW_SHARE.length - 1] * CLASP_TAPER - 0.15;
  across(circleOutline(hingeAt - 0.1 - BARREL_R, BARREL_HEIGHT, BARREL_R, 10), -barrelHalf, barrelHalf, out.polished, 0.2);

  // Shadow on the pin line between the last links of either half; under the flap the loop is hollow.
  const coreHalf = (HALF_WIDTH - CORE_INSET) * CLASP_TAPER;
  const onArc = (s: number): Pin => { const q = bend(s, 0, 0); return { z: q[2], y: q[1], s }; };
  for (const [from, to] of [[before, start], [shoulder, -before]]) {
    for (let i = 0; i < 3; i++) addCore(out.shadow, onArc(from + (to - from) * i / 3), onArc(from + (to - from) * (i + 1) / 3), () => coreHalf);
  }

  // Folded blade: hinged below the hinge of the flap, it runs under the twelve o'clock links.
  // Each half is lofted along the arc; `opening` is the half width of the fork and of the slot.
  const bladeStart = hingeAt - 0.1 - BARREL_R, bladeEnd = bladeStart - BLADE_LENGTH;
  const slotEnd = bladeEnd + SLOT_FROM_END, slotStart = slotEnd + SLOT_LENGTH, forkEnd = bladeStart - FORK_LENGTH;
  const opening = (s: number): number => s > forkEnd ? FORK_HALF * ((s - forkEnd) / FORK_LENGTH) ** 0.55 : s <= slotStart && s >= slotEnd ? SLOT_HALF : 0;
  const bladeHalf = (s: number): number => BLADE_HALF - (BLADE_HALF - BLADE_END_HALF) * THREE.MathUtils.clamp((forkEnd - s) / (forkEnd - bladeEnd), 0, 1);
  const stations = [1, 0.7, 0.45, 0.25, 0.1, 0.03, 0].map(t => forkEnd + FORK_LENGTH * t);
  for (let i = 1; i <= 4; i++) stations.push(forkEnd + (slotStart + 0.02 - forkEnd) * i / 4);
  stations.push(slotStart, slotEnd, slotEnd - 0.02, bladeEnd);
  for (const side of [-1, 1]) {
    const loops = stations.map((s): Loop => {
      const g = opening(s), w = bladeHalf(s);
      // Inner face, outer edge, face towards the links, edge of the opening; sharp edges list their point twice.
      const section: Array<[number, number, number, number]> = [
        [g, BLADE_INNER, 0, -1], [w, BLADE_INNER, 0, -1], [w, BLADE_INNER, 1, 0], [w, BLADE_OUTER, 1, 0],
        [w, BLADE_OUTER, 0, 1], [g, BLADE_OUTER, 0, 1], [g, BLADE_OUTER, -1, 0], [g, BLADE_INNER, -1, 0],
      ];
      return { p: section.map(([x, v]) => bend(s, side * x, v)), n: section.map(([, , nx, nv]) => bendNormal(s, side * nx, nv)) };
    });
    // The two ends stay open: they are rolled into the hinge barrels.
    addBody(loops, { face: j => j === 0 || j === 4 ? out.satin : out.polished, edge: out.polished });
  }
  across(circleOutline(bladeStart, BLADE_INNER + 0.2, 0.5, 8), -BLADE_HALF - 0.1, BLADE_HALF + 0.1, out.polished, 0.15);
  across(circleOutline(bladeEnd, BLADE_INNER + 0.3, 0.45, 8), -BLADE_END_HALF - 0.1, BLADE_END_HALF + 0.1, out.polished, 0.15);
}

// ── Finish ─────────────────────────────────────────────────────────────────

/** Satin finish: the shared brushed steel plus a fine grain that runs along the bracelet.
 * One texture tile covers 5 mm across and 40 mm along. */
function satinFinish(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const size = 256;
  const height = new Float32Array(size * size);
  let seed = 7;
  const random = (): number => (seed = seed * 16807 % 2147483647) / 2147483647;
  // Brushing marks: strokes of random length and depth, each one texel wide.
  for (let i = 0; i < 9000; i++) {
    const x = Math.floor(random() * size), y = Math.floor(random() * size), length = 10 + Math.floor(random() * 60);
    const depth = (random() - 0.5) * 0.3;
    for (let j = 0; j < length; j++) height[(y + j) % size * size + x] += depth;
  }
  const at = (x: number, y: number): number => height[y * size + (x + size) % size];
  // Data textures (no colour space conversion); `write` fills the r, g, b of one texel.
  const texture = (write: (x: number, y: number, rgb: Uint8ClampedArray, offset: number) => void): THREE.CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(size, size);
    image.data.fill(255);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) write(x, y, image.data, (y * size + x) * 4);
    ctx.putImageData(image, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(0.2 / UV_SCALE, 0.025 / UV_SCALE);
    tex.anisotropy = 8;
    return tex;
  };
  const satin = base.clone();
  satin.name = 'Satin bracelet steel';
  // The green channel scales the roughness: marks alternate between glossier and duller.
  satin.roughness = Math.min(1, base.roughness * SATIN_ROUGHNESS);
  satin.roughnessMap = texture((x, y, rgb, i) => { rgb[i] = rgb[i + 1] = rgb[i + 2] = 255 * THREE.MathUtils.clamp(0.8 + at(x, y) * 0.4, 0.5, 1); });
  // The marks only tilt the surface across the grain.
  satin.normalMap = texture((x, y, rgb, i) => {
    const slope = (at(x + 1, y) - at(x - 1, y)) * 0.6, l = Math.hypot(slope, 1);
    rgb[i] = 255 * (0.5 - 0.5 * slope / l); rgb[i + 1] = 128; rgb[i + 2] = 255 * (0.5 + 0.5 / l);
  });
  satin.normalScale.set(0.25, 0.25);
  return satin;
}

// ── Assembly ───────────────────────────────────────────────────────────────

/** Closed seven-row bracelet with fitted end links and a folding clasp resting at GROUND_Y. */
export function makeBracelet(m: WatchMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Seven-row bracelet with folding clasp';
  const out = newFinish(), twelve = newFinish();
  const edges = rowEdges();
  const layout = settleLayout(edges);
  addEndLink(out, edges);
  addLinks(out, layout, edges);
  for (const surface of Object.values(out)) surface.mirrorZ();
  addClaspLinks(out, twelve, layout, edges);
  for (const finish of Object.keys(out) as Array<keyof Finish>) out[finish].addMirrored(twelve[finish]);
  addClasp(out, layout, edges);

  const parts: Array<[string, Surface, THREE.Material]> = [
    ['Satin bracelet surfaces', out.satin, satinFinish(m.brushed)],
    ['Polished bracelet surfaces', out.polished, m.steel],
    ['Bracelet pin heads', out.dark, m.darkSteel],
    ['Bracelet gap shadows', out.shadow, new THREE.MeshStandardMaterial({ name: 'Gap shadow', color: 0x14171b, metalness: 0, roughness: 1 })],
  ];
  for (const [name, surface, material] of parts) {
    const mesh = new THREE.Mesh(surface.geometry(), material);
    mesh.name = name;
    group.add(mesh);
  }
  return group;
}
