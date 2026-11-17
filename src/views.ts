// Where the camera stands, what it has to show and where it must not go.
// Plain numbers and arithmetic, free of three.js, so the text UI (ui.ts,
// steps.ts) can load, and fall back to text, without the 3D chunk.
//
// Axes as in watch/dimensions.ts: the dial faces +Y, twelve o'clock points to
// -Z, the crown sits at +X. Lengths are millimetres.
import {
  APERTURE_CENTER, APERTURE_R, BEZEL_TOP_Y, CASE_BOTTOM_Y, CASE_R, CROWN_BASE_X, CROWN_TRAVEL, CROWN_Y,
  DATE_CENTER_X, DATE_W, DIAL_Y, GROUND_Y, LUG_INNER_X, LUG_TIP_Z,
} from './watch/dimensions';

export type Vec3 = [number, number, number];

/** How far the camera may be turned and moved by hand once it has arrived. */
export interface OrbitLimits {
  /** Degrees around the vertical axis: 0 looks from six o'clock, 90 from the crown side. */
  azimuth?: [number, number];
  /** Degrees from straight above (0) to straight below (180). */
  polar?: [number, number];
}

export interface CameraPose {
  pos: Vec3;
  target: Vec3;
  /** Points that must stay inside the free part of the stage, whatever its
   * shape. The lens is chosen to fit them; the viewpoint stays as given, so
   * the perspective of a pose is the same on every screen. Without a subject
   * a square 38° view around the target is fitted instead. */
  subject?: readonly Vec3[];
  /** Share of the free rectangle left empty on every side of the subject. */
  margin?: number;
  limits?: OrbitLimits;
  /** The target may be moved by hand (panning) this far (mm) within its own level. */
  pan?: number;
  /** Viewpoint used instead when the free part of the stage is taller than wide. */
  portrait?: { pos: Vec3; target: Vec3 };
}

// ── Subjects ────────────────────────────────────────────────────────────────

const ring = (radius: number, y: number, cx = 0, cz = 0, count = 16): Vec3[] =>
  Array.from({ length: count }, (_, i) => {
    const a = i / count * Math.PI * 2;
    return [cx + radius * Math.cos(a), y, cz + radius * Math.sin(a)] as Vec3;
  });

const box = (min: Vec3, max: Vec3): Vec3[] =>
  [0, 1, 2, 3, 4, 5, 6, 7].map(i => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]] as Vec3);

/** Crown head: its radius, and how far its cap reaches in position 0 and pulled to position 3. */
const CROWN_R = 4;
const CROWN_TIP = CROWN_BASE_X + 0.9;
const CROWN_TIP_PULLED = CROWN_TIP + 3 * CROWN_TRAVEL;
/** Outer edge of the horns at their tips, and their lowest point: they end just below the caseback. */
const LUG_OUTER_X = LUG_INNER_X + 2.8;
const LUG_BOTTOM_Y = -4.9;

const caseBody: Vec3[] = [...ring(CASE_R, BEZEL_TOP_Y + 1), ...ring(CASE_R, CASE_BOTTOM_Y)];
const lugs: Vec3[] = box([-LUG_OUTER_X, LUG_BOTTOM_Y, -LUG_TIP_Z], [LUG_OUTER_X, 2.6, LUG_TIP_Z]);
const crownAt = (tip: number): Vec3[] => box([CASE_R, CROWN_Y - CROWN_R, -CROWN_R], [tip, CROWN_Y + CROWN_R, CROWN_R]);

/** Outline of the closed bracelet seen from the side, as [y, half depth]; the
 * clasp rests on the floor. A little wider than the links themselves, which
 * reach LINK_DEPTH inwards from it. */
const LOOP: Array<[number, number]> = [
  [0.5, 23.3], [-8, 27.4], [-16, 30.3], [-26, 32.3], [-34, 32.6], [-42, 30.9], [-50, 24.9], [GROUND_Y, 16.6],
];
const loop: Vec3[] = LOOP.flatMap(([y, z]) => [-10, 10].flatMap(x => [[x, y, -z], [x, y, z]] as Vec3[]));
const LINK_DEPTH = 3.5;
/** Half the width of the bracelet loop (21 mm at the lugs), a little generous. */
const LOOP_HALF_X = 10;

/** The movement seen from the front: the dial-side works lie between the plate (y 0.4) and the dial seat (1.85). */
const WORKS_TOP = DIAL_Y - 0.75;
const WORKS_BOTTOM = -1.2;
/** Underside of the middle case around the opened back. */
const UNDERSIDE_Y = -4;

const SUBJECT = {
  /** Everything: case, crown and the closed bracelet. */
  watch: [...caseBody, ...lugs, ...crownAt(CROWN_TIP), ...loop],
  /** The watch head with its horns; the bracelet may leave the picture. */
  head: [...caseBody, ...lugs, ...crownAt(CROWN_TIP)],
  /** Bezel and crown seen from above, with room for the crown pulled out. */
  dial: [...ring(CASE_R, BEZEL_TOP_Y), ...crownAt(CROWN_TIP_PULLED)],
  /** The crown in every position and the flank it sits on. */
  crown: box([CASE_R - 3.5, CROWN_Y - 6, -7.2], [CROWN_TIP_PULLED + 1, CROWN_Y + 6, 7.2]),
  /** From the date window out to the pulled crown. */
  date: box([DATE_CENTER_X - DATE_W / 2 - 2.2, CROWN_Y - CROWN_R, -5.2], [CROWN_TIP_PULLED, BEZEL_TOP_Y, 5.2]),
  /** The moon aperture with the numerals around it. */
  moon: ring(APERTURE_R + 2.6, DIAL_Y, 0, APERTURE_CENTER),
  /** The watch opened from the front: the movement inside the case ring. */
  works: [...ring(CASE_R, BEZEL_TOP_Y - 1.4), ...ring(CASE_R - 1.5, WORKS_BOTTOM)],
  /** The watch opened from the back: the case's underside round the rotor side. */
  back: ring(CASE_R, UNDERSIDE_Y),
} satisfies Record<string, Vec3[]>;

// ── Poses ───────────────────────────────────────────────────────────────────

/** A viewpoint `distance` away from `target`: azimuth 0 looks from six o'clock,
 * 90 from the crown side; elevation 90 looks straight down on the dial. */
function from(target: Vec3, azimuth: number, elevation: number, distance: number): Vec3 {
  const az = azimuth * Math.PI / 180;
  const el = elevation * Math.PI / 180;
  const round = (v: number): number => Math.round(v * 100) / 100;
  return [
    round(target[0] + distance * Math.cos(el) * Math.sin(az)),
    round(target[1] + distance * Math.sin(el)),
    round(target[2] + distance * Math.cos(el) * Math.cos(az)),
  ];
}

// Every pose is taken with a long lens (the subject spans 15 to 20 degrees),
// like a product photograph: little perspective distortion, and parts lifted
// out of the opened watch leave through the top of the picture instead of
// passing the camera.

const WATCH_CENTRE: Vec3 = [1.5, -24, 0];
const HEAD_CENTRE: Vec3 = [1, 0.4, 0];
const DIAL_CENTRE: Vec3 = [1.6, DIAL_Y, 0];
const CROWN_CENTRE: Vec3 = [CROWN_TIP + 0.85, CROWN_Y, 0];
const DATE_CENTRE: Vec3 = [(DATE_CENTER_X + CROWN_TIP_PULLED) / 2 - 0.6, 1.2, 0];
const MOON_CENTRE: Vec3 = [0, DIAL_Y, APERTURE_CENTER];
const WORKS_CENTRE: Vec3 = [0, WORKS_TOP - 0.6, 0.6];
/** The rotor side: oscillating weight (y -3.55) up to the plate's back face (-1.5). */
const BACK_CENTRE: Vec3 = [0, -3.2, 0];

/** The three stage views. */
export const VIEWS = {
  /** Hero three-quarter shot of the whole watch standing on its clasp. */
  overview: { pos: from(WATCH_CENTRE, 31, 54, 250), target: WATCH_CENTRE, subject: SUBJECT.watch, margin: 0.03 },
  /** The dial from above, tilted a few degrees towards the viewer. */
  dial: { pos: from(DIAL_CENTRE, 0, 84, 150), target: DIAL_CENTRE, subject: SUBJECT.dial, margin: 0.03 },
  /** Crown macro from the crown side; the camera stays on that side. */
  crown: {
    pos: from(CROWN_CENTRE, 50, 26, 78), target: CROWN_CENTRE, subject: SUBJECT.crown, margin: 0,
    limits: { azimuth: [14, 166], polar: [18, 148] },
  },
} satisfies Record<string, CameraPose>;
export type ViewName = keyof typeof VIEWS;

/** Cameras of the guide: what each step works on, close enough to read. */
export const STEP_VIEWS = {
  /** Steps 1 and 2 (unscrew, wind): the crown macro. */
  crown: VIEWS.crown,
  /** Steps 3 and 6 (hands): the dial from above with the crown in the picture. */
  dial: VIEWS.dial,
  /** Step 4 (date): the date window and the crown that sets it. */
  date: {
    pos: from(DATE_CENTRE, 16, 54, 96), target: DATE_CENTRE, subject: SUBJECT.date, margin: 0.02,
    limits: { azimuth: [-75, 150], polar: [8, 80] },
  },
  /** Step 5 (moon): the moon aperture. */
  moon: {
    pos: from(MOON_CENTRE, 7, 63, 96), target: MOON_CENTRE, subject: SUBJECT.moon, margin: 0,
    limits: { polar: [4, 80] },
  },
  /** Step 7 (final check): the watch head as a three-quarter portrait, dial and crown readable. */
  hero: { pos: from(HEAD_CENTRE, 29, 52, 170), target: HEAD_CENTRE, subject: SUBJECT.head, margin: 0.04 },
} satisfies Record<string, CameraPose>;

/** The watch opened from the front: into the movement from the six o'clock side.
 * A narrow stage looks down more steeply, so the round works fill it. */
export const WORKS_VIEW_PORTRAIT: CameraPose = {
  pos: from(WORKS_CENTRE, 12, 66, 150), target: WORKS_CENTRE, subject: SUBJECT.works, margin: 0.03,
  limits: { polar: [4, 82] },
};
/** In the opened views the target can be moved over the movement, so the closest zoom reaches the
 * calendar finger, the jumpers, the keyless works and the balance. */
const MOVEMENT_PAN = 9;
export const WORKS_VIEW: CameraPose = {
  pos: from(WORKS_CENTRE, 16, 54, 150), target: WORKS_CENTRE, subject: SUBJECT.works, margin: 0.03,
  limits: { polar: [4, 82] }, pan: MOVEMENT_PAN,
  portrait: { pos: WORKS_VIEW_PORTRAIT.pos, target: WORKS_VIEW_PORTRAIT.target },
};

/** The watch opened from the back, seen from below and from the nine o'clock side, where the loop of
 * the bracelet is open: the crown lies at the foot of the picture. A narrow stage looks up more
 * steeply. The camera stays below the watch; with the caseback off it may also come in under the
 * case, inside the loop (keep-out 'back'). Towards twelve or six the bracelet fills the picture, so the
 * camera stays on the nine o'clock side. */
const BACK_LIMITS: OrbitLimits = { azimuth: [-150, -30], polar: [100, 165] };
export const BACK_VIEW_PORTRAIT: CameraPose = {
  pos: from(BACK_CENTRE, -90, -72, 150), target: BACK_CENTRE, subject: SUBJECT.back, margin: 0.03,
  limits: BACK_LIMITS,
};
export const BACK_VIEW: CameraPose = {
  pos: from(BACK_CENTRE, -90, -62, 150), target: BACK_CENTRE, subject: SUBJECT.back, margin: 0.03,
  limits: BACK_LIMITS, pan: MOVEMENT_PAN,
  portrait: { pos: BACK_VIEW_PORTRAIT.pos, target: BACK_VIEW_PORTRAIT.target },
};

// ── Lens ────────────────────────────────────────────────────────────────────

/** What a pose needs to show: half extents around its optical axis, as tangents. */
export interface Fit { x: number; y: number; margin: number }

export interface Rect { x: number; y: number; width: number; height: number }

/** Half angle of the square view fitted when a pose names no subject. */
const PLAIN_HALF_ANGLE = 19 * Math.PI / 180;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** The viewpoint a pose uses on a stage of the given shape. */
export function viewpoint(pose: CameraPose, portrait: boolean): { pos: Vec3; target: Vec3 } {
  return portrait && pose.portrait ? pose.portrait : pose;
}

/** How large the subject of a pose appears from `pos` looking at `target`. */
export function fitOf(pose: CameraPose, pos: Vec3 = pose.pos, target: Vec3 = pose.target): Fit {
  if (!pose.subject?.length) {
    const plain = Math.tan(PLAIN_HALF_ANGLE);
    return { x: plain, y: plain, margin: pose.margin ?? 0 };
  }
  // The camera's axes, as three.js derives them for an upright camera.
  const back = unit(sub(pos, target));
  let right = cross([0, 1, 0], back);
  if (Math.hypot(...right) < 1e-6) right = [1, 0, 0]; // straight above or below: twelve o'clock is up
  right = unit(right);
  const up = cross(back, right);
  let x = 0;
  let y = 0;
  for (const point of pose.subject) {
    const v = sub(point, pos);
    const depth = -dot(v, back);
    if (depth < 1) continue;
    x = Math.max(x, Math.abs(dot(v, right)) / depth);
    y = Math.max(y, Math.abs(dot(v, up)) / depth);
  }
  return { x: Math.max(x, 1e-3), y: Math.max(y, 1e-3), margin: pose.margin ?? 0.04 };
}

/** Widest vertical field of view the lens may take, in degrees. */
const MAX_FOV = 100;

/** The lens for a canvas of which only `safe` (in canvas pixels) is free: the
 * vertical field of view in degrees, and how far the optical centre lies from
 * the canvas centre, in pixels to the right and downwards. `fit` then fills
 * the free rectangle in at least one direction and stays inside it. */
export function lensFor(fit: Fit, canvas: { width: number; height: number }, safe: Rect): { fov: number; offsetX: number; offsetY: number } {
  const free = 1 - 2 * fit.margin;
  // Pixels per unit of tangent.
  const scale = Math.max(1e-3, Math.min(safe.width * free / (2 * fit.x), safe.height * free / (2 * fit.y)));
  const fov = Math.min(MAX_FOV, 2 * Math.atan(canvas.height / (2 * scale)) * 180 / Math.PI);
  return {
    fov,
    offsetX: safe.x + safe.width / 2 - canvas.width / 2,
    offsetY: safe.y + safe.height / 2 - canvas.height / 2,
  };
}

// ── Keep-out ────────────────────────────────────────────────────────────────

/** Clearance between the camera and the watch; the near plane (1 mm) and its
 * corners stay well outside the steel. */
const CLEARANCE = 3;

type Solid =
  | { min: Vec3; max: Vec3 }
  /** Upright cylinder around the dial axis. */
  | { radius: number; bottom: number; top: number };

/** The watch head as a few simple solids, each grown by the clearance: case, horns and crown (in any position). */
const HEAD: Solid[] = [
  { radius: CASE_R + CLEARANCE, bottom: CASE_BOTTOM_Y - CLEARANCE, top: BEZEL_TOP_Y + 1 + CLEARANCE },
  { min: [-LUG_OUTER_X - CLEARANCE, LUG_BOTTOM_Y - CLEARANCE, -LUG_TIP_Z - CLEARANCE], max: [LUG_OUTER_X + CLEARANCE, 2.6 + CLEARANCE, LUG_TIP_Z + CLEARANCE] },
  { min: [CASE_R - 3, CROWN_Y - CROWN_R - CLEARANCE, -CROWN_R - CLEARANCE], max: [CROWN_TIP_PULLED + CLEARANCE, CROWN_Y + CROWN_R + CLEARANCE, CROWN_R + CLEARANCE] },
];

/** The bracelet's links only, as slices of the loop about 2 mm high, each covering the links of
 * both halves (twelve and six o'clock) at that height, and the clasp. */
function braceletLinks(): Solid[] {
  const solids: Solid[] = [];
  const x = LOOP_HALF_X + CLEARANCE;
  for (let i = 0; i + 1 < LOOP.length; i++) {
    const [y0, z0] = LOOP[i];
    const [y1, z1] = LOOP[i + 1];
    const steps = Math.ceil((y0 - y1) / 2);
    for (let k = 0; k < steps; k++) {
      const ya = y0 + (y1 - y0) * k / steps;
      const yb = y0 + (y1 - y0) * (k + 1) / steps;
      const za = z0 + (z1 - z0) * k / steps;
      const zb = z0 + (z1 - z0) * (k + 1) / steps;
      const inner = Math.min(za, zb) - LINK_DEPTH - CLEARANCE;
      const outer = Math.max(za, zb) + CLEARANCE;
      for (const side of [-1, 1]) {
        const [zMin, zMax] = side > 0 ? [inner, outer] : [-outer, -inner];
        solids.push({ min: [-x, yb - CLEARANCE, zMin], max: [x, ya + CLEARANCE, zMax] });
      }
    }
  }
  const clasp = LOOP[LOOP.length - 1][1] + CLEARANCE;
  solids.push({ min: [-x, GROUND_Y - CLEARANCE, -clasp], max: [x, GROUND_Y + LINK_DEPTH + CLEARANCE, clasp] });
  return solids;
}

/** What the camera must stay out of. Closed, the bracelet counts with the space it encloses: nothing
 * there is worth seeing. Opened from the back, the camera may look up from inside that loop. */
export type KeepOut = 'closed' | 'back';

const KEEP_OUT: Record<KeepOut, Solid[]> = {
  closed: [
    ...HEAD,
    { min: [-LOOP_HALF_X - CLEARANCE, GROUND_Y - CLEARANCE, -32.6 - CLEARANCE], max: [LOOP_HALF_X + CLEARANCE, 0.5 + CLEARANCE, 32.6 + CLEARANCE] },
  ],
  back: [...HEAD, ...braceletLinks()],
};

/** The stretch [enter, leave] of the ray origin + t * dir that lies inside a solid, or null. */
function inside(solid: Solid, origin: Vec3, dir: Vec3): [number, number] | null {
  let enter = -Infinity;
  let leave = Infinity;
  const slab = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) return o > lo && o < hi;
    const a = (lo - o) / d;
    const b = (hi - o) / d;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    return enter < leave;
  };
  if ('radius' in solid) {
    if (!slab(origin[1], dir[1], solid.bottom, solid.top)) return null;
    const a = dir[0] * dir[0] + dir[2] * dir[2];
    const b = origin[0] * dir[0] + origin[2] * dir[2];
    const c = origin[0] * origin[0] + origin[2] * origin[2] - solid.radius * solid.radius;
    if (a < 1e-12) return c < 0 ? [enter, leave] : null;
    const disc = b * b - a * c;
    if (disc <= 0) return null;
    const root = Math.sqrt(disc);
    enter = Math.max(enter, (-b - root) / a);
    leave = Math.min(leave, (-b + root) / a);
  } else {
    for (let axis = 0; axis < 3; axis++) {
      if (!slab(origin[axis], dir[axis], solid.min[axis], solid.max[axis])) return null;
    }
  }
  return enter < leave ? [enter, leave] : null;
}

/** The distance from `target` at which a camera looking along -`dir` (a unit
 * vector from the target towards the camera) may stand: `distance` itself, or
 * the next larger one outside the watch. */
export function clearDistance(target: Vec3, dir: Vec3, distance: number, keepOut: KeepOut = 'closed'): number {
  const solids = KEEP_OUT[keepOut];
  let d = distance;
  for (let pass = 0; pass < solids.length; pass++) {
    let moved = false;
    for (const solid of solids) {
      const span = inside(solid, target, dir);
      if (span && d > span[0] && d < span[1]) { d = span[1]; moved = true; }
    }
    if (!moved) break;
  }
  return d;
}
