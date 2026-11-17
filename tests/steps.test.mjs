// The instruction texts themselves: they must not depend on the time of day at
// which they were rendered, and every variant must be a complete sentence.
process.env.TZ = 'Europe/Berlin';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load.mjs';

const { STEPS, CALENDAR_STEP } = await loadModule('../../src/steps.ts');
const { makePlan } = await loadModule('../../src/plan.ts');
const { moonState } = await loadModule('../../src/moon.ts');

const body = (step, planAt, now = planAt) => STEPS[step - 1].body({ now, moon: moonState(now), plan: makePlan(planAt) });
const text = html => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

test('seven steps; every text renders for every hour of awkward days without holes', () => {
  assert.equal(STEPS.length, 7);
  assert.equal(CALENDAR_STEP, 3);
  for (const [y, m, d] of [[2026, 10, 13], [2026, 11, 1], [2027, 2, 1], [2028, 1, 29], [2026, 10, 24], [2026, 10, 25], [2026, 2, 29]]) {
    for (let minute = 0; minute < 1440; minute += 7) {
      const now = new Date(y, m, d, 0, minute, 30);
      for (let step = 1; step <= 7; step++) {
        const html = body(step, now);
        assert.doesNotMatch(html, /undefined|NaN|\[object|Invalid Date/, `step ${step} at ${now.toString()}`);
        assert.equal((html.match(/<(p|div|ol|li)\b/g) ?? []).length, (html.match(/<\/(p|div|ol|li)>/g) ?? []).length, `balanced markup in step ${step}`);
      }
    }
  }
});

test('step 6 says the same whatever the time of day, so noon or midnight may pass while it is open', () => {
  const plan = new Date(2026, 10, 13, 9, 0, 0);
  const reference = body(6, plan, new Date(2026, 10, 13, 9, 5, 0));
  for (const [h, min] of [[11, 50], [11, 59], [12, 0], [12, 10], [17, 5], [23, 40], [23, 58]]) {
    assert.equal(body(6, plan, new Date(2026, 10, 13, h, min, 0)), reference, `rendered at ${h}:${min}`);
  }
  const plain = text(reference);
  assert.match(plain, /Das Datumsfenster zeigt die 12 aus Schritt 4/);
  assert.match(plain, /Das Datum springt auf 13: Im Werk ist Mitternacht/);
  assert.match(plain, /vor 12:00 Uhr: die Zwölf nicht noch einmal überfahren/);
  assert.match(plain, /12:00 Uhr oder später: genau einmal über die Zwölf/);
  assert.match(plain, /Zeigt die Referenz inzwischen schon den 14\. November .* bis das Datum noch einmal springt \(auf 14\)/);
  assert.doesNotMatch(plain, /heute/);
});

test('a real midnight between calendar and time setting: two complete, correct sentences', () => {
  const plain = text(body(6, new Date(2026, 10, 13, 23, 40, 0), new Date(2026, 10, 14, 0, 5, 0)));
  assert.match(plain, /rücken auf den 14\. November/);
  assert.match(plain, /Das Datum springt zuerst auf 13: Im Werk ist Mitternacht, die Tageshälfte ist jetzt sicher bekannt\. Dann einen vollen Tag weiterdrehen – zweimal über die Zwölf –, bis das Datum noch einmal springt: auf 14\./);
  assert.doesNotMatch(plain, /Erst dann ist|Zeigertag/);
});

test('month ends: the ring number is never called today when it is not', () => {
  // Calendar set on 30 November just before midnight, time set on 1 December.
  const six = text(body(6, new Date(2026, 10, 30, 23, 50, 0), new Date(2026, 11, 1, 0, 5, 0)));
  assert.match(six, /springt zuerst auf 30/);
  assert.match(six, /noch einmal springt: auf 31\. Die Datumsscheibe kennt keine Monatslängen: nach Schritt 7 am Morgen \(nach 4 Uhr\) in Position 2 von Hand auf 1 weiterschalten/);
  const seven = text(body(7, new Date(2026, 10, 30, 23, 50, 0), new Date(2026, 11, 1, 0, 10, 0)));
  assert.match(seven, /Datum zeigt 31 \(01\.12\.2026\)/);
  assert.match(seven, /von Hand auf 1 weiterschalten/);
  // On the 1st itself the number before today is the ring's 31, and step 7 shows the 1st.
  assert.match(text(body(4, new Date(2026, 11, 1, 10, 0, 0))), /die Zahl vor dem heutigen Datum ein: die 31\. Die Datumsscheibe hat immer 31 Positionen/);
  assert.match(text(body(7, new Date(2026, 11, 1, 10, 0, 0))), /Datum zeigt 1 \(01\.12\.2026\)/);
});

test('steps 4, 5 and 7 name the day their numbers belong to', () => {
  // In the last seconds of a day the reference minute belongs to tomorrow.
  const late = new Date(2026, 10, 13, 23, 59, 30);
  assert.match(text(body(4, late)), /Gleich ist Mitternacht – die Uhr wird schon auf den 14\. November gestellt\. Stelle die Zahl davor ein: die 13\./);
  assert.match(text(body(5, late)), /bis zum 13\. November \(18 Tage\)/);
  assert.match(text(body(7, late)), /Datum zeigt 14 \(14\.11\.2026\) · Mondphase/, 'the watch is being set to the 14th');
  // Ordinary afternoon.
  const noon = new Date(2026, 10, 13, 17, 0, 0);
  assert.match(text(body(4, noon)), /die Zahl vor dem heutigen Datum ein: die 12\./);
  assert.match(text(body(5, noon)), /Dann 17 Klicks weiter – einen für jeden Tag vom letzten Vollmond am 26\. Oktober bis zum 12\. November \(17 Tage\)/);
  assert.match(text(body(7, noon)), /Datum zeigt 13 \(13\.11\.2026\).*die Scheibe steht 18 Tage nach der Vollmond-Stellung/);
  // The day of a full moon, and the day after it.
  assert.match(text(body(5, new Date(2026, 10, 24, 9, 0, 0))), /Dann 28 Klicks weiter .* Am 24\. November ist Vollmond\. Gezählt wird trotzdem vom Vollmond davor/);
  assert.match(text(body(5, new Date(2026, 10, 25, 9, 0, 0))), /Am 24\. November war Vollmond: bei der Vollmond-Stellung stehen bleiben/);
});

test('step 5 says the missing moon day comes with step 6, and squares its count with the maker\'s', () => {
  // The maker counts straight to the day being set: 18 on 13 November; this guide 17 now plus one at midnight.
  const plain = text(body(5, new Date(2026, 10, 13, 17, 0, 0)));
  assert.match(plain, /\(17 Tage\)\. Der 18\. Tag – der 13\. November – kommt in Schritt 6 von selbst dazu, wenn die Zeiger über Mitternacht laufen\./);
  assert.match(plain, /Die Herstelleranleitung zählt direkt bis zum 13\. November, also 18 Klicks – nach Schritt 6 steht die Scheibe hier genauso\. Nur nicht mischen: 18 Klicks und danach Schritt 6 stellen den Mond einen Tag zu weit\./);
  // The day after a full moon: no clicks now, the first day comes with step 6.
  const after = text(body(5, new Date(2026, 10, 25, 9, 0, 0)));
  assert.match(after, /keine weiteren Klicks\. Der 1\. Tag – der 25\. November – kommt in Schritt 6/);
  assert.match(after, /zählt direkt bis zum 25\. November, also 1 Klick –/);
  // Full moon on the day being set: the maker just centres a moon, so there is no count to compare.
  const full = text(body(5, new Date(2026, 10, 24, 9, 0, 0)));
  assert.match(full, /Dann 28 Klicks weiter .* Der 29\. Tag – der 24\. November – kommt in Schritt 6/);
  assert.doesNotMatch(full, /Herstelleranleitung zählt/);
  // A plan kept across midnight still names its own day.
  assert.match(text(body(4, new Date(2026, 10, 13, 23, 40, 0), new Date(2026, 10, 14, 0, 5, 0))), /Eingestellt wird die 12, die Zahl vor dem 13\. November/);
});
