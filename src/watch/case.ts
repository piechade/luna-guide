import * as THREE from 'three';
import {
  BEZEL_TOP_Y, CASEBACK_INNER_Y, CASE_BOTTOM_Y, CASE_R, CRYSTAL_R, DIAL_R, DIAL_Y, LUG_INNER_X, LUG_TIP_Z, SPRING_BAR_Y,
  SPRING_BAR_Z,
} from './dimensions';
import type { WatchMaterials } from './materials';

export interface CaseParts {
  /** Everything of the case, including `top` and `back`. */
  group: THREE.Group;
  /** Bezel and crystal as one sub-group, so an exploded view can lift it. */
  top: THREE.Group;
  /** The screw-down caseback as one sub-group, so the opened back can drop it. */
  back: THREE.Group;
}

// The middle case is one continuous skin rather than a turned ring with lugs
// stuck on: a top and an underside, trimmed by a plan outline that runs around
// the case and out along the four horns. Both are level around the case (as
// if turned on a lathe) and roll down along the horns, level across each horn,
// so the horns curve down and end in a round nose below the caseback. A fine
// chamfer, the convex flank and a tucked-under edge are swept along the
// outline in one piece, from horn tip to horn tip. Only the quadrant between
// three and six o'clock is built; the other three are mirror images.
//
// Finishing: top and underside are satin with a circular grain (shoulder, horn
// tops, underside), everything swept is polished (chamfer, flanks), so each
// finish keeps one clean grain direction. The caseback is a separate part with
// a straight grain of its own, from twelve to six.
//
// Everything ends up in eight meshes: satin tops, polished flanks and rims,
// shadowed recesses, rehaut, caseback plate, bezel, bezel seam and crystal.

// ── Proportions in millimetres ─────────────────────────────────────────────

/** Facets of the turned parts (bezel, crystal, rehaut, foot of the caseback). */
const TURNS = 192;

/** Top of the middle case: level under the bezel, whose foot stands at SHOULDER_R. */
const SHOULDER_R = 19.1;
const SHOULDER_Y = 2.1;
/** Underside of the middle case around the caseback, and where the caseback starts. */
const UNDER_Y = -4;
const BACK_SEAM_R = 16.9;
const BACK_R = 16.8;
/** How far out a point lies along a horn is measured as hypot(z, HORN_CROSS·x): the lines of
 * equal height run across the horns rather than around the case, so a horn is level across. */
const HORN_CROSS = 0.5;
/** Beyond TOP_LEVEL the top falls by TOP_FALL·Δ²: the horns roll over towards their tips. */
const TOP_LEVEL = 19;
const TOP_FALL = 0.17;
/** The underside follows more gently from UNDER_LEVEL on, down to below the caseback, and from
 * UNDER_LIFT_FROM on it rolls up again by UNDER_LIFT·Δ² into the nose of the horn. */
const UNDER_LEVEL = 17.5;
const UNDER_FALL = 0.055;
const UNDER_LIFT_FROM = 21.3;
const UNDER_LIFT = 0.55;

/** The flank is convex: two elliptical arcs that meet upright on its widest line. That line
 * lies this share of the flank's height above its foot … */
const WIDEST = 0.56;
/** … and the arcs are cut off after these angles, where the chamfer and the tuck take over. */
const UPPER_TURN = rad(70);
const LOWER_TURN = rad(62);
/** The chamfer always breaks the edge between top and flank by at least this much on either side. */
const MIN_BREAK = rad(5);
/** Between the horns the flank is a plain barrel, drawn in by SEAT_BARREL·Δy² about SEAT_EQUATOR_Y;
 * the end link of the bracelet is shaped to the same numbers (bracelet.ts). */
const SEAT_EQUATOR_Y = -0.6;
const SEAT_BARREL = 0.04;

/** Angle from three o'clock at which the outer edge of a horn leaves the case circle. */
const ROOT = rad(22);
/** The outer edge still converges on the bracelet by this much when it reaches the tip. */
const TIP_LEAN = rad(18);
const TIP_WIDTH = 2.3;
const TIP_OUTER_R = 1.15;
const TIP_INNER_R = 0.5;
/** Spring bar: the pin of the end link sits here (shared with the bracelet layout). */
const SPRING_BAR = { z: SPRING_BAR_Z, y: SPRING_BAR_Y, r: 0.42 };

/** How the edge is finished at a station of the outline: plan width of the chamfer, how far the
 * top and the foot of the convex flank lie inside the outline (0 = upright wall), and the plan
 * width and height of the rounding that tucks the flank under. */
type Edge = Pick<Station, 'chamfer' | 'upper' | 'lower' | 'tuck' | 'tuckH'>;
/** Around the case … */
const CASE_EDGE: Edge = { chamfer: 0.1, upper: 0.3, lower: 0.7, tuck: 0.35, tuckH: 0.45 };
/** … slimmer where the flank reaches the tip of a horn … */
const HORN_EDGE: Edge = { chamfer: 0.1, upper: 0.3, lower: 0.55, tuck: 0.3, tuckH: 0.4 };
/** … rounded into a nose across its blunt end … */
const NOSE_EDGE: Edge = { chamfer: 0.12, upper: 0.3, lower: 0.6, tuck: 0.4, tuckH: 0.5 };
/** … and upright where it faces the bracelet (inside of the horns, between the horns). */
const INNER_EDGE: Edge = { chamfer: 0.14, upper: 0, lower: 0, tuck: 0.3, tuckH: 0.35 };

// Stations along the outline of one quadrant (intervals per stretch).
const N_FLANK_ARC = 12;
const N_ROOT_ARC = 12;
const N_FACE = 14;
const N_HORN = N_ROOT_ARC + 1 + N_FACE;
/** Along a horn the stations close up towards the tip, where its top rolls over. */
const TIP_BIAS = 1.4;
const N_TIP_CORNER = 6;
/** Across the blunt end of a horn; also the number of rows across its top. */
const N_ACROSS = 4;
const N_SEAT_ARC = 18;
/** Rows of the swept edge: upper and lower arc of the flank, tucked-under rounding. */
const N_UPPER_ROWS = 6;
const N_LOWER_ROWS = 8;
const N_FLANK_ROWS = N_UPPER_ROWS + N_LOWER_ROWS;
const N_TUCK_ROWS = 5;

/** Rehaut: the flange between dial and crystal. Its lip stays clear of the hands, whose cap
 * ends at DIAL_Y + 1.12. */
const REHAUT_FOOT: Pt = [DIAL_R + 0.02, DIAL_Y - 0.07];
const REHAUT_LIP: Pt = [CRYSTAL_R - 0.05, 3.8];
const REHAUT_OUTER_R = 17.3;

/** Bezel: a short upright foot, then a dome that starts steeply and rolls over to a crisp crown
 * around the crystal. */
const BEZEL_FOOT_H = 0.2;
const BEZEL_CROWN_R = CRYSTAL_R + 0.36;

/** Crystal: an upright edge standing proud of the bezel, a chamfer, then a shallow dome. */
const CRYSTAL_EDGE_Y = BEZEL_TOP_Y - 0.14;
const CRYSTAL_PROUD = 0.2;
const CRYSTAL_CHAMFER: Pt = [0.3, 0.2];
const CRYSTAL_SAG = 0.7;

// Caseback, from the centre outwards: one flat plate with a fine engraved line,
// a lettered band and an edge cut into teeth for the case opener.
const BACK_LINE = { r: 12.55, halfWidth: 0.05, depth: 0.035 };
/** The capitals stand on the first radius and reach out to the second. */
const LETTER_BASE_R = 13.33;
const LETTER_CAP_R = 14.52;
/** Teeth: triangles in plan, as high as the plate stands proud of its foot. */
const BACK_TEETH = 144;
const BACK_ROOT_R = 15.65;
const BACK_TIP_R = 16.5;
const BACK_FOOT_Y = -4.06;
/** Engraved around the band, each phrase followed by a small crescent. */
const BACK_LETTERING = ['LUNA GUIDE', 'STUDIENMODELL', 'LUNA GUIDE', 'EDELSTAHL', '100 M'];
/** The lettered band is cut into sectors that lie side by side in the texture,
 * each in its true shape: stems stay upright and parallel, texels stay square.
 * A sector spans a whole number of teeth, so the plate needs no extra vertices. */
const LETTER_TILES = (() => {
  const count = 24, columns = 6, pxPerMm = 128, gutter = 8, pad = 0.1;
  const half = Math.PI / count, inner = LETTER_BASE_R - pad, outer = LETTER_CAP_R + pad;
  const tileW = Math.ceil(2 * outer * Math.sin(half) * pxPerMm) + 2 * gutter;
  const tileH = Math.ceil((outer - inner * Math.cos(half)) * pxPerMm) + 2 * gutter;
  return { count, columns, pxPerMm, gutter, half, inner, outer, tileW, tileH, width: columns * tileW, height: count / columns * tileH };
})();

// ── Small helpers ──────────────────────────────────────────────────────────

type Pt = [number, number];
type Vec = [number, number, number];

function rad(deg: number): number { return deg * Math.PI / 180; }
const { lerp, smoothstep } = THREE.MathUtils;

/** Indexed triangles with explicit normals, UVs and vertex colours. A triangle
 * is always wound to face the way its vertex normals point, so builders only
 * have to get the normals right — also after mirroring. */
class Surface {
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly uv: number[] = [];
  private readonly color: number[] = [];
  private readonly index: number[] = [];

  /** Number of vertices so far: the index the next one will get. */
  get count(): number { return this.position.length / 3; }

  vertex(p: Vec, n: Vec, u = 0, v = 0, shade = 1, alpha = 1): number {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.position.push(p[0], p[1], p[2]);
    this.normal.push(n[0] / l, n[1] / l, n[2] / l);
    this.uv.push(u, v);
    this.color.push(shade, shade, shade, alpha);
    return this.position.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    const P = this.position, N = this.normal;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    // Collapsed triangles occur at poles and where a horn closes at its tip.
    if (gx * gx + gy * gy + gz * gz < 1e-14) return;
    const facing = gx * (N[a * 3] + N[b * 3] + N[c * 3]) + gy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1])
      + gz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (facing >= 0) this.index.push(a, b, c); else this.index.push(a, c, b);
  }

  /** Corners in order around the quad. */
  quad(a: number, b: number, c: number, d: number): void { this.tri(a, b, c); this.tri(a, c, d); }

  /** Grid of `cols` × `rows` vertices added column by column, starting at `first`. */
  stitch(first: number, cols: number, rows: number, skip?: (col: number, row: number) => boolean): void {
    for (let i = 0; i < cols - 1; i++) for (let j = 0; j < rows - 1; j++) {
      if (skip?.(i, j)) continue;
      const n = first + i * rows + j;
      this.quad(n, n + rows, n + rows + 1, n + 1);
    }
  }

  /** Appends `source` mirrored by the signs; mirrored grain runs on continuously. */
  addMirrored(source: Surface, sx: number, sz: number): void {
    const offset = this.position.length / 3;
    for (let i = 0; i < source.position.length; i += 3) {
      this.position.push(source.position[i] * sx, source.position[i + 1], source.position[i + 2] * sz);
      this.normal.push(source.normal[i] * sx, source.normal[i + 1], source.normal[i + 2] * sz);
    }
    for (let i = 0; i < source.uv.length; i += 2) this.uv.push(source.uv[i] * sx * sz, source.uv[i + 1]);
    for (const c of source.color) this.color.push(c);
    for (let i = 0; i < source.index.length; i += 3) {
      this.tri(source.index[i] + offset, source.index[i + 1] + offset, source.index[i + 2] + offset);
    }
  }

  /** Positions and normals, plus only what the material reads: UVs, shade (rgb) or shade and alpha (rgba). */
  toGeometry(extra: { uv?: boolean; color?: 'rgb' | 'rgba' } = {}): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    if (extra.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (extra.color === 'rgba') geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 4));
    if (extra.color === 'rgb') geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.color.filter((_, i) => i % 4 !== 3), 3));
    geometry.setIndex(this.index);
    return geometry;
  }
}

/** Turns a profile of [radius, y] points about the Y axis. The solid lies to the
 * left of the direction of travel. Smooth within one call; a second call makes
 * a crisp edge. U runs around the turn, V along the profile; `alpha` is the
 * vertex alpha of the whole band (crystal). */
function revolve(out: Surface, profile: Pt[], alpha = 1): void {
  const first = out.count;
  let length = 0;
  for (let k = 0; k <= TURNS; k++) {
    const a = k / TURNS * Math.PI * 2, cos = Math.cos(a), sin = Math.sin(a);
    length = 0;
    for (let i = 0; i < profile.length; i++) {
      const [r, y] = profile[i];
      const before = profile[Math.max(0, i - 1)], after = profile[Math.min(profile.length - 1, i + 1)];
      const tr = after[0] - before[0], ty = after[1] - before[1];
      if (i > 0) length += Math.hypot(r - profile[i - 1][0], y - profile[i - 1][1]);
      out.vertex([r * cos, y, r * sin], [ty * cos, -tr, ty * sin], k / TURNS * 12, length / 3, 1, alpha);
    }
  }
  out.stitch(first, TURNS + 1, profile.length);
}

function cubic(a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt {
  const s = 1 - t;
  return [
    s * s * s * a[0] + 3 * s * s * t * b[0] + 3 * s * t * t * c[0] + t * t * t * d[0],
    s * s * s * a[1] + 3 * s * s * t * b[1] + 3 * s * t * t * c[1] + t * t * t * d[1],
  ];
}

function cubicTangent(a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt {
  const s = 1 - t;
  return [
    3 * s * s * (b[0] - a[0]) + 6 * s * t * (c[0] - b[0]) + 3 * t * t * (d[0] - c[0]),
    3 * s * s * (b[1] - a[1]) + 6 * s * t * (c[1] - b[1]) + 3 * t * t * (d[1] - c[1]),
  ];
}

// ── Top and underside of the middle case ───────────────────────────────────

/** A height and how it changes with x and with z. */
type Height = [y: number, dx: number, dz: number];

/** Distance along a horn, with its gradient. */
function hornReach(x: number, z: number): Height {
  const s = Math.hypot(z, HORN_CROSS * x) || 1;
  return [s, HORN_CROSS * HORN_CROSS * x / s, z / s];
}

/** The top is level under the bezel and along the first stretch of a horn, then rolls over. */
function topAt(x: number, z: number): Height {
  const [s, sx, sz] = hornReach(x, z);
  const d = Math.max(0, s - TOP_LEVEL), slope = -2 * TOP_FALL * d;
  return [SHOULDER_Y - TOP_FALL * d * d, slope * sx, slope * sz];
}

/** The underside is flat around the caseback, follows the horns down and rolls up into their noses. */
function underAt(x: number, z: number): Height {
  const [s, sx, sz] = hornReach(x, z);
  const d = Math.max(0, s - UNDER_LEVEL), e = Math.max(0, s - UNDER_LIFT_FROM);
  const slope = -2 * UNDER_FALL * d + 2 * UNDER_LIFT * e;
  return [UNDER_Y - UNDER_FALL * d * d + UNDER_LIFT * e * e, slope * sx, slope * sz];
}

// ── Plan outline and swept edge ────────────────────────────────────────────

/** One column of the swept edge. */
interface Station {
  /** Point on the widest outline and its outward normal, in plan. */
  x: number; z: number; nx: number; nz: number;
  /** Plan width of the polished top chamfer. */
  chamfer: number;
  /** How far the top and the foot of the convex flank lie inside the outline; 0 = upright wall. */
  upper: number; lower: number;
  /** 1 = the plain barrel between the horns, on which the end link sits. */
  seat: number;
  /** Plan width and height of the rounding that tucks the flank under. */
  tuck: number; tuckH: number;
}

interface Outline {
  /** Three o'clock → along the horn → around its tip → down its inner face to the case. */
  horn: Station[];
  /** From that inner corner along the case between the horns to six o'clock. */
  seat: Station[];
  /** Indices into `horn`: where the horn leaves the case, both ends of its blunt tip, the start of its inner face. */
  root: number; tipOuter: number; tipInner: number; face: number;
}

function blend(a: Edge, b: Edge, w: number): Edge {
  return {
    chamfer: lerp(a.chamfer, b.chamfer, w), upper: lerp(a.upper, b.upper, w), lower: lerp(a.lower, b.lower, w),
    tuck: lerp(a.tuck, b.tuck, w), tuckH: lerp(a.tuckH, b.tuckH, w),
  };
}

function quadrantOutline(): Outline {
  const horn: Station[] = [];
  const add = (list: Station[], x: number, z: number, nx: number, nz: number, edge: Edge, seat = 0): void => {
    const l = Math.hypot(nx, nz);
    list.push({ x, z, nx: nx / l, nz: nz / l, seat, ...edge });
  };

  for (let i = 0; i <= N_FLANK_ARC; i++) {
    const a = ROOT * i / N_FLANK_ARC;
    add(horn, CASE_R * Math.cos(a), CASE_R * Math.sin(a), Math.cos(a), Math.sin(a), CASE_EDGE);
  }
  const root = horn.length - 1;

  // Outer edge of the horn: leaves the circle tangentially and runs almost straight to the tip.
  const outerCorner: Pt = [LUG_INNER_X + TIP_WIDTH - TIP_OUTER_R, LUG_TIP_Z - TIP_OUTER_R];
  const p0: Pt = [CASE_R * Math.cos(ROOT), CASE_R * Math.sin(ROOT)];
  const p3: Pt = [outerCorner[0] + TIP_OUTER_R * Math.cos(TIP_LEAN), outerCorner[1] + TIP_OUTER_R * Math.sin(TIP_LEAN)];
  const reach = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / 3;
  const p1: Pt = [p0[0] - Math.sin(ROOT) * reach, p0[1] + Math.cos(ROOT) * reach];
  const p2: Pt = [p3[0] + Math.sin(TIP_LEAN) * reach, p3[1] - Math.cos(TIP_LEAN) * reach];
  for (let i = 1; i <= N_HORN; i++) {
    const t = 1 - (1 - i / N_HORN) ** TIP_BIAS;
    const [x, z] = cubic(p0, p1, p2, p3, t), [tx, tz] = cubicTangent(p0, p1, p2, p3, t);
    add(horn, x, z, tz, -tx, blend(CASE_EDGE, HORN_EDGE, smoothstep(t, 0.15, 0.9)));
  }

  // Around the outer corner the flank turns into the nose across the blunt end …
  for (let i = 1; i <= N_TIP_CORNER; i++) {
    const a = lerp(TIP_LEAN, Math.PI / 2, i / N_TIP_CORNER);
    add(horn, outerCorner[0] + TIP_OUTER_R * Math.cos(a), outerCorner[1] + TIP_OUTER_R * Math.sin(a), Math.cos(a), Math.sin(a),
      blend(HORN_EDGE, NOSE_EDGE, smoothstep(i / N_TIP_CORNER, 0, 1)));
  }
  const tipOuter = horn.length - 1;
  const innerCorner: Pt = [LUG_INNER_X + TIP_INNER_R, LUG_TIP_Z - TIP_INNER_R];
  for (let i = 1; i <= N_ACROSS; i++) {
    add(horn, lerp(outerCorner[0], innerCorner[0], i / N_ACROSS), LUG_TIP_Z, 0, 1, NOSE_EDGE);
  }
  const tipInner = horn.length - 1;
  // … and around the inner corner the nose runs out into the upright inner face.
  for (let i = 1; i <= N_TIP_CORNER; i++) {
    const a = lerp(Math.PI / 2, Math.PI, i / N_TIP_CORNER);
    add(horn, innerCorner[0] + TIP_INNER_R * Math.cos(a), innerCorner[1] + TIP_INNER_R * Math.sin(a), Math.cos(a), Math.sin(a),
      blend(NOSE_EDGE, INNER_EDGE, smoothstep(i / N_TIP_CORNER, 0, 1)));
  }
  const face = horn.length - 1;
  const cornerZ = Math.sqrt(CASE_R ** 2 - LUG_INNER_X ** 2);
  for (let i = 1; i <= N_FACE; i++) {
    add(horn, LUG_INNER_X, lerp(innerCorner[1], cornerZ, (i / N_FACE) ** TIP_BIAS), -1, 0, INNER_EDGE);
  }

  // Between the horns the end link of the bracelet sits against the barrel flank.
  const seat: Station[] = [];
  const cornerAngle = Math.atan2(cornerZ, LUG_INNER_X);
  for (let i = 0; i <= N_SEAT_ARC; i++) {
    const a = lerp(cornerAngle, Math.PI / 2, i / N_SEAT_ARC);
    add(seat, CASE_R * Math.cos(a), CASE_R * Math.sin(a), Math.cos(a), Math.sin(a), INNER_EDGE, 1);
  }
  return { horn, seat, root, tipOuter, tipInner, face };
}

/** Rows of the swept edge as [inset from the outline, y]: chamfer top, flank
 * top … widest line … flank foot, then the tuck. `fall` is the slope at which
 * the top arrives at the edge (positive = falling outwards), `lift` the slope
 * at which the underside does (positive = rising outwards). Heights depend
 * only on the edge sizes and on those slopes, so two faces meeting in a corner
 * share their rows. */
function edgeRows(st: Station, yTop: number, fall: number, yUnder: number, lift: number): Pt[] {
  const flankBottom = yUnder + st.tuckH;
  const cosU = Math.cos(UPPER_TURN), sinU = Math.sin(UPPER_TURN), cosL = Math.cos(LOWER_TURN), sinL = Math.sin(LOWER_TURN);
  // The upper arc must start more steeply than the top arrives, or the edge would be hollow
  // where a horn rolls over towards its tip: there the arc is kept slimmer. The chamfer halves
  // the angle between the two. Its height and the arc depend on each other; a few passes settle them.
  const topAngle = Math.atan(fall), steepest = topAngle + 2 * MIN_BREAK;
  let upper = st.upper, flankTop = yTop;
  for (let pass = 0; pass < 4; pass++) {
    const rise = (flankTop - flankBottom) * (1 - WIDEST);
    if (steepest > rad(1)) upper = Math.min(st.upper, rise * cosU / ((1 + cosU) * Math.tan(Math.min(rad(85), steepest))));
    const arcAngle = upper > 1e-6 ? Math.atan2(rise * cosU, upper * (1 + cosU)) : Math.PI / 2;
    flankTop = yTop - st.chamfer * Math.tan(THREE.MathUtils.clamp((topAngle + arcAngle) / 2, rad(10), rad(70)));
  }
  const widest = lerp(flankBottom, flankTop, WIDEST);
  // Likewise the lower arc where the underside rolls up into the nose of a horn.
  const depth = widest - flankBottom;
  const flattest = Math.PI / 2 - Math.atan(Math.max(0, lift)) - 2 * MIN_BREAK;
  const lower = Math.min(st.lower, Math.tan(Math.max(0, flattest)) * cosL * depth / (1 + cosL));
  const barrel = (y: number): number => st.seat * SEAT_BARREL * (y - SEAT_EQUATOR_Y) ** 2;

  const rows: Pt[] = [];
  for (let i = 0; i <= N_UPPER_ROWS; i++) {
    const t = UPPER_TURN * (1 - i / N_UPPER_ROWS);
    const y = widest + (flankTop - widest) * Math.sin(t) / sinU;
    rows.push([upper * (1 - Math.cos(t)) / (1 - cosU) + barrel(y), y]);
  }
  for (let i = 1; i <= N_LOWER_ROWS; i++) {
    const t = LOWER_TURN * i / N_LOWER_ROWS;
    const y = widest - depth * Math.sin(t) / sinL;
    rows.push([lower * (1 - Math.cos(t)) / (1 - cosL) + barrel(y), y]);
  }
  rows.unshift([rows[0][0] + st.chamfer, yTop]);
  // The tuck leaves the flank at the flank's own slope and meets the underside at the slope of the underside.
  const foot = rows[rows.length - 1][0];
  const slope = lower * (1 + cosL) / (cosL * Math.max(1e-6, depth)) + 2 * st.seat * SEAT_BARREL * (SEAT_EQUATOR_Y - flankBottom);
  const from: Pt = [foot, flankBottom], to: Pt = [foot + st.tuck, yUnder];
  const leave: Pt = [foot + 0.55 * st.tuckH * slope, flankBottom - 0.55 * st.tuckH];
  const arrive: Pt = [to[0] - 0.55 * st.tuck, yUnder + 0.55 * st.tuck * lift];
  for (let i = 1; i <= N_TUCK_ROWS; i++) rows.push(cubic(from, leave, arrive, to, i / N_TUCK_ROWS));
  return rows;
}

const EDGE_ROWS = 2 + N_FLANK_ROWS + N_TUCK_ROWS;

/** Positions of one station's rows. Top and underside heights follow from where the rows end up. */
function stationColumn(st: Station): THREE.Vector3[] {
  let yTop = SHOULDER_Y, fall = 0, yUnder = UNDER_Y, lift = 0, rows: Pt[] = [];
  for (let pass = 0; pass < 10; pass++) {
    rows = edgeRows(st, yTop, fall, yUnder, lift);
    const top = rows[0][0], under = rows[EDGE_ROWS - 1][0];
    const [ty, tdx, tdz] = topAt(st.x - st.nx * top, st.z - st.nz * top);
    const [uy, udx, udz] = underAt(st.x - st.nx * under, st.z - st.nz * under);
    yTop = ty;
    fall = -(tdx * st.nx + tdz * st.nz);
    yUnder = uy;
    lift = udx * st.nx + udz * st.nz;
  }
  return rows.map(([d, y]) => new THREE.Vector3(st.x - st.nx * d, y, st.z - st.nz * d));
}

/** Column in the inner corner, where the flat face of the horn meets the barrel
 * flank between the horns: every row lies on the mitre of the two. Top and
 * underside are level there, so both faces have the same rows. */
function mitreColumn(face: Station, seat: Station): THREE.Vector3[] {
  const mitre = (dFace: number, dSeat: number): Pt => {
    const x = LUG_INNER_X + dFace;
    return [x, Math.sqrt((CASE_R - dSeat) ** 2 - x * x)];
  };
  let yTop = SHOULDER_Y, yUnder = UNDER_Y, a: Pt[] = [], b: Pt[] = [];
  for (let pass = 0; pass < 6; pass++) {
    a = edgeRows(face, yTop, 0, yUnder, 0);
    b = edgeRows(seat, yTop, 0, yUnder, 0);
    yTop = topAt(...mitre(a[0][0], b[0][0]))[0];
    yUnder = underAt(...mitre(a[EDGE_ROWS - 1][0], b[EDGE_ROWS - 1][0]))[0];
  }
  return a.map(([d, y], row) => { const [x, z] = mitre(d, b[row][0]); return new THREE.Vector3(x, y, z); });
}

/** Surfaces by finish. */
interface Skin { satin: Surface; polish: Surface; dark: Surface; }

/** Polished chamfer, flank and tuck along one stretch of the outline. `mirrorBefore`
 * and `mirrorAfter` continue the stretch across a mirror plane (absent at a crease). */
function addSweptEdge(
  out: Surface, columns: THREE.Vector3[][], mirrorBefore: Vec | null, mirrorAfter: Vec | null,
  skip?: (col: number, row: number) => boolean,
): void {
  const n = columns.length;
  const scratch = new THREE.Vector3(), along = new THREE.Vector3(), down = new THREE.Vector3(), normal = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const at = (i: number, row: number, target: THREE.Vector3): THREE.Vector3 => {
    if (i < 0) return mirrorBefore ? target.copy(columns[1][row]).multiply(scratch.fromArray(mirrorBefore)) : target.copy(columns[0][row]);
    if (i >= n) return mirrorAfter ? target.copy(columns[n - 2][row]).multiply(scratch.fromArray(mirrorAfter)) : target.copy(columns[n - 1][row]);
    return target.copy(columns[i][row]);
  };

  // Chamfer: flat across its width, with a crisp edge above and below.
  const chamfer = out.count;
  for (let i = 0; i < n; i++) {
    along.copy(at(i + 1, 0, a)).add(at(i + 1, 1, b)).sub(at(i - 1, 0, a)).sub(at(i - 1, 1, b));
    down.copy(columns[i][1]).sub(columns[i][0]);
    normal.crossVectors(along, down);
    for (let row = 0; row < 2; row++) out.vertex(columns[i][row].toArray(), normal.toArray());
  }
  out.stitch(chamfer, n, 2);

  // Flank and tuck: one smooth skin.
  const flank = out.count;
  for (let i = 0; i < n; i++) {
    for (let row = 1; row < EDGE_ROWS; row++) {
      along.copy(at(i + 1, row, a)).sub(at(i - 1, row, b));
      down.copy(columns[i][Math.min(EDGE_ROWS - 1, row + 1)]).sub(columns[i][Math.max(1, row - 1)]);
      normal.crossVectors(along, down);
      out.vertex(columns[i][row].toArray(), normal.toArray());
    }
  }
  out.stitch(flank, n, EDGE_ROWS - 1, skip);
}

/** Top (`up` = 1) or underside (−1) inside the swept edge: a ring around the
 * case, and along the horn a tongue of ribs between its outer and inner edge. */
function addCap(out: Surface, outline: Outline, hornEdge: THREE.Vector3[], seatEdge: THREE.Vector3[], innerRadii: number[], up: 1 | -1): void {
  const at = up > 0 ? topAt : underAt;
  const corner = hornEdge.length - 1;
  const vertex = (x: number, z: number): number => {
    const [y, dx, dz] = at(x, z);
    // Three grain repeats per quadrant keep the brushing seamless across the mirror planes.
    return out.vertex([x, y, z], [-up * dx, up, -up * dz], Math.atan2(z, x) / (Math.PI / 2) * 3, Math.hypot(x, z) / 3);
  };

  // The ring's outer row: flank arc, then the arc under the root of the horn, the corner, the seat arc.
  const rim = Math.hypot(hornEdge[0].x, hornEdge[0].z);
  const faceX = hornEdge[corner].x;
  const rootArc: Pt[] = [[hornEdge[outline.root].x, hornEdge[outline.root].z]];
  for (let i = 1; i <= N_ROOT_ARC; i++) {
    const a = lerp(ROOT, Math.acos(faceX / rim), i / N_ROOT_ARC);
    rootArc.push([rim * Math.cos(a), rim * Math.sin(a)]);
  }
  const outer: Pt[] = [
    ...hornEdge.slice(0, outline.root).map((p): Pt => [p.x, p.z]),
    ...rootArc,
    [hornEdge[corner].x, hornEdge[corner].z],
    ...seatEdge.slice(1).map((p): Pt => [p.x, p.z]),
  ];
  const ring = out.count;
  for (const [x, z] of outer) {
    const r = Math.hypot(x, z), innermost = innerRadii[innerRadii.length - 1];
    for (const radius of [...innerRadii, (innermost + r) / 2, r]) vertex(x * radius / r, z * radius / r);
  }
  out.stitch(ring, outer.length, innerRadii.length + 2);

  // Tongue: ribs from the inner side (root arc, then the inner face) to the outer edge of the
  // horn. The first rib is the point where the horn leaves the case, the last its blunt end.
  const outerSide: Pt[] = hornEdge.slice(outline.root, outline.tipOuter + 1).map((p): Pt => [p.x, p.z]);
  const innerSide: Pt[] = [...rootArc, [hornEdge[corner].x, hornEdge[corner].z]];
  for (let i = corner - 1; i >= outline.tipInner; i--) innerSide.push([hornEdge[i].x, hornEdge[i].z]);
  const tongue = out.count, ribs = outerSide.length;
  for (let k = 0; k < ribs; k++) {
    for (let j = 0; j <= N_ACROSS; j++) {
      const t = j / N_ACROSS, end = hornEdge[outline.tipInner - j];
      if (k === ribs - 1) vertex(end.x, end.z);
      else vertex(lerp(innerSide[k][0], outerSide[k][0], t), lerp(innerSide[k][1], outerSide[k][1], t));
    }
  }
  out.stitch(tongue, ribs, N_ACROSS + 1);
}

/** Flat inner face of the horn with the drilled spring-bar hole. */
function addHornFace(out: Skin, columns: THREE.Vector3[][], faceStart: number): void {
  const last = columns.length - 1, top = 1, bottom = 1 + N_FLANK_ROWS;
  const rimPoints: THREE.Vector3[] = [];
  for (let i = faceStart; i <= last; i++) rimPoints.push(columns[i][top]);
  for (let row = top + 1; row <= bottom; row++) rimPoints.push(columns[last][row]);
  for (let i = last - 1; i >= faceStart; i--) rimPoints.push(columns[i][bottom]);
  for (let row = bottom - 1; row > top; row--) rimPoints.push(columns[faceStart][row]);
  const steps = 24, sink = SPRING_BAR.r + 0.13, depth = 1.2;
  const circle = (r: number, k: number): Pt => {
    const a = k / steps * Math.PI * 2;
    return [SPRING_BAR.z + r * Math.cos(a), SPRING_BAR.y + r * Math.sin(a)];
  };
  const hole: THREE.Vector2[] = [];
  for (let k = 0; k < steps; k++) hole.push(new THREE.Vector2(...circle(sink, k)));
  const contour = rimPoints.map(p => new THREE.Vector2(p.z, p.y));
  const first = out.polish.count;
  for (const p of [...contour, ...hole]) out.polish.vertex([LUG_INNER_X, p.y, p.x], [-1, 0, 0]);
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [hole])) out.polish.tri(first + a, first + b, first + c);

  // Countersink, bore and blind end.
  const sinkStart = out.polish.count;
  const boreStart = out.dark.count;
  const end = out.dark.vertex([LUG_INNER_X + depth, SPRING_BAR.y, SPRING_BAR.z], [-1, 0, 0]);
  for (let k = 0; k <= steps; k++) {
    const [uz, uy] = circle(1, k), dz = uz - SPRING_BAR.z, dy = uy - SPRING_BAR.y;
    const [z0, y0] = circle(sink, k), [z1, y1] = circle(SPRING_BAR.r, k);
    out.polish.vertex([LUG_INNER_X, y0, z0], [-1, -dy, -dz]);
    out.polish.vertex([LUG_INNER_X + 0.13, y1, z1], [-1, -dy, -dz]);
    out.dark.vertex([LUG_INNER_X + 0.13, y1, z1], [0, -dy, -dz]);
    out.dark.vertex([LUG_INNER_X + depth, y1, z1], [0, -dy, -dz]);
    out.dark.vertex([LUG_INNER_X + depth, y1, z1], [-1, 0, 0]);
  }
  out.polish.stitch(sinkStart, steps + 1, 2);
  for (let k = 0; k < steps; k++) {
    const n = boreStart + 1 + k * 3;
    out.dark.quad(n, n + 3, n + 4, n + 1);
    out.dark.tri(end, n + 2, n + 5);
  }
}

/** Middle case with its four horns, the seat under the bezel, the rehaut and the open cavity. */
function buildMiddleCase(out: Skin, rehaut: Surface): void {
  const outline = quadrantOutline();
  const hornColumns = outline.horn.map(stationColumn);
  const seatColumns = outline.seat.map(stationColumn);
  const corner = mitreColumn(outline.horn[outline.horn.length - 1], outline.seat[0]);
  hornColumns[hornColumns.length - 1] = corner;
  seatColumns[0] = corner;

  const quadrant: Skin = { satin: new Surface(), polish: new Surface(), dark: new Surface() };
  // The flat inner face of the horn is cut out of the sweep and filled in around the spring-bar hole.
  const faceQuad = (col: number, row: number) => col >= outline.face && row < N_FLANK_ROWS;
  addSweptEdge(quadrant.polish, hornColumns, [1, 1, -1], null, faceQuad);
  addSweptEdge(quadrant.polish, seatColumns, null, [-1, 1, 1]);
  addHornFace(quadrant, hornColumns, outline.face);
  // The top reaches in under the bezel as its seat; the underside laps over the seam around the caseback.
  addCap(quadrant.satin, outline, hornColumns.map(c => c[0]), seatColumns.map(c => c[0]), [REHAUT_OUTER_R, SHOULDER_R - 0.3], 1);
  addCap(quadrant.satin, outline, hornColumns.map(c => c[EDGE_ROWS - 1]), seatColumns.map(c => c[EDGE_ROWS - 1]), [BACK_SEAM_R - 0.02], -1);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    out.satin.addMirrored(quadrant.satin, sx, sz);
    out.polish.addMirrored(quadrant.polish, sx, sz);
    out.dark.addMirrored(quadrant.dark, sx, sz);
  }

  // Rehaut: a satin cone from the dial up to the crystal, standing on the seat of the bezel.
  revolve(out.satin, [[REHAUT_OUTER_R, SHOULDER_Y - 0.05], [REHAUT_OUTER_R, REHAUT_LIP[1]]]);
  revolve(out.dark, [[REHAUT_OUTER_R, REHAUT_LIP[1]], REHAUT_LIP]);
  revolve(rehaut, [REHAUT_LIP, REHAUT_FOOT]);
  // Bore for the movement (seen with dial or caseback removed), the lip the caseback screws
  // against, and the seam around the caseback.
  revolve(out.dark, [REHAUT_FOOT, [REHAUT_FOOT[0], CASEBACK_INNER_Y]]);
  revolve(out.dark, [[REHAUT_FOOT[0], CASEBACK_INNER_Y], [BACK_R, CASEBACK_INNER_Y]]);
  revolve(out.dark, [[BACK_SEAM_R, UNDER_Y + 0.14], [BACK_SEAM_R, UNDER_Y]]);
  revolve(out.dark, [[BACK_R, UNDER_Y + 0.14], [BACK_SEAM_R, UNDER_Y + 0.14]]);
  revolve(out.dark, [[BACK_R, CASEBACK_INNER_Y], [BACK_R, UNDER_Y + 0.14]]);
}

// ── Caseback ───────────────────────────────────────────────────────────────

/** Where a point of the lettered band lies in the texture; `sector` picks the tile. */
function letterUv(sector: number, a: number, r: number): Pt {
  const { columns, pxPerMm, gutter, half, outer, tileW, tileH, width, height } = LETTER_TILES;
  const turned = a - (sector * 2 + 1) * half;
  const x = (sector % columns + 0.5) * tileW + r * Math.sin(turned) * pxPerMm;
  const y = Math.floor(sector / columns) * tileH + gutter + (outer - r * Math.cos(turned)) * pxPerMm;
  return [x / width, 1 - y / height];
}

/** Closed screw-down back: a flat plate, straight-brushed from twelve to six by
 * its material, with the engraved line and the lettering, which reads clockwise
 * when the watch is turned over. Around it the teeth for the case opener stand
 * on a narrow foot that runs out into the seam. Its inner face lies flush with
 * the lip of the case, under the movement. */
function buildCaseback(out: Skin, plate: Surface): void {
  const y = CASE_BOTTOM_Y, pitch = Math.PI * 2 / BACK_TEETH;
  // Seen from behind, clockwise is the direction of falling angle.
  const at = (a: number, r: number, height = y): Vec => [r * Math.cos(-a), height, r * Math.sin(-a)];
  // The corner of a tile lies outside the lettering: plain steel, no relief.
  const blank: Pt = [2 / LETTER_TILES.width, 1 - 2 / LETTER_TILES.height];

  /** Plain ring of the plate between two [radius, y] points, with a shade at either edge. */
  const ring = (from: Pt, to: Pt, shades: Pt = [1, 1]): void => {
    const first = plate.count, run = to[0] - from[0], rise = to[1] - from[1];
    for (let i = 0; i <= BACK_TEETH; i++) {
      const a = i * pitch, normal: Vec = [rise * Math.cos(-a), -run, rise * Math.sin(-a)];
      plate.vertex(at(a, from[0], from[1]), normal, blank[0], blank[1], shades[0]);
      plate.vertex(at(a, to[0], to[1]), normal, blank[0], blank[1], shades[1]);
    }
    plate.stitch(first, BACK_TEETH + 1, 2);
  };
  const { r: lineR, halfWidth, depth } = BACK_LINE;
  ring([0, y], [lineR - halfWidth, y]);
  ring([lineR - halfWidth, y], [lineR, y + depth], [0.8, 0.35]);
  ring([lineR, y + depth], [lineR + halfWidth, y], [0.35, 0.8]);
  ring([lineR + halfWidth, y], [LETTER_TILES.inner, y]);
  ring([LETTER_TILES.outer, y], [BACK_ROOT_R, y]);

  // Lettered band: every sector has its own vertices, mapped onto its tile.
  const perSector = BACK_TEETH / LETTER_TILES.count;
  for (let sector = 0; sector < LETTER_TILES.count; sector++) {
    const first = plate.count;
    for (let i = 0; i <= perSector; i++) {
      const a = (sector * perSector + i) * pitch;
      for (const r of [LETTER_TILES.inner, LETTER_TILES.outer]) plate.vertex(at(a, r), [0, -1, 0], ...letterUv(sector, a, r));
    }
    plate.stitch(first, perSector + 1, 2);
  }

  // Teeth: the top of each is part of the plate, its two flanks are polished walls down to the foot.
  for (let i = 0; i < BACK_TEETH; i++) {
    const left = at(i * pitch, BACK_ROOT_R), tip = at((i + 0.5) * pitch, BACK_TIP_R), right = at((i + 1) * pitch, BACK_ROOT_R);
    plate.tri(
      plate.vertex(left, [0, -1, 0], blank[0], blank[1]),
      plate.vertex(tip, [0, -1, 0], blank[0], blank[1]),
      plate.vertex(right, [0, -1, 0], blank[0], blank[1]),
    );
    for (const [from, to, other] of [[left, tip, right], [tip, right, left]]) {
      // Level normal across the flank, pointing away from the tooth's third corner.
      let nx = to[2] - from[2], nz = from[0] - to[0];
      if (nx * (from[0] - other[0]) + nz * (from[2] - other[2]) < 0) { nx = -nx; nz = -nz; }
      const corners: Vec[] = [from, to, [to[0], BACK_FOOT_Y, to[2]], [from[0], BACK_FOOT_Y, from[2]]];
      const [a, b, c, d] = corners.map(p => out.polish.vertex(p, [nx, 0, nz]));
      out.polish.quad(a, b, c, d);
    }
  }
  // The floor between the teeth lies in their shadow; the polished foot runs out into the seam.
  revolve(out.dark, [[BACK_ROOT_R - 0.2, BACK_FOOT_Y], [BACK_TIP_R, BACK_FOOT_Y]]);
  revolve(out.polish, [
    [BACK_TIP_R, BACK_FOOT_Y], [BACK_TIP_R + 0.12, BACK_FOOT_Y + 0.008], [BACK_R - 0.08, BACK_FOOT_Y + 0.03],
    [BACK_R - 0.02, BACK_FOOT_Y + 0.055], [BACK_R, CASEBACK_INNER_Y],
  ]);
  revolve(out.dark, [[BACK_R, CASEBACK_INNER_Y], [0, CASEBACK_INNER_Y]]);
}

// ── Bezel and crystal ──────────────────────────────────────────────────────

/** Polished bezel: a short upright foot above a shadow line, a dome that rolls over to a
 * crisp crown, then a narrow bevel down to the lip that holds the crystal. */
function buildBezel(polish: Surface, seam: Surface): void {
  const foot = SHOULDER_Y + 0.02, lipR = CRYSTAL_R + 0.02, lipY = BEZEL_TOP_Y - 0.15;
  const wallR = SHOULDER_R - 0.02, wallFrom = foot + 0.1, wallTo = wallFrom + BEZEL_FOOT_H;
  const crown: Pt = [BEZEL_CROWN_R, BEZEL_TOP_Y];
  revolve(polish, [[wallR, wallFrom], [wallR, wallTo]]);
  const dome: Pt[] = [];
  for (let i = 0; i <= 20; i++) {
    dome.push(cubic([wallR, wallTo], [wallR - 0.12, wallTo + 0.8], [BEZEL_CROWN_R + 0.82, BEZEL_TOP_Y - 0.08], crown, i / 20));
  }
  revolve(polish, dome);
  const bevel: Pt[] = [];
  for (let i = 0; i <= 4; i++) {
    bevel.push(cubic(crown, [BEZEL_CROWN_R - 0.12, BEZEL_TOP_Y - 0.06], [BEZEL_CROWN_R - 0.25, BEZEL_TOP_Y - 0.11], [lipR, lipY], i / 4));
  }
  revolve(polish, bevel);
  // Inside: the wall that holds the crystal, its ledge, the bore over the rehaut and the underside.
  revolve(polish, [[lipR, lipY], [lipR, REHAUT_LIP[1] + 0.03]]);
  revolve(polish, [[lipR, REHAUT_LIP[1] + 0.03], [REHAUT_OUTER_R + 0.05, REHAUT_LIP[1] + 0.03]]);
  revolve(polish, [[REHAUT_OUTER_R + 0.05, REHAUT_LIP[1] + 0.03], [REHAUT_OUTER_R + 0.05, foot]]);
  revolve(polish, [[REHAUT_OUTER_R + 0.05, foot], [wallR - 0.1, foot]]);
  // Undercut at the foot: reads as the shadow line between bezel and case.
  revolve(seam, [[wallR - 0.1, foot], [wallR, wallFrom]]);
}

/** Sapphire crystal: an upright edge standing proud of the bezel, a chamfer, then a low dome. */
function buildCrystal(glass: Surface): void {
  const edge: Pt = [CRYSTAL_R, CRYSTAL_EDGE_Y];
  const rim: Pt = [CRYSTAL_R, BEZEL_TOP_Y + CRYSTAL_PROUD];
  const shoulder: Pt = [CRYSTAL_R - CRYSTAL_CHAMFER[0], rim[1] + CRYSTAL_CHAMFER[1]];
  revolve(glass, [edge, rim], 0.3);
  revolve(glass, [rim, shoulder], 0.3);
  const sphere = (shoulder[0] ** 2 + CRYSTAL_SAG ** 2) / (2 * CRYSTAL_SAG);
  const dome: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const r = shoulder[0] * (1 - i / 12);
    dome.push([r, shoulder[1] + Math.sqrt(sphere ** 2 - r ** 2) - Math.sqrt(sphere ** 2 - shoulder[0] ** 2)]);
  }
  revolve(glass, dome, 0);
}

// ── Textures and materials ─────────────────────────────────────────────────

/** The engraved lettering of the caseback: dark where the steel is cut away, so
 * the same picture serves as colour and as relief. The phrases and the
 * crescents between them are spaced out to fill the turn exactly, whatever
 * font the device supplies, so the lettering closes on itself evenly. */
function makeCasebackTexture(): THREE.CanvasTexture {
  const { count, columns, pxPerMm, gutter, half, outer, tileW, tileH, width, height } = LETTER_TILES;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#a9aeb3';

  // Fonts differ in their proportions: the size follows from the measured height of a capital.
  const capHeight = (LETTER_CAP_R - LETTER_BASE_R) * pxPerMm;
  const family = '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", "Noto Serif", serif';
  ctx.font = `700 100px ${family}`;
  const measured = ctx.measureText('H').actualBoundingBoxAscent;
  ctx.font = `700 ${capHeight / (measured > 50 && measured < 90 ? measured / 100 : 0.66)}px ${family}`;
  ctx.textBaseline = 'alphabetic';

  // A crescent of our own between the phrases; no manufacturer emblem. It leans back,
  // horns up and to the right: upright it reads as a bracket opening the next phrase.
  const moonR = capHeight * 0.52, biteR = moonR * 0.88, biteX = moonR * 0.5, lean = rad(30);
  const hornX = (moonR ** 2 - biteR ** 2 + biteX ** 2) / (2 * biteX), hornY = Math.sqrt(moonR ** 2 - hornX ** 2);
  const limb = Math.atan2(hornY, hornX), bite = Math.atan2(hornY, hornX - biteX);
  const crescent = (centre: number): void => {
    // Centred between its round back and the lower horn.
    ctx.translate(centre + moonR * (1 - Math.cos(limb - lean)) / 2, -capHeight / 2);
    ctx.rotate(-lean);
    ctx.beginPath();
    ctx.arc(0, 0, moonR, limb, Math.PI * 2 - limb);
    ctx.arc(biteX, 0, biteR, Math.PI * 2 - bite, bite, true);
    ctx.fill();
  };

  // Glyphs in reading order: width along the line and how to draw one centred on the baseline.
  const glyphs: { advance: number; draw: (() => void) | null }[] = [];
  for (const phrase of BACK_LETTERING) {
    for (const ch of phrase) {
      const w = ctx.measureText(ch).width;
      glyphs.push(ch === ' ' ? { advance: capHeight * 0.3, draw: null } : { advance: w, draw: () => ctx.fillText(ch, -w / 2, 0) });
    }
    // A phrase that ends on a capital with an open right side (L, E) would leave a hole
    // before its crescent: the crescent moves up to it by that much.
    const open = capHeight * (phrase.endsWith('L') ? 0.16 : phrase.endsWith('E') ? 0.08 : 0);
    glyphs.push({ advance: capHeight * 1.7 - open, draw: () => crescent(-open / 2) });
  }
  // The line is as long as the turn at half the height of the capitals.
  const around = Math.PI * (LETTER_BASE_R + LETTER_CAP_R) * pxPerMm;
  const natural = glyphs.reduce((sum, g) => sum + g.advance, 0);
  // A wider fallback font is squeezed rather than allowed to overlap.
  const squeeze = Math.min(1, around * 0.92 / natural);
  const tracking = (around - natural * squeeze) / glyphs.length;
  // The first phrase is centred on twelve o'clock, a quarter turn from the crown.
  const firstWidth = glyphs.slice(0, BACK_LETTERING[0].length).reduce((sum, g) => sum + g.advance * squeeze + tracking, 0) - tracking;
  let x = around / 4 - firstWidth / 2;
  const placed = glyphs.map(g => {
    const angle = (x + g.advance * squeeze / 2) / around * Math.PI * 2;
    x += g.advance * squeeze + tracking;
    return { angle, draw: g.draw };
  });

  for (let sector = 0; sector < count; sector++) {
    const left = sector % columns * tileW, top = Math.floor(sector / columns) * tileH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, tileW, tileH);
    ctx.clip();
    // Origin on the axis of the watch, the middle of the sector straight above it.
    ctx.translate(left + tileW / 2, top + gutter + outer * pxPerMm);
    for (const glyph of placed) {
      const turned = THREE.MathUtils.euclideanModulo(glyph.angle - (sector * 2 + 1) * half + Math.PI, Math.PI * 2) - Math.PI;
      // Glyphs of the neighbouring sectors run on into the gutter.
      if (!glyph.draw || Math.abs(turned) > half * 2) continue;
      ctx.save();
      ctx.rotate(turned);
      ctx.translate(0, -LETTER_BASE_R * pxPerMm);
      ctx.scale(squeeze, 1);
      glyph.draw();
      ctx.restore();
    }
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Sapphire: nothing but its reflection, added to what lies behind it. What the
 * glass reflects it no longer lets through, so alpha is the reflectance — and
 * the vertex alpha of the chamfer, where the thick edge dims the view a little.
 * The anti-reflective coating keeps the reflection faint and slightly blue. */
function sapphire(): THREE.MeshPhysicalMaterial {
  const ior = 1.77, coating = 0.7;
  // Lamps are points to the renderer and would glare off the dome as large blooms. Their
  // share of the reflection is cut down to a glint; the studio reflection keeps its strength.
  const lamps = 0.06, studio = 0.4;
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x000000, metalness: 0, roughness: 0, ior, specularColor: 0xd4e2ff,
    specularIntensity: coating * lamps, envMapIntensity: studio / lamps,
    vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const head = ((ior - 1) / (ior + 1)) ** 2 * coating;
  glass.onBeforeCompile = shader => {
    // Without this patch (other three.js shader layout) the glass merely stops dimming what is behind it.
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`
      float glassGrazing = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 5.0 );
      diffuseColor.a = max( diffuseColor.a, mix( ${head.toFixed(4)}, ${coating.toFixed(4)}, glassGrazing ) );
      #include <opaque_fragment>`);
  };
  glass.customProgramCacheKey = () => 'luna-case-sapphire';
  return glass;
}

/** A copy that keeps the shader hooks of a shared material. */
function variant<T extends THREE.Material>(material: T): T {
  const copy = material.clone();
  copy.onBeforeCompile = material.onBeforeCompile;
  copy.customProgramCacheKey = material.customProgramCacheKey;
  return copy;
}

// ── Assembly ───────────────────────────────────────────────────────────────

/** Middle case, lugs, caseback, rehaut, bezel and crystal. */
export function makeCase(m: WatchMaterials): CaseParts {
  const group = new THREE.Group();
  group.name = 'Case';
  const top = new THREE.Group();
  top.name = 'Bezel and crystal';
  const back = new THREE.Group();
  back.name = 'Caseback';

  const skin: Skin = { satin: new Surface(), polish: new Surface(), dark: new Surface() };
  const backSkin: Skin = { satin: new Surface(), polish: new Surface(), dark: new Surface() };
  const rehaut = new Surface(), plate = new Surface();
  buildMiddleCase(skin, rehaut);
  buildCaseback(backSkin, plate);

  // Everything turned is satin with the grain running around the dial axis.
  const satin = m.brushedCircular;
  // The caseback is brushed straight; the grain of that steel runs across the geometry's X axis,
  // which is from twelve to six here. Its lettering is engraved: darker ground, real relief.
  const engraved = variant(m.brushed);
  engraved.vertexColors = true;
  engraved.map = engraved.bumpMap = makeCasebackTexture();
  engraved.bumpScale = 1.2;
  const glass = sapphire();

  const add = (parent: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  };
  add(group, 'Shoulder, horn tops and underside · satin', skin.satin.toGeometry({ uv: true }), satin);
  add(group, 'Flanks and chamfers · polished', skin.polish.toGeometry(), m.steel);
  add(group, 'Recesses and cavity', skin.dark.toGeometry(), m.darkSteel);
  add(group, 'Rehaut', rehaut.toGeometry(), m.rehaut);
  add(back, 'Screw-down caseback · straight-brushed, engraved', plate.toGeometry({ uv: true, color: 'rgb' }), engraved);
  add(back, 'Caseback teeth and foot · polished', backSkin.polish.toGeometry(), m.steel);
  add(back, 'Caseback recesses and inner face', backSkin.dark.toGeometry(), m.darkSteel);

  const bezel = new Surface(), seam = new Surface(), crystal = new Surface();
  buildBezel(bezel, seam);
  buildCrystal(crystal);
  add(top, 'Domed polished bezel', bezel.toGeometry(), m.steel);
  add(top, 'Bezel seam', seam.toGeometry(), m.darkSteel);
  // Drawn after the dial, the hands and the overlays on the dial.
  add(top, 'Low-domed sapphire crystal', crystal.toGeometry({ color: 'rgba' }), glass).renderOrder = 3;

  group.add(top, back);
  return { group, top, back };
}
