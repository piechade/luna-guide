// Astronomical moon phase math. Pure functions of the given date — no I/O.
//
// New and full moon instants follow Jean Meeus, "Astronomical Algorithms"
// (2nd ed.), chapter 49: the mean phase plus its periodic terms, good to a few
// minutes. That matters here because the moon disc is set by counting whole
// calendar days since the DATE of the last full moon — a mean lunation is off
// by up to half a day and would name the wrong date about one time in seven.

export const SYNODIC_MONTH = 29.530588861; // mean length in days
const MS_PER_DAY = 86_400_000;
/** Terrestrial time minus UTC, in seconds (2020s). An error of a few seconds is irrelevant here. */
const DELTA_T_SECONDS = 69;
const J1970 = 2440587.5;
const MEAN_NEW_MOON_JDE = 2451550.09766; // k = 0: 6 January 2000

const rad = (degrees: number): number => degrees * Math.PI / 180;

/** [coefficient new moon, coefficient full moon, multiples of M, M', F, Ω, power of E] */
const PERIODIC: ReadonlyArray<readonly [number, number, number, number, number, number, number]> = [
  [-0.40720, -0.40614, 0, 1, 0, 0, 0],
  [0.17241, 0.17302, 1, 0, 0, 0, 1],
  [0.01608, 0.01614, 0, 2, 0, 0, 0],
  [0.01039, 0.01043, 0, 0, 2, 0, 0],
  [0.00739, 0.00734, -1, 1, 0, 0, 1],
  [-0.00514, -0.00515, 1, 1, 0, 0, 1],
  [0.00208, 0.00209, 2, 0, 0, 0, 2],
  [-0.00111, -0.00111, 0, 1, -2, 0, 0],
  [-0.00057, -0.00057, 0, 1, 2, 0, 0],
  [0.00056, 0.00056, 1, 2, 0, 0, 1],
  [-0.00042, -0.00042, 0, 3, 0, 0, 0],
  [0.00042, 0.00042, 1, 0, 2, 0, 1],
  [0.00038, 0.00038, 1, 0, -2, 0, 1],
  [-0.00024, -0.00024, -1, 2, 0, 0, 1],
  [-0.00017, -0.00017, 0, 0, 0, 1, 0],
  [-0.00007, -0.00007, 2, 1, 0, 0, 0],
  [0.00004, 0.00004, 0, 2, -2, 0, 0],
  [0.00004, 0.00004, 3, 0, 0, 0, 0],
  [0.00003, 0.00003, 1, 1, -2, 0, 0],
  [0.00003, 0.00003, 0, 2, 2, 0, 0],
  [-0.00003, -0.00003, 1, 1, 2, 0, 0],
  [0.00003, 0.00003, -1, 1, 2, 0, 0],
  [-0.00002, -0.00002, -1, 1, -2, 0, 0],
  [-0.00002, -0.00002, 1, 3, 0, 0, 0],
  [0.00002, 0.00002, 0, 4, 0, 0, 0],
];
/** Planetary arguments: [constant, rate per lunation, coefficient in 1e-6 days]. */
const PLANETARY: ReadonlyArray<readonly [number, number, number]> = [
  [299.77, 0.107408, 325], [251.88, 0.016321, 165], [251.83, 26.651886, 164], [349.42, 36.412478, 126],
  [84.66, 18.206239, 110], [141.74, 53.303771, 62], [207.14, 2.453732, 60], [154.84, 7.306860, 56],
  [34.52, 27.261239, 47], [207.19, 0.121824, 42], [291.34, 1.844379, 40], [161.72, 24.198154, 37],
  [239.56, 25.513099, 35], [331.55, 3.592518, 23],
];

/** Epoch milliseconds of the true new moon (whole k) or full moon (k + 0.5). */
function phaseInstant(k: number): number {
  const full = Math.abs(k - Math.floor(k) - 0.5) < 0.01;
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = rad(2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3);
  const Mp = rad(201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4);
  const F = rad(160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4);
  const omega = rad(124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3);
  let jde = MEAN_NEW_MOON_JDE + SYNODIC_MONTH * k + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;
  for (const [newMoon, fullMoon, m, mp, f, om, e] of PERIODIC) {
    jde += (full ? fullMoon : newMoon) * E ** e * Math.sin(m * M + mp * Mp + f * F + om * omega);
  }
  PLANETARY.forEach(([constant, rate, coefficient], index) => {
    const secular = index === 0 ? -0.009173 * T2 : 0; // only the first argument has a T² term
    jde += coefficient * 1e-6 * Math.sin(rad(constant + rate * k + secular));
  });
  return (jde - J1970) * MS_PER_DAY - DELTA_T_SECONDS * 1000;
}

/** Index k of the latest phase of the given kind (0 = new, 0.5 = full) at or before `time`. */
function phaseIndexBefore(time: number, kind: 0 | 0.5): number {
  const mean = (time / MS_PER_DAY + J1970 - MEAN_NEW_MOON_JDE) / SYNODIC_MONTH;
  let k = Math.floor(mean - kind) + kind;
  while (phaseInstant(k) > time) k -= 1;
  while (phaseInstant(k + 1) <= time) k += 1;
  return k;
}

/** The latest full moon at or before `date`, and the first one after it. */
export function fullMoonBefore(date: Date): Date {
  return new Date(phaseInstant(phaseIndexBefore(date.getTime(), 0.5)));
}
export function fullMoonAfter(date: Date): Date {
  return new Date(phaseInstant(phaseIndexBefore(date.getTime(), 0.5) + 1));
}

/** A calendar day of the device's time zone as a running number; differences are whole days, also across DST. */
const dayNumber = (d: Date): number => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY);
/** Whole calendar days from `from` to `to` in local time. */
export const calendarDaysBetween = (from: Date, to: Date): number => dayNumber(to) - dayNumber(from);

/** The full moon whose local calendar date is the latest one not after `day`. */
export function fullMoonOnOrBefore(day: Date): Date {
  return fullMoonBefore(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999));
}

/**
 * The makers' count for the moon disc: whole calendar days from the date of the
 * last full moon to `day` — 0 on the day of the full moon itself, at most 29.
 * One quick-set click per counted day, starting from the centred moon.
 */
export function daysSinceFullMoonDate(day: Date): number {
  return calendarDaysBetween(fullMoonOnOrBefore(day), day);
}

export interface MoonState {
  /** Days since the last new moon. */
  ageDays: number;
  /** Position in the lunation, 0 = new moon, 0.5 = full moon, in [0, 1). */
  phaseFraction: number;
  /** Illuminated fraction of the moon's disc, 0..1. */
  illumination: number;
  waxing: boolean;
  /** German phase name. */
  name: string;
  /** Days elapsed since the last full moon, as a fraction. */
  daysSinceFullMoon: number;
  /** Quick-set clicks from the centred moon: whole calendar days since the date of the last full moon. */
  clicksFromFullMoon: number;
  lastFullMoon: Date;
  nextFullMoon: Date;
  nextFullMoonInDays: number;
}

export function moonState(date: Date = new Date()): MoonState {
  const time = date.getTime();
  const k = phaseIndexBefore(time, 0);
  const lastNew = phaseInstant(k);
  const full = phaseInstant(k + 0.5);
  const nextNew = phaseInstant(k + 1);
  const waxing = time < full;
  // Each half of the lunation is mapped onto half a turn, so the full moon sits exactly at 0.5.
  const phaseFraction = waxing
    ? 0.5 * (time - lastNew) / (full - lastNew)
    : 0.5 + 0.5 * (time - full) / (nextNew - full);
  const lastFullMoon = fullMoonBefore(date);
  const nextFullMoon = fullMoonAfter(date);
  return {
    ageDays: (time - lastNew) / MS_PER_DAY,
    phaseFraction,
    illumination: (1 - Math.cos(phaseFraction * Math.PI * 2)) / 2,
    waxing,
    name: phaseName(phaseFraction),
    daysSinceFullMoon: (time - lastFullMoon.getTime()) / MS_PER_DAY,
    clicksFromFullMoon: daysSinceFullMoonDate(date),
    lastFullMoon,
    nextFullMoon,
    nextFullMoonInDays: (nextFullMoon.getTime() - time) / MS_PER_DAY,
  };
}

/** The principal phases are named for about a day on either side of the exact instant. */
function phaseName(fraction: number): string {
  const window = 1 / SYNODIC_MONTH;
  if (fraction < window || fraction > 1 - window) return 'Neumond';
  if (fraction < 0.25 - window) return 'Zunehmende Sichel';
  if (fraction < 0.25 + window) return 'Erstes Viertel';
  if (fraction < 0.5 - window) return 'Zunehmender Mond';
  if (fraction < 0.5 + window) return 'Vollmond';
  if (fraction < 0.75 - window) return 'Abnehmender Mond';
  if (fraction < 0.75 + window) return 'Letztes Viertel';
  return 'Abnehmende Sichel';
}
