// What has to be set, derived from the wall clock. Pure: no DOM, no rendering.
//
// A twelve-hour dial does not show in which half of the day a stopped watch
// stands, and the calendar switches only at the movement's own midnight. The
// procedure therefore never assumes the half of the day. It is the one POINTtec
// publishes for the Sellita SW200/SW280/SW290:
//
//   1. Hands on a position that is clear of the calendar's switching window in
//      both halves of the day, so quick corrections are safe without knowing
//      which half it is. POINTtec uses six o'clock; this guide uses five: 05:00
//      is past every published window and 17:00 leaves three hours before
//      20:00 for a watch that runs on while parked. At five the hour hand also
//      stays clear of the moon aperture, which has to be judged in step 5.
//   2. Date to the number before today's, moon one day short.
//   3. Hands forward until the date jumps to today — that is the movement's
//      midnight, so the half of the day is now proven — and on to the real time.
//
// The midnight pass is always part of the way, so there is no special case for
// the time of day. What "the number before today" is gets decided once, when
// the calendar is set (`makePlan`); the time-setting step (`timeSetting`) counts
// the calendar days from there, so a real midnight passing while the owner is
// busy only adds a second date jump instead of leaving the watch a day behind.

import { calendarDaysBetween, daysSinceFullMoonDate } from './moon';
import { DATE_POSITIONS, DAY, HALF_DAY, mod, nextMidnight, type MechanismSnapshot } from './watch/mechanism';

/** Safe position for the quick corrections, as shown by the hands: five o'clock. */
export const PARK_DIAL_MINUTE = 5 * 60;
/** Close enough to it: a quarter of an hour either side (04:45 is still past the widest published window). */
export const PARK_TOLERANCE = 15;
/** Time the owner needs to position the hands before the reference minute. */
const SETTING_LEAD_MS = 12_000;

/** The full minute on which the watch is started in sync with the reference. */
export function syncTarget(now: Date): Date {
  return new Date(Math.floor((now.getTime() + SETTING_LEAD_MS) / 60_000) * 60_000 + 60_000);
}

export const minuteOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes();
const startOfDay = (d: Date, shiftDays = 0): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + shiftDays);

/** What the calendar is set to while the watch is parked. Decided once per run of the guide. */
export interface Plan {
  /** The calendar day the calendar is set to: the day before the reference minute's. */
  parkDay: Date;
  /** Number the date window must show while the watch is parked: the one before today's on the ring. */
  parkDate: number;
  /** Quick-set clicks after the centred moon while parked: calendar days from the last full moon to `parkDay`. */
  moonClicksAtPark: number;
}

export function makePlan(now: Date): Plan {
  const target = syncTarget(now);
  const parkDay = startOfDay(target, -1);
  return {
    parkDay,
    // One position back on the 31-position date ring, which is not always
    // yesterday's date: before the 1st the ring shows 31.
    parkDate: mod(target.getDate() - 2, DATE_POSITIONS) + 1,
    moonClicksAtPark: daysSinceFullMoonDate(parkDay),
  };
}

/** A plan made days ago no longer describes the watch; the calendar steps have to be planned anew. */
export function planIsCurrent(plan: Plan, now: Date): boolean {
  const days = calendarDaysBetween(plan.parkDay, syncTarget(now));
  return days === 1 || days === 2;
}

/** What turning the hands to the reference minute does to a watch set according to `plan`. */
export interface TimeSetting {
  /** The minute the watch will be started on. */
  target: Date;
  targetMinuteOfDay: number;
  /** Midnights the hands pass on the way: one, or two when a real midnight has passed since the calendar was set. */
  midnightPasses: number;
  /** What the date window shows afterwards (the ring knows no months). */
  finalDate: number;
  /** Calendar days since the last full moon on the day of the reference minute. */
  moonDaysFinal: number;
}

export function timeSetting(plan: Plan, now: Date): TimeSetting {
  const target = syncTarget(now);
  const midnightPasses = Math.max(1, calendarDaysBetween(plan.parkDay, target));
  return {
    target,
    targetMinuteOfDay: minuteOfDay(target),
    midnightPasses,
    finalDate: mod(plan.parkDate - 1 + midnightPasses, DATE_POSITIONS) + 1,
    moonDaysFinal: daysSinceFullMoonDate(target),
  };
}

/** A watch that ran down at some unknown point of the day, a few days ago. */
export type Scenario = MechanismSnapshot;

/**
 * The stopped watch of the demonstration. The time of day is arbitrary, in
 * either half of the day: that the dial does not reveal which is the point.
 */
export function makeScenario(now: Date, random: () => number = Math.random): Scenario {
  const hours = [1, 2, 3, 7, 8, 9, 10]; // keeps the hands clear of 12 and of the parking position
  const hour = hours[Math.floor(random() * hours.length)];
  const minute = 4 + Math.floor(random() * 53);
  const afternoon = random() < 0.5;
  const stopped = new Date(now);
  stopped.setDate(stopped.getDate() - 3 - Math.floor(random() * 2));
  return {
    minuteOfDay: (afternoon ? 12 : 0) * 60 + hour * 60 + minute,
    date: stopped.getDate(),
    moon: -(6 + Math.floor(random() * 6)), // a handful of teeth short of a centred moon
  };
}

/** The same stopped watch, twelve hours earlier or later: the dial looks identical. */
export function otherHalf(scenario: Scenario): Scenario {
  return { ...scenario, minuteOfDay: mod(scenario.minuteOfDay + DAY / 2, DAY) };
}

/** Parse `HH:MM` (24 h) into a minute of the day, or null. */
export function parseClock(text: string | null): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

// Where the hands have to go, as targets on the movement's continuous time
// axis. Midnights are whole multiples of a day there, so a target of exactly
// midnight is hit exactly and counts as passing it.

interface TimeAxis { minutes: number }

/** Step "park": forward until the hands show five o'clock; no move when they are within a quarter of an hour of it. */
export function parkTarget(mech: TimeAxis): number {
  const dial = mod(mech.minutes, HALF_DAY);
  if (Math.abs(dial - PARK_DIAL_MINUTE) <= PARK_TOLERANCE) return mech.minutes;
  const half = mech.minutes - dial;
  return dial < PARK_DIAL_MINUTE ? half + PARK_DIAL_MINUTE : half + HALF_DAY + PARK_DIAL_MINUTE;
}

/**
 * Step "set the time": forward over the next midnight — wherever in the day
 * the movement stands — plus any further planned ones, and on to the reference
 * minute. Counting midnights (not looking at the hand position) is what makes
 * the result independent of the half of the day the watch was parked in.
 */
export function timeTarget(mech: TimeAxis, setting: TimeSetting): number {
  return nextMidnight(mech.minutes) + (setting.midnightPasses - 1) * DAY + setting.targetMinuteOfDay;
}
