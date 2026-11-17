import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DATE_POSITIONS, MOON_DISC_CENTER_Z } from '../dimensions';
import type { WatchMaterials } from '../materials';
import {
  DIAL_SIDE, FINISHES, JEWELS, KEYLESS, PLATE, SCREWS, TAU,
  calendarWheelAngle, cannonPinionAngle, dateRingAngle, hourWheelAngle, intermediateDateWheelAngle, minuteWheelAngle,
  minutesFromMidnight, moonDiscAngle, quickSetWeight, relaxedFingerAngle, starWheelAngle, switchLeverAngle, type MovementState,
} from './data';

// Dial-side calendar works: everything between the main plate's dial face and
// the dial, except the printed date ring and the moon disc (dial.ts).
//
// Frame as data.ts: a plan point [x, z] sits at world (x, y, z); a plan angle
// atan2(z, x) grows clockwise seen from the dial; a part turned by rotation.y
// carries a point at local plan angle a to plan angle a - rotation.y.

// The finger, the tooth phases and the jumpers were solved together in plan
// space (see `solveCalendar`), from data.ts's layout: the date finger enters the
// date teeth about 20:00, comes to rest on a tab flank about 21:35 (the moon
// finger a hair later on a star point), winds its spring until midnight, then
// snaps forward and pushes date ring and star wheel past their jumpers' crests;
// the jumpers finish both steps and the finger leaves both wheels by 01:25
// without touching the next tab or point.

// ── Plan geometry ───────────────────────────────────────────────────────────
type P = readonly [number, number];
const rad = (d: number): number => d * Math.PI / 180;
const polar = (r: number, a: number, c: P = [0, 0]): P => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
/** Turns p by plan angle a about c. */
const turn = (p: P, a: number, c: P = [0, 0]): P => {
  const s = Math.sin(a);
  const k = Math.cos(a);
  const x = p[0] - c[0];
  const z = p[1] - c[1];
  return [c[0] + x * k - z * s, c[1] + x * s + z * k];
};
/** A local point (about the origin) turned by plan angle a and carried to c. */
const place = (p: P, a: number, c: P): P => {
  const q = turn(p, a);
  return [q[0] + c[0], q[1] + c[1]];
};
const dirOf = (from: P, to: P): number => Math.atan2(to[1] - from[1], to[0] - from[0]);
const dist = (a: P, b: P): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const arc = (c: P, r: number, a0: number, a1: number, n: number): P[] =>
  Array.from({ length: n + 1 }, (_, i) => polar(r, a0 + (a1 - a0) * i / n, c));
const circle = (c: P, r: number, n: number): P[] => arc(c, r, 0, TAU, n).slice(0, n);

function crosses(a: P, b: P, c: P, d: P): boolean {
  const side = (p: P, q: P, r: P): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return (side(c, d, a) > 0) !== (side(c, d, b) > 0) && (side(a, b, c) > 0) !== (side(a, b, d) > 0);
}
function contains(poly: readonly P[], p: P): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function apart(a: readonly P[], b: readonly P[]): boolean {
  let ax0 = Infinity, ax1 = -Infinity, az0 = Infinity, az1 = -Infinity;
  for (const p of a) { ax0 = Math.min(ax0, p[0]); ax1 = Math.max(ax1, p[0]); az0 = Math.min(az0, p[1]); az1 = Math.max(az1, p[1]); }
  for (const p of b) if (p[0] >= ax0 && p[0] <= ax1 && p[1] >= az0 && p[1] <= az1) return false;
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const p of b) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); }
  return bx0 > ax1 || bx1 < ax0 || bz0 > az1 || bz1 < az0;
}
function overlaps(a: readonly P[], b: readonly P[]): boolean {
  if (apart(a, b)) return false;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) if (crosses(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  }
  return contains(b, a[0]) || contains(a, b[0]);
}
/** Largest value in lo..hi still free when sweeping upwards; Infinity if nothing is hit. */
function firstContact(hit: (v: number) => boolean, lo: number, hi: number, step = rad(0.5)): number {
  for (let v = lo; v <= hi; v += step) {
    if (!hit(v)) continue;
    let free = v - step;
    let blocked = v;
    for (let i = 0; i < 12; i++) {
      const mid = (free + blocked) / 2;
      if (hit(mid)) blocked = mid; else free = mid;
    }
    return free;
  }
  return Infinity;
}

/** Tapered finger along +x from baseX, with a round tip; first and last point are the base corners. */
function fingerOutline(length: number, baseX: number, baseHalf: number, tipHalf: number): P[] {
  const pts: P[] = [[baseX, -baseHalf], [length - tipHalf, -tipHalf]];
  for (let i = 1; i < 6; i++) pts.push(polar(tipHalf, -Math.PI / 2 + i * Math.PI / 6, [length - tipHalf, 0]));
  pts.push([length - tipHalf, tipHalf], [baseX, baseHalf]);
  return pts;
}
/** A finger grown out of a round boss of radius `boss` about the origin, pointing along plan angle `a`. */
function bossedFinger(boss: number, a: number, length: number, baseHalf: number, tipHalf: number): P[] {
  const open = Math.asin(baseHalf / boss);
  const finger = fingerOutline(length, Math.sqrt(boss * boss - baseHalf * baseHalf), baseHalf, tipHalf);
  return [...arc([0, 0], boss, a + open, a - open + TAU, 28), ...finger.slice(1, -1).map(p => turn(p, a))];
}
/** Inner tab of the date ring centred on plan angle a. */
function tabOutline(a: number): P[] {
  const tip = DIAL_SIDE.dateTeeth.tipR;
  return [polar(TAB_ROOT_R, a - TAB_ROOT_HALF / TAB_ROOT_R), polar(tip, a - TAB_TIP_HALF / tip), polar(tip, a + TAB_TIP_HALF / tip), polar(TAB_ROOT_R, a + TAB_ROOT_HALF / TAB_ROOT_R)];
}
/** Rounded point of the star wheel centred on plan angle a (the base is buried in the wheel). */
function pointOutline(a: number, base = DIAL_SIDE.starWheel.rootR - 0.2): P[] {
  const tip = DIAL_SIDE.starWheel.tipR;
  const cx = tip - POINT_HALF;
  const pts: P[] = [[base, -POINT_HALF], [cx, -POINT_HALF]];
  for (let i = 1; i < 8; i++) pts.push(polar(POINT_HALF, -Math.PI / 2 + i * Math.PI / 8, [cx, 0]));
  pts.push([cx, POINT_HALF], [base, POINT_HALF]);
  return pts.map(p => turn(p, a));
}
/** Gear outline about the origin: `teeth` trapezoid teeth, tooth 0 centred on `phase`. */
function gearOutline(teeth: number, tipR: number, rootR: number, phase: number): P[] {
  const pitch = TAU / teeth;
  const pts: P[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = phase + i * pitch;
    pts.push(polar(rootR, a - 0.3 * pitch), polar(tipR, a - 0.13 * pitch), polar(tipR, a + 0.13 * pitch), polar(rootR, a + 0.3 * pitch));
  }
  return pts;
}
/** Plan angle of a tooth of gear B in mesh with gear A whose tooth stands at `toothA` (same module). */
function meshedPhase(toothA: number, teethA: number, dirAB: number, teethB: number): number {
  const pitchA = TAU / teethA;
  let delta = dirAB - toothA;
  delta -= Math.round(delta / pitchA) * pitchA;
  return dirAB + Math.PI + delta * teethA / teethB + Math.PI / teethB;
}
/** Strip of half-width `half(t)` along a polyline. */
function ribbon(path: readonly P[], half: (t: number) => number): P[] {
  const left: P[] = [];
  const right: P[] = [];
  path.forEach((p, i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const l = dist(a, b) || 1;
    const nx = -(b[1] - a[1]) / l;
    const nz = (b[0] - a[0]) / l;
    const w = half(i / (path.length - 1));
    left.push([p[0] + nx * w, p[1] + nz * w]);
    right.push([p[0] - nx * w, p[1] - nz * w]);
  });
  return [...left, ...right.reverse()];
}

// ── Layout taken from data.ts ───────────────────────────────────────────────
const D = DIAL_SIDE;
const CAL_AXIS = D.calendarWheel.axis;
const CAL_DIR = Math.atan2(CAL_AXIS[1], CAL_AXIS[0]);
const DATE_PITCH = TAU / DATE_POSITIONS;
const STAR_PITCH = TAU / D.starWheel.points;
const TAB_PHASE = D.dateTeeth.phase;
const POINT_PHASE = D.starWheel.pointPhase;
const MOON_AXIS: P = [0, MOON_DISC_CENTER_Z];
const FOOT = D.doubleJumper.foot;
const DATE_REACH = D.calendarWheel.dateFinger.reach;
const DATE_TIP_HALF = D.calendarWheel.dateFinger.tipWidth / 2;
const MOON_REACH = D.calendarWheel.moonFinger.reach;
const MOON_TIP_HALF = D.calendarWheel.moonFinger.tipWidth / 2;
const MOON_ARM = D.calendarWheel.moonFinger.angle;
const FINGER_MIDNIGHT = D.calendarWheel.fingerMidnight;
const TAB_TIP_HALF = D.dateTeeth.tipWidth / 2;
const TAB_ROOT_HALF = D.dateTeeth.rootWidth / 2;
const TAB_ROOT_R = D.dateTeeth.rootR;
const POINT_HALF = D.starWheel.pointWidth / 2;
const DATE_ARM_ROOT = D.doubleJumper.dateArm.root;
const STAR_ARM_ROOT = D.doubleJumper.starArm.root;
/** Gap centres nearest the measured beaks (the beaks must sit in a gap at every whole step). */
const nearestGap = (phase: number, pitch: number, near: P): number =>
  phase + (Math.round((Math.atan2(near[1], near[0]) - phase) / pitch - 0.5) + 0.5) * pitch;
const DATE_GAP = nearestGap(TAB_PHASE, DATE_PITCH, D.doubleJumper.dateArm.beak);
const STAR_GAP = nearestGap(POINT_PHASE, STAR_PITCH, D.doubleJumper.starArm.beak);

// ── Kinematics, solved once in plan space ───────────────────────────────────
/** Share of a quick-set crown turn after which the day corrector meets its star point, at the latest. */
const DAY_CONTACT_AT = 0.4;
const STOP_STEPS = 32;
/** Contact angles are kept this far short of touching: tables are interpolated between samples. */
const CONTACT_MARGIN = 0.2 * Math.PI / 180;

interface Rocker {
  pivot: P;
  /** rotation.y per unit lift (+1 or -1). */
  sign: number;
  /** Lift (rad) by step fraction, STOP_STEPS + 1 entries. */
  lift: Float32Array;
}

interface Calendar {
  /** Finger angle (from the line of centres) at which the resting finger meets tooth or point. */
  hold: number;
  /** Finger angle at which it rests against the pushed tooth / point, by step fraction (Infinity: free). */
  dateStops: Float32Array;
  moonStops: Float32Array;
  /** Minutes after midnight when the finger has left both wheels. */
  exitMinutes: number;
  dateJumper: Rocker;
  starJumper: Rocker;
}

function rockerTable(pivot: P, beak: P[], obstacles: (f: number) => P[][], liftOutwards: boolean): Rocker {
  const at = (w: number): P[] => beak.map(p => turn(p, -w, pivot));
  // The sign of rotation.y that lifts the beak out of the wheel, judged at the beak's tip.
  const tip = beak.reduce((best, p) => ((Math.hypot(...p) < Math.hypot(...best)) === liftOutwards ? p : best), beak[0]);
  const moved = turn(tip, -rad(1), pivot);
  const sign = (Math.hypot(...moved) > Math.hypot(...tip)) === liftOutwards ? 1 : -1;
  const hit = (w: number, f: number): boolean => obstacles(f).some(o => overlaps(at(sign * w), o));
  // Seat: as deep into the gap as the neighbouring teeth allow.
  const seat = (hit(0, 0) ? firstContact(w => !hit(w, 0), 0, rad(20)) : -firstContact(w => hit(-w, 0), 0, rad(20))) + CONTACT_MARGIN;
  const lift = new Float32Array(STOP_STEPS + 1);
  for (let i = 0; i <= STOP_STEPS; i++) {
    const f = i / STOP_STEPS;
    lift[i] = hit(seat, f) ? Math.min(rad(25), firstContact(w => !hit(seat + w, f), 0, rad(25)) + seat + CONTACT_MARGIN) : seat;
  }
  return { pivot, sign, lift };
}

function* solveCalendar(dateBeak: P[], starBeak: P[]): Generator<void, Calendar, void> {
  const dateFinger = fingerOutline(DATE_REACH, 0.62, 0.21, DATE_TIP_HALF);
  const moonFinger = fingerOutline(MOON_REACH, 0.62, 0.21, MOON_TIP_HALF);
  const dateAt = (psi: number): P[] => dateFinger.map(p => place(p, CAL_DIR + psi, CAL_AXIS));
  const moonAt = (psi: number): P[] => moonFinger.map(p => place(p, CAL_DIR + MOON_ARM + psi, CAL_AXIS));
  const tab = (j: number, f: number): P[] => tabOutline(TAB_PHASE + (j + f) * DATE_PITCH);
  const point = (j: number, g: number): P[] => pointOutline(POINT_PHASE + (j - g) * STAR_PITCH);
  const tabs = [-2, -1, 0, 1, 2];
  const points = [-3, -2, -1, 0, 1, 2, 3];
  const from = FINGER_MIDNIGHT - rad(100);
  const dateHold = firstContact(psi => tabs.some(j => overlaps(dateAt(psi), tab(j, 0))), from, FINGER_MIDNIGHT);
  const moonHold = firstContact(psi => points.some(j => overlaps(moonAt(psi), point(j, 0))), from, FINGER_MIDNIGHT);
  const hold = Math.min(dateHold, moonHold, FINGER_MIDNIGHT);
  const pushedTab = tabs.find(j => overlaps(dateAt(dateHold + rad(0.3)), tab(j, 0))) ?? 0;
  const pushedPoint = points.find(j => overlaps(moonAt(moonHold + rad(0.3)), point(j, 0))) ?? 0;
  const dateStops = new Float32Array(STOP_STEPS + 1);
  const moonStops = new Float32Array(STOP_STEPS + 1);
  for (let i = 0; i <= STOP_STEPS; i++) {
    const f = i / STOP_STEPS;
    dateStops[i] = firstContact(psi => overlaps(dateAt(psi), tab(pushedTab, f)), hold - rad(1), FINGER_MIDNIGHT + rad(2)) - CONTACT_MARGIN;
    moonStops[i] = firstContact(psi => overlaps(moonAt(psi), point(pushedPoint, f)), hold - rad(1), FINGER_MIDNIGHT + rad(2)) - CONTACT_MARGIN;
  }
  // The finger has left both wheels once the date tip is inside the tab circle and the moon tip outside the points.
  const tipR = D.dateTeeth.tipR;
  let exit = FINGER_MIDNIGHT;
  while (exit < FINGER_MIDNIGHT + rad(90)) {
    const out = Math.max(...dateAt(exit).map(p => Math.hypot(...p))) < tipR - 0.03
      && Math.min(...moonAt(exit).map(p => Math.hypot(...p))) > D.starWheel.tipR + 0.03;
    if (out) break;
    exit += rad(1);
  }
  yield;
  const dateBase = Math.round((DATE_GAP - TAB_PHASE) / DATE_PITCH - 0.5);
  const starBase = Math.round((STAR_GAP - POINT_PHASE) / STAR_PITCH - 0.5);
  const dateJumper = rockerTable(DATE_ARM_ROOT, dateBeak, f => [-1, 0, 1, 2].map(j => tab(dateBase + j, f)), false);
  const starJumper = rockerTable(STAR_ARM_ROOT, starBeak, g => [-1, 0, 1, 2].map(j => point(starBase + j, g)), true);
  return { hold: hold - CONTACT_MARGIN, dateStops, moonStops, exitMinutes: (exit - FINGER_MIDNIGHT) / TAU * 1440, dateJumper, starJumper };
}

/** Fraction of a calendar step in progress; whole values (within rounding) count as at rest. */
function stepFraction(value: number): number {
  const f = value - Math.floor(value);
  return f > 1e-4 && f < 1 - 1e-4 ? f : 0;
}
function sample(table: Float32Array, fraction: number): number {
  const x = fraction * STOP_STEPS;
  const i = Math.min(STOP_STEPS - 1, Math.floor(x));
  const a = table[i];
  const b = table[i + 1];
  if (a === Infinity || b === Infinity) return a === Infinity ? Infinity : x - i < 0.5 ? a : Infinity;
  return a + (b - a) * (x - i);
}

// ── Mesh building ───────────────────────────────────────────────────────────
const COLORS = {
  gilt: new THREE.Color(FINISHES.gilt.color),
  steel: new THREE.Color(FINISHES.polishedSteel.color),
  blued: new THREE.Color(FINISHES.blued.color),
  shadow: new THREE.Color(0x1a1d22),
};

/** Extrudes a plan outline between two heights, with a small chamfer. */
function slab(outline: readonly P[], bottom: number, top: number, bevel = 0.02, holes: readonly P[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, z))));
  const b = Math.min(bevel, (top - bottom) / 3);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: top - bottom - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b,
    bevelSegments: 1, steps: 1, curveSegments: 1,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, top - b, 0);
  return geo;
}
function cylinder(c: P, r: number, bottom: number, top: number, segments = 20, topR = r): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(topR, r, top - bottom, segments);
  geo.translate(c[0], (bottom + top) / 2, c[1]);
  return geo;
}
/** Solid of revolution about the vertical through c; profile points are [radius, y]. */
function lathe(c: P, profile: readonly (readonly [number, number])[], segments = 24): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  geo.translate(c[0], 0, c[1]);
  return geo;
}
/** Vertex colour for the shared metal material; UVs are not used by the grained finish. */
function paint(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.deleteAttribute('uv');
  const n = flat.attributes.position.count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(data, i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(data, 3));
  return flat;
}
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return out!;
}
/** Slotted screw head standing on `seat`, rising by `rise` (+ up, - down; 0 = countersunk, flush). */
function screwHead(at: P, r: number, seat: number, rise: number, slot: number): THREE.BufferGeometry[] {
  const up = rise >= 0 ? 1 : -1;
  const h = Math.abs(rise) || 0.012;
  const face = seat + up * h;
  const head = lathe(at, up > 0
    ? [[0, seat], [r, seat], [r, face - 0.025], [r * 0.82, face], [0, face]]
    : [[0, face], [r * 0.82, face], [r, face + 0.025], [r, seat], [0, seat]], 24);
  const cut = new THREE.BoxGeometry(r * 1.8, 0.02, r * 0.24);
  cut.rotateY(-slot);
  cut.translate(at[0], face, at[1]);
  return [paint(head, COLORS.blued), paint(cut, COLORS.shadow)];
}

export interface DialSideWorks {
  /** All dial-side parts, in the watch frame. */
  group: THREE.Group;
  update(s: MovementState): void;
}

/**
 * The calendar module under the dial, as in the reference calibre: motion
 * works, 24-hour calendar wheel with its sprung double finger, date-ring teeth
 * and the double jumper, the 14-point star wheel whose 28-leaf pinion turns the
 * 118-tooth rim of the moon disc, and the quick-set correctors.
 */
export function makeDialSide(m: WatchMaterials): DialSideWorks {
  const build = buildDialSide(m);
  let slice = build.next();
  while (!slice.done) slice = build.next();
  return slice.value;
}

/** The same build in slices of a few tens of milliseconds, one per `next()`, for idle callbacks. */
export function* buildDialSide(m: WatchMaterials): Generator<void, DialSideWorks, void> {
  const group = new THREE.Group();
  group.name = 'Movement, dial side';

  // One grained metal (vertex colours tell gilt, steel and blued apart), the
  // rhodium plates, and the rubies.
  const metal = m.brushedCircular.clone();
  metal.color.set(0xffffff);
  metal.vertexColors = true;
  metal.roughness = 0.3;
  metal.name = 'Movement metal (dial side)';
  const rhodium = m.brushedCircular.clone();
  rhodium.color.set(FINISHES.rhodium.color);
  rhodium.roughness = FINISHES.rhodium.roughness;
  rhodium.name = 'Rhodium plates (dial side)';
  const ruby = new THREE.MeshPhysicalMaterial({
    color: FINISHES.ruby.color, metalness: 0, roughness: FINISHES.ruby.roughness, clearcoat: 1, clearcoatRoughness: 0.05,
    emissive: 0x3a0610, emissiveIntensity: 0.6,
  });
  ruby.name = 'Ruby';

  // Every moving part is one instance of a single batched mesh. Its driver, an
  // empty node on the part's axis, stays in the graph: the scene manager's change
  // detection sees the drivers turn, and update() copies their matrices.
  const moving: { driver: THREE.Object3D; geo: THREE.BufferGeometry; id: number }[] = [];
  const part = (name: string, axis: P, geo: THREE.BufferGeometry, parent: THREE.Object3D = group): THREE.Object3D => {
    const driver = new THREE.Object3D();
    driver.name = name;
    driver.position.set(axis[0], 0, axis[1]);
    parent.add(driver);
    moving.push({ driver, geo, id: -1 });
    return driver;
  };
  const statics: THREE.BufferGeometry[] = [];
  const plates: THREE.BufferGeometry[] = [];
  const jewels: THREE.BufferGeometry[] = [];

  // ---- date ring teeth: 31 gilt tabs inside the printed ring, turning with it
  const tabs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < DATE_POSITIONS; i++) tabs.push(paint(slab(tabOutline(TAB_PHASE + i * DATE_PITCH), D.dateTeeth.y.bottom, D.dateTeeth.y.top, 0.015), COLORS.gilt));
  const ring = part('Date ring teeth (31)', [0, 0], merged(tabs));

  // ---- star wheel (gilt, 14 points) with its 28-leaf pinion (steel)
  const sw = D.starWheel;
  const starOutline: P[] = [];
  const flank = Math.asin(POINT_HALF / sw.rootR);
  for (let i = 0; i < sw.points; i++) {
    const a = POINT_PHASE + i * STAR_PITCH;
    starOutline.push(...arc([0, 0], sw.rootR, a - STAR_PITCH + flank, a - flank, 6).slice(1, -1));
    const point = pointOutline(a, Math.sqrt(sw.rootR ** 2 - POINT_HALF ** 2));
    starOutline.push(...point);
  }
  const webHoles = Array.from({ length: sw.web.holes }, (_, i) => circle(polar(sw.web.holePitchR, rad(45) + i * TAU / sw.web.holes), sw.web.holeR, 14));
  const bore = circle([0, 0], sw.boreR, 32);
  const leaves = gearOutline(sw.pinion.teeth, sw.pinion.tipR, sw.pinion.rootR, sw.leafPhase);
  const star = part('Star wheel (14) with pinion (28)', [0, 0], merged([
    paint(slab(starOutline, sw.y.bottom, sw.y.top, 0.02, [bore, ...webHoles]), COLORS.gilt),
    paint(slab(circle([0, 0], sw.web.discR, 72), sw.y.top - 0.01, sw.y.top + 0.02, 0.01, [circle([0, 0], 1.62, 32), ...webHoles]), COLORS.gilt),
    paint(slab(leaves, sw.pinionY.bottom, sw.pinionY.top, 0.015, [bore]), COLORS.steel),
  ]));

  yield;
  // ---- moon-disc rim: 118 gilt teeth under the edge of dial.ts's sky disc
  const mw = D.moonWheel;
  const moonRim = part('Moon disc rim (118)', MOON_AXIS, paint(slab(gearOutline(mw.gear.teeth, mw.gear.tipR, mw.gear.rootR, mw.toothPhase),
    mw.y.bottom, mw.y.top, 0, [circle([0, 0], mw.innerR, 118)]), COLORS.gilt));

  // ---- motion works: phases make every pair mesh at minutes = 0 (all rotations 0 there)
  const hw = D.hourWheel;
  const iw = D.intermediateDateWheel;
  const mwh = D.minuteWheel;
  const cp = D.cannonPinion;
  const dirHI = Math.atan2(iw.axis[1], iw.axis[0]);
  const dirHM = Math.atan2(mwh.axis[1], mwh.axis[0]);
  const hourPhase = dirHI;
  const interPhase = meshedPhase(hourPhase, hw.gear.teeth, dirHI, iw.wheel.teeth);
  const cannonPhase = dirHM;
  const minutePhase = meshedPhase(cannonPhase, cp.gear.teeth, dirHM, mwh.wheel.teeth);
  const minutePinionPhase = meshedPhase(hourPhase, hw.gear.teeth, dirHM, mwh.pinion.teeth);
  const interPinionPhase = dirOf(iw.axis, CAL_AXIS);
  // The calendar wheel carries the finger: at minutes = 0 it is turned by -(CAL_DIR + FINGER_MIDNIGHT).
  const calRest = -(CAL_DIR + FINGER_MIDNIGHT);
  const calPhase = meshedPhase(interPinionPhase, iw.pinion.teeth, dirOf(iw.axis, CAL_AXIS), D.calendarWheel.gear.teeth) + calRest;

  const hourHoles = Array.from({ length: 5 }, (_, i) => circle(polar(1.75, rad(18) + i * TAU / 5), 0.42, 14));
  const hour = part('Hour wheel (32)', [0, 0], merged([
    paint(slab(gearOutline(hw.gear.teeth, hw.gear.tipR, hw.gear.rootR, hourPhase), hw.y.bottom, hw.y.top, 0.015, [circle([0, 0], hw.pipe.innerR, 24), ...hourHoles]), COLORS.gilt),
    paint(lathe([0, 0], [[hw.pipe.outerR + 0.15, hw.y.top - 0.005], [hw.pipe.outerR + 0.15, hw.y.top], [hw.pipe.outerR, hw.y.top],
      [hw.pipe.outerR, hw.pipe.y.top - 0.04], [hw.pipe.outerR - 0.04, hw.pipe.y.top], [hw.pipe.innerR, hw.pipe.y.top]], 28), COLORS.gilt),
    paint(slab(([[hw.pipe.outerR - 0.1, -0.06], [hw.pipe.innerR + 0.02, -0.06], [hw.pipe.innerR + 0.02, 0.06], [hw.pipe.outerR - 0.1, 0.06]] as P[]).map(p => turn(p, hourPhase)),
      hw.pipe.y.top - 0.01, hw.pipe.y.top + 0.004, 0), COLORS.shadow),
  ]));
  const cannon = part('Cannon pinion (10)', [0, 0], merged([
    paint(slab(gearOutline(cp.gear.teeth, cp.gear.tipR, cp.gear.rootR, cannonPhase), cp.leavesY.bottom, cp.leavesY.top, 0.015, [circle([0, 0], cp.pipe.innerR, 20)]), COLORS.steel),
    paint(lathe([0, 0], [[cp.pipe.innerR, cp.pipe.y.bottom], [cp.pipe.outerR, cp.pipe.y.bottom], [cp.pipe.outerR, cp.pipe.y.top - 0.03],
      [cp.pipe.outerR - 0.03, cp.pipe.y.top], [cp.pipe.innerR, cp.pipe.y.top]], 24), COLORS.steel),
    ...[0, Math.PI].map(a => paint(slab(([[cp.pipe.innerR + 0.01, -0.05], [cp.pipe.outerR - 0.02, -0.05], [cp.pipe.outerR - 0.02, 0.05], [cp.pipe.innerR + 0.01, 0.05]] as P[]).map(p => turn(p, cannonPhase + a)),
      cp.pipe.y.top - 0.01, cp.pipe.y.top + 0.004, 0), COLORS.shadow)),
  ]));
  const minuteWheel = part('Minute wheel (30/8)', mwh.axis, merged([
    paint(slab(gearOutline(mwh.wheel.teeth, mwh.wheel.tipR, mwh.wheel.rootR, minutePhase), mwh.wheelY.bottom, mwh.wheelY.top, 0.012,
      Array.from({ length: 4 }, (_, i) => circle(polar(1.6, rad(10) + i * TAU / 4), 0.5, 14))), COLORS.gilt),
    paint(slab(gearOutline(mwh.pinion.teeth, mwh.pinion.tipR, mwh.pinion.rootR, minutePinionPhase), mwh.pinionY.bottom, mwh.pinionY.top, 0.012), COLORS.steel),
    paint(cylinder([0, 0], mwh.arborR, D.cannonPinion.pipe.y.bottom, mwh.pinionY.top + 0.04, 12), COLORS.steel),
  ]));
  const inter = part('Intermediate date wheel (16/16)', iw.axis, merged([
    paint(slab(gearOutline(iw.wheel.teeth, iw.wheel.tipR, iw.wheel.rootR, interPhase), iw.wheelY.bottom, iw.wheelY.top, 0.012), COLORS.steel),
    paint(slab(gearOutline(iw.pinion.teeth, iw.pinion.tipR, iw.pinion.rootR, interPinionPhase), iw.pinionY.bottom, iw.pinionY.top, 0.012), COLORS.gilt),
    paint(lathe([0, 0], [[0, iw.arborY.bottom], [iw.arborR, iw.arborY.bottom], [iw.arborR, iw.pinionY.top + 0.03], [iw.arborR * 0.6, iw.pinionY.top + 0.05], [0, iw.pinionY.top + 0.05]], 12), COLORS.steel),
  ]));

  yield;
  // ---- 24-hour calendar wheel (gilt, 64) with the pin that winds the finger's spring
  // and the stud that lifts the release yoke before midnight
  const cw = D.calendarWheel;
  const ry = D.unlockingYoke;
  const PIN_ANGLE = rad(-80);
  const PIN_R = 0.72;
  const yokePivot = ry.yoke.pivot;
  const beak = ry.yoke.beak;
  // Where the yoke's centre line crosses the stud's circle: the stud meets it there.
  const studMeet = ((): P => {
    let lo = 0, hi = 1;
    const at = (t: number): P => [yokePivot[0] + (beak[0] - yokePivot[0]) * t, yokePivot[1] + (beak[1] - yokePivot[1]) * t];
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (dist(at(mid), CAL_AXIS) > ry.stud.r) lo = mid; else hi = mid;
    }
    return at(lo);
  })();
  // The stud touches the yoke's leading side half-way through the lift; the wheel's own frame is turned
  // by calendarWheelAngle, a local plan angle a shows at a - rotation.y.
  const studLocal = dirOf(CAL_AXIS, studMeet) - (ry.stud.radius + ry.yoke.width / 2) / ry.stud.r
    + calendarWheelAngle((1440 + (ry.liftFrom + ry.release) / 2) % 1440);
  const cal = part('Calendar driving wheel (24 h, 64)', CAL_AXIS, merged([
    paint(slab(gearOutline(cw.gear.teeth, cw.gear.tipR, cw.gear.rootR, calPhase), cw.y.bottom, cw.y.top, 0.015, [circle([0, 0], cw.stud.r + 0.02, 20)]), COLORS.gilt),
    paint(cylinder(turn([PIN_R, 0], PIN_ANGLE), 0.07, cw.y.top, cw.fingerHub.y.top + 0.07, 10), COLORS.steel),
    paint(cylinder(polar(ry.stud.r, studLocal), ry.stud.radius, cw.y.top, ry.yoke.y.top, 10), COLORS.steel),
  ]));

  // Double-jumper beaks in their gaps (world plan), wedges matched to tabs and points.
  // The kinematics need them; the arms are built further down.
  const wedge = (gap: number, pts: readonly P[]): P[] => pts.map(([u, v]) => turn([u, v], gap));
  const dateBeak = wedge(DATE_GAP, [[7.86, -0.26], [8.02, -0.82], [8.2, -0.74], [8.5, -0.06], [8.53, 0], [8.5, 0.06], [8.2, 0.74], [8.02, 0.82], [7.86, 0.26]]);
  const starBeak = wedge(STAR_GAP, [[5.02, 0.26], [4.86, 0.95], [4.6, 0.95], [4.31, 0.06], [4.28, 0], [4.31, -0.06], [4.6, -0.95], [4.86, -0.95], [5.02, -0.26]]);
  yield;
  const kin = yield* solveCalendar(dateBeak, starBeak);
  yield;

  // ---- release yoke: rests on the calendar wheel, tangent to the finger hub at its beak
  const yokeOutline = ribbon([yokePivot, lerp(yokePivot, beak, 0.6), beak], t => ry.yoke.width / 2 + 0.06 * (1 - t));
  yokeOutline.push(...arc(beak, ry.yoke.width / 2, dirOf(yokePivot, beak) - Math.PI / 2, dirOf(yokePivot, beak) + Math.PI / 2, 6).slice(1, -1).reverse());
  // The hook: from the centre line in towards the hub, at the very end, its face towards the pivot.
  const along = dirOf(yokePivot, beak);
  const inward = dirOf(beak, CAL_AXIS);
  const hookDepth = dist(beak, CAL_AXIS) - ry.yoke.beakTipR;
  const hookOutline: P[] = [polar(0.02, inward, polar(-0.2, along, beak)), polar(0.02, inward, polar(0.12, along, beak)),
    polar(hookDepth, inward, polar(0.06, along, beak)), polar(hookDepth, inward, polar(-0.14, along, beak))];
  const yokeAt = (lift: number): P[] => yokeOutline.map(p => turn(p, -lift, yokePivot));
  const hookAt = (lift: number): P[] => hookOutline.map(p => turn(p, -lift, yokePivot));
  // Catch on the finger hub, placed so that the yoke holds the finger 2° short of the date tooth.
  const latch = kin.hold - rad(2);
  const catchShape = (local: number): P[] => {
    const half = ry.catch.width / 2;
    const pts: P[] = [[cw.fingerHub.r - 0.1, -half], [ry.catch.tipR - 0.04, -half * 0.8], [ry.catch.tipR, 0], [ry.catch.tipR - 0.04, half * 0.8], [cw.fingerHub.r - 0.1, half]];
    return pts.map(p => turn(p, local));
  };
  const catchAt = (local: number, psi: number): P[] => catchShape(local).map(p => place(p, CAL_DIR + psi, CAL_AXIS));
  const yokeRest = yokeAt(0);
  const hookRest = hookAt(0);
  // Contact of a catch at local angle 0, then the local angle that puts that contact on the latch angle.
  const catchContact0 = firstContact(psi => overlaps(catchAt(0, psi), hookRest) || overlaps(catchAt(0, psi), yokeRest), latch - TAU + rad(10), latch + rad(30), rad(0.25));
  const catchLocal = catchContact0 - latch;
  const yokeDriver = part('Release yoke', yokePivot, merged([
    paint(slab(yokeOutline, ry.yoke.y.bottom, ry.yoke.y.top, 0.01), COLORS.steel),
    paint(slab(hookOutline, ry.yoke.y.bottom, ry.yoke.y.top, 0.01), COLORS.steel),
    paint(slab(circle(yokePivot, 0.34, 20), ry.yoke.y.bottom, ry.yoke.y.top, 0.01), COLORS.steel),
  ]).translate(-yokePivot[0], 0, -yokePivot[1]));
  statics.push(paint(cylinder(yokePivot, 0.16, ry.plate.y.top, ry.yoke.y.top + 0.03, 12), COLORS.steel));
  // While the hands are turned back past the latch with the switch already done, the sprung yoke is pushed aside.
  const catchBand = rad(24);

  // ---- sprung double finger: hub whose slot lets the wheel's pin wind the spring,
  // moon finger at the star level, date finger at the date-teeth level, the catch at the hub level
  const maxLag = FINGER_MIDNIGHT - latch;

  const slotFrom = PIN_ANGLE - rad(9);
  const slotTo = PIN_ANGLE + maxLag + rad(9);
  const slotHole = [...arc([0, 0], PIN_R + 0.1, slotFrom, slotTo, 14), ...arc([0, 0], PIN_R - 0.1, slotTo, slotFrom, 14)];
  const finger = part('Calendar double finger', CAL_AXIS, merged([
    paint(slab(circle([0, 0], cw.fingerHub.r, 40), cw.fingerHub.y.bottom, cw.fingerHub.y.top, 0.012, [slotHole]), COLORS.steel),
    paint(slab(catchShape(catchLocal), cw.fingerHub.y.bottom, cw.fingerHub.y.top, 0.01), COLORS.steel),
    paint(slab(bossedFinger(0.55, MOON_ARM, MOON_REACH, 0.21, MOON_TIP_HALF), cw.moonFinger.y.bottom, cw.moonFinger.y.top, 0.02), COLORS.steel),
    paint(cylinder([0, 0], 0.4, cw.moonFinger.y.top - 0.01, cw.dateFinger.y.bottom + 0.01, 20), COLORS.steel),
    paint(slab(bossedFinger(0.5, 0, DATE_REACH, 0.21, DATE_TIP_HALF), cw.dateFinger.y.bottom, cw.dateFinger.y.top, 0.02), COLORS.steel),
    paint(lathe([0, 0], [[0, cw.dateFinger.y.top], [0.3, cw.dateFinger.y.top], [0.3, cw.dateFinger.y.top + 0.03], [0.2, cw.dateFinger.y.top + 0.06], [0, cw.dateFinger.y.top + 0.065]], 20), COLORS.steel),
  ]));

  yield;
  // ---- double jumper: body under its maintaining plate, a sprung arm for each wheel
  const dj = D.doubleJumper;
  const dateBeakBase = turn([7.92, 0], DATE_GAP);
  const starBeakBase = turn([4.98, 0], STAR_GAP);
  const datePath: P[] = [DATE_ARM_ROOT, [-7.82, 0.55], dateBeakBase];
  const starPath: P[] = [STAR_ARM_ROOT, [-5.2, 1.25], [-5.02, 0.55], starBeakBase];
  const armGroup = (name: string, rocker: Rocker, geos: THREE.BufferGeometry[]): THREE.Object3D =>
    part(name, rocker.pivot, merged(geos).translate(-rocker.pivot[0], 0, -rocker.pivot[1]));
  const dateArm = armGroup('Double jumper, date arm', kin.dateJumper, [
    paint(slab(ribbon(datePath, t => dj.dateArm.width / 2 + 0.06 * (1 - t)), dj.dateArm.y.bottom, dj.dateArm.y.top, 0.015), COLORS.steel),
    paint(slab(dateBeak, dj.dateArm.y.bottom, dj.dateArm.y.top, 0.015), COLORS.steel),
  ]);
  const starArm = armGroup('Double jumper, star arm', kin.starJumper, [
    paint(slab(ribbon(starPath, t => dj.starArm.width / 2 + 0.06 * (1 - t)), dj.starArm.y.bottom, dj.starArm.y.top, 0.015), COLORS.steel),
    paint(slab(starBeak, dj.starArm.y.bottom, dj.starArm.y.top, 0.015), COLORS.steel),
  ]);
  statics.push(
    paint(slab(ribbon([FOOT, DATE_ARM_ROOT], () => 0.3), dj.dateArm.y.bottom, dj.dateArm.y.top, 0.015), COLORS.steel),
    paint(slab(ribbon([FOOT, STAR_ARM_ROOT], () => 0.3), dj.starArm.y.bottom, dj.starArm.y.top, 0.015), COLORS.steel),
    paint(slab(circle(FOOT, dj.footR, 28), dj.starArm.y.bottom, dj.dateArm.y.top, 0.02), COLORS.steel),
    paint(cylinder(FOOT, 0.36, dj.postY.bottom, dj.starArm.y.bottom, 16), COLORS.steel),
  );

  // ---- static steel: star bush, moon stud and friction spring, calendar stud
  statics.push(
    paint(lathe([0, 0], [[D.starBush.innerR, D.starBush.y.bottom], [D.starBush.outerR + 0.25, D.starBush.y.bottom], [D.starBush.outerR + 0.25, D.starBush.y.bottom + 0.06],
      [D.starBush.outerR, D.starBush.y.bottom + 0.08], [D.starBush.outerR, D.starBush.y.top], [D.starBush.innerR, D.starBush.y.top]], 32), COLORS.steel),
    paint(cylinder(D.moonStud.axis, D.moonStud.r, D.moonStud.y.bottom, D.moonStud.y.top, 18), COLORS.steel),
    paint(slab(Array.from({ length: 48 }, (_, i) => polar(D.moonSpring.outerR - 0.12 * (1 + Math.cos(D.moonSpring.lobes * i / 48 * TAU)), i / 48 * TAU, D.moonSpring.axis)),
      D.moonSpring.y.bottom, D.moonSpring.y.top, 0, [circle(D.moonSpring.axis, D.moonSpring.innerR, 20)]), COLORS.gilt),
    paint(cylinder(CAL_AXIS, cw.stud.r, cw.stud.y.bottom, cw.y.bottom, 16), COLORS.steel),
  );

  yield;
  // ---- rhodium plates: minute-train bridge, unlocking-yoke plate, jumper maintaining plate, dial support ring
  const mb = D.minuteBridge;
  const pallet = JEWELS.dialSide[1];
  plates.push(slab(mb.outline, mb.y.bottom, mb.y.top, 0.03, [
    circle([0, 0], mb.centreHoleR, 32),
    circle(iw.axis, iw.arborR + 0.06, 14),
    circle(pallet.at, pallet.chaton + 0.08, 20),
  ]));
  plates.push(slab(D.unlockingYoke.plate.outline, D.unlockingYoke.plate.y.bottom, D.unlockingYoke.plate.y.top, 0.03));
  plates.push(slab(D.jumperPlate.outline, D.jumperPlate.y.bottom, D.jumperPlate.y.top, 0.025));
  const ds = D.dialSupport;
  const notchFrom = ds.moonNotch.from;
  const notchTo = ds.moonNotch.to;
  plates.push(
    slab([...arc([0, 0], ds.outerR, notchTo, notchFrom + TAU, 220), ...arc([0, 0], ds.innerR, notchFrom + TAU, notchTo, 220)], ds.y.bottom, ds.y.top, 0.03),
    slab([...arc([0, 0], ds.outerR, notchFrom, notchTo, 30), ...arc([0, 0], ds.innerR, notchTo, notchFrom, 30)], ds.y.bottom, ds.moonNotch.top, 0.03),
    slab(circle([0, 0], ds.innerR + 0.02, 220), ds.ledge.y.bottom, ds.ledge.y.top, 0.02, [circle([0, 0], ds.ledge.innerR, 220)]),
  );
  // Screws: minute-bridge screw, jumper-plate screw (countersunk), yoke-plate screw, day-corrector screw.
  for (const s of SCREWS.dialSide) statics.push(...screwHead(s.at, s.headR, s.seatY, s.rise, s.slot));

  // ---- jewels on the plate's dial face: balance shock absorber (12 o'clock) and pallet jewel
  for (const j of JEWELS.dialSide) {
    statics.push(paint(lathe(j.at, [[j.chaton, PLATE.dialFaceY], [j.chaton, j.y + 0.02], [j.r, j.y + 0.02]], 32), COLORS.steel));
    jewels.push(lathe(j.at, [[j.r, j.y - 0.02], [j.r, j.y + 0.03], [j.r * 0.55, j.y + 0.065], [0, j.y + 0.07]], 24));
  }
  // Lyre spring of the shock absorber: two arcs held by the chaton's ears.
  const shock = JEWELS.dialSide[0];
  for (const a of [rad(-90), rad(90)]) {
    statics.push(paint(slab(ribbon(arc(shock.at, shock.r + 0.28, a - rad(55), a + rad(55), 10), () => 0.05), shock.y + 0.02, shock.y + 0.06, 0), COLORS.steel));
  }

  yield;
  // ---- quick-set: the double corrector on its arm about the setting wheel's arbor, and the day corrector
  const correctorMotion = yield* buildCorrectors();
  function* buildCorrectors(): Generator<void, (s: MovementState, fD: number, fM: number) => void, void> {
    const kq = KEYLESS;
    const dc = kq.doubleCorrector;
    const sw = kq.settingWheel;
    const swPivot = kq.switchLever.pivot;
    const swArm = dist(swPivot, sw.axis);
    const swRest = dirOf(swPivot, sw.axis);
    const dayc = kq.dayCorrector;
    const dayHub = dayc.hub;
    const fg = dc.finger;

    // Arm, corrector wheel (10) with its arbor and pinion (8), and the finger on the arbor: the arm turns about
    // the setting wheel's arbor (its driver moves with the switching lever), wheel and finger turn on the arm.
    const rocker = part('Double corrector, rocking arm', sw.axis, merged([
      paint(slab(ribbon([[0, 0], [dc.arm, 0]], t => 0.3 - 0.08 * t), dc.armY.bottom, dc.armY.top, 0.012), COLORS.steel),
      paint(slab(circle([0, 0], 0.32, 20), dc.armY.bottom, dc.armY.top, 0.012), COLORS.steel),
    ]).translate(-sw.axis[0], 0, -sw.axis[1]));
    const corrector = part('Double corrector (10) with pinion (8)', [dc.arm, 0], merged([
      paint(slab(gearOutline(dc.gear.teeth, dc.gear.tipR, dc.gear.rootR, 0), dc.y.bottom, dc.y.top, 0.012, [circle([0, 0], dc.arborR, 12)]), COLORS.gilt),
      paint(cylinder([0, 0], dc.arborR, dc.y.bottom, fg.y.bottom, 10), COLORS.steel),
      paint(slab(gearOutline(dc.pinion.teeth, dc.pinion.tipR, dc.pinion.rootR, 0), dc.pinionY.bottom, dc.pinionY.top, 0.01), COLORS.steel),
    ]), rocker);
    const fingerShape = bossedFinger(fg.boss, 0, fg.reach, fg.width / 2, fg.tipWidth / 2);
    const cFinger = part('Double corrector, date finger', [dc.arm, 0], merged([
      paint(slab(fingerShape, fg.y.bottom, fg.y.top, 0.012), COLORS.steel),
      paint(lathe([0, 0], [[0, fg.y.top], [0.1, fg.y.top], [0.08, fg.y.top + 0.03], [0, fg.y.top + 0.035]], 12), COLORS.steel),
    ]), rocker);

    // Date side: the finger turns clockwise about the corrector's arbor and meets a tab.
    const qs = sw.quickSetAxis;
    const dateAxis = polar(dc.arm, dc.dateAngle, qs);
    const fingerAt = (phi: number): P[] => fingerShape.map(p => place(p, phi, dateAxis));
    const tab = (j: number, f: number): P[] => tabOutline(TAB_PHASE + (j + f) * DATE_PITCH);
    const outward = dirOf([0, 0], dateAxis);
    const nearTab = Math.round((outward - TAB_PHASE) / DATE_PITCH);
    const tabsNear = [-3, -2, -1, 0, 1, 2, 3].map(j => nearTab + j);
    const fingerContact = firstContact(phi => tabsNear.some(j => overlaps(fingerAt(phi), tab(j, 0))), outward - rad(120), outward + rad(120), rad(0.25));
    const pushedTab = tabsNear.find(j => overlaps(fingerAt(fingerContact + rad(0.3)), tab(j, 0))) ?? nearTab;
    const fingerStops = new Float32Array(STOP_STEPS + 1);
    for (let i = 0; i <= STOP_STEPS; i++) {
      fingerStops[i] = firstContact(phi => overlaps(fingerAt(phi), tab(pushedTab, i / STOP_STEPS)), fingerContact - rad(2), fingerContact + rad(120)) - CONTACT_MARGIN;
    }
    // The finger leaves the tab zone at `fingerExit`; it meets the tab half a crown turn after the press began.
    let fingerExit = fingerContact;
    while (fingerExit < fingerContact + Math.PI && Math.max(...fingerAt(fingerExit).map(p => Math.hypot(...p))) > D.dateTeeth.tipR - 0.02) fingerExit += rad(1);
    // The longest swing onto either side starts on the other side. Phased for it, finger and day corrector
    // reach their tooth at the latest half a crown turn into a press, when the mechanism steps; from a
    // shorter swing they arrive early and wait at the tooth.
    const longestSwing = dc.moonAngle - dc.dateAngle;
    // Plan angle of the finger (about its arbor) when it is let go at the date side; in the arm's frame while held.
    const fingerRelease = fingerContact - Math.PI + longestSwing;
    const fingerHeld = fingerRelease - dc.dateAngle;

    yield;
    // Day corrector: three arms over a 24-tooth hub. It turns clockwise (growing plan angle) while the
    // corrector's pinion is in its hub.
    const dayArm = fingerOutline(dayc.reach, 0.48, 0.17, 0.11);
    const dayPeriod = TAU / dayc.arms;
    const dayArms = (d: number): P[] => Array.from({ length: dayc.arms }, (_, i) => dayArm.map(p => place(p, d + i * dayPeriod, dayc.pivot))).flat();
    const dayToStar = dirOf(dayc.pivot, [0, 0]);
    const starBase = Math.round((dayToStar + Math.PI - POINT_PHASE) / STAR_PITCH);
    const point = (j: number, g: number): P[] => pointOutline(POINT_PHASE + (starBase + j - g) * STAR_PITCH);
    const pointsNear = [-2, -1, 0, 1, 2];
    const clearOf = (d: number): boolean => !pointsNear.some(j => overlaps(dayArms(d), point(j, 0)));
    // First contact after a turn from a pose with the arms clear.
    let dayFrom = dayToStar + dayPeriod / 2;
    if (!clearOf(dayFrom)) dayFrom = dayToStar;
    const dayContact = firstContact(d => !clearOf(d), dayFrom, dayFrom + dayPeriod, rad(0.25));
    const pushedPoint = pointsNear.find(j => overlaps(dayArms(dayContact + rad(0.3)), point(j, 0))) ?? 0;
    const dayStops = new Float32Array(STOP_STEPS + 1);
    for (let i = 0; i <= STOP_STEPS; i++) {
      dayStops[i] = firstContact(d => overlaps(dayArms(d), point(pushedPoint, i / STOP_STEPS)), dayContact - rad(2), dayContact + dayPeriod) - CONTACT_MARGIN;
    }
    let dayExit = dayContact + rad(1);
    while (dayExit < dayContact + dayPeriod && !clearOf(dayExit)) dayExit += rad(0.5);
    const pinionRatio = dc.pinion.teeth / dayHub.teeth;
    // The star snaps on faster than the day corrector turns: the arm reaches its point well before the
    // step and waits there, so that it is out of the way when the next point comes round.
    const dayRest = dayContact - pinionRatio * (TAU * DAY_CONTACT_AT - longestSwing);
    const dayOutline: P[] = [];
    for (let i = 0; i < dayc.arms; i++) {
      const a = i * dayPeriod;
      dayOutline.push(...arc([0, 0], 0.5, a - dayPeriod + rad(21), a - rad(21), 6).slice(1, -1), ...dayArm.map(p => turn(p, a)));
    }
    const dayCorrector = part('Day corrector (3 arms, 24)', dayc.pivot, merged([
      paint(slab(dayOutline, dayc.y.bottom, dayc.y.top, 0.015, [circle([0, 0], 0.16, 12)]), COLORS.steel),
      paint(slab(gearOutline(dayHub.teeth, dayHub.tipR, dayHub.rootR, 0), dayc.hubY.bottom, dayc.hubY.top, 0.01, [circle([0, 0], 0.16, 12)]), COLORS.gilt),
    ]));
    const moonAxis = polar(dc.arm, dc.moonAngle, qs);
    const toHub = dirOf(moonAxis, dayc.pivot);
    const hubPitch = TAU / dayHub.teeth;

    // Arm angle and setting wheel as last seen; arm angle when free (position 2); finger and day corrector.
    const st = {
      first: true, lastSetting: 0, free: dc.quickSetRestAngle,
      released: false, fingerOffset: 0, pushed: false, fingerDev: 0, fingerLeave: 0, fingerBack: 1,
      meshed: false, day: dayRest, dayRef: 0, cRef: 0, dayPushed: false, dayLeave: 0, dayBack: 1, clamped: 0,
    };
    const toDate = dc.quickSetRestAngle - dc.dateAngle;
    const toMoon = dc.moonAngle - dc.quickSetRestAngle;
    const wrap = (a: number): number => a - Math.round(a / TAU) * TAU;
    // A driver (finger, day corrector) at plan angle `a` stays on the tooth it pushes while that tooth's step
    // (fraction f) is on its way, and waits at first contact until the step begins. Result in `clamped`;
    // returns whether this pass has pushed.
    const clampDriver = (a: number, period: number, contact: number, exit: number, stops: Float32Array, f: number, pushed: boolean): boolean => {
      st.clamped = a;
      const rel = a - contact - Math.round((a - contact) / period) * period;
      if (rel <= -rad(4) || rel >= exit - contact) return false;
      if (f > 0) pushed = true;
      if (rel > 0) {
        const stop = f > 0 ? sample(stops, f) : pushed ? Infinity : -CONTACT_MARGIN;
        st.clamped = Math.min(a, a - rel + (f > 0 ? stop - contact : stop));
      }
      return pushed;
    };
    return (s, fD, fM) => {
      const quick = quickSetWeight(s.crownPull);
      const setting = s.settingWheel;
      if (st.first) { st.first = false; st.lastSetting = setting; }
      const dS = setting - st.lastSetting;
      st.lastSetting = setting;
      // The arm rocks with the setting wheel (rotation.y grows when the crown turns towards 12) until it
      // reaches the date or the day-corrector side; held at rest by the switching lever outside position 2.
      if (quick >= 0.999) {
        if (dS > 0) st.free = Math.max(dc.dateAngle, st.free - dS);
        else if (dS < 0) st.free = Math.min(dc.moonAngle, st.free - dS);
      } else if (quick === 0) {
        st.free = dc.quickSetRestAngle;
      }
      const theta = dc.restAngle + (dc.quickSetRestAngle - dc.restAngle) * quick + (st.free - dc.quickSetRestAngle) * quick;
      // Pivot: the setting wheel's axis, carried by the switching lever.
      const sweep = swRest - switchLeverAngle(s.crownPull);
      rocker.position.set(swPivot[0] + swArm * Math.cos(sweep), 0, swPivot[1] + swArm * Math.sin(sweep));
      rocker.rotation.y = -theta;
      // Planet on the arm, as many teeth as the setting wheel: rotation.y = -2 theta - setting - PI keeps the mesh.
      const c = -2 * theta - setting - Math.PI;
      corrector.rotation.y = c + theta;

      // Finger: on the date side it follows the corrector by friction; leaving it, the arm's stop brings it
      // back to where it is held as the arm swings to rest.
      const atDate = quick >= 0.999 && st.free === dc.dateAngle;
      if (atDate && !st.released) st.fingerOffset = -(theta + fingerHeld + st.fingerDev) - c;
      if (!atDate && st.released) {
        st.fingerLeave = wrap(-(c + st.fingerOffset) - (theta + fingerHeld));
        st.fingerBack = 0;
      }
      st.released = atDate;
      let phi: number;
      if (atDate) {
        phi = -(c + st.fingerOffset);
        st.pushed = clampDriver(phi, TAU, fingerContact, fingerExit, fingerStops, fD, st.pushed);
        phi = st.clamped;
      } else {
        // How far the arm has come back from the date side since it left; it only grows.
        st.fingerBack = Math.max(st.fingerBack, clamp01((st.free - dc.dateAngle) / toDate));
        st.fingerDev = st.fingerLeave * (1 - st.fingerBack);
        phi = theta + fingerHeld + st.fingerDev;
        st.pushed = false;
      }
      cFinger.rotation.y = -phi + theta;

      // Day corrector: turned by the corrector's pinion while the arm stands on its side.
      const atMoon = quick >= 0.999 && st.free === dc.moonAngle;
      if (atMoon && !st.meshed) {
        // The hub rolls into mesh: a hub gap faces the pinion's tooth on the line of centres.
        const pinionTooth = toHub + Math.round((-c - toHub) / (TAU / dc.pinion.teeth)) * (TAU / dc.pinion.teeth);
        const hubTooth = meshedPhase(pinionTooth, dc.pinion.teeth, toHub, dayHub.teeth) - Math.PI / dayHub.teeth;
        const into = wrap(hubTooth - st.day);
        st.dayRef = st.day + into - Math.round(into / hubPitch) * hubPitch;
        st.cRef = c;
      }
      if (!atMoon && st.meshed) {
        const off = st.day - dayRest;
        st.dayLeave = off - Math.round(off / dayPeriod) * dayPeriod;
        st.dayBack = 0;
      }
      st.meshed = atMoon;
      // Unmeshed, it goes back to rest as the arm swings away (a third of a turn on from where it began).
      if (atMoon) st.day = st.dayRef + pinionRatio * (c - st.cRef);
      else {
        st.dayBack = Math.max(st.dayBack, clamp01((dc.moonAngle - st.free) / toMoon));
        st.day = dayRest + st.dayLeave * (1 - st.dayBack);
      }
      st.dayPushed = clampDriver(st.day, dayPeriod, dayContact, dayExit, dayStops, fM, st.dayPushed);
      dayCorrector.rotation.y = -st.clamped;
    };
  }

  yield;
  // ---- static meshes and the batch of moving parts
  const staticMesh = new THREE.Mesh(merged(statics), metal);
  staticMesh.name = 'Dial-side studs, jumper body, screws and settings';
  for (const g of plates) g.deleteAttribute('uv');
  const plateMesh = new THREE.Mesh(merged(plates), rhodium);
  plateMesh.name = 'Minute-train bridge, yoke and jumper plates, dial support';
  const rubyMesh = new THREE.Mesh(merged(jewels.map(g => { const n = g.toNonIndexed(); n.deleteAttribute('uv'); return n; })), ruby);
  rubyMesh.name = 'Jewels (dial side)';
  let vertexCount = 0;
  for (const p of moving) vertexCount += p.geo.attributes.position.count;
  const batch = new THREE.BatchedMesh(moving.length, vertexCount, 0, metal);
  batch.name = 'Dial-side moving parts';
  batch.sortObjects = false;
  batch.perObjectFrustumCulled = false;
  batch.frustumCulled = false;
  for (const p of moving) {
    p.id = batch.addInstance(batch.addGeometry(p.geo));
    p.geo.dispose();
  }
  // Only non-metal takes shadows (scene.ts) and none lies under these parts: they cast none, which spares the shadow pass.
  for (const mesh of [staticMesh, plateMesh, rubyMesh, batch]) mesh.userData.lunaShadow = false;
  group.add(staticMesh, plateMesh, rubyMesh, batch);
  const local = new THREE.Matrix4();
  const syncBatch = (): void => {
    for (let i = 0; i < moving.length; i++) {
      const p = moving[i];
      const d = p.driver;
      d.updateMatrix();
      if (d.parent === group) batch.setMatrixAt(p.id, d.matrix);
      else batch.setMatrixAt(p.id, local.multiplyMatrices(d.parent!.matrix, d.matrix));
    }
  };

  // ---- motion
  const update = (s: MovementState): void => {
    const minutes = s.minutes;
    hour.rotation.y = hourWheelAngle(minutes);
    cannon.rotation.y = cannonPinionAngle(minutes);
    minuteWheel.rotation.y = minuteWheelAngle(minutes);
    inter.rotation.y = intermediateDateWheelAngle(minutes);

    const since = minutesFromMidnight(s.minuteOfDay);
    const relaxed = relaxedFingerAngle(s.minuteOfDay);
    cal.rotation.y = calendarWheelAngle(s.minuteOfDay);

    const fD = stepFraction(s.date);
    const fM = stepFraction(s.moon);
    // Before midnight the release yoke holds the finger just short of its tooth (when this midnight still
    // switches); just after midnight the finger follows tooth and point while their jump is on its way.
    let psi = relaxed;
    if (since < 0) {
      if (s.armed && relaxed > latch) psi = latch;
    } else if (since < kin.exitMinutes && (fD > 0 || fM > 0)) {
      const dStop = fD > 0 ? sample(kin.dateStops, fD) : Infinity;
      const mStop = fM > 0 ? sample(kin.moonStops, fM) : Infinity;
      psi = Math.min(relaxed, dStop, mStop);
    }
    finger.rotation.y = -(CAL_DIR + psi);

    // Release yoke: lifted by the wheel's stud over the last minutes before midnight, back by 00:10.
    let lift = 0;
    if (since >= ry.liftFrom && since < ry.release) lift = (since - ry.liftFrom) / (ry.release - ry.liftFrom);
    else if (since >= ry.release && since < ry.dropBy) lift = 1 - (since - ry.release) / (ry.dropBy - ry.release);
    if (!s.armed && relaxed > latch - rad(1) && relaxed < latch + catchBand) lift = 1;
    yokeDriver.rotation.y = ry.yoke.lift * lift;

    ring.rotation.y = dateRingAngle(s.date);
    star.rotation.y = starWheelAngle(s.moon);
    moonRim.rotation.y = moonDiscAngle(s.moon);
    dateArm.rotation.y = kin.dateJumper.sign * sample(kin.dateJumper.lift, fD);
    starArm.rotation.y = kin.starJumper.sign * sample(kin.starJumper.lift, fM);
    correctorMotion(s, fD, fM);
    syncBatch();
  };

  return { group, update };
}
