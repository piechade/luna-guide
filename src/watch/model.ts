import * as THREE from 'three';
import { CROWN_BASE_X, CROWN_TRAVEL, CROWN_Y } from './dimensions';
import { makeMaterials, type WatchMaterials } from './materials';
import { makeCase } from './case';
import { makeBracelet } from './bracelet';
import { makeDial, type DialParts } from './dial';
import { makeHands, type HandParts } from './hands';
import { makeCrown, type CrownParts } from './crown';
import type { Movement } from './movement/movement';
import { DATE_POSITIONS, Mechanism, mod } from './mechanism';

export { CROWN_LABELS } from './labels';

/** Sector opacity while the calendar wheels are engaged, and while they are not. */
const ZONE_ENGAGED = 0.6;
const ZONE_IDLE = 0.2;
/** The opened caseback drops this far and slides out of the picture towards three o'clock: away
 * from the camera of the opened back, which looks up from the nine o'clock side. */
const BACK_DROP = 30;
const BACK_SLIDE = 80;
/** The oscillating weight as a damped pendulum about the dial axis: stiffness per unit of the
 * gravity that lies in the movement's plane (1/s²), damping (1/s) and integration step (s). */
const ROTOR_STIFFNESS = 40;
const ROTOR_DAMPING = 3;
const ROTOR_STEP = 1 / 120;

const smooth = (v: number): number => v * v * (3 - 2 * v);
const nextTask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/**
 * The visible watch. All time and calendar state lives in `mech`; this class
 * only draws it, so hands, date window, moon disc and movement can never
 * disagree.
 */
export class WatchModel {
  readonly group = new THREE.Group();
  readonly bracelet: THREE.Group;
  readonly mech = new Mechanism();
  /** Crown position 0 (screwed down) to 3 (time setting); fractional while moving. */
  crownPull = 0;
  /** The balance is swinging: the movement advances in real time. */
  running = false;
  displaySeconds = 34;
  /** 0..1: how prominently the switching-window sector (20:00–04:00) is drawn on the dial. */
  zone = 0;
  /** 0 = assembled, 1 = opened from the front: crystal, hands and dial lifted away from the movement. */
  explode = 0;
  /** 0 = closed, 1 = opened from the back: the caseback dropped away from the rotor side. */
  openBack = 0;
  /** The camera, if any: the oscillating weight hangs towards the bottom of its picture, so turning
   * the view swings it like turning the watch in the hand. */
  viewer: THREE.Object3D | null = null;
  /** Angle of the oscillating weight (rotation.y). */
  rotor = 0;
  private rotorSpeed = 0;
  private readonly materials: WatchMaterials;
  private readonly dial: DialParts;
  private readonly hands: HandParts;
  private readonly crown: CrownParts;
  private readonly caseTop: THREE.Group;
  private readonly caseBack: THREE.Group;
  /** Built on the first opening (see loadMovement), then kept. */
  private movement: Movement | null = null;
  private movementLoad: Promise<void> | null = null;
  /** The movement's groups are in the scene graph only while the watch is open. */
  private movementShown = false;
  /** The rotor side is shown (the back is open). */
  private rotorShown = false;
  /** While set, the movement follows the device clock from this moment on. */
  private anchor: { epochMs: number; minutes: number; seconds: number } | null = null;
  private shownDate = 1;
  private shownMoon = 0;
  private shownZone = 0;
  constructor() {
    this.group.name = 'Luna Guide · original study model v2';
    this.materials = makeMaterials();
    const watchCase = makeCase(this.materials);
    this.caseTop = watchCase.top;
    this.caseBack = watchCase.back;
    this.bracelet = makeBracelet(this.materials);
    this.dial = makeDial(this.materials);
    this.hands = makeHands(this.materials);
    this.crown = makeCrown(this.materials);
    this.group.add(watchCase.group, this.bracelet, this.dial.group, this.hands.group, this.crown.carriage, this.crown.tube);
    this.snap();
  }

  set crownSpin(a: number) { this.crown.spinner.rotation.x = a; }
  get crownSpin(): number { return this.crown.spinner.rotation.x; }

  /** The movement is built and can be shown. */
  get movementReady(): boolean { return this.movement !== null; }

  /** The movement's groups (empty until it is built), e.g. to compile their shaders before they show. */
  get movementGroups(): readonly THREE.Group[] { return this.movement?.groups ?? []; }

  /** Downloads and builds the movement, once; settles when it can be shown. A failed download may be retried. */
  loadMovement(): Promise<void> {
    this.movementLoad ??= import('./movement/movement')
      .then(({ buildMovement }) => buildMovement(this.materials, nextTask))
      .then(movement => {
        this.movement = movement;
      })
      .catch((error: unknown) => {
        this.movementLoad = null;
        throw error;
      });
    return this.movementLoad;
  }

  /** Run in step with the device clock from `epochMs` on (the second hand at `seconds` then). */
  lockToClock(epochMs: number, seconds: number): void {
    this.anchor = { epochMs, minutes: this.mech.minutes, seconds };
    this.running = true;
  }

  releaseClock(): void { this.anchor = null; }
  get lockedToClock(): boolean { return this.anchor !== null; }

  /** Show the device's time, date and the given moon position, and keep running with it. */
  showWallClock(now: Date, moon: number): void {
    const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
    this.mech.set({ minuteOfDay: now.getHours() * 60 + now.getMinutes() + seconds / 60, date: now.getDate(), moon });
    this.displaySeconds = seconds;
    this.lockToClock(now.getTime(), seconds);
  }

  /** Jump the displays to the movement's state without animating the change. */
  snap(): void {
    this.shownDate = this.mech.date;
    this.shownMoon = this.mech.moon;
    this.shownZone = this.zoneTarget();
    this.tick(0);
  }

  private zoneTarget(): number {
    return this.zone * (this.mech.inLockout ? ZONE_ENGAGED : ZONE_IDLE);
  }

  tick(dt: number): void {
    const { mech } = this;
    if (this.anchor) {
      const elapsed = Date.now() - this.anchor.epochMs;
      const target = this.anchor.minutes + elapsed / 60_000;
      if (target > mech.minutes) mech.turnTo(target); // a device clock set back never turns the hands back
      this.displaySeconds = this.anchor.seconds + elapsed / 1000;
    } else if (this.running) {
      mech.turn(dt / 60);
      this.displaySeconds += dt;
    }

    const dial = mech.dialMinutes;
    this.hands.minute.rotation.y = -(dial % 60) / 60 * Math.PI * 2;
    this.hands.hour.rotation.y = -dial / 720 * Math.PI * 2;
    // Eight impulses per second represent the 28,800 A/h reference movement.
    this.hands.second.rotation.y = -mod(Math.floor(this.displaySeconds * 8) / 8, 60) / 60 * Math.PI * 2;
    this.crown.carriage.position.set(CROWN_BASE_X + this.crownPull * CROWN_TRAVEL, CROWN_Y, 0);

    // Date ring and moon disc jump quickly but visibly; both only ever move forward.
    const dateAhead = mod(mech.date - this.shownDate, DATE_POSITIONS);
    this.shownDate = dateAhead < 0.004 || dateAhead > DATE_POSITIONS - 0.5
      ? mech.date
      : this.shownDate + dateAhead * (1 - Math.exp(-dt * 26));
    const moonAhead = mech.moon - this.shownMoon;
    this.shownMoon = moonAhead < 0.004 ? mech.moon : this.shownMoon + moonAhead * (1 - Math.exp(-dt * 20));
    this.shownZone += (this.zoneTarget() - this.shownZone) * (1 - Math.exp(-dt * 8));
    this.dial.setDate(this.shownDate);
    this.dial.setMoon(this.shownMoon);
    this.dial.setDanger(this.shownZone);

    // Opening the watch from the front: crystal, hands and dial rise out of the
    // picture one after the other, so nothing is left between the eye and the
    // works. From the back the caseback drops away.
    const lift = smooth(this.explode);
    const open = this.explode >= 1;
    this.caseTop.position.y = lift * 150;
    this.hands.group.position.y = lift * 105;
    this.dial.face.position.y = lift * 60;
    this.caseTop.visible = this.hands.group.visible = this.dial.face.visible = !open;
    const away = smooth(this.openBack);
    this.caseBack.position.set(away * away * BACK_SLIDE, -away * BACK_DROP, 0);
    this.caseBack.visible = this.openBack < 1;
    this.drawMovement(dt);
  }

  /** Feeds the movement while the watch is open; while it is closed the movement is out of the scene graph. */
  private drawMovement(dt: number): void {
    const front = this.explode > 0.001;
    const back = this.openBack > 0.001;
    const mv = this.movement;
    if (!mv) {
      // Normally the UI waits for loadMovement() before it opens the watch.
      if (front || back) void this.loadMovement().catch(() => undefined);
      return;
    }
    const shown = front || back;
    if (shown !== this.movementShown) {
      this.movementShown = shown;
      for (const g of mv.groups) {
        if (shown) this.group.add(g);
        else this.group.remove(g);
      }
      if (shown) mv.keyless.resync();
    }
    // The weight is only seen, and only swings, with the back open; it comes to rest at once when the
    // back opens, which the keyless works must not count as winding.
    if (back !== this.rotorShown) {
      this.rotorShown = back;
      if (back) {
        const rest = this.rotorRest();
        this.rotorSpeed = 0;
        this.rotor -= Math.atan2(Math.sin(this.rotor - rest), Math.cos(this.rotor - rest));
        mv.keyless.resync();
      }
    }
    if (!shown) return;
    mv.dialSide.group.visible = front;
    mv.backSide.rotorSide.visible = back;
    if (back) this.swingRotor(dt);
    const s = mv.state;
    s.minutes = this.mech.minutes;
    s.minuteOfDay = this.mech.minuteOfDay;
    s.date = this.shownDate;
    s.moon = this.shownMoon;
    s.crownPull = this.crownPull;
    s.crownSpin = this.crownSpin;
    s.seconds = this.displaySeconds;
    s.running = this.running;
    s.rotor = this.rotor;
    s.armed = this.mech.armed;
    s.dt = dt;
    mv.keyless.update(s);
    if (front) mv.dialSide.update(s);
    if (back) mv.backSide.update(s);
  }

  // Gravity as the viewer sees it: the bottom of the picture, laid into the
  // movement's plane. Its share in that plane (0 seen edge-on, 1 seen face-on)
  // sets how strongly the weight is pulled.
  private gravityX = 0;
  private gravityZ = 1;

  private readGravity(): void {
    const v = this.viewer;
    if (!v) { this.gravityX = 0; this.gravityZ = 1; return; }
    v.updateMatrixWorld();
    const e = v.matrixWorld.elements;
    this.gravityX = -e[4];
    this.gravityZ = -e[6];
  }

  /** The weight's angle at rest: like a real oscillating weight, its heavy side (local +z) hangs towards the bottom of the picture. */
  private rotorRest(): number {
    this.readGravity();
    return Math.atan2(this.gravityX, this.gravityZ);
  }

  private swingRotor(dt: number): void {
    const rest = this.rotorRest();
    const pull = ROTOR_STIFFNESS * Math.hypot(this.gravityX, this.gravityZ);
    for (let left = dt; left > 1e-6; left -= ROTOR_STEP) {
      const h = Math.min(ROTOR_STEP, left);
      this.rotorSpeed += (-pull * Math.sin(this.rotor - rest) - ROTOR_DAMPING * this.rotorSpeed) * h;
      this.rotor += this.rotorSpeed * h;
    }
    // Settled: come to rest exactly, so a still picture stays still.
    const off = Math.atan2(Math.sin(this.rotor - rest), Math.cos(this.rotor - rest));
    if (Math.abs(this.rotorSpeed) < 1e-3 && Math.abs(off) < 1e-3) {
      this.rotorSpeed = 0;
      this.rotor -= off;
    }
  }
}
