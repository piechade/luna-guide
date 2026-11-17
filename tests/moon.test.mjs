// True full moons (Meeus ch. 49) and the makers' day count for the moon disc.
process.env.TZ = 'Europe/Berlin';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load.mjs';

const { moonState, fullMoonBefore, fullMoonAfter, fullMoonOnOrBefore, daysSinceFullMoonDate, calendarDaysBetween } = await loadModule('../../src/moon.ts');

// Published full moon instants, UTC, to the minute.
const FULL_MOONS = [
  '2025-01-13T22:27', '2025-02-12T13:53', '2025-03-14T06:55', '2025-04-13T00:22', '2025-05-12T16:56',
  '2025-06-11T07:44', '2025-07-10T20:37', '2025-08-09T07:55', '2025-09-07T18:09', '2025-10-07T03:48',
  '2025-11-05T13:19', '2025-12-04T23:14', '2026-01-03T10:03', '2026-02-01T22:09', '2026-03-03T11:38',
  '2026-04-02T02:12', '2026-05-01T17:23', '2026-05-31T08:45', '2026-06-29T23:57', '2026-07-29T14:36',
  '2026-08-28T04:18', '2026-09-26T16:49', '2026-10-26T04:12', '2026-11-24T14:53', '2026-12-24T01:28',
].map(text => new Date(`${text}:00Z`));

test('full moon instants match the published times to within two minutes', () => {
  let from = new Date(Date.UTC(2025, 0, 1));
  for (const expected of FULL_MOONS) {
    const found = fullMoonAfter(from);
    assert.ok(Math.abs(found.getTime() - expected.getTime()) < 120_000, `${found.toISOString()} vs ${expected.toISOString()}`);
    assert.equal(fullMoonBefore(new Date(found.getTime() + 1000)).getTime(), found.getTime());
    from = new Date(found.getTime() + 60_000);
  }
});

test('the phase is named and lit correctly at and between the full moons', () => {
  for (const full of FULL_MOONS) {
    const at = moonState(full);
    assert.equal(at.name, 'Vollmond');
    assert.ok(at.illumination > 0.999, String(at.illumination));
    const week = moonState(new Date(full.getTime() + 7.4 * 86_400_000));
    assert.equal(week.name, 'Letztes Viertel');
    assert.equal(week.waxing, false);
    const before = moonState(new Date(full.getTime() - 14.8 * 86_400_000));
    assert.equal(before.name, 'Neumond');
    assert.ok(before.illumination < 0.01);
  }
  let last = moonState(new Date(2026, 0, 1));
  for (let hour = 1; hour < 24 * 400; hour++) {
    const state = moonState(new Date(new Date(2026, 0, 1).getTime() + hour * 3_600_000));
    assert.ok(state.phaseFraction >= 0 && state.phaseFraction < 1);
    assert.ok(state.phaseFraction > last.phaseFraction || state.phaseFraction < 0.01, 'the phase only runs forward');
    assert.ok(state.nextFullMoonInDays > 0 && state.nextFullMoonInDays < 30);
    last = state;
  }
});

test('the moon disc is set by whole calendar days since the date of the last full moon', () => {
  // Mühle's worked example for the SW280-1: full moon on 10 July, set on 15 July: five steps.
  assert.equal(daysSinceFullMoonDate(new Date(2025, 6, 15, 9, 0)), 5);
  // 26 October 2026, 05:12 CET, to 13 November: 18 days, whatever the time of day.
  for (const hour of [0, 7, 12, 19, 23]) assert.equal(daysSinceFullMoonDate(new Date(2026, 10, 13, hour, 30)), 18);
  // The day of the full moon counts as zero from its first minute, also before the instant itself (15:53 CET).
  assert.equal(daysSinceFullMoonDate(new Date(2026, 10, 24, 0, 5)), 0);
  assert.equal(daysSinceFullMoonDate(new Date(2026, 10, 23, 23, 55)), 28);
  assert.equal(fullMoonOnOrBefore(new Date(2026, 10, 24, 0, 5)).getDate(), 24);
  // Every day of four years: 0..29, rising by one per day and falling to 0 only on a full-moon date.
  let previous = daysSinceFullMoonDate(new Date(2025, 0, 1, 12));
  for (let day = 2; day < 4 * 366; day++) {
    const date = new Date(2025, 0, day, 12);
    const count = daysSinceFullMoonDate(date);
    assert.ok(count >= 0 && count <= 29, `${count} on ${date.toDateString()}`);
    if (count === 0) assert.ok(previous === 28 || previous === 29, `${previous} before a full moon on ${date.toDateString()}`);
    else assert.equal(count, previous + 1, date.toDateString());
    assert.equal(moonState(date).clicksFromFullMoon, count);
    previous = count;
  }
  // Calendar days are counted in local time, across both clock changes.
  assert.equal(calendarDaysBetween(new Date(2026, 2, 28, 23, 0), new Date(2026, 2, 30, 1, 0)), 2);
  assert.equal(calendarDaysBetween(new Date(2026, 9, 24, 23, 0), new Date(2026, 9, 26, 1, 0)), 2);
});
