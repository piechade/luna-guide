// Keyless and setting works of the study movement, on both sides of the main
// plate: winding stem, sliding and winding pinion, setting lever with its
// jumper, yoke, switching lever with the setting wheel, the stop lever at the
// balance, and on the rotor side crown wheel, ratchet and click. The quick-set
// correctors (double corrector, date, moon and day corrector) belong to
// dial-side.ts, whose kinematics step the calendar past its jumpers.
//
// Every moving steel part is a bone of one of two skinned meshes (one per
// finish). Bones are ordinary scene nodes: the scene manager's fingerprint sees
// them move, no invalidate needed. Crown wheel and ratchet are plain meshes so
// their circular graining turns with them.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { skin, type P3 } from '../crown';
import type { WatchMaterials } from '../materials';
import {
  BACK_SIDE, DIAL_SIDE, FINISHES, KEYLESS, PLATE, SCREWS,
  SETTING_WHEEL_PER_CROWN, STEM_Y, TAU, WINDING, quickSetWeight, settingLeverAngle,
  settingWheelAngle, slidingPinionShift, stemTravel, stopLeverEngagement, switchLeverAngle,
  type MovementState, type ScrewSpec,
} from './data';
import { withUnderside } from './underside';

export interface Keyless {
  group: THREE.Group;
  /** Every frame while shown; allocation-free. */
  update(s: MovementState): void;
  /** Forget the previous frame (call when showing the works again after skipped updates), so crown
   * turns made meanwhile are not replayed as winding or corrector motion. */
  resync(): void;
}

type P = readonly [number, number];
type Finish = 'satin' | 'polished';
interface Faces { caps: THREE.BufferGeometry; sides: THREE.BufferGeometry }
interface Toothing { readonly teeth: number; readonly pitchR: number; readonly tipR: number; readonly rootR: number }

const deg = (d: number): number => d * Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const fract = (v: number): number => v - Math.floor(v);
const dist = (a: P, b: P): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angleOf = (from: P, to: P): number => Math.atan2(to[1] - from[1], to[0] - from[0]);
const polar = (c: P, a: number, r: number): P => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
const lerp2 = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/** `p` carried round `c` by a part turned to rotation.y = `rot` (plan angles shrink by `rot`). */
const carried = (p: P, c: P, rot: number): P => polar(c, angleOf(c, p) - rot, dist(c, p));
/** Velocity direction of `p` when a part turns about `c` with rotation.y increasing. */
const spinVelocity = (p: P, c: P): P => {
  const a = angleOf(c, p);
  return [Math.sin(a), -Math.cos(a)];
};
const dot = (a: P, b: P): number => a[0] * b[0] + a[1] * b[1];

// ── Layout (data.ts) and what follows from it ────────────────────────────────

const { stem: STEM, slidingPinion: SLIDING, windingPinion: WINDING_PINION, settingLever: LEVER, yoke: YOKE } = KEYLESS;
const { switchLever: SWITCH, settingWheel: SETTING, stopLever: STOP, settingLeverJumper: JUMPER } = KEYLESS;

const GROOVE_WIDTH = SLIDING.grooveWidth;
/** Breguet teeth between sliding and winding pinion: depth of the saw, and one tooth as an angle. */
const BREGUET_DEPTH = WINDING_PINION.breguetDepth;
const BREGUET_PITCH = TAU / SLIDING.breguetTeeth;
/** Contact plane of the Breguet teeth in position 1: the winding pinion's inner face. */
const BREGUET_X = WINDING_PINION.fromX;
/** Up to this crown pull the Breguet teeth are in mesh (they let go after 0.1 of the 0.55 shift). */
const WIND_ENGAGED_PULL = WINDING_PINION.engagedUpToPull;
const WINDING_PINION_PER_RATCHET = 1 / WINDING.ratchetPerStemTurn;
const RATCHET = BACK_SIDE.ratchet;
const CROWN_WHEEL = BACK_SIDE.crownWheel;
const CROWN_WHEEL_PER_RATCHET = -RATCHET.gear.teeth / CROWN_WHEEL.gear.teeth;
const RATCHET_PITCH = TAU / RATCHET.gear.teeth;

/** Yoke beak on the setting lever's cam: on the circle over both pivots (Thales), so the cam
 * lifts it straight away from the setting-lever pivot; on the stem side of the pivots. */
const YOKE_BEAK: P = (() => {
  const mid = lerp2(YOKE.pivot, LEVER.pivot, 0.5);
  const across = angleOf(YOKE.pivot, LEVER.pivot) + Math.PI / 2;
  return polar(mid, across, dist(YOKE.pivot, LEVER.pivot) / 2);
})();
/** The beak ends in a round, its centre straight out from the lever pivot. */
const YOKE_BEAK_R = YOKE.beakR;
const YOKE_BEAK_CENTRE: P = polar(YOKE_BEAK, angleOf(LEVER.pivot, YOKE_BEAK), YOKE_BEAK_R);
const NOTCH_ANGLE = LEVER.notches.angle;
const NOTCH_R = LEVER.notches.r;
const NOTCH_DEPTH = LEVER.notches.depth;
/** The jumper's spring finger runs along the tangent of the notch circle, clear of the lobe;
 * only its beak reaches into the notches. */
const JUMPER_FINGER_LENGTH = JUMPER.finger.length;
const JUMPER_FINGER_LINE_R = JUMPER.finger.lineR;
/** Stud of the setting lever arbor, seen through the jumper plate. */
const LEVER_ARBOR_R = LEVER.arborR;

/** Setting wheel on the minute wheel: settingWheelAngle(minutes) plus this phase puts its teeth in
 * the minute wheel's tooth spaces. Follows dial-side.ts's minute-wheel phase (a tooth space towards
 * the cannon pinion: tooth 0 at dirHM + PI + PI/30 at minutes 0). */
const SETTING_PITCH = TAU / SETTING.gear.teeth;
const SETTING_MESH_PHASE = (() => {
  const mw = DIAL_SIDE.minuteWheel;
  const toCentre = angleOf([0, 0], mw.axis);
  const minutePhase = toCentre + Math.PI + Math.PI / mw.wheel.teeth;
  const contact = angleOf(mw.axis, SETTING.axis);
  const minutePitch = TAU / mw.wheel.teeth;
  // Minute-wheel turn that puts a tooth on the line of centres, and the setting-wheel turn with a space there.
  const minuteAt = minutePhase - contact;
  const settingAt = Math.PI / SETTING.gear.teeth + SETTING_PITCH / 2 - (contact + Math.PI);
  const ratio = mw.wheel.teeth / SETTING.gear.teeth;
  return settingAt + ratio * (minuteAt - Math.round(minuteAt / minutePitch) * minutePitch);
})();

/** Stop lever: turns about data.ts's pivot (near the stem) from the rest point of its tip onto the balance rim. */
const STOP_TURN_PIVOT: P = STOP.pivot;
const STOP_TURN = angleOf(STOP_TURN_PIVOT, STOP.tipRest) - angleOf(STOP_TURN_PIVOT, STOP.tipStop);

/** Click: its beak on a ratchet gap that also faces the crown wheel's mesh line, so one tooth phase
 * serves both; leaning so the click locks the ratchet against unwinding. */
const CLICK_PIVOT: P = BACK_SIDE.click.pivot;
const CLICK_BEAK_ANGLE = BACK_SIDE.click.beakAngle;
/** The beak's point rests this far above the ratchet's root circle. */
const CLICK_BEAK_REST_R = BACK_SIDE.click.beakRestR;
const CLICK_BEAK: P = polar(RATCHET.axis, CLICK_BEAK_ANGLE, CLICK_BEAK_REST_R);

// ── Geometry helpers ──────────────────────────────────────────────────────────

function signedArea(loop: readonly P[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** The loop with the material on its left: outer contours counter-clockwise in (x, z), holes clockwise. */
function oriented(loop: readonly P[], outer: boolean): P[] {
  return (signedArea(loop) > 0) === outer ? [...loop] : [...loop].reverse();
}

/** Moves a loop whose material lies on its left into the material by `d`. */
function inset(loop: readonly P[], d: number): P[] {
  const n = loop.length;
  return loop.map((p, i) => {
    const a = loop[(i + n - 1) % n];
    const b = loop[(i + 1) % n];
    const l1 = dist(a, p) || 1;
    const l2 = dist(p, b) || 1;
    const n1: P = [-(p[1] - a[1]) / l1, (p[0] - a[0]) / l1];
    const n2: P = [-(b[1] - p[1]) / l2, (b[0] - p[0]) / l2];
    let bx = n1[0] + n2[0];
    let bz = n1[1] + n2[1];
    const l = Math.hypot(bx, bz) || 1;
    bx /= l;
    bz /= l;
    const k = d / Math.max(0.4, bx * n2[0] + bz * n2[1]);
    return [p[0] + bx * k, p[1] + bz * k] as P;
  });
}

function capGeometry(outer: readonly P[], holes: readonly P[][], y: number, up: boolean): THREE.BufferGeometry {
  const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
  const holeVectors = holes.map(h => h.map(([x, z]) => new THREE.Vector2(x, z)));
  const faces = THREE.ShapeUtils.triangulateShape(contour, holeVectors);
  const all = contour.concat(...holeVectors);
  const position: number[] = [];
  const normal: number[] = [];
  const ny = up ? 1 : -1;
  for (const [a, b, c] of faces) {
    const pa = all[a];
    let pb = all[b];
    let pc = all[c];
    // A face points up when its (x, z) winding is clockwise.
    const area = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    if ((area < 0) !== up) [pb, pc] = [pc, pb];
    position.push(pa.x, y, pa.y, pb.x, y, pb.y, pc.x, y, pc.y);
    normal.push(0, ny, 0, 0, ny, 0, 0, ny, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  return geo;
}

/** A plan outline (and holes) between y0 and y1, its edges chamfered by `c` top and bottom
 * (`outerC` overrides the chamfer of the outline itself, e.g. 0 for fine teeth). */
function prism(outline: readonly P[], y0: number, y1: number, c = 0.02, holes: readonly (readonly P[])[] = [], outerC = c): Faces {
  const crease = 38;
  const outer = oriented(outline, true);
  const inner = holes.map(h => oriented(h, false));
  const limit = (v: number): number => Math.min(v, (y1 - y0) * 0.3);
  const ring = (pts: readonly P[], y: number): P3[] => pts.map(([x, z]) => [x, y, z]);
  const chamfered = (loop: readonly P[], cc: number): P[] => (cc > 0 ? inset(loop, cc) : [...loop]);
  const wall = (loop: readonly P[], cc: number): THREE.BufferGeometry => {
    if (cc <= 0) return skin([ring(loop, y1), ring(loop, y0)], crease);
    const small = inset(loop, cc);
    return skin([ring(small, y1), ring(loop, y1 - cc), ring(loop, y0 + cc), ring(small, y0)], crease);
  };
  const walls = [wall(outer, limit(outerC)), ...inner.map(h => wall(h, limit(c)))];
  const capOuter = chamfered(outer, limit(outerC));
  const capHoles = inner.map(h => chamfered(h, limit(c)));
  return {
    caps: merge([capGeometry(capOuter, capHoles, y1, true), capGeometry(capOuter, capHoles, y0, false)]),
    sides: merge(walls),
  };
}

/** Both faces of a prism in one geometry. */
const solid = (f: Faces): THREE.BufferGeometry => merge([f.caps, f.sides]);

/** Concatenates geometries into one non-indexed geometry with positions and normals only. */
function merge(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const g of parts) count += g.index ? g.index.count : g.getAttribute('position').count;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const pa = g.getAttribute('position').array;
    const na = g.getAttribute('normal').array;
    const index = g.index ? g.index.array : null;
    const n = index ? index.length : pa.length / 3;
    for (let i = 0; i < n; i++, o += 3) {
      const v = (index ? index[i] : i) * 3;
      position[o] = pa[v]; position[o + 1] = pa[v + 1]; position[o + 2] = pa[v + 2];
      normal[o] = na[v]; normal[o + 1] = na[v + 1]; normal[o + 2] = na[v + 2];
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  return geo;
}

/** Turned part about the x axis at the stem height. Profile [radius, x] runs from the inner end
 * outwards along the surface (the convention of crown.ts). */
function turnedX(profile: readonly (readonly [number, number])[], segments: number, crease = 40): THREE.BufferGeometry {
  return skin(profile.map(([r, x]) => {
    const ring: P3[] = [];
    for (let i = 0; i < segments; i++) {
      const a = i / segments * TAU;
      ring.push([x, STEM_Y + Math.cos(a) * r, Math.sin(a) * r]);
    }
    return ring;
  }), crease);
}

/** Turned part about a vertical axis at plan point `c`. Profile [radius, y] runs from the bottom up the outside to the top. */
function turnedY(c: P, profile: readonly (readonly [number, number])[], segments: number, crease = 40): THREE.BufferGeometry {
  // The x-axis convention turned a quarter about z: (h, r cos a, r sin a) -> (-r cos a, h, r sin a).
  return skin(profile.map(([r, y]) => {
    const ring: P3[] = [];
    for (let i = 0; i < segments; i++) {
      const a = i / segments * TAU;
      ring.push([c[0] - Math.cos(a) * r, y, c[1] + Math.sin(a) * r]);
    }
    return ring;
  }), crease);
}

/** Plain cylinder with chamfered rims about a vertical axis. */
function pin(c: P, r: number, y0: number, y1: number, segments = 20, chamfer = 0.02): THREE.BufferGeometry {
  const k = Math.min(chamfer, r * 0.3, (y1 - y0) * 0.3);
  return turnedY(c, [[0, y0], [r - k, y0], [r, y0 + k], [r, y1 - k], [r - k, y1], [0, y1]], segments);
}

function ngon(c: P, r: number, n: number, a0 = 0): P[] {
  const pts: P[] = [];
  for (let i = 0; i < n; i++) pts.push(polar(c, a0 + i / n * TAU, r));
  return pts;
}

/** Outline of a band of constant half width along a polyline, with round ends. */
function ribbon(path: readonly P[], half: number | readonly number[], capSteps = 6): P[] {
  const halfAt = (i: number): number => (typeof half === 'number' ? half : half[i]);
  const n = path.length;
  const dirs: P[] = [];
  for (let i = 0; i < n - 1; i++) {
    const l = dist(path[i], path[i + 1]) || 1;
    dirs.push([(path[i + 1][0] - path[i][0]) / l, (path[i + 1][1] - path[i][1]) / l]);
  }
  const left: P[] = [];
  const right: P[] = [];
  for (let i = 0; i < n; i++) {
    const d0 = dirs[Math.max(0, i - 1)];
    const d1 = dirs[Math.min(n - 2, i)];
    let nx = -(d0[1] + d1[1]);
    let nz = d0[0] + d1[0];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    const k = halfAt(i) / Math.max(0.5, nx * -d1[1] + nz * d1[0]);
    left.push([path[i][0] + nx * k, path[i][1] + nz * k]);
    right.push([path[i][0] - nx * k, path[i][1] - nz * k]);
  }
  const out: P[] = [...left];
  const end = path[n - 1];
  const endA = Math.atan2(dirs[n - 2][1], dirs[n - 2][0]);
  for (let s = 1; s < capSteps; s++) out.push(polar(end, endA + Math.PI / 2 - s / capSteps * Math.PI, halfAt(n - 1)));
  out.push(...right.reverse());
  const start = path[0];
  const startA = Math.atan2(dirs[0][1], dirs[0][0]);
  for (let s = 1; s < capSteps; s++) out.push(polar(start, startA - Math.PI / 2 - s / capSteps * Math.PI, halfAt(0)));
  return out;
}

/** Tooth profile: offset from the tooth centre (in pitches) and the radius there, as a share
 * from root (0) over pitch (PITCH_SHARE) to tip (1). */
const TOOTH_U = [0, 0.05, 0.14, 0.24, 0.33, 0.5];
const TOOTH_K = [1, 1, -1, 0, -2, -2];
function toothRadius(g: Toothing, offset: number): number {
  const u = Math.abs(offset);
  for (let i = 1; i < TOOTH_U.length; i++) {
    if (u <= TOOTH_U[i]) {
      const r0 = profileRadius(g, TOOTH_K[i - 1]);
      return r0 + (profileRadius(g, TOOTH_K[i]) - r0) * (u - TOOTH_U[i - 1]) / (TOOTH_U[i] - TOOTH_U[i - 1]);
    }
  }
  return g.rootR;
}
/** 1 tip, -1 between pitch and tip, 0 pitch, -2 root. */
function profileRadius(g: Toothing, k: number): number {
  if (k === 1) return g.tipR;
  if (k === 0) return g.pitchR;
  if (k === -1) return g.pitchR + 0.7 * (g.tipR - g.pitchR);
  return g.rootR;
}

/** Watch-type tooth outline about [0, 0]; tooth 0 centred on plan angle `phase`. */
function gearOutline(g: Toothing, phase = 0, c: P = [0, 0]): P[] {
  const p = TAU / g.teeth;
  const offsets = [-0.5, -0.33, -0.24, -0.14, -0.05, 0.05, 0.14, 0.24, 0.33];
  const pts: P[] = [];
  for (let k = 0; k < g.teeth; k++) {
    for (const o of offsets) pts.push(polar(c, phase + (k + o) * p, toothRadius(g, o)));
  }
  return pts;
}

/** Turns a geometry built about the y axis so that y runs along +x, at the stem height. */
function alongStem(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.rotateZ(-Math.PI / 2);
  geo.translate(0, STEM_Y, 0);
  return geo;
}

/**
 * Saw-toothed (Breguet) face about the stem axis, between radii rIn and rOut. The contact
 * surface lies at x0 + h(0.5 - fract(n·a / TAU)) for the angle a about the axis; the part's
 * body is on the side `towards` (-1: smaller x, +1: larger x), its base at x0 + towards·h/2.
 */
function breguetFace(x0: number, towards: 1 | -1, rIn: number, rOut: number, teeth: number, h: number): THREE.BufferGeometry {
  const steps = 5;
  const position: number[] = [];
  const base = x0 + towards * h / 2;
  const surf = (a: number): number => x0 + h * (0.5 - fract(teeth * a / TAU));
  const pt = (x: number, r: number, a: number): number[] => [x, STEM_Y + Math.cos(a) * r, Math.sin(a) * r];
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => { position.push(...a, ...b, ...c, ...a, ...c, ...d); };
  const pitch = TAU / teeth;
  for (let k = 0; k < teeth; k++) {
    for (let s = 0; s < steps; s++) {
      const a0 = (k + s / steps) * pitch + 1e-6;
      const a1 = (k + (s + 1) / steps) * pitch - 1e-6;
      const x0a = surf(a0);
      const x1a = surf(a1);
      quad(pt(x0a, rIn, a0), pt(x0a, rOut, a0), pt(x1a, rOut, a1), pt(x1a, rIn, a1));
      quad(pt(base, rOut, a0), pt(base, rOut, a1), pt(x1a, rOut, a1), pt(x0a, rOut, a0));
      quad(pt(base, rIn, a1), pt(base, rIn, a0), pt(x0a, rIn, a0), pt(x1a, rIn, a1));
    }
    const a = (k + 1) * pitch;
    quad(pt(surf(a - 1e-6), rIn, a), pt(surf(a - 1e-6), rOut, a), pt(surf(a + 1e-6), rOut, a), pt(surf(a + 1e-6), rIn, a));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  // The winding above suits a body on the -x side; the other body faces the other way.
  if (towards === 1) {
    const idx = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < idx.count; i += 3) {
      const bx = idx.getX(i + 1); const by = idx.getY(i + 1); const bz = idx.getZ(i + 1);
      idx.setXYZ(i + 1, idx.getX(i + 2), idx.getY(i + 2), idx.getZ(i + 2));
      idx.setXYZ(i + 2, bx, by, bz);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

// ── Rig: bones and skinned meshes ─────────────────────────────────────────────

class Rig {
  readonly bones: THREE.Bone[] = [];
  private readonly parts: Record<Finish, THREE.BufferGeometry[]> = { satin: [], polished: [] };

  bone(parent: THREE.Object3D, at: P, y: number, name: string): THREE.Bone {
    const b = new THREE.Bone();
    b.name = name;
    // Child bones are placed relative to their parent's (unturned) origin.
    const origin = parent instanceof THREE.Bone ? parent.userData.at as [number, number, number] : [0, 0, 0];
    b.position.set(at[0] - origin[0], y - origin[1], at[1] - origin[2]);
    b.userData.at = [at[0], y, at[1]];
    parent.add(b);
    this.bones.push(b);
    return b;
  }

  add(finish: Finish, bone: THREE.Bone, ...geos: THREE.BufferGeometry[]): void {
    const index = this.bones.indexOf(bone);
    for (const g of geos) {
      const geo = g.index || g.attributes.uv ? merge([g]) : g;
      const count = geo.getAttribute('position').count;
      const skinIndex = new Uint16Array(count * 4);
      const skinWeight = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        skinIndex[i * 4] = index;
        skinWeight[i * 4] = 1;
      }
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
      this.parts[finish].push(geo);
    }
  }

  /** Lever plate: satin faces, polished flanks. */
  addLever(bone: THREE.Bone, f: Faces): void {
    this.add('satin', bone, f.caps);
    this.add('polished', bone, f.sides);
  }

  build(group: THREE.Group, materials: Record<Finish, THREE.Material>): THREE.SkinnedMesh[] {
    group.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    const meshes: THREE.SkinnedMesh[] = [];
    for (const finish of ['satin', 'polished'] as const) {
      if (this.parts[finish].length === 0) continue;
      const mesh = new THREE.SkinnedMesh(mergeGeometries(this.parts[finish], false)!, materials[finish]);
      mesh.name = `Keyless works (${finish})`;
      mesh.frustumCulled = false;
      group.add(mesh);
      mesh.bind(skeleton, new THREE.Matrix4());
      meshes.push(mesh);
    }
    return meshes;
  }
}

// ── Parts ─────────────────────────────────────────────────────────────────────

const STEM_SEGMENTS = 24;

function stemGeometry(): THREE.BufferGeometry {
  const sections = STEM.sections;
  const tip = sections[0];
  const square = sections[1];
  const parts: THREE.BufferGeometry[] = [];
  // Pivot end, riding in the plate.
  parts.push(turnedX([[0, tip.from], [tip.r - 0.05, tip.from], [tip.r, tip.from + 0.05], [tip.r, tip.to + 0.02], [0, tip.to + 0.02]], 16));
  // Square for the sliding pinion; corners towards its teeth.
  const w = square.r;
  const k = 0.07;
  const oct: [number, number][] = [[w, -(w - k)], [w, w - k], [w - k, w], [-(w - k), w], [-w, w - k], [-w, -(w - k)], [-(w - k), -w], [w - k, -w]];
  const ringAt = (x: number): P3[] => oct.map(([y, z]) => [x, STEM_Y + y, z]);
  parts.push(skin([ringAt(square.from), ringAt(square.to)], 30, { capStart: true, capEnd: true }));
  // Round body: winding-pinion seat, shoulder, groove for the setting-lever pin, outer end.
  const [, , seat, body, groove, outer] = sections;
  parts.push(turnedX([
    [0, seat.from - 0.01], [seat.r, seat.from - 0.01], [seat.r, seat.to], [body.r - 0.03, seat.to], [body.r, seat.to + 0.03],
    [body.r, groove.from - 0.04], [groove.r + 0.03, groove.from], [groove.r, groove.from + 0.03],
    [groove.r, groove.to - 0.03], [groove.r + 0.03, groove.to], [outer.r, groove.to + 0.04],
    [outer.r, outer.to], [0, outer.to],
  ], STEM_SEGMENTS));
  return merge(parts);
}

function slidingPinionGeometry(): THREE.BufferGeometry {
  const x0 = SLIDING.innerX;
  const g = SLIDING.gear;
  const grooveFrom = x0 + SLIDING.grooveOffset - GROOVE_WIDTH / 2;
  const grooveTo = grooveFrom + GROOVE_WIDTH;
  const faceX = BREGUET_X - BREGUET_DEPTH / 2;
  const bore = ngon([0, 0], (STEM.sections[1].r + 0.01) * Math.SQRT2, 4, Math.PI / 4);
  // Teeth for the setting wheel, built about y and laid along the stem.
  const teeth = solid(prism(gearOutline(g, Math.PI / 2), x0, grooveFrom, 0.03, [bore]));
  const parts = [alongStem(teeth)];
  parts.push(turnedX([
    [STEM.sections[1].r + 0.02, grooveFrom - 0.001], [SLIDING.grooveR, grooveFrom], [SLIDING.grooveR, grooveTo],
    [0.62, grooveTo], [0.65, grooveTo + 0.03], [0.65, faceX - 0.03], [0.62, faceX], [0.4, faceX],
  ], 24));
  parts.push(breguetFace(BREGUET_X, -1, 0.4, 0.62, SLIDING.breguetTeeth, BREGUET_DEPTH));
  return merge(parts);
}

function windingPinionGeometry(): THREE.BufferGeometry {
  const g = WINDING_PINION.gear;
  const from = BREGUET_X + BREGUET_DEPTH / 2;
  const to = WINDING_PINION.toX;
  const bore = ngon([0, 0], STEM.sections[2].r + 0.01, 16);
  const teeth = solid(prism(gearOutline(g, 0), from + 0.12, to, 0.03, [bore]));
  return merge([
    alongStem(teeth),
    turnedX([[0.44, from], [0.62, from], [0.66, from + 0.04], [0.66, from + 0.12], [0.44, from + 0.12]], 24),
    breguetFace(BREGUET_X, 1, 0.42, 0.62, WINDING_PINION.breguetTeeth, BREGUET_DEPTH),
  ]);
}

/** Setting-lever outline pieces (rest pose): boss, arm to the pin, cam lobe for the yoke, notched lobe for the jumper. */
function settingLeverOutlines(): { pieces: P[][]; notchLocal: (a: number) => number } {
  const c = LEVER.pivot;
  const pieces: P[][] = [];
  pieces.push(ngon(c, LEVER.pivotR + 0.15, 28));
  pieces.push(ribbon([c, LEVER.pin], [LEVER.width / 2 + 0.06, LEVER.width / 2 - 0.02], 8));
  // Cam: the inner envelope of the yoke beak's round end as the lever sees it over the crown pull.
  const centres: P[] = [];
  for (let i = 0; i <= 40; i++) {
    const pull = 1 + 2 * i / 40;
    const centre = carried(YOKE_BEAK_CENTRE, YOKE.pivot, yokeAngleFor(slidingPinionShift(pull)));
    centres.push(carried(centre, c, -settingLeverAngle(pull)));
  }
  const a1 = angleOf(c, centres[0]);
  const r1 = dist(c, centres[0]) - YOKE_BEAK_R;
  const aEnd = angleOf(c, centres[centres.length - 1]);
  const r2 = dist(c, centres[centres.length - 1]) - YOKE_BEAK_R;
  const camR = (a: number): number => {
    let r = a <= a1 ? r1 : r2;
    const u: P = [Math.cos(a), Math.sin(a)];
    for (const centre of centres) {
      const d: P = [centre[0] - c[0], centre[1] - c[1]];
      const b = dot(u, d);
      const disc = b * b - dot(d, d) + YOKE_BEAK_R * YOKE_BEAK_R;
      if (disc >= 0) r = Math.min(r, b - Math.sqrt(disc));
    }
    return r - 0.004;
  };
  const lobe: P[] = [polar(c, a1 - deg(14), 0.35)];
  const camFrom = a1 - deg(3);
  const camTo = aEnd + deg(1);
  for (let i = 0; i <= 48; i++) {
    const a = camFrom + (camTo - camFrom) * i / 48;
    lobe.push(polar(c, a, camR(a)));
  }
  lobe.push(polar(c, camTo + deg(1.5), r2 - 0.1));
  lobe.push(polar(c, aEnd + deg(10), 0.35));
  pieces.push(lobe);
  // Notches for the jumper: one per crown position, as the lever turns under the jumper's beak.
  const notchAt = [1, 2, 3].map(pull => NOTCH_ANGLE + settingLeverAngle(pull));
  const halfWidth = 0.075 / NOTCH_R;
  const notchLocal = (a: number): number => {
    let depth = 0;
    for (let i = 0; i < notchAt.length; i++) depth = Math.max(depth, 1 - Math.abs(a - notchAt[i]) / halfWidth);
    return NOTCH_R - NOTCH_DEPTH * Math.max(0, depth);
  };
  const notched: P[] = [polar(c, NOTCH_ANGLE - deg(16), 0.3)];
  const from = NOTCH_ANGLE - deg(7);
  const to = notchAt[2] + deg(6);
  for (let i = 0; i <= 60; i++) {
    const a = from + (to - from) * i / 60;
    notched.push(polar(c, a, notchLocal(a)));
  }
  notched.push(polar(c, to + deg(14), 0.3));
  pieces.push(notched);
  return { pieces, notchLocal };
}

const YOKE_ARM = dist(YOKE.pivot, YOKE.fork);
const YOKE_FORK_X = YOKE.fork[0] - YOKE.pivot[0];
const YOKE_REST = Math.asin(YOKE_FORK_X / YOKE_ARM);
function yokeAngleFor(shift: number): number {
  return Math.asin(clamp((YOKE_FORK_X + shift) / YOKE_ARM, -1, 1)) - YOKE_REST;
}

function yokeOutlines(): { flat: P[][]; tongue: P[] } {
  const c = YOKE.pivot;
  const toFork = angleOf(c, YOKE.fork);
  const armEnd = polar(c, toFork, dist(c, YOKE.fork) + 0.05);
  // The fork drops into the sliding pinion's groove beside the stem, at the stem's outer side of -z.
  const flat: P[][] = [];
  flat.push(ngon(c, YOKE.pivotR + 0.14, 24));
  flat.push(ribbon([c, armEnd], [YOKE.width / 2 + 0.05, YOKE.width / 2 - 0.02], 8));
  // Beak lobe from the arm down to the cam: its round end touches the cam at YOKE_BEAK.
  const root = polar(c, toFork, (YOKE_BEAK[1] + 0.95 - c[1]) / Math.sin(toFork));
  flat.push(ribbon([root, YOKE_BEAK_CENTRE], [0.21, YOKE_BEAK_R], 8));
  // Tongue: a plate across the groove, turned half the yoke's swing so it lies square at mid travel.
  const half = yokeAngleFor(SLIDING.shift) / 2;
  const f = YOKE.fork;
  const box: P[] = [[f[0] - 0.08, f[1] - 0.15], [f[0] + 0.08, f[1] - 0.15], [f[0] + 0.08, f[1] + 0.15], [f[0] - 0.08, f[1] + 0.15]];
  const tongue = box.map(p => carried(p, f, half));
  return { flat, tongue };
}

function switchLeverOutline(): P[][] {
  const pivot = SWITCH.path[0];
  const wheel = SWITCH.path[SWITCH.path.length - 1];
  return [
    ngon(pivot, SWITCH.pivotR + 0.08, 24),
    ribbon(SWITCH.path, SWITCH.width / 2, 8),
    ngon(wheel, SETTING.lowerGear.rootR + 0.08, 24),
  ];
}

function screwHead(): THREE.BufferGeometry {
  const slot = 0.15;
  const a = Math.asin(slot);
  const half = (sign: 1 | -1): P[] => {
    const pts: P[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = a + (Math.PI - 2 * a) * i / 12;
      pts.push([Math.cos(t), sign * Math.sin(t)]);
    }
    return pts;
  };
  return merge([
    turnedY([0, 0], [[0, 0], [1, 0], [1, 0.5], [0, 0.5]], 28),
    solid(prism(half(1), 0.45, 1, 0.12)),
    solid(prism(half(-1), 0.45, 1, 0.12)),
  ]);
}

/** Instance matrix of a screw head: base on seatY, rising by `rise` (flush heads stand 0.015 proud). */
function screwMatrix(s: ScrewSpec, turn: number, out: THREE.Matrix4): THREE.Matrix4 {
  const flush = s.rise === 0;
  _q.setFromAxisAngle(_y, -(s.slot + turn));
  // Heads on the rotor side hang towards the caseback.
  if (s.rise < 0) _q.premultiply(_flip);
  _v.set(s.at[0], flush ? s.seatY - 0.035 : s.seatY, s.at[1]);
  return out.compose(_v, _q, _s.set(s.headR, flush ? 0.05 : Math.abs(s.rise), s.headR));
}
const _q = new THREE.Quaternion();
const _flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);

// ── Builder ───────────────────────────────────────────────────────────────────

export function makeKeyless(m: WatchMaterials): Keyless {
  const group = new THREE.Group();
  group.name = 'Keyless and setting works';
  const rig = new Rig();

  // Stem: slides with the crown's real travel, turns with it.
  const stem = rig.bone(group, [0, 0], STEM_Y, 'Aufzugwelle');
  rig.add('polished', stem, stemGeometry());

  // Sliding pinion: held by the yoke, turns with the stem's square.
  const sliding = rig.bone(group, [SLIDING.innerX, 0], STEM_Y, 'Kupplungstrieb');
  rig.add('polished', sliding, slidingPinionGeometry());

  // Winding pinion: free on the stem, under the crown wheel.
  const winding = rig.bone(group, [WINDING_PINION.fromX, 0], STEM_Y, 'Aufzugtrieb');
  rig.add('polished', winding, windingPinionGeometry());

  // Setting lever with its pin in the stem groove, the cam for the yoke and the jumper notches.
  const lever = rig.bone(group, LEVER.pivot, 0, 'Winkelhebel');
  const leverShape = settingLeverOutlines();
  for (const piece of leverShape.pieces) rig.addLever(lever, prism(piece, LEVER.y.bottom, LEVER.y.top, 0.025));
  rig.add('polished', lever,
    pin(LEVER.pin, LEVER.pinR, LEVER.pinY.bottom, LEVER.y.bottom + 0.01, 16, 0.03),
    pin(LEVER.pivot, LEVER_ARBOR_R, PLATE.keylessPocket.floorY, JUMPER.y.top - 0.005, 20, 0.03));

  // Yoke with its tongue in the sliding pinion's groove and its beak on the setting lever's cam.
  const yoke = rig.bone(group, YOKE.pivot, 0, 'Kupplungstriebhebel');
  const yokeShape = yokeOutlines();
  for (const piece of yokeShape.flat) rig.addLever(yoke, prism(piece, YOKE.y.bottom, YOKE.y.top, 0.025));
  rig.add('polished', yoke,
    solid(prism(yokeShape.tongue, -0.53, YOKE.y.bottom + 0.01, 0.02)),
    pin(YOKE.pivot, 0.2, PLATE.keylessPocket.floorY, YOKE.y.top + 0.03, 16, 0.03));

  // Setting-lever jumper: the plate (static, with the lever arbor showing through it) and its spring finger.
  const fixed = rig.bone(group, [0, 0], 0, 'Fest');
  rig.addLever(fixed, prism(JUMPER.outline, JUMPER.y.bottom, JUMPER.y.top, 0.025, [ngon(LEVER.pivot, LEVER_ARBOR_R + 0.03, 20)]));
  const beakRest = polar(LEVER.pivot, NOTCH_ANGLE, NOTCH_R - NOTCH_DEPTH);
  const tangent = NOTCH_ANGLE + Math.PI / 2;
  const fingerTip = polar(polar(LEVER.pivot, NOTCH_ANGLE, JUMPER_FINGER_LINE_R), tangent + Math.PI, 0.22);
  const fingerRoot = polar(fingerTip, tangent, JUMPER_FINGER_LENGTH + 0.22);
  const fingerFoot = polar(fingerRoot, tangent, 0.35);
  const beakBase = polar(LEVER.pivot, NOTCH_ANGLE, JUMPER_FINGER_LINE_R);
  const jumperFinger = rig.bone(group, fingerRoot, 0, 'Winkelhebelraste, Feder');
  const springY0 = LEVER.y.bottom + 0.015;
  const springY1 = LEVER.y.top - 0.015;
  rig.addLever(jumperFinger, prism(ribbon([fingerRoot, fingerTip], [0.09, 0.07], 6), springY0, springY1, 0.015));
  rig.addLever(jumperFinger, prism([beakRest, polar(beakBase, tangent, 0.11), polar(beakBase, tangent + Math.PI, 0.11)], springY0, springY1, 0.012));
  rig.addLever(fixed, prism(ribbon([fingerFoot, fingerRoot], 0.1, 6), springY0, springY1, 0.015));
  rig.add('polished', fixed, pin(fingerFoot, 0.14, LEVER.y.bottom + 0.015, JUMPER.y.bottom + 0.005, 14, 0.02));
  const fingerLever = dist(fingerRoot, beakRest);
  // The beak moves out (away from the lever pivot) for this sign of rotation.
  const fingerOut = dot(spinVelocity(beakRest, fingerRoot), [Math.cos(NOTCH_ANGLE), Math.sin(NOTCH_ANGLE)]) > 0 ? 1 : -1;

  // Switching lever and setting wheel (carried by it, in a bone of its own).
  const switchLever = rig.bone(group, SWITCH.pivot, 0, 'Schalthebel');
  for (const piece of switchLeverOutline()) rig.addLever(switchLever, prism(piece, SWITCH.y.bottom, SWITCH.y.top, 0.02));
  const settingWheel = rig.bone(switchLever, SETTING.axis, 0, 'Zeigerstellrad');
  rig.add('polished', settingWheel,
    solid(prism(gearOutline(SETTING.lowerGear, 0, SETTING.axis), SETTING.lowerY.bottom, SETTING.lowerY.top, 0.025)),
    solid(prism(gearOutline(SETTING.gear, Math.PI / SETTING.gear.teeth, SETTING.axis), SETTING.upperY.bottom, SETTING.upperY.top, 0.025)),
    pin(SETTING.axis, SETTING.arborR, SETTING.lowerY.top - 0.01, SETTING.upperY.bottom + 0.01, 12),
    pin(SETTING.axis, 0.2, SETTING.upperY.top - 0.01, SETTING.upperY.top + 0.005, 16, 0.01));

  // Stop lever on the plate's back face: a long arm out to the balance rim, a short tail with a hook at
  // the setting lever's arbor, which turns it from position 2 to 3.
  const stopLever = rig.bone(group, STOP_TURN_PIVOT, 0, 'Stopphebel');
  const stopMid = lerp2(STOP_TURN_PIVOT, STOP.tipRest, 0.55);
  rig.addLever(stopLever, prism(ribbon([STOP_TURN_PIVOT, stopMid, STOP.tipRest], [STOP.width / 2 + 0.06, STOP.width / 2, 0.06], 8),
    STOP.y.bottom, STOP.y.top, 0.015));
  rig.addLever(stopLever, prism(ngon(STOP_TURN_PIVOT, 0.42, 24), STOP.y.bottom, STOP.y.top, 0.015));
  const tailDir = angleOf(STOP_TURN_PIVOT, STOP.tail);
  rig.addLever(stopLever, prism(ribbon([STOP_TURN_PIVOT, STOP.tail, polar(STOP.tail, tailDir - Math.PI / 2, 0.28)], 0.12, 6),
    STOP.y.bottom, STOP.y.top, 0.015));

  // Rotor side: click (a bone), crown wheel and ratchet (plain meshes with circular graining).
  // Their faces look towards the caseback: every material here sees the studio mirrored from below.
  const grained = withUnderside(m.brushedCircular.clone(), 'luna-satin-circular-underside');
  grained.color.set(0xd2d6da);
  grained.roughness = 0.26;
  const click = rig.bone(group, CLICK_PIVOT, 0, 'Klinke');
  const out = angleOf(RATCHET.axis, CLICK_BEAK);
  // Slim towards the beak: lifted over a tooth, the click swings its end towards the crown wheel.
  const bodyEnd = polar(RATCHET.axis, out, RATCHET.gear.tipR + 0.12);
  rig.addLever(click, prism(ribbon([CLICK_PIVOT, bodyEnd], [0.3, 0.13], 8), RATCHET.y.bottom, RATCHET.y.top, 0.015));
  rig.addLever(click, prism([CLICK_BEAK, polar(bodyEnd, out + Math.PI / 2, 0.14), polar(bodyEnd, out - Math.PI / 2, 0.14)],
    RATCHET.y.bottom, RATCHET.y.top, 0.012));
  rig.addLever(click, prism(ngon(CLICK_PIVOT, 0.42, 24), RATCHET.y.bottom, RATCHET.y.top, 0.015));
  // Lift per radian of click turn: the beak's motion along the ratchet radius.
  const outward: P = [Math.cos(CLICK_BEAK_ANGLE), Math.sin(CLICK_BEAK_ANGLE)];
  const clickLift = dot(spinVelocity(CLICK_BEAK, CLICK_PIVOT), outward) * dist(CLICK_PIVOT, CLICK_BEAK);

  const crownWheelMesh = new THREE.Mesh(crownWheelGeometry(), grained);
  crownWheelMesh.name = 'Kronrad';
  crownWheelMesh.position.set(CROWN_WHEEL.axis[0], 0, CROWN_WHEEL.axis[1]);
  const ratchetMesh = new THREE.Mesh(ratchetGeometry(), grained);
  ratchetMesh.name = 'Sperrrad';
  ratchetMesh.position.set(RATCHET.axis[0], 0, RATCHET.axis[1]);
  group.add(crownWheelMesh, ratchetMesh);

  const materials: Record<Finish, THREE.Material> = {
    // Grey satin faces set the steel parts off the rhodium plate; their polished bevels catch the light.
    satin: withUnderside(new THREE.MeshStandardMaterial({ color: 0x939ba4, metalness: 1, roughness: 0.36 }), 'luna-movement-underside'),
    polished: withUnderside(new THREE.MeshStandardMaterial({ ...FINISHES.polishedSteel }), 'luna-movement-underside'),
  };
  materials.satin.name = 'Keyless satin steel';
  materials.polished.name = 'Keyless polished steel';
  rig.build(group, materials);

  // Blued screws, one instanced mesh; the ratchet screw turns with the ratchet.
  const screws = SCREWS.keyless;
  const ratchetScrew = screws.findIndex(s => dist(s.at, RATCHET.axis) < 1e-6);
  const blued = withUnderside(new THREE.MeshStandardMaterial({ ...FINISHES.blued }), 'luna-movement-underside');
  blued.name = 'Keyless blued screws';
  const screwMesh = new THREE.InstancedMesh(screwHead(), blued, screws.length);
  screwMesh.name = 'Keyless screws';
  const matrix = new THREE.Matrix4();
  screws.forEach((s, i) => screwMesh.setMatrixAt(i, screwMatrix(s, 0, matrix)));
  screwMesh.computeBoundingBox();
  screwMesh.computeBoundingSphere();
  group.add(screwMesh);

  // State carried between frames. Kept in one object: doubles in object fields are updated in
  // place, closure variables would box a new number on every write.
  const st = {
    first: true,
    engaged: false,
    lastSpin: 0,
    lastRotor: 0,
    /** Breguet teeth: how far the sliding pinion trails the winding pinion within one tooth (rad). */
    lag: 0,
    /** Ratchet turn (rotation.y), wound by crown and rotor. */
    ratchet: 0,
    settingTurn: 0,
    /** Setting wheel as turned by the sliding pinion since it left the minute wheel. */
    settingFree: 0,
    lastScrewTurn: 0,
  };

  const notchOf = leverShape.notchLocal;

  function update(s: MovementState): void {
    const pull = s.crownPull;
    const spin = s.crownSpin;
    const setting = settingWheelAngle(s.minutes);
    if (st.first) {
      st.first = false;
      st.lastSpin = spin;
      st.lastRotor = s.rotor;
    }
    const dSpin = spin - st.lastSpin;
    st.lastSpin = spin;
    const dRotor = s.rotor - st.lastRotor;
    st.lastRotor = s.rotor;

    // Stem and crown positions.
    const travel = stemTravel(pull);
    stem.position.x = travel;
    stem.rotation.x = spin;
    const leverTurn = settingLeverAngle(pull);
    lever.rotation.y = leverTurn;

    // Winding: the rotor always winds the st.ratchet; the crown only through the Breguet teeth in
    // position 1, towards 12. Turned the other way (or overtaken by the rotor) the sliding pinion
    // rides up the saw teeth and drops back, pushing the yoke a little.
    const rotorWind = WINDING.ratchetPerRotorTurn * Math.abs(dRotor);
    st.ratchet += rotorWind;
    const nowEngaged = pull <= WIND_ENGAGED_PULL;
    if (nowEngaged) {
      if (!st.engaged) {
        // Seating again: the teeth meet wherever the two pinions happen to stand.
        st.lag = ((spin + st.ratchet * WINDING_PINION_PER_RATCHET) % BREGUET_PITCH + BREGUET_PITCH) % BREGUET_PITCH;
      } else {
        st.lag += dSpin + rotorWind * WINDING_PINION_PER_RATCHET;
        if (st.lag < 0) {
          st.ratchet -= st.lag * WINDING.ratchetPerStemTurn;
          st.lag = 0;
        }
        st.lag %= BREGUET_PITCH;
      }
    } else {
      st.lag = 0;
    }
    st.engaged = nowEngaged;
    winding.rotation.x = -st.ratchet * WINDING_PINION_PER_RATCHET;
    const shift = slidingPinionShift(pull) - BREGUET_DEPTH * st.lag / BREGUET_PITCH;
    sliding.position.x = SLIDING.innerX + shift;
    sliding.rotation.x = spin;
    yoke.rotation.y = yokeAngleFor(shift);

    // Setting-lever jumper: its beak rides out of one notch over the ridge into the next.
    const under = notchOf(NOTCH_ANGLE + leverTurn);
    jumperFinger.rotation.y = fingerOut * (under - (NOTCH_R - NOTCH_DEPTH)) / fingerLever;

    // Setting wheel: on the minute wheel in positions 1 and 3, lifted onto the double corrector
    // (dial-side.ts) and driven by the sliding pinion in position 2.
    const quick = quickSetWeight(pull);
    const switchTurn = switchLeverAngle(pull);
    switchLever.rotation.y = switchTurn;
    const byCrown = SETTING_WHEEL_PER_CROWN * dSpin;
    const onMinuteWheel = setting + SETTING_MESH_PHASE;
    if (quick === 0) st.settingFree = onMinuteWheel + Math.round((st.settingFree - onMinuteWheel) / SETTING_PITCH) * SETTING_PITCH;
    else st.settingFree += quick * byCrown;
    // Lowered back onto the minute wheel it rolls into the nearest tooth space.
    const seated = onMinuteWheel + Math.round((st.settingFree - onMinuteWheel) / SETTING_PITCH) * SETTING_PITCH;
    st.settingTurn = seated + (st.settingFree - seated) * Math.min(1, 2 * quick);
    settingWheel.rotation.y = st.settingTurn - switchTurn;
    s.settingWheel = st.settingTurn;

    // Stop lever.
    stopLever.rotation.y = STOP_TURN * stopLeverEngagement(pull);

    // Rotor side.
    ratchetMesh.rotation.y = st.ratchet;
    crownWheelMesh.rotation.y = st.ratchet * CROWN_WHEEL_PER_RATCHET;
    // The click's beak rides over the ratchet teeth passing under it.
    const offset = fract((CLICK_BEAK_ANGLE + st.ratchet - RATCHET.phase) / RATCHET_PITCH + 0.5) - 0.5;
    const lift = Math.max(0, toothRadius(RATCHET.gear, offset) + 0.02 - CLICK_BEAK_REST_R);
    click.rotation.y = lift / clickLift;
    if (ratchetScrew >= 0 && st.ratchet !== st.lastScrewTurn) {
      st.lastScrewTurn = st.ratchet;
      screwMesh.setMatrixAt(ratchetScrew, screwMatrix(screws[ratchetScrew], st.ratchet, matrix));
      screwMesh.instanceMatrix.needsUpdate = true;
    }
  }

  function resync(): void {
    st.first = true;
    st.engaged = false;
  }

  return { group, update, resync };
}

function ratchetGeometry(): THREE.BufferGeometry {
  const g = RATCHET.gear;
  const { bottom, top } = RATCHET.y;
  return solid(prism(gearOutline(g, RATCHET.phase), bottom, top, 0.02, [ngon([0, 0], 0.62, 4, Math.PI / 4)], 0));
}

function crownWheelGeometry(): THREE.BufferGeometry {
  const g = CROWN_WHEEL.gear;
  const { bottom, top } = CROWN_WHEEL.y;
  // A tooth on the line towards the ratchet's gap (the ratchet keeps a gap facing the crown wheel).
  const phase = CROWN_WHEEL.phase;
  const rimIn = g.rootR - 0.35;
  return merge([
    solid(prism(gearOutline(g, phase), bottom, top, 0.03, [ngon([0, 0], rimIn, 56)], 0)),
    solid(prism(ngon([0, 0], rimIn + 0.02, 56), bottom + 0.08, top - 0.06, 0.02, [ngon([0, 0], CROWN_WHEEL.coreR, 36)])),
    turnedY([0, 0], [[0.42, bottom], [CROWN_WHEEL.coreR, bottom], [CROWN_WHEEL.coreR, top], [0.42, top]], 36),
  ]);
}
