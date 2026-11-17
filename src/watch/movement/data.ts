// Layout of the movement inside the study model: every position, height, tooth
// count and phase the three movement modules (dial-side.ts, keyless.ts,
// back-side.ts) build from, and the pure functions that turn the watch state
// into the angles of the parts. Numbers that only shape a part's look (bevels,
// facets, finishes) stay in the module that draws it.
// No three.js here: the module is plain data and arithmetic.
//
// Frame (dimensions.ts): millimetres, y up (the dial faces +y), 12 o'clock at
// -z, 3 o'clock (crown) at +x. A plan point is [x, z]. A plan angle is
// atan2(z, x): 0 at 3 o'clock, growing towards 6 o'clock, i.e. clockwise seen
// from the dial. Part angles are `rotation.y` values: a positive rotation.y
// turns a part counter-clockwise seen from the dial, so a point at local plan
// angle a ends up at plan angle a - rotation.y.
//
// Gears are given by tooth count and module; where two wheels mesh, their
// axes are derived from the pitch radii, so they sit exactly r1 + r2 apart.
// Axes called "measured" come from the maker's drawings (scale from the 7.00 mm
// moon axis and the 26.00 mm overall diameter); everything hidden is laid out
// here so that it meshes and clears its neighbours.

import {
  CASEBACK_INNER_Y, CASE_BOTTOM_Y, CROWN_Y, DATE_POSITIONS, DATE_RING_INNER_R, DATE_RING_OUTER_R, DATE_RING_Y, DIAL_Y,
  MOON_DISC_CENTER_Z, MOON_DISC_R, MOON_DISC_STEPS, MOON_DISC_Y,
} from '../dimensions';

export const TAU = Math.PI * 2;
const deg = (d: number): number => d * Math.PI / 180;

// ── Watch state ──────────────────────────────────────────────────────────────

/** Everything the movement draws, read once per frame from WatchModel / Mechanism. */
export interface MovementState {
  /** Mechanism.minutes: movement time on a continuous axis (minutes). */
  minutes: number;
  /** Mechanism.minuteOfDay, 0..1440. */
  minuteOfDay: number;
  /** Date as shown, 1..31, fractional while the ring jumps (WatchModel's shown date). */
  date: number;
  /** Moon position as shown, in daily steps, fractional while the disc jumps. */
  moon: number;
  /** WatchModel.crownPull: 0 screwed down, 1 winding, 2 quick-set, 3 hand setting. */
  crownPull: number;
  /** WatchModel.crownSpin: crown rotation in radians; decreasing = turned towards 12 o'clock. */
  crownSpin: number;
  /** WatchModel.displaySeconds: grows only while the balance runs. */
  seconds: number;
  /** WatchModel.running. */
  running: boolean;
  /** Oscillating weight angle in radians (rotation.y), driven by the integrator. */
  rotor: number;
  /** Mechanism.armed: the coming midnight will still switch the calendar. */
  armed: boolean;
  /** Setting wheel turn (rotation.y in the watch frame), written by keyless.update() for dial-side.ts. */
  settingWheel: number;
  /** Seconds since the previous frame. */
  dt: number;
}

export function createMovementState(): MovementState {
  return { minutes: 0, minuteOfDay: 0, date: 1, moon: 0, crownPull: 0, crownSpin: 0, seconds: 0, running: false, rotor: 0, armed: true, settingWheel: 0, dt: 0 };
}

// ── Geometry helpers (module load only) ─────────────────────────────────────

export type Plan = readonly [x: number, z: number];

/** A vertical extent: lower and upper face of a part. */
export interface Span { readonly bottom: number; readonly top: number }
const span = (bottom: number, top: number): Span => ({ bottom, top });

export interface Gear {
  readonly teeth: number;
  readonly module: number;
  readonly pitchR: number;
  readonly tipR: number;
  readonly rootR: number;
}

/** Watch-type gearing: addendum 1.0 m on wheels (1.1 m on pinions), root 1.25 m. */
export function gearOf(teeth: number, module: number, addendum = 1, dedendum = 1.25): Gear {
  const pitchR = teeth * module / 2;
  return { teeth, module, pitchR, tipR: pitchR + addendum * module, rootR: pitchR - dedendum * module };
}

export const planAngle = (p: Plan): number => Math.atan2(p[1], p[0]);
export const planDistance = (a: Plan, b: Plan): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const direction = (from: Plan, to: Plan): number => Math.atan2(to[1] - from[1], to[0] - from[0]);
const along = (from: Plan, angle: number, distance: number): Plan =>
  [from[0] + Math.cos(angle) * distance, from[1] + Math.sin(angle) * distance];

/** The point at distance ra from a and rb from b; side +1 or -1 picks one of the two. */
function meshPoint(a: Plan, ra: number, b: Plan, rb: number, side: 1 | -1): Plan {
  const d = planDistance(a, b);
  const t = (ra * ra - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ra * ra - t * t));
  const ux = (b[0] - a[0]) / d;
  const uz = (b[1] - a[1]) / d;
  return [a[0] + ux * t - side * uz * h, a[1] + uz * t + side * ux * h];
}

const round = (p: Plan): Plan => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];

// ── Frame and vertical stack ────────────────────────────────────────────────

/** Mirrors PLATE_THICKNESS in dial.ts. */
export const DIAL_PLATE_THICKNESS = 0.4;
/** Underside of the dial = the movement's dial seat (top of the dial support ring). */
export const DIAL_SEAT_Y = DIAL_Y - DIAL_PLATE_THICKNESS;
/** Maker's figures: overall height 5.40, case fitting Ø25.60, overall Ø26.00. */
export const MOVEMENT_HEIGHT = 5.4;
export const MOVEMENT_R = 12.8;
export const MOVEMENT_FLANGE_R = 13.0;
/** The moon-phase calibre is its date-only base plus a 0.80 mm calendar module. */
export const CALENDAR_MODULE_HEIGHT = 0.8;
/** Dial seat of the base movement: top of the main plate's rim, foot of the dial support ring. */
export const BASE_SEAT_Y = DIAL_SEAT_Y - CALENDAR_MODULE_HEIGHT;
/** Case-fitting flange: 1.60 to 2.00 mm below the dial seat (maker's frame drawing). */
export const FLANGE = { innerR: MOVEMENT_R, outerR: MOVEMENT_FLANGE_R, y: span(DIAL_SEAT_Y - 2.0, DIAL_SEAT_Y - 1.6) } as const;
/** Back face of the movement body (top of the automatic framework), 4.30 below the dial seat. */
export const BODY_BACK_Y = DIAL_SEAT_Y - 4.3;
/** Lowest point of the oscillating weight. */
export const ROTOR_BOTTOM_Y = DIAL_SEAT_Y - MOVEMENT_HEIGHT;
/** Between the oscillating weight and the caseback's inner face (dimensions.ts); the maker asks for 0.35–0.55. */
export const ROTOR_CASEBACK_GAP = ROTOR_BOTTOM_Y - CASEBACK_INNER_Y;
export const CASEBACK_THICKNESS = CASEBACK_INNER_Y - CASE_BOTTOM_Y;
/** Where the calibre has its stem axis (2.60 below the dial seat); the model keeps the crown at CROWN_Y. */
export const CALIBRE_STEM_Y = DIAL_SEAT_Y - 2.6;
export const STEM_Y = CROWN_Y;
/** Real stem travel for positions 1, 2, 3 (0.30 + 0.50); the crown itself moves CROWN_TRAVEL per step. */
export const STEM_TRAVEL = [0, 0.3, 0.8] as const;

/** Main plate. Its dial face carries motion works and keyless works; its back face the bridges. */
export const PLATE = {
  name: 'Werkplatte',
  r: MOVEMENT_R,
  dialFaceY: 0.4,
  backFaceY: -1.5,
  /** Raised rim on the dial side, up to the base dial seat; the dial support ring stands on it. */
  rim: { innerR: 11.95, top: BASE_SEAT_Y },
  flange: FLANGE,
  /** Bore for the stem through the plate's edge at +x. */
  stemBoreR: 0.55,
  /** Pocket on the dial side for setting lever, yoke and their jumper. */
  keylessPocket: {
    outline: [[6.2, -7.3], [10.6, -7.5], [12.2, -5.0], [12.4, 1.4], [10.2, 2.0], [7.9, 1.9], [6.9, 1.75], [5.8, 1.25], [5.5, -1.4], [6.0, -4.6]] as readonly Plan[],
    floorY: -0.45,
  },
  /** Slot through the plate along the stem: sliding and winding pinion reach the crown wheel on the back. */
  stemChannel: { fromX: 7.6, toX: 11.1, halfWidth: 1.15 },
  /** The stem bore runs on outwards from the channel as a slot of this half width, below the keyless pocket. */
  stemSlotHalf: 0.55,
  /** Pockets milled into the back face: under the going train and the escapement up to `trainTop`
   * (shaped by the pallet bridge's pocket outline and circles round the wheels), and for the barrel. */
  trainPocketTop: -0.7,
  barrelPocket: { teethR: 5.12, drumR: 4.82, drumTop: 0 },
} as const;

// ── Gear modules shared by meshing pairs ───────────────────────────────────

/** Star-wheel pinion (28) and moon wheel (118) on the 7.00 mm centre distance of the dial drawing. */
export const MOON_MODULE = 2 * MOON_DISC_CENTER_Z / (28 + 118);
/** Motion works (cannon pinion 10, minute wheel 30/8, hour wheel 32: 12 h per turn) and setting wheels. */
export const MOTION_MODULE = 0.18;
/** 24-hour calendar wheel and the pinion of the intermediate date wheel. */
export const CALENDAR_MODULE = 0.08;

// ── Dial side: motion works and calendar ────────────────────────────────────

/** Measured on the maker's dial-side top view (±0.1): 24-hour calendar wheel. */
const CALENDAR_WHEEL_AXIS: Plan = [-5.16, -3.73];
/** Setting wheel, on the stem line just inside the sliding pinion (owner's drawing, dial view: [7.13, -0.06]). */
const SETTING_WHEEL_AXIS: Plan = [7.1, 0];

const hourWheelGear = gearOf(32, MOTION_MODULE);
const cannonGear = gearOf(10, MOTION_MODULE, 1.1, 1.3);
const minuteWheelGear = gearOf(30, MOTION_MODULE);
const minutePinionGear = gearOf(8, MOTION_MODULE, 1.1, 1.3);
const settingWheelGear = gearOf(10, MOTION_MODULE, 1.1, 1.3);
const intermediateWheelGear = gearOf(16, MOTION_MODULE);
const intermediatePinionGear = gearOf(16, CALENDAR_MODULE, 1.1, 1.3);
const calendarWheelGear = gearOf(64, CALENDAR_MODULE);

const MINUTE_WHEEL_AXIS = round(meshPoint([0, 0], cannonGear.pitchR + minuteWheelGear.pitchR,
  SETTING_WHEEL_AXIS, settingWheelGear.pitchR + minuteWheelGear.pitchR, -1));
const INTERMEDIATE_AXIS = round(meshPoint([0, 0], hourWheelGear.pitchR + intermediateWheelGear.pitchR,
  CALENDAR_WHEEL_AXIS, calendarWheelGear.pitchR + intermediatePinionGear.pitchR, 1));

/** The date ring's 31 internal teeth hang in this band, inside the white ring of dial.ts. */
const DATE_TEETH_Y = span(DATE_RING_Y - 0.13, DATE_RING_Y - 0.01);
const DATE_TEETH_TIP_R = 8.25;
/** Star wheel, moon finger, day corrector and the star arm of the double jumper. */
const STAR_Y = span(1.33, 1.45);
/** Release yoke: pivot on the maintaining plate, its centre line tangent to a circle about the calendar
 * wheel's axis (its edge clear of the hub's catch); a short hook at its end reaches in to `beakTipR`. */
const RELEASE_YOKE_PIVOT: Plan = [-7.7, -6.1];
const RELEASE_BEAK_R = 1.55;
const RELEASE_BEAK: Plan = round(along(CALENDAR_WHEEL_AXIS, direction(CALENDAR_WHEEL_AXIS, RELEASE_YOKE_PIVOT)
  + Math.acos(RELEASE_BEAK_R / planDistance(CALENDAR_WHEEL_AXIS, RELEASE_YOKE_PIVOT)), RELEASE_BEAK_R));
/** Measured (±0.3): gaps that the double jumper's beaks rest in. */
const DATE_JUMPER_BEAK: Plan = [-7.95, 2.9];
const STAR_JUMPER_BEAK: Plan = [-4.25, 0.25];

// The calendar was solved as one mechanism in plan space (dial-side.ts): finger
// reaches and angles, tooth and point phases and the jumper arms below make the
// date finger come to rest on a tab flank about 21:35 and the moon finger on a
// star point a hair later; at midnight the sprung finger snaps forward, pushes
// ring and star past their jumpers' crests and leaves both wheels by 01:25
// without touching the next tab or point. Tooth and point phases are therefore
// given relative to the calendar wheel's direction from the centre.
const CALENDAR_DIRECTION = planAngle(CALENDAR_WHEEL_AXIS);
/** At midnight the date finger stands this far past the line of centres. */
const FINGER_MIDNIGHT = deg(26);
const DATE_TEETH_PHASE = CALENDAR_DIRECTION + deg(-0.5);

export const DIAL_SIDE = {
  /** Dial support ring: lifts the dial seat by the calendar module; its ledge carries the date ring. */
  dialSupport: {
    name: 'Zifferblattträger',
    innerR: 12.15, outerR: 12.78, y: span(BASE_SEAT_Y, DIAL_SEAT_Y),
    ledge: { innerR: DATE_RING_OUTER_R - 0.4, y: span(1.33, DATE_RING_Y - 0.16) },
    /** The toothed moon disc reaches r 12.75 at six o'clock: the ring is cut down there (plan angles). */
    moonNotch: { from: deg(68), to: deg(112), top: MOON_DISC_Y - 0.14 },
  },
  /** Cannon pinion on the hollow centre-wheel arbor; carries the minute hand (dial.ts draws the post above the dial). */
  cannonPinion: {
    name: 'Minutenrohr',
    axis: [0, 0] as Plan, gear: cannonGear, leavesY: span(0.45, 0.68),
    pipe: { outerR: 0.45, innerR: 0.28, y: span(PLATE.dialFaceY, DIAL_SEAT_Y - 0.05) },
  },
  minuteWheel: {
    name: 'Wechselrad',
    axis: MINUTE_WHEEL_AXIS, wheel: minuteWheelGear, wheelY: span(0.45, 0.55),
    pinion: minutePinionGear, pinionY: span(0.55, 0.86), arborR: 0.16,
  },
  hourWheel: {
    name: 'Stundenrad',
    axis: [0, 0] as Plan, gear: hourWheelGear, y: span(0.72, 0.84),
    pipe: { outerR: 0.75, innerR: 0.5, y: span(0.84, DIAL_SEAT_Y - 0.05) },
  },
  /** Intermediate date wheel: wheel on the hour wheel, pinion (above the bridge) on the calendar wheel. One turn in 6 h. */
  intermediateDateWheel: {
    name: 'Datum-Zwischenrad',
    axis: INTERMEDIATE_AXIS, wheel: intermediateWheelGear, wheelY: span(0.72, 0.84),
    pinion: intermediatePinionGear, pinionY: span(1.15, 1.28), arborR: 0.14, arborY: span(PLATE.dialFaceY, 1.28),
  },
  /** 24-hour calendar wheel with the sprung double finger (date finger out, moon finger in at midnight). */
  calendarWheel: {
    name: 'Kalender-Mitnehmerrad (24 h)',
    axis: CALENDAR_WHEEL_AXIS, gear: calendarWheelGear, y: span(1.15, 1.28),
    stud: { r: 0.42, y: span(PLATE.dialFaceY, 1.33) },
    fingerHub: { r: 0.95, y: span(1.28, 1.33) },
    /** Plan angle, seen from the wheel's axis, of the date finger at midnight when the finger is relaxed:
     * the line of centres (away from the movement centre) plus `fingerMidnight`. */
    fingerMidnight: FINGER_MIDNIGHT,
    /** Along the finger's local +x; reaches into the date teeth from about 20:00 to 01:25. */
    dateFinger: { reach: 2.2, width: 0.42, tipWidth: 0.2, y: DATE_TEETH_Y },
    /** At `angle` from the date finger; reaches between the star points over the same hours. */
    moonFinger: { reach: 2.2, width: 0.42, tipWidth: 0.2, angle: deg(170), y: STAR_Y },
  },
  /** Teeth of the date ring (the printed ring is dial.ts's): 31 tabs on its inside, turning with it.
   * The roots reach 0.05 into the printed ring, of which the teeth are part. */
  dateTeeth: {
    name: 'Datumring-Innenverzahnung',
    count: DATE_POSITIONS, tipR: DATE_TEETH_TIP_R, rootR: DATE_RING_INNER_R + 0.05,
    rootWidth: 0.48, tipWidth: 0.32, y: DATE_TEETH_Y,
    /** Local plan angle of tooth 0 at date 1 (rotation 0). */
    phase: DATE_TEETH_PHASE,
  },
  /** 14-point star wheel on the centre, with the 28-leaf pinion that turns the moon wheel. */
  starWheel: {
    name: 'Mondphasen-Mitnehmerrad (Stern)',
    axis: [0, 0] as Plan, points: 14, tipR: 4.7, rootR: 3.95, pointWidth: 0.7, y: STAR_Y,
    web: { discR: 3.45, holeR: 0.28, holePitchR: 2.35, holes: 4 },
    pinion: gearOf(28, MOON_MODULE, 1.1, 1.25), pinionY: span(STAR_Y.top, MOON_DISC_Y - 0.01),
    boreR: 0.95,
    /** Local plan angle of point 0 at moon 0. */
    pointPhase: CALENDAR_DIRECTION + deg(3),
    /** Local plan angle of pinion leaf 0 at moon 0: a leaf points at the moon wheel (+z). */
    leafPhase: Math.PI / 2,
  },
  /** Fixed bush the star wheel turns on; the hour-wheel pipe passes inside it. */
  starBush: { innerR: 0.79, outerR: 0.94, y: span(1.1, STAR_Y.top) },
  /** Toothed rim of the moon disc (dial.ts draws the disc): 118 teeth, 2 per daily step. */
  moonWheel: {
    name: 'Mondscheibe, Verzahnung',
    axis: [0, MOON_DISC_CENTER_Z] as Plan, gear: gearOf(118, MOON_MODULE), innerR: MOON_DISC_R - 0.1,
    y: span(MOON_DISC_Y - 0.095, MOON_DISC_Y - 0.015),
    /** Local plan angle of tooth 0 at moon 0 (dial.ts rotation 0): a gap faces the pinion (-z). */
    toothPhase: -Math.PI / 2 + Math.PI / 118,
  },
  moonStud: { axis: [0, MOON_DISC_CENTER_Z] as Plan, r: 0.4, y: span(PLATE.dialFaceY, MOON_DISC_Y - 0.1) },
  /** Wavy friction washer under the moon disc. */
  moonSpring: {
    name: 'Friktionsfeder', axis: [0, MOON_DISC_CENTER_Z] as Plan, innerR: 0.48, outerR: 1.0, lobes: 3,
    y: span(MOON_DISC_Y - 0.145, MOON_DISC_Y - 0.1),
  },
  /** One spring part with two beaks: one in the date teeth, one between the star points. The beaks
   * sit in the gaps nearest the measured points; each arm flexes about a point near its root. */
  doubleJumper: {
    name: 'Doppelraste',
    foot: [-6.5, 0.65] as Plan, footR: 0.62, postY: span(PLATE.dialFaceY, 1.63),
    dateArm: { beak: DATE_JUMPER_BEAK, root: [-7.5, -0.6] as Plan, width: 0.24, y: DATE_TEETH_Y },
    starArm: { beak: STAR_JUMPER_BEAK, root: [-5.75, 2.15] as Plan, width: 0.24, y: STAR_Y },
    beakR: 0.17,
  },
  jumperPlate: {
    name: 'Halteplatte Doppelraste',
    outline: [[-7.6, -1.6], [-5.4, -1.9], [-4.95, -0.6], [-5.1, 1.4], [-6.0, 2.6], [-7.3, 2.9], [-7.95, 1.2]] as readonly Plan[],
    y: span(1.63, 1.72),
  },
  /** Bridge over minute wheel, intermediate date wheel and the star-wheel bush. */
  minuteBridge: {
    name: 'Wechselradbrücke',
    outline: [
      [-3.3, -4.9], [-1.0, -5.25], [1.2, -4.45], [3.6, -3.65], [5.9, -3.4], [7.15, -2.8], [7.05, -2.0], [6.2, -1.4],
      [5.4, -0.2], [4.6, 0.95], [2.6, 1.3], [1.0, 1.4], [-0.6, 1.2], [-1.6, 0.2], [-2.0, -1.6], [-3.3, -2.6], [-4.0, -3.9],
    ] as readonly Plan[],
    y: span(0.92, 1.1), centreHoleR: 0.79,
  },
  /** Release yoke of the instantaneous calendar finger and its maintaining plate. The yoke lies on the
   * calendar wheel, tangent to the finger hub at `beak`: from about 21:30 a catch on the hub rests against
   * its end, so the finger stays just short of the date tooth while the wheel winds its spring. A stud on
   * the wheel lifts it `lift` (rotation.y) over the last minutes before midnight and lets the finger go
   * at 00:00; it drops back by 00:10. */
  unlockingYoke: {
    name: 'Auslösewippe mit Halteplatte',
    plate: { outline: [[-8.6, -5.3], [-7.0, -7.4], [-4.6, -7.5], [-3.7, -6.1], [-4.4, -5.6], [-6.4, -5.9], [-7.6, -4.2]] as readonly Plan[], y: span(0.92, 1.1) },
    yoke: { pivot: RELEASE_YOKE_PIVOT, beak: RELEASE_BEAK, width: 0.3, y: span(1.285, 1.33), lift: deg(6), beakTipR: 1.1 },
    /** Catch on the finger hub: its tip radius about the calendar wheel's axis, and its width. */
    catch: { tipR: 1.32, width: 0.24 },
    /** Stud on the calendar wheel's face, on this radius; it meets the yoke `liftFrom` minutes before midnight. */
    stud: { r: 2.0, radius: 0.08 },
    /** Minutes from midnight: the lift begins, the finger is let go, the yoke is back. */
    liftFrom: -8, release: 0, dropBy: 10,
    screw: [-5.6, -6.8] as Plan,
  },
} as const;

// ── Keyless and setting works ───────────────────────────────────────────────

/** Sliding pinion and the lower teeth of the setting wheel (8 : 8, so one crown turn is one turn of the
 * setting wheel and an hour of hand travel); finer, so the pinion clears the crown wheel. */
const SETTING_MODULE = 0.15;
const slidingPinionGear = gearOf(8, SETTING_MODULE, 1.1, 1.3);
const settingWheelLowerGear = gearOf(8, SETTING_MODULE, 1.1, 1.3);
/** Winding pinion, crown wheel and ratchet share one module. */
const WINDING_MODULE = 0.18;
const windingPinionGear = gearOf(8, WINDING_MODULE, 1.1, 1.3);
/** The double corrector has as many teeth as the setting wheel: it turns once per crown turn. */
const correctorGear = gearOf(10, MOTION_MODULE, 1.1, 1.3);

/** In position 2 the switching lever carries the setting wheel this far out of the minute wheel, along the
 * line of centres: its rim then still meets the sliding pinion close to the stem line (4° off the tangent). */
const SETTING_WHEEL_SHIFT = 0.48;
const SETTING_WHEEL_OUT = direction(MINUTE_WHEEL_AXIS, SETTING_WHEEL_AXIS);
const SWITCH_LEVER_ARM = 4.4;
const SWITCH_LEVER_PIVOT = round(along(SETTING_WHEEL_AXIS, SETTING_WHEEL_OUT - Math.PI / 2, SWITCH_LEVER_ARM));
const SWITCH_LEVER_SWING = SETTING_WHEEL_SHIFT / SWITCH_LEVER_ARM;
/** The setting wheel's axis with the switching lever turned by SWITCH_LEVER_SWING (rotation.y). */
const SETTING_WHEEL_QUICKSET = round(along(SWITCH_LEVER_PIVOT,
  direction(SWITCH_LEVER_PIVOT, SETTING_WHEEL_AXIS) - SWITCH_LEVER_SWING, SWITCH_LEVER_ARM));

/** Crown-gear meshes: the setting wheel and the crown wheel lie across the stem, their rims over a pinion. */
const SLIDING_PINION_LENGTH = 1.42;
/** Where the setting wheel's lower rim crosses the stem line, at rest (position 3) and in position 2. */
const rimOnStem = (axis: Plan): number => axis[0] + Math.sqrt(settingWheelLowerGear.tipR ** 2 - axis[1] ** 2);
const SLIDING_PINION_IN = rimOnStem(SETTING_WHEEL_AXIS);
/** Position 1: the inner face this far out from position 3. */
const SLIDING_PINION_SHIFT = -0.6;
const SLIDING_PINION_OUT = SLIDING_PINION_IN - SLIDING_PINION_SHIFT;
/** Position 2: on the rim of the setting wheel lifted out of the minute wheel. */
const SLIDING_PINION_SHIFT_QUICKSET = rimOnStem(SETTING_WHEEL_QUICKSET) - SLIDING_PINION_OUT;
const WINDING_PINION_FROM = SLIDING_PINION_OUT + SLIDING_PINION_LENGTH;
const WINDING_PINION_TO = WINDING_PINION_FROM + 0.95;
const BREGUET_DEPTH = 0.1;

/** Double corrector: a 10-tooth wheel on an arm that turns about the setting wheel's arbor, so it always
 * meshes the setting wheel. Outside position 2 the switching lever holds the arm at `restAngle`; in
 * position 2 the arm rocks with the setting wheel: crown towards 12 (setting wheel counter-clockwise) onto
 * the date side, towards 6 onto the day corrector. It carries a finger at the date-teeth level and an
 * 8-leaf pinion at the day-corrector hub level. */
const CORRECTOR_ARM = settingWheelGear.pitchR + correctorGear.pitchR;
const DATE_FINGER_REACH = 0.6;
const DATE_FINGER_BOSS = 0.15;
/** Date side: the arbor stays inside the tab tips; its finger reaches 0.35 into the teeth. */
const CORRECTOR_DATE_R = DATE_TEETH_TIP_R - DATE_FINGER_BOSS - 0.1;
const DAY_GEAR_MODULE = 0.172;
const DAY_GEAR_Y = span(1.18, 1.3);
const dayHubGear = gearOf(24, DAY_GEAR_MODULE);
const correctorPinionGear = gearOf(8, DAY_GEAR_MODULE, 1.1, 1.3);
/** Measured (±0.2): shouldered screw of the day corrector. */
const DAY_CORRECTOR_PIVOT: Plan = [4.85, 3.56];
/** Arm angle about the quick-set axis at which the corrector's arbor stands `r` from the centre (6 o'clock side). */
const armAngleAtRadius = (r: number): number => {
  const q = Math.hypot(...SETTING_WHEEL_QUICKSET);
  const c = (r * r - q * q - CORRECTOR_ARM * CORRECTOR_ARM) / (2 * q * CORRECTOR_ARM);
  return planAngle(SETTING_WHEEL_QUICKSET) + Math.acos(c);
};
const CORRECTOR_DATE_ANGLE = armAngleAtRadius(CORRECTOR_DATE_R);
/** Moon side: the pinion rolls into the day corrector's hub; the arm stops at full depth. */
const CORRECTOR_MOON_ANGLE = (() => {
  const q = SETTING_WHEEL_QUICKSET;
  const d = planDistance(q, DAY_CORRECTOR_PIVOT);
  const need = correctorPinionGear.pitchR + dayHubGear.pitchR;
  const c = (d * d + CORRECTOR_ARM * CORRECTOR_ARM - need * need) / (2 * d * CORRECTOR_ARM);
  return direction(q, DAY_CORRECTOR_PIVOT) - Math.acos(c);
})();

/** Balance: rotor-side drawing [0.53, -6.52], dial-side view [0.37, -6.56]. */
const BALANCE_AXIS: Plan = [0.45, -6.55];
const BALANCE_RIM_R = 5.06;
/** Stop lever: pivot near the stem beside the setting lever, a long arm out to the balance rim. Its tip
 * lies on a circle about the pivot; it comes onto the rim (stop) from 0.35 mm outside it (rest). */
const STOP_LEVER_PIVOT: Plan = [8.7, -3.0];
const STOP_LEVER_LENGTH = 4.0;
const stopTip = (r: number): Plan => round(meshPoint(STOP_LEVER_PIVOT, STOP_LEVER_LENGTH, BALANCE_AXIS, r, -1));
const STOP_TIP_STOP = stopTip(BALANCE_RIM_R + 0.03);
const STOP_TIP_REST = stopTip(BALANCE_RIM_R + 0.38);

export const KEYLESS = {
  /** The movement's part of the stem; crown.ts draws the rest from x 15.92 outwards. */
  stem: {
    name: 'Aufzugwelle',
    y: STEM_Y, z: 0, innerX: 5.75, outerX: 15.92,
    sections: [
      { from: 5.75, to: 6.6, kind: 'round', r: 0.25 },
      { from: 6.6, to: WINDING_PINION_FROM, kind: 'square', r: 0.32 },
      { from: WINDING_PINION_FROM, to: WINDING_PINION_TO, kind: 'round', r: 0.4 },
      { from: WINDING_PINION_TO, to: 11.15, kind: 'round', r: 0.45 },
      { from: 11.15, to: 11.45, kind: 'round', r: 0.3 },
      { from: 11.45, to: 15.92, kind: 'round', r: 0.45 },
    ] as const,
    /** Groove for the setting-lever pin (the r 0.30 section), in position 1. */
    grooveX: 11.3,
  },
  /** On the stem's square; Breguet teeth outwards (winding), radial teeth inwards (setting wheel). */
  slidingPinion: {
    name: 'Kupplungstrieb',
    innerX: SLIDING_PINION_OUT, length: SLIDING_PINION_LENGTH, gear: slidingPinionGear, breguetTeeth: 9,
    /** The yoke's fork sits in a groove of this width, centred this far from the inner face. */
    grooveOffset: 0.71, grooveWidth: 0.28, grooveR: 0.5,
    /** Shift towards the centre in position 3 (onto the setting wheel at rest) and in position 2 (onto the
     * setting wheel lifted out of the minute wheel). */
    shift: SLIDING_PINION_SHIFT, quickSetShift: SLIDING_PINION_SHIFT_QUICKSET,
  },
  /** Free on the stem, held axially; its teeth mesh the crown wheel's rim above it (back side). The
   * Breguet teeth between it and the sliding pinion are this deep and stay in mesh up to this pull. */
  windingPinion: {
    name: 'Aufzugtrieb', fromX: WINDING_PINION_FROM, toX: WINDING_PINION_TO, gear: windingPinionGear, breguetTeeth: 9,
    breguetDepth: BREGUET_DEPTH, engagedUpToPull: 1 + BREGUET_DEPTH / -SLIDING_PINION_SHIFT_QUICKSET,
  },
  /** Its pin rides in the stem groove; a notched lobe (notches for positions 1, 2, 3 on the circle `r`
   * about the pivot, starting at plan angle `angle`) holds it under the jumper's spring finger. */
  settingLever: {
    name: 'Winkelhebel',
    pivot: [10.2, -4.5] as Plan, pivotR: 0.45, pin: [11.3, 0] as Plan, pinR: 0.15, arborR: 0.26,
    width: 0.6, y: span(-0.22, -0.09), pinY: span(STEM_Y + 0.3, -0.09),
    notches: { angle: deg(200), r: 2.2, depth: 0.06 },
  },
  yoke: {
    name: 'Kupplungstriebhebel',
    pivot: [6.8, -4.2] as Plan, pivotR: 0.4, fork: [SLIDING_PINION_OUT + 0.71, -0.62] as Plan,
    width: 0.55, y: span(-0.22, -0.09), forkY: span(STEM_Y - 0.1, -0.09),
    /** Its beak ends in a round of this radius and rides on the setting lever's cam. */
    beakR: 0.17,
  },
  settingLeverJumper: {
    name: 'Winkelhebelraste',
    outline: [[7.6, -6.6], [9.9, -6.9], [11.2, -5.6], [10.9, -4.4], [10.1, -3.5], [9.5, -4.6], [8.4, -5.0], [7.7, -5.4]] as readonly Plan[],
    screw: [8.95, -5.85] as Plan, y: span(-0.05, 0.07),
    /** Spring finger along the tangent of the notch circle at `lineR` from the lever pivot. */
    finger: { length: 1.1, lineR: 2.33 },
  },
  /** Switching lever: carries the setting wheel; in position 2 swings it out of the minute wheel. */
  switchLever: {
    name: 'Schalthebel für Doppelkorrektor',
    pivot: SWITCH_LEVER_PIVOT, pivotR: 0.4, width: 0.6, y: span(0.12, 0.24),
    /** Centre line at rest: pivot to setting-wheel axis. */
    path: [SWITCH_LEVER_PIVOT, SETTING_WHEEL_AXIS] as readonly Plan[],
    /** rotation.y of the lever in position 2 (positive: the setting wheel moves away from the minute wheel). */
    swing: SWITCH_LEVER_SWING,
  },
  /** Setting wheel on the switching lever: lower teeth on the sliding pinion, upper teeth on the minute
   * wheel (positions 1 and 3) and the double corrector. */
  settingWheel: {
    name: 'Zeigerstellrad',
    axis: SETTING_WHEEL_AXIS, quickSetAxis: SETTING_WHEEL_QUICKSET,
    lowerGear: settingWheelLowerGear, lowerY: span(-0.3, 0.1),
    gear: settingWheelGear, upperY: span(0.26, 0.55), arborR: 0.14,
  },
  /** Rocking double corrector (see CORRECTOR_ARM). Arm angles are plan angles seen from the setting wheel's axis. */
  doubleCorrector: {
    name: 'Doppelkorrektor',
    arm: CORRECTOR_ARM, gear: correctorGear, y: span(0.42, 0.55), armY: span(0.56, 0.62), arborR: 0.12,
    /** Held by the switching lever outside position 2, and where it rests in position 2 before the crown turns. */
    restAngle: deg(78), quickSetRestAngle: deg(88),
    dateAngle: CORRECTOR_DATE_ANGLE, moonAngle: CORRECTOR_MOON_ANGLE,
    /** Finger at the date-teeth level. It sits on the arbor with a friction spring: away from the date
     * side a stop on the arm holds it, so every date click starts from the same place. */
    finger: { reach: DATE_FINGER_REACH, boss: DATE_FINGER_BOSS, width: 0.26, tipWidth: 0.16, y: DATE_TEETH_Y },
    /** Pinion for the day corrector's hub. */
    pinion: correctorPinionGear, pinionY: DAY_GEAR_Y,
  },
  /** Day corrector: three arms on a shouldered screw; its 24-tooth hub takes a third of a turn per crown
   * turn from the corrector's pinion, which steps the star wheel past its jumper by one point. */
  dayCorrector: {
    name: 'Tageskorrektor',
    pivot: DAY_CORRECTOR_PIVOT, arms: 3, reach: 1.6, y: STAR_Y, screwR: 0.42,
    hub: dayHubGear, hubY: DAY_GEAR_Y,
  },
  /** Stop-seconds lever on the back face of the plate; the setting lever turns it from position 2 to 3,
   * when its tip comes onto the balance rim. */
  stopLever: {
    name: 'Stopphebel',
    pivot: STOP_LEVER_PIVOT, tipStop: STOP_TIP_STOP, tipRest: STOP_TIP_REST,
    width: 0.3, y: span(-1.66, -1.56),
    /** End of its short tail at the setting lever's arbor. */
    tail: [9.55, -3.75] as Plan,
  },
} as const;

// ── Back side: going train, escapement, winding, bridges, rotor ─────────────

/** Measured (±0.4): barrel, escape wheel; pallet staff (±0.1, dial-side view). */
const BARREL_MEASURED: Plan = [2.65, 5.0];
const ESCAPE_AXIS: Plan = [-3.15, -2.15];
const PALLET_AXIS: Plan = [-1.43, -4.4];
/** Crown wheel: across the stem with its rim over the winding pinion (measured on the rotor-side view: [7.9, 0.25] ±0.4). */
const crownWheelGear = gearOf(28, WINDING_MODULE);
const CROWN_WHEEL_AXIS: Plan = round([(WINDING_PINION_FROM + WINDING_PINION_TO) / 2 - crownWheelGear.pitchR, 0.25]);
/** Third wheel: on the measured direction (±0.4), far enough out for its arbor to clear the fourth wheel. */
const THIRD_AXIS: Plan = round(along([0, 0], planAngle([-2.9, 2.0]), 3.85));

const ratchetGear = gearOf(46, WINDING_MODULE);
const RATCHET_PITCH = TAU / ratchetGear.teeth;
/** Barrel axis: on the measured direction from the crown wheel, at the ratchet/crown-wheel centre distance. */
const BARREL_AXIS: Plan = round(along(CROWN_WHEEL_AXIS, direction(CROWN_WHEEL_AXIS, BARREL_MEASURED),
  crownWheelGear.pitchR + ratchetGear.pitchR));
const BACK_SIDE_CLICK_PIVOT: Plan = round(along(BARREL_AXIS, deg(-10), ratchetGear.tipR + 1.0));
/** The ratchet gap nearest plan angle -21° (about the ratchet axis) that faces the crown wheel's mesh line. */
const CLICK_BEAK_ANGLE = ((): number => {
  const meshLine = direction(BARREL_AXIS, CROWN_WHEEL_AXIS);
  return meshLine + Math.round((deg(-21) - meshLine) / RATCHET_PITCH) * RATCHET_PITCH;
})();

const BARREL_MODULE = 2 * Math.hypot(...BARREL_AXIS) / (84 + 12);
const CENTRE_MODULE = 2 * Math.hypot(...THIRD_AXIS) / (80 + 10);
const THIRD_MODULE = 2 * Math.hypot(...THIRD_AXIS) / (75 + 10);
const FOURTH_MODULE = 2 * Math.hypot(...ESCAPE_AXIS) / (84 + 7);

const ESCAPE_TIP_R = 2.3;
/** Half the angle the pallets span seen from the escape-wheel axis (tangential locking). */
const PALLET_HALF_SPAN = Math.acos(ESCAPE_TIP_R / planDistance(ESCAPE_AXIS, PALLET_AXIS));
const ESCAPE_TO_PALLET = direction(ESCAPE_AXIS, PALLET_AXIS);

// Automatic device: the rotor gear drives two reversing wheels (they do not touch
// each other); both pinions drive the reduction wheel, whose pinion drives the
// ratchet driving wheel, whose pinion drives the ratchet.
const ROTOR_GEAR = gearOf(40, 0.12);
const REVERSER_GEAR = gearOf(24, 0.12);
const REVERSER_PINION = gearOf(10, 0.1, 1.1, 1.3);
const REDUCTION_GEAR = gearOf(36, 0.1);
const REDUCTION_PINION = gearOf(10, 0.1, 1.1, 1.3);
const DRIVER_GEAR = gearOf(28, 0.1);
const DRIVER_PINION = gearOf(10, WINDING_MODULE, 1.1, 1.3);
const REVERSER_RADIUS = ROTOR_GEAR.pitchR + REVERSER_GEAR.pitchR;
const REVERSER_AXIS = round(along([0, 0], deg(75), REVERSER_RADIUS));
const AUX_REVERSER_AXIS = round(along([0, 0], deg(125), REVERSER_RADIUS));
const REDUCTION_AXIS = round(meshPoint(REVERSER_AXIS, REVERSER_PINION.pitchR + REDUCTION_GEAR.pitchR,
  AUX_REVERSER_AXIS, REVERSER_PINION.pitchR + REDUCTION_GEAR.pitchR, -1));
const RATCHET_DRIVER_AXIS = round(meshPoint(REDUCTION_AXIS, REDUCTION_PINION.pitchR + DRIVER_GEAR.pitchR,
  BARREL_AXIS, ratchetGear.pitchR + DRIVER_PINION.pitchR, 1));
/** Layers of the automatic device between the bridges (-1.95) and its framework (-2.27). */
const AUTO_L1 = span(-2.26, -2.19);
const AUTO_L2 = span(-2.18, -2.12);
const AUTO_L3 = span(-2.11, -2.06);
const RATCHET_Y = span(-2.05, -1.96);

/** A screw head on the face at `seatY`. `rise` is the head height, signed: + towards the dial, - towards
 * the caseback; 0 for countersunk heads, which sit flush. `slot`: plan angle of the slot. */
export interface ScrewSpec { readonly at: Plan; readonly headR: number; readonly seatY: number; readonly rise: number; readonly slot: number }

export const BACK_SIDE = {
  plate: PLATE,
  barrel: {
    name: 'Federhaus',
    axis: BARREL_AXIS, gear: gearOf(84, BARREL_MODULE), drumY: span(-0.95, -0.05), teethY: span(-0.95, -0.75),
    coverR: 4.3, arborR: 0.55, arborY: span(RATCHET_Y.bottom, -0.05),
  },
  /** Ratchet: tooth 0 at plan angle `phase` (rotation 0), so gaps face the click's beak and the crown wheel. */
  ratchet: { name: 'Sperrrad', axis: BARREL_AXIS, gear: ratchetGear, y: RATCHET_Y, coreR: 1.1, phase: CLICK_BEAK_ANGLE + RATCHET_PITCH / 2 },
  /** Crown wheel, sunk into the barrel bridge so it reaches down to the winding pinion; a tooth on the line to the ratchet. */
  crownWheel: { name: 'Kronrad', axis: CROWN_WHEEL_AXIS, gear: crownWheelGear, y: span(-2.12, -1.8), coreR: 0.85, phase: direction(CROWN_WHEEL_AXIS, BARREL_AXIS) },
  /** Click: its beak rests `beakRestR` from the ratchet axis on a ratchet gap at plan angle `beakAngle` (about the
   * ratchet axis), a gap that also faces the crown wheel's mesh line, and locks the ratchet against unwinding. */
  click: {
    name: 'Klinke mit Feder',
    pivot: BACK_SIDE_CLICK_PIVOT, beakAngle: CLICK_BEAK_ANGLE, beakRestR: ratchetGear.rootR + 0.1,
    width: 0.45, y: RATCHET_Y,
  },
  /** Centre wheel: one turn an hour; its hollow arbor carries the cannon pinion through the plate.
   * Simplification: in the reference calibre the centre wheel stands off-centre (about [-4.1, +5]) and the
   * cannon pinion turns on a driving wheel of its own; only the seconds wheel shares the centre axis. The
   * model keeps the centre wheel on the axis; the train ratios are the same. */
  centreWheel: {
    name: 'Grossbodenrad',
    axis: [0, 0] as Plan, gear: gearOf(80, CENTRE_MODULE), y: span(-1.1, -1.0),
    pinion: gearOf(12, BARREL_MODULE, 1.1, 1.25), pinionY: span(-0.95, -0.75),
    arbor: { outerR: 0.3, innerR: 0.16, y: span(-1.1, PLATE.dialFaceY) },
    spokes: 4,
  },
  thirdWheel: {
    name: 'Kleinbodenrad',
    axis: THIRD_AXIS, gear: gearOf(75, THIRD_MODULE), y: span(-1.25, -1.15),
    pinion: gearOf(10, CENTRE_MODULE, 1.1, 1.25), pinionY: span(-1.13, -0.97), arborY: span(-1.95, -0.3), spokes: 5,
  },
  /** Fourth (seconds) wheel on the centre axis; its long arbor carries the seconds hand. */
  fourthWheel: {
    name: 'Sekundenrad',
    axis: [0, 0] as Plan, gear: gearOf(84, FOURTH_MODULE), y: span(-1.4, -1.3),
    pinion: gearOf(10, THIRD_MODULE, 1.1, 1.25), pinionY: span(-1.27, -1.13), arborY: span(-1.95, -1.1), spokes: 6,
  },
  escapeWheel: {
    name: 'Hemmungsrad',
    axis: ESCAPE_AXIS, teeth: 20, tipR: ESCAPE_TIP_R, rootR: 1.85, rimInnerR: 1.55, spokes: 4,
    y: span(-0.85, -0.75), pinion: gearOf(7, FOURTH_MODULE, 1.1, 1.25), pinionY: span(-1.42, -1.28), arborY: span(-1.95, -0.3),
  },
  palletFork: {
    name: 'Anker',
    axis: PALLET_AXIS, y: span(-0.92, -0.72),
    /** Pallet stones touch the escape-wheel tip circle at these plan points (rest pose). */
    entryStone: round(along(ESCAPE_AXIS, ESCAPE_TO_PALLET + PALLET_HALF_SPAN, ESCAPE_TIP_R)),
    exitStone: round(along(ESCAPE_AXIS, ESCAPE_TO_PALLET - PALLET_HALF_SPAN, ESCAPE_TIP_R)),
    /** End of the fork with its horns, just short of the balance roller. */
    forkTip: round(along(PALLET_AXIS, direction(PALLET_AXIS, BALANCE_AXIS), planDistance(PALLET_AXIS, BALANCE_AXIS) - 0.62)),
    stoneSize: [0.42, 0.16, 0.2] as const, width: 0.3, swing: deg(9),
  },
  balance: {
    name: 'Unruh',
    axis: BALANCE_AXIS, rimOuterR: BALANCE_RIM_R, rimInnerR: 4.74, y: span(-1.85, -1.55),
    arms: 3, armWidth: 0.34, armY: span(-1.78, -1.62), hubR: 0.45,
    staff: { r: 0.1, y: span(-2.4, PLATE.dialFaceY + 0.05) },
    roller: { r: 0.6, y: span(-0.92, -0.8), impulsePin: { r: 0.09, at: 0.48 } },
    /** Swing amplitude each way while running, and the frequency (28,800 A/h). */
    amplitude: deg(270), hertz: 4,
  },
  hairspring: {
    name: 'Spirale',
    axis: BALANCE_AXIS, innerR: 0.32, outerR: 2.05, turns: 14, strip: 0.035, y: span(-2.0, -1.92),
    /** Plan angle of the outer end (stud) seen from the balance axis. */
    studAngle: deg(200),
  },
  balanceCock: {
    name: 'Unruhbrücke',
    foot: {
      outline: [[7.0, -5.2], [9.3, -4.2], [11.0, -5.6], [9.9, -7.5], [8.6, -8.6], [6.6, -7.7]] as readonly Plan[],
      y: span(-1.95, -1.5),
    },
    /** The arm carries the regulator's fine-adjustment eccentric (regulator.pointerTip) and its +/- scale;
     * below -2.10 it stays inside r 10.4. It ends short of the cock screw on the foot (rotor-side drawing [8.1, -6.35]). */
    arm: {
      outline: [
        [0.9, -5.45], [3.6, -5.5], [6.3, -5.3], [7.3, -5.55], [7.35, -7.1], [6.6, -7.6], [5.6, -7.75],
        [4.4, -7.75], [3.0, -7.65], [1.3, -7.8],
      ] as readonly Plan[],
      y: span(-2.4, -2.05),
    },
    bossR: 1.25,
  },
  /** Index on the cock: the pointer runs straight out along +x to the fine-adjustment eccentric (rotor-side
   * drawing [5.00, -6.47]), with a fan of marks and "+" and "-" either side. */
  regulator: {
    name: 'Rücker',
    axis: BALANCE_AXIS, pointerTip: [5.0, -6.5] as Plan, y: span(-2.48, -2.4), scaleSpan: deg(12),
  },
  /** Shock-absorber settings on both ends of the balance staff. */
  shockSetting: { r: 1.1, capR: 0.55 },
  // Train and barrel bridge reach out towards the plate edge, so that bridges and not bare plate fill
  // the rotor side. Both stay outside the balance circle (r 5.16 about the balance axis), clear the stop
  // lever on the plate and leave the lower half of the escape wheel open.
  trainBridge: {
    name: 'Räderwerkbrücke',
    outline: [
      [0.95, -0.6], [1.1, 0.7], [-0.4, 2.7], [-2.1, 3.75], [-3.4, 5.6], [-5.6, 7.9], [-8.3, 8.1], [-10.6, 5.2],
      [-11.8, 1.2], [-11.6, -3.0], [-10.3, -6.4], [-8.4, -8.6], [-6.6, -8.4], [-6.2, -5.6], [-6.0, -3.3],
      [-4.9, -2.75], [-3.2, -2.75], [-2.3, -2.05], [-0.95, -1.2],
    ] as readonly Plan[],
    y: span(-1.95, -1.5),
  },
  barrelBridge: {
    name: 'Federhausbrücke',
    outline: [
      [1.4, 0.9], [3.7, -0.3], [6.2, -1.7], [9.4, -1.8], [11.6, -1.3], [12.0, 1.6], [11.4, 4.4], [10.0, 6.9],
      [7.9, 9.0], [5.2, 10.7], [2.0, 11.6], [-1.3, 11.6], [-2.2, 10.2], [-1.7, 6.3], [-0.9, 3.8],
    ] as readonly Plan[],
    y: span(-1.95, -1.5),
    /** Cut from the back face down to `bottomY`: the crown wheel lies in it. */
    crownWheelRecess: { center: CROWN_WHEEL_AXIS, r: 3.3, bottomY: -1.78 },
    /** Cut from the dial-side face up to `topY` along the stem; where it meets the recess the bridge is open. */
    keylessChannel: { fromX: 7.5, toX: 11.0, halfWidth: 1.0, topY: -1.78 },
  },
  /** A narrow bar over the pallet arbor between its two screws, so the entry stone, the fork and the
   * escape wheel show; `pocket` is the outline of the plate pocket it is sunk into. */
  palletBridge: {
    name: 'Ankerbrücke',
    outline: [
      [-3.3, -4.4], [-2.5, -4.05], [-1.4, -3.85], [-0.3, -4.2], [-0.2, -5.2], [-0.9, -5.35], [-1.5, -4.95],
      [-2.6, -5.45], [-3.3, -5.2],
    ] as readonly Plan[],
    pocket: [[-0.3, -4.1], [-0.5, -5.2], [-2.6, -5.6], [-3.8, -4.3], [-2.9, -3.2], [-1.6, -3.5]] as readonly Plan[],
    y: span(-1.45, -1.1),
  },
  automatic: {
    framework: {
      name: 'Automatikgestell',
      outline: [
        [2.9, -2.2], [3.4, 0.4], [2.6, 2.4], [1.6, 4.6], [1.0, 8.8], [-1.6, 9.2], [-4.6, 7.0], [-6.4, 3.8],
        [-5.6, 1.2], [-3.6, -0.6], [-1.6, -2.6], [0.8, -3.0],
      ] as readonly Plan[],
      y: span(BODY_BACK_Y, AUTO_L1.bottom - 0.01), bearingHoleR: 2.6,
    },
    rotorGear: { axis: [0, 0] as Plan, gear: ROTOR_GEAR, y: AUTO_L1 },
    reverser: { name: 'Umkehrrad', axis: REVERSER_AXIS, gear: REVERSER_GEAR, y: AUTO_L1, pinion: REVERSER_PINION, pinionY: AUTO_L2 },
    auxReverser: { name: 'Hilfs-Umkehrrad', axis: AUX_REVERSER_AXIS, gear: REVERSER_GEAR, y: AUTO_L1, pinion: REVERSER_PINION, pinionY: AUTO_L2 },
    reduction: { name: 'Reduktionsrad', axis: REDUCTION_AXIS, gear: REDUCTION_GEAR, y: AUTO_L2, pinion: REDUCTION_PINION, pinionY: AUTO_L3 },
    ratchetDriver: { name: 'Mitnehmerrad für Sperrrad', axis: RATCHET_DRIVER_AXIS, gear: DRIVER_GEAR, y: AUTO_L3, pinion: DRIVER_PINION, pinionY: RATCHET_Y },
  },
  /** Oscillating weight: a half disc on a ball bearing; the heavy rim lies towards local +z. */
  rotor: {
    name: 'Schwungmasse',
    axis: [0, 0] as Plan,
    sweep: Math.PI,
    bearing: { outerR: 2.25, raceInnerR: 1.0, raceOuterR: 1.65, y: span(ROTOR_BOTTOM_Y, BODY_BACK_Y) },
    hubR: 3.2,
    plate: { innerR: 3.2, outerR: 10.6, y: span(ROTOR_BOTTOM_Y, ROTOR_BOTTOM_Y + 0.4) },
    rim: { innerR: 10.6, outerR: 12.65, innerFaceY: -2.1 },
    /** Back face: flat out to coneFromR, then a cone up to the outer edge (maker's frame drawing, 20°). */
    envelope: { flatY: ROTOR_BOTTOM_Y, coneFromR: 9.8, edgeR: 12.65, edgeY: BODY_BACK_Y },
    /** Rounded ends of the half disc. */
    cornerR: 0.8,
    /** Hole in the weight round the bearing; knurled outer race of the bearing. */
    plateHoleR: 2.6, raceKnurlR: 2.5,
    /** Polished rings on the back face (radii from, to). */
    rings: { hub: [3.1, 3.3] as const, middle: [7.5, 7.65] as const },
  },
  /** Movement holder ring between the movement (Ø25.60, flange Ø26.00) and the case cavity (r 16.22). */
  casingRing: {
    name: 'Werkhaltering',
    boreR: 12.84, flangeSeatR: 13.05, seatY: FLANGE.y.bottom, outerR: 16.18,
    y: span(CASEBACK_INNER_Y, DIAL_SEAT_Y), stemHoleR: 0.6,
  },
} as const;

export const TRAIN = {
  barrelTurnsPerHour: 12 / 84,
  centreTurnsPerHour: 1,
  thirdTurnsPerHour: 80 / 10,
  fourthTurnsPerHour: 80 / 10 * 75 / 10,
  escapeTurnsPerHour: 80 / 10 * 75 / 10 * 84 / 7,
  beatsPerSecond: 8,
  escapeTeeth: 20,
} as const;

// ── Screws and jewels (instanced) ───────────────────────────────────────────

export const SCREWS: { readonly dialSide: readonly ScrewSpec[]; readonly keyless: readonly ScrewSpec[]; readonly backSide: readonly ScrewSpec[] } = {
  dialSide: [
    { at: [6.6, -2.5], headR: 0.5, seatY: DIAL_SIDE.minuteBridge.y.top, rise: 0.15, slot: deg(30) },
    { at: DIAL_SIDE.doubleJumper.foot, headR: 0.55, seatY: DIAL_SIDE.jumperPlate.y.top, rise: 0, slot: deg(80) },
    { at: DIAL_SIDE.unlockingYoke.screw, headR: 0.45, seatY: DIAL_SIDE.unlockingYoke.plate.y.top, rise: 0, slot: deg(70) },
    /** Shouldered screw of the day corrector. */
    { at: KEYLESS.dayCorrector.pivot, headR: KEYLESS.dayCorrector.screwR, seatY: STAR_Y.top, rise: 0.12, slot: deg(120) },
  ],
  /** Keyless works on both faces of the plate, and the winding wheels on the barrel bridge. */
  keyless: [
    { at: KEYLESS.settingLeverJumper.screw, headR: 0.5, seatY: KEYLESS.settingLeverJumper.y.top, rise: 0, slot: deg(10) },
    { at: SWITCH_LEVER_PIVOT, headR: 0.32, seatY: KEYLESS.switchLever.y.top, rise: 0.09, slot: deg(60) },
    { at: STOP_LEVER_PIVOT, headR: 0.33, seatY: KEYLESS.stopLever.y.bottom, rise: -0.1, slot: deg(15) },
    { at: BACK_SIDE_CLICK_PIVOT, headR: 0.34, seatY: RATCHET_Y.bottom, rise: -0.1, slot: deg(35) },
    { at: CROWN_WHEEL_AXIS, headR: 0.75, seatY: -2.12, rise: -0.12, slot: deg(15) },
    /** Ratchet screw: turns with the ratchet. */
    { at: BARREL_AXIS, headR: 0.75, seatY: RATCHET_Y.bottom, rise: -0.13, slot: deg(95) },
  ],
  backSide: [
    { at: [-4.6, -0.8], headR: 0.55, seatY: -1.95, rise: 0, slot: deg(20) },
    { at: [-1.9, 2.9], headR: 0.55, seatY: -1.95, rise: 0, slot: deg(65) },
    // Barrel bridge: clear of ratchet, click and crown wheel.
    { at: [0.9, 10.6], headR: 0.55, seatY: -1.95, rise: 0, slot: deg(140) },
    { at: [9.6, 6.2], headR: 0.55, seatY: -1.95, rise: 0, slot: deg(35) },
    { at: [11.0, 2.6], headR: 0.55, seatY: -1.95, rise: 0, slot: deg(100) },
    { at: [-2.7, -4.85], headR: 0.45, seatY: -1.45, rise: 0, slot: deg(5) },
    { at: [-0.75, -4.75], headR: 0.45, seatY: -1.45, rise: 0, slot: deg(75) },
    { at: [8.1, -6.35], headR: 0.6, seatY: -1.95, rise: 0, slot: deg(50) },
    { at: [2.3, -1.4], headR: 0.5, seatY: BODY_BACK_Y, rise: 0, slot: deg(40) },
    { at: [-5.2, 3.0], headR: 0.5, seatY: BODY_BACK_Y, rise: 0, slot: deg(130) },
    { at: [0, 0], headR: 0.75, seatY: ROTOR_BOTTOM_Y, rise: -0.08, slot: deg(90) },
  ],
};

/** Jewels the viewer can see, by face (the other jewel holes are hidden under wheels and plates). */
export interface JewelSpec { readonly at: Plan; readonly r: number; readonly y: number; readonly face: 'up' | 'down'; readonly chaton: number }

export const JEWELS: { readonly dialSide: readonly JewelSpec[]; readonly backSide: readonly JewelSpec[] } = {
  dialSide: [
    { at: BALANCE_AXIS, r: 0.32, y: PLATE.dialFaceY + 0.05, face: 'up', chaton: 1.1 },
    { at: PALLET_AXIS, r: 0.25, y: PLATE.dialFaceY + 0.02, face: 'up', chaton: 0.5 },
  ],
  backSide: [
    { at: BALANCE_AXIS, r: 0.32, y: -2.45, face: 'down', chaton: 1.1 },
    { at: PALLET_AXIS, r: 0.25, y: -1.45, face: 'down', chaton: 0.48 },
    { at: ESCAPE_AXIS, r: 0.25, y: -1.95, face: 'down', chaton: 0.5 },
    { at: THIRD_AXIS, r: 0.28, y: -1.95, face: 'down', chaton: 0.55 },
    { at: [0, 0], r: 0.3, y: -1.95, face: 'down', chaton: 0.6 },
    { at: BARREL_AXIS, r: 0.35, y: -1.95, face: 'down', chaton: 0.7 },
    { at: REVERSER_AXIS, r: 0.22, y: BODY_BACK_Y, face: 'down', chaton: 0.45 },
    { at: AUX_REVERSER_AXIS, r: 0.22, y: BODY_BACK_Y, face: 'down', chaton: 0.45 },
    { at: REDUCTION_AXIS, r: 0.22, y: BODY_BACK_Y, face: 'down', chaton: 0.45 },
  ],
};

/** Neutral engravings (no maker or calibre names anywhere), read from the back. Train and barrel bridge
 * lie under the automatic framework, the ratchet and the crown wheel: the texts go where they can be read. */
export const ENGRAVINGS = {
  rotor: ['LUNA GUIDE', 'AUTOMATIK'],
  balanceCock: { text: 'STUDIENMODELL', at: [3.3, -7.2] as Plan },
  automaticFramework: { text: '26 STEINE', at: [-3.3, 5.45] as Plan },
} as const;

// ── Finishes (parameters for MeshStandard/Physical materials) ───────────────

export const FINISHES = {
  /** Rhodium-plated plate and bridges: perlage on the plate, circular graining on the bridges. */
  rhodium: { color: 0xc9cdd2, metalness: 1, roughness: 0.34 },
  /** Polished edges (anglage), stem and steel levers. */
  polishedSteel: { color: 0xdadde0, metalness: 1, roughness: 0.12 },
  /** Gilt wheels: train, calendar wheel, star wheel, balance rim, date teeth, moon rim. */
  gilt: { color: 0xd9b45e, metalness: 1, roughness: 0.3 },
  /** Heat-blued screws. */
  blued: { color: 0x22408f, metalness: 1, roughness: 0.25 },
  /** Synthetic ruby: glossy, slightly transmissive red. */
  ruby: { color: 0xa3122a, metalness: 0, roughness: 0.08, clearcoat: 1, transmission: 0.25 },
  /** Oscillating weight: rhodium steel; the heavy-metal rim a darker grey. */
  rotor: { color: 0xc5c9ce, metalness: 1, roughness: 0.3 },
  heavyMetal: { color: 0x8a8f96, metalness: 1, roughness: 0.38 },
  hairspring: { color: 0x3d4552, metalness: 1, roughness: 0.32 },
  /** Movement holder ring: turned anthracite steel with a fine circular grain, darker than the plate. */
  casingRing: { color: 0x6a7078, metalness: 0.4, roughness: 0.45 },
  /** Perlage: overlapping circular graining on a hexagonal pitch (mm). */
  perlage: { dotR: 0.7, pitch: 0.95 },
} as const;

/** Main-pass budget of the whole movement (no shadow pass: no movement part casts). The rotor side
 * of back-side.ts only draws with the caseback off, dial-side.ts only with the dial lifted. */
export const BUDGET = {
  dialSide: { drawCalls: 4, triangles: 32_000 },
  keyless: { drawCalls: 5, triangles: 15_000 },
  backSide: { drawCalls: 14, triangles: 42_000 },
} as const;

// ── State → angles (rotation.y unless stated), allocation-free ─────────────

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const positiveMod = (n: number, m: number): number => ((n % m) + m) % m;

/** The calibre prints the date numerals counter-clockwise and turns the ring clockwise (-1): the
 * next date comes down into the window at three. dial.ts turns its printed ring the same way. */
export const DATE_RING_SENSE: 1 | -1 = -1;

/** Hour wheel and hour hand: one turn clockwise in 12 h (as hands.ts). */
export const hourWheelAngle = (minutes: number): number => -TAU * minutes / 720;
/** Cannon pinion and minute hand: one turn clockwise an hour. */
export const cannonPinionAngle = (minutes: number): number => -TAU * minutes / 60;
export const minuteWheelAngle = (minutes: number): number => TAU * minutes / 60 * (cannonGear.teeth / minuteWheelGear.teeth);
/** Intermediate date wheel: counter-clockwise, one turn in 6 h. */
export const intermediateDateWheelAngle = (minutes: number): number =>
  TAU * minutes / 720 * (hourWheelGear.teeth / intermediateWheelGear.teeth);
/** Minutes from the nearest past or coming midnight: -720 < result <= 720, negative before midnight. */
export function minutesFromMidnight(minuteOfDay: number): number {
  const day = positiveMod(minuteOfDay, 1440);
  return day > 720 ? day - 1440 : day;
}
/** Where the date finger would stand if it only rode with its wheel: plan angle seen from the calendar
 * wheel's axis, measured from the line of centres (away from the movement centre). */
export const relaxedFingerAngle = (minuteOfDay: number): number =>
  FINGER_MIDNIGHT + TAU * minutesFromMidnight(minuteOfDay) / 1440;
/** 24-hour calendar wheel: clockwise, one turn a day, the same angle every midnight. */
export const calendarWheelAngle = (minuteOfDay: number): number => -(CALENDAR_DIRECTION + relaxedFingerAngle(minuteOfDay));

/** Date ring teeth, exactly as dial.ts turns the printed ring. */
export const dateRingAngle = (date: number): number => DATE_RING_SENSE * TAU * (date - 1) / DATE_POSITIONS;
/** Moon disc rim, exactly as dial.ts turns the disc (clockwise, 59 steps a turn). */
export const moonDiscAngle = (moon: number): number => -TAU * moon / MOON_DISC_STEPS;
/** Star wheel and pinion: counter-clockwise, one point per daily step. */
export const starWheelAngle = (moon: number): number => TAU * moon / 14;

/** The train follows the running time (displaySeconds), not the hands: hand setting slips at the cannon pinion. */
export const centreWheelAngle = (seconds: number): number => -TAU * seconds / 3600;
export const thirdWheelAngle = (seconds: number): number => TAU * seconds / 3600 * TRAIN.thirdTurnsPerHour;
export const barrelAngle = (seconds: number): number => TAU * seconds / 3600 * TRAIN.barrelTurnsPerHour;
/** Beats since the start of the display clock: 8 a second. */
export const beatOf = (seconds: number): number => Math.floor(seconds * TRAIN.beatsPerSecond);
/** Fourth wheel: steps with the seconds hand, 8 steps a second (same expression as model.ts). */
export const fourthWheelAngle = (seconds: number): number =>
  -positiveMod(beatOf(seconds) / TRAIN.beatsPerSecond, 60) / 60 * TAU;
/** Escape wheel: counter-clockwise, half a tooth per beat. */
export const escapeWheelAngle = (seconds: number): number =>
  positiveMod(beatOf(seconds), 2 * TRAIN.escapeTeeth) / (2 * TRAIN.escapeTeeth) * TAU;
/** Pallet fork: against one banking or the other, flipping at every beat. */
export const palletAngle = (seconds: number): number =>
  (positiveMod(beatOf(seconds), 2) === 0 ? 1 : -1) * BACK_SIDE.palletFork.swing;
/** Balance: passes its rest position at every beat. `amplitude` eases to 0 when stopped. */
export const balanceAngle = (seconds: number, amplitude: number): number =>
  amplitude * Math.sin(TAU * BACK_SIDE.balance.hertz * seconds);

/** Reversing wheels turn with the rotor in both directions. */
export const reverserAngle = (rotor: number): number => -rotor * ROTOR_GEAR.teeth / REVERSER_GEAR.teeth;
/** Ratchet turns per rotor turn (either direction, rectified) and per winding turn of the stem. */
export const WINDING = {
  ratchetPerRotorTurn: ROTOR_GEAR.teeth / REVERSER_GEAR.teeth * REVERSER_PINION.teeth / REDUCTION_GEAR.teeth
    * REDUCTION_PINION.teeth / DRIVER_GEAR.teeth * DRIVER_PINION.teeth / ratchetGear.teeth,
  ratchetPerStemTurn: windingPinionGear.teeth / ratchetGear.teeth,
  /** Winding turns the ratchet counter-clockwise seen from the dial (+rotation.y). */
  ratchetSense: 1,
} as const;

/** Stem travel along +x for a crown pull (pulls 0 and 1 are the same stem position). */
export function stemTravel(crownPull: number): number {
  if (crownPull <= 1) return 0;
  if (crownPull <= 2) return STEM_TRAVEL[1] * (crownPull - 1);
  return STEM_TRAVEL[1] + (STEM_TRAVEL[2] - STEM_TRAVEL[1]) * clamp01(crownPull - 2);
}
/** Sliding pinion: out on the winding pinion in position 1, in on the setting wheel from position 2. */
export function slidingPinionShift(crownPull: number): number {
  if (crownPull <= 2) return SLIDING_PINION_SHIFT_QUICKSET * clamp01(crownPull - 1);
  return SLIDING_PINION_SHIFT_QUICKSET + (SLIDING_PINION_SHIFT - SLIDING_PINION_SHIFT_QUICKSET) * clamp01(crownPull - 2);
}
/** 1 in position 2, falling to 0 half a position either side. */
export const quickSetWeight = (crownPull: number): number => clamp01(1 - 2 * Math.abs(crownPull - 2));

// Per-frame functions below read only constants computed here (no Math.hypot or destructuring per call).
const LEVER_RADIUS = planDistance(KEYLESS.settingLever.pivot, KEYLESS.settingLever.pin);
const LEVER_PIN_X = KEYLESS.settingLever.pin[0] - KEYLESS.settingLever.pivot[0];
const LEVER_REST = Math.asin(LEVER_PIN_X / LEVER_RADIUS);
const YOKE_RADIUS = planDistance(KEYLESS.yoke.pivot, KEYLESS.yoke.fork);
const YOKE_FORK_X = KEYLESS.yoke.fork[0] - KEYLESS.yoke.pivot[0];
const YOKE_REST = Math.asin(YOKE_FORK_X / YOKE_RADIUS);

/** Setting lever: its pin rides in the stem groove, so it turns as the stem slides. */
export function settingLeverAngle(crownPull: number): number {
  return Math.asin(Math.min(1, (LEVER_PIN_X + stemTravel(crownPull)) / LEVER_RADIUS)) - LEVER_REST;
}
/** Yoke: its fork follows the sliding pinion along the stem. */
export function yokeAngle(crownPull: number): number {
  return Math.asin((YOKE_FORK_X + slidingPinionShift(crownPull)) / YOKE_RADIUS) - YOKE_REST;
}
/** Switching lever: carries the setting wheel onto the double corrector in position 2. */
export const switchLeverAngle = (crownPull: number): number => KEYLESS.switchLever.swing * quickSetWeight(crownPull);
const LEVER_AT_2 = settingLeverAngle(2);
const LEVER_AT_3 = settingLeverAngle(3);
/** Stop lever: 0 at rest, 1 on the balance rim. The setting lever turns it as it goes from position 2 to 3. */
export const stopLeverEngagement = (crownPull: number): number =>
  clamp01((settingLeverAngle(crownPull) - LEVER_AT_2) / (LEVER_AT_3 - LEVER_AT_2));
/** Setting wheel while it meshes the minute wheel (positions 1 and 3). */
export const settingWheelAngle = (minutes: number): number =>
  -minuteWheelAngle(minutes) * minuteWheelGear.teeth / settingWheelGear.teeth;
/** Setting wheel per radian of crown turn while it is driven by the sliding pinion (position 2). */
export const SETTING_WHEEL_PER_CROWN = -slidingPinionGear.teeth / settingWheelLowerGear.teeth;
/** Double corrector per radian of setting-wheel turn. */
export const CORRECTOR_PER_SETTING_WHEEL = -settingWheelGear.teeth / correctorGear.teeth;
