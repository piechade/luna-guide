// The calendar-relevant state of the movement, independent of rendering and of
// the wall clock.
//
// A twelve-hour dial cannot show which half of the day the movement is in, but
// the calendar depends on it: the date ring and the moon disc are switched by
// the gear train once per 24 hours, at the movement's own midnight — never at
// noon. Everything that moves the hands goes through `turnTo`, so a date change
// is always the consequence of the hands passing midnight, in every mode.

export const DAY = 1440;
export const HALF_DAY = 720;
/**
 * The calendar's switching window in movement time. No maker publishes one for
 * this watch; figures for the calibre family are 20–02, 21–03 and 20–04 h. The
 * guide avoids the widest: quick corrections stay outside 20:00–04:00.
 */
export const LOCKOUT_FROM = 20 * 60;
export const LOCKOUT_UNTIL = 4 * 60;
/** The date ring has 31 positions regardless of the month. */
export const DATE_POSITIONS = 31;
/** Daily steps of the moon disc per revolution; it carries two moons. In the calibre a 14-point star wheel with a 28-leaf pinion moves a wheel of 118 teeth two teeth per step: 14 × 118 / 28 = 59. */
export const MOON_TEETH = 59;

export const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** The first midnight strictly after `minutes` on the continuous time axis. */
export const nextMidnight = (minutes: number): number => (Math.floor(minutes / DAY) + 1) * DAY;

/** True when `phase` (a time of day in minutes) lies in (from, to] going forwards. */
export function passes(from: number, to: number, phase: number): boolean {
  if (to <= from) return false;
  const first = Math.floor((from - phase) / DAY) * DAY + phase + DAY; // first occurrence after `from`
  return first <= to;
}

export interface MechanismSnapshot {
  minuteOfDay: number;
  date: number;
  moon: number;
}

export class Mechanism {
  /** Movement time in minutes on a continuous axis; multiples of 1440 are midnights. */
  minutes = 0;
  /** Date ring position, 1..31. */
  date = 1;
  /** Moon disc position in daily steps. A moon is centred at multiples of 29.5. */
  moon = 0;
  /**
   * Index of the last midnight whose tooth the date finger has pushed (midnight
   * k lies at k * DAY). The finger can push the next tooth only at a later
   * midnight, or again at the same one after the hands went back to before
   * 20:00 of its evening.
   */
  private pushed = 0;

  /** Put the movement into a known state, e.g. the moment it stopped. */
  set(state: MechanismSnapshot): void {
    this.minutes = mod(state.minuteOfDay, DAY);
    this.date = mod(Math.round(state.date) - 1, DATE_POSITIONS) + 1;
    this.moon = state.moon;
    // The midnight at the start of this day has been switched.
    this.pushed = 0;
  }

  get minuteOfDay(): number { return mod(this.minutes, DAY); }
  /** The coming midnight will still switch the calendar: its tooth has not been pushed yet. */
  get armed(): boolean { return this.pushed < Math.floor(this.minutes / DAY) + 1; }
  /** Position of the hands on the twelve-hour dial, in minutes after 12. */
  get dialMinutes(): number { return mod(this.minutes, HALF_DAY); }
  get isAfternoon(): boolean { return this.minuteOfDay >= HALF_DAY; }
  /** Quick corrections are forbidden while the calendar wheels are engaged. */
  get inLockout(): boolean {
    const m = this.minuteOfDay;
    return m >= LOCKOUT_FROM || m < LOCKOUT_UNTIL;
  }
  /** How far the hands have to go forward to leave the switching window; 0 outside it. */
  get minutesToLockoutEnd(): number {
    return this.inLockout ? mod(LOCKOUT_UNTIL - this.minuteOfDay, DAY) : 0;
  }

  /**
   * Move the hands to `target` on the continuous axis, by the crown or by the
   * running movement. Returns how many times the calendar switched on the way.
   *
   * Forwards, every midnight that is reached or passed advances the date ring
   * and the moon disc by one. Backwards nothing switches back: the sprung
   * finger slips past the teeth, as on the real mechanism.
   */
  turnTo(target: number): number {
    const from = this.minutes;
    let switched = 0;
    if (target > from) {
      for (let k = Math.floor(from / DAY) + 1; k * DAY <= target; k++) {
        if (k <= this.pushed) continue;
        this.date = (this.date % DATE_POSITIONS) + 1;
        this.moon += 1;
        this.pushed = k;
        switched++;
      }
    } else if (target < from) {
      // Back before 20:00 the finger is behind the tooth of the coming midnight again.
      this.pushed = Math.min(this.pushed, Math.floor((target + DAY - LOCKOUT_FROM) / DAY));
    }
    this.minutes = target;
    return switched;
  }

  turn(deltaMinutes: number): number { return this.turnTo(this.minutes + deltaMinutes); }

  /** Quick-set in crown position 2, towards twelve: one day forward. */
  quickDate(): void { this.date = (this.date % DATE_POSITIONS) + 1; }
  /** Quick-set in crown position 2, towards six: one step forward. */
  quickMoon(): void { this.moon += 1; }

  /** Quick-set clicks until `day` shows in the window (the ring only goes forward). */
  clicksToDate(day: number): number { return mod(day - this.date, DATE_POSITIONS); }

  /**
   * Quick-set clicks until a moon stands centred in the aperture. The second
   * moon sits half a step off the grid, so it counts as centred on the first
   * step at or after its exact pose.
   */
  clicksToFullMoonPose(): number {
    const p = mod(this.moon, MOON_TEETH);
    if (p === 0) return 0;
    return p <= 30 ? 30 - p : MOON_TEETH - p;
  }
}
