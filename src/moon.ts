// Astronomical moon phase math. Pure functions of the given date — no I/O.

export const SYNODIC_MONTH = 29.530588853; // days
// Reference new moon: 2000-01-06 18:14 UTC (JD 2451550.1)
const NEW_MOON_REF_UTC = Date.UTC(2000, 0, 6, 18, 14, 0);
const MS_PER_DAY = 86_400_000;

export interface MoonState {
  /** Days since the last new moon, in [0, SYNODIC_MONTH). */
  ageDays: number;
  /** ageDays / SYNODIC_MONTH, in [0, 1). */
  phaseFraction: number;
  /** Illuminated fraction of the moon's disc, 0..1. */
  illumination: number;
  waxing: boolean;
  /** German phase name. */
  name: string;
  /** Days elapsed since the last full moon (0..29.5). */
  daysSinceFullMoon: number;
  /** Crown clicks from the full-moon position (1 click = 1 day), rounded. */
  clicksFromFullMoon: number;
  lastFullMoon: Date;
  nextFullMoonInDays: number;
}

export function moonState(date: Date = new Date()): MoonState {
  const days = (date.getTime() - NEW_MOON_REF_UTC) / MS_PER_DAY;
  const ageDays = ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const phaseFraction = ageDays / SYNODIC_MONTH;
  const illumination = (1 - Math.cos(phaseFraction * Math.PI * 2)) / 2;
  const waxing = ageDays < SYNODIC_MONTH / 2;
  const half = SYNODIC_MONTH / 2;
  const daysSinceFullMoon = (ageDays - half + SYNODIC_MONTH) % SYNODIC_MONTH;
  const clicksFromFullMoon = Math.round(daysSinceFullMoon) % 30;
  const lastFullMoon = new Date(date.getTime() - daysSinceFullMoon * MS_PER_DAY);
  const nextFullMoonInDays = (half - ageDays + SYNODIC_MONTH) % SYNODIC_MONTH;

  return {
    ageDays,
    phaseFraction,
    illumination,
    waxing,
    name: phaseName(ageDays),
    daysSinceFullMoon,
    clicksFromFullMoon,
    lastFullMoon,
    nextFullMoonInDays,
  };
}

function phaseName(age: number): string {
  if (age < 1.0 || age > SYNODIC_MONTH - 1.0) return 'Neumond';
  if (age < 6.38) return 'Zunehmende Sichel';
  if (age < 8.38) return 'Erstes Viertel';
  if (age < 13.77) return 'Zunehmender Mond';
  if (age < 15.77) return 'Vollmond';
  if (age < 21.15) return 'Abnehmender Mond';
  if (age < 23.15) return 'Letztes Viertel';
  return 'Abnehmende Sichel';
}
