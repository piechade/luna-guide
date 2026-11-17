// The setting procedure, executed on the movement model for a watch that
// stopped at ANY time of day, started at ANY wall-clock time.
process.env.TZ = 'Europe/Berlin';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load.mjs';

const { Mechanism, DAY, HALF_DAY, nextMidnight, passes } = await loadModule('../../src/watch/mechanism.ts');
const { makePlan, timeSetting, planIsCurrent, parkTarget, timeTarget, PARK_DIAL_MINUTE, PARK_TOLERANCE, makeScenario, otherHalf, parseClock, syncTarget } = await loadModule('../../src/plan.ts');
const { daysSinceFullMoonDate } = await loadModule('../../src/moon.ts');

/**
 * Follow the guide's instructions literally and record what the calendar does.
 * `now` is when the calendar steps are read; `settingNow` when the time is set
 * (the watch keeps running in crown position 2 in between).
 */
function follow(scenario, now, settingNow = now) {
  const mech = new Mechanism();
  mech.set(scenario);
  const report = {};

  // Hands forward onto the five; which five is unknown to the owner.
  report.switchesParking = mech.turnTo(parkTarget(mech));
  report.parkedDial = mech.dialMinutes;
  report.parkedInLockout = mech.inLockout;
  report.parkedInMorning = !mech.isAfternoon;

  // Quick-set date and moon, both one day short.
  const plan = makePlan(now);
  report.plan = plan;
  report.dateClicks = mech.clicksToDate(plan.parkDate);
  for (let i = 0; i < report.dateClicks; i++) mech.quickDate();
  const toReference = mech.clicksToFullMoonPose();
  for (let i = 0; i < toReference + plan.moonClicksAtPark; i++) mech.quickMoon();
  const reference = mech.moon - plan.moonClicksAtPark;

  // Until the time is set the parked watch has been running.
  mech.turn((settingNow.getTime() - now.getTime()) / 60_000);
  report.stillSafe = !mech.inLockout;

  // Forward over midnight to the reference minute.
  const setting = timeSetting(plan, settingNow);
  report.setting = setting;
  const from = mech.minutes;
  const midnight = nextMidnight(from);
  report.noonBeforeJump = passes(from, midnight, HALF_DAY);
  report.switchesToMidnight = mech.turnTo(midnight);
  report.dateAtMidnight = mech.date;
  report.switchesAfterMidnight = mech.turnTo(timeTarget({ minutes: from }, setting));
  report.moonAfterReference = mech.moon - reference;
  report.mech = mech;
  return report;
}

/** The disc stands as many days after a centred moon as the makers count for the day of the reference minute. */
function assertMoon(r, where) {
  const counted = daysSinceFullMoonDate(r.setting.target);
  // On the day of a full moon the next moon arrives: 29 or 30 steps after the last one, at most one step off centre.
  if (counted === 0 && r.moonAfterReference !== 0) assert.ok(r.moonAfterReference === 29 || r.moonAfterReference === 30, `moon ${r.moonAfterReference} steps after the reference on a full-moon day (${where})`);
  else assert.equal(r.moonAfterReference, counted, `moon disc (${where})`);
}

const DATES = [
  [2026, 10, 13], // an ordinary day
  [2026, 2, 1],   // 1 March after a 28-day February
  [2028, 1, 29],  // leap day
  [2028, 2, 1],   // 1 March after a leap day
  [2026, 11, 31], // New Year's Eve
  [2027, 0, 1],   // New Year's Day
  [2026, 2, 29],  // start of summer time (02:00 → 03:00)
  [2026, 9, 25],  // end of summer time (03:00 → 02:00)
  [2026, 4, 31],  // a 31st
  [2026, 6, 1],   // 1 July after a 30-day June
  [2026, 10, 24], // the day of a full moon
];
const STOP_MINUTES = [0, 1, 179, 180, 181, 239, 240, 284, 285, 299, 300, 315, 316, 359, 360, 361, 420, 421, 1004, 1005, 1035, 1036, 609, 719, 720, 721, 1020, 1080, 1140, 1141, 1199, 1200, 1201, 1329, 1438, 1439];
for (let m = 17; m < DAY; m += 53) STOP_MINUTES.push(m);

test('any stop time, any wall-clock time: the watch ends on the right time, half of the day, date and moon', () => {
  let cases = 0;
  for (const [year, month, day] of DATES) {
    const first = new Date(year, month, day, 0, 0, 7).getTime();
    for (let minute = 0; minute < 25 * 60; minute += 1) { // 25 h covers the long day at the end of summer time
      const now = new Date(first + minute * 60_000 + (minute % 3) * 19_000);
      for (const stop of STOP_MINUTES) {
        if ((minute + stop) % 4) continue; // thin out; every stop time still meets every fourth minute of the day
        const stoppedOn = new Date(now);
        stoppedOn.setDate(stoppedOn.getDate() - 1 - (stop % 5));
        const r = follow({ minuteOfDay: stop, date: stoppedOn.getDate(), moon: -3 - (stop % 40) }, now);
        const where = `stopped at ${stop} min, now ${now.toString()}`;
        const target = r.setting.target;

        assert.ok(Math.abs(r.parkedDial - PARK_DIAL_MINUTE) <= PARK_TOLERANCE, `parked within a quarter of an hour of the five (${where})`);
        assert.equal(r.parkedInLockout, false, `quick-set happens outside the switching window (${where})`);
        assert.ok(r.switchesParking <= 1, where);
        assert.ok(r.dateClicks <= 30, where);

        // The half of the day is unknown while parked; the date jump settles it.
        assert.equal(r.noonBeforeJump, r.parkedInMorning, `noon is passed first only when parked in the morning (${where})`);
        assert.equal(r.switchesToMidnight, 1, `exactly one date jump on reaching midnight (${where})`);
        assert.equal(r.dateAtMidnight, target.getDate(), `the jump brings today's date (${where})`);
        // The owner's complaint: once the date shows today it must not move again.
        assert.equal(r.switchesAfterMidnight, 0, `date moved again on the way to the time (${where})`);
        assert.equal(r.setting.midnightPasses, 1, where);

        assert.equal(r.mech.minuteOfDay, target.getHours() * 60 + target.getMinutes(), `24 h time (${where})`);
        assert.equal(r.mech.isAfternoon, target.getHours() >= 12, `half of the day (${where})`);
        assert.equal(r.mech.date, target.getDate(), `date (${where})`);
        assert.equal(r.setting.finalDate, target.getDate(), where);
        assert.equal(r.moonAfterReference, r.plan.moonClicksAtPark + 1, where);
        assertMoon(r, where);
        cases++;
      }
    }
  }
  assert.ok(cases > 150_000, `${cases} cases`);
});

test('once set, the date changes at night and never at noon', () => {
  for (const hour of [7, 11, 13, 19, 23, 1, 5]) {
    for (const stop of [10 * 60 + 9, 22 * 60 + 9]) {
      const now = new Date(2026, 10, 13, hour, 20, 0);
      const r = follow({ minuteOfDay: stop, date: 10, moon: -6 }, now);
      const mech = r.mech;
      let wall = r.setting.target.getTime();
      let shown = mech.date;
      for (let step = 0; step < 48 * 60; step++) { // let it run for two days, minute by minute
        mech.turn(1);
        wall += 60_000;
        const clock = new Date(wall);
        if (mech.date !== shown) {
          assert.equal(clock.getHours(), 0, `date changed at ${clock.toString()}`);
          assert.equal(clock.getMinutes(), 0);
          shown = mech.date;
        }
        assert.equal(mech.date, clock.getDate(), clock.toString());
      }
    }
  }
});

test('the reported fault: setting today\'s date on an unknown half of the day leaves a morning stop twelve hours off and a day ahead', () => {
  // The dial shows 10:09 whether the movement stopped in the morning or in the
  // evening. The earlier guide parked "at 6:30", set today's date there and
  // turned the hands forward to the time — right only for an evening stop.
  const now = new Date(2026, 10, 13, 17, 5, 0);
  const target = syncTarget(now);
  const targetMinute = target.getHours() * 60 + target.getMinutes();
  const earlier = stop => {
    const mech = new Mechanism();
    mech.set({ minuteOfDay: stop, date: 10, moon: 0 });
    const park = 6 * 60 + 30;
    mech.turn((park - mech.dialMinutes + DAY) % HALF_DAY || HALF_DAY); // to the next "6:30" on the dial
    for (let i = mech.clicksToDate(target.getDate()); i > 0; i--) mech.quickDate();
    const switched = mech.turn(targetMinute - park); // "from 6:30 forward to 17:06"
    return { switched, date: mech.date, minuteOfDay: mech.minuteOfDay };
  };
  assert.deepEqual(earlier(22 * 60 + 9), { switched: 0, date: 13, minuteOfDay: targetMinute }, 'evening stop: luck');
  assert.deepEqual(earlier(10 * 60 + 9), { switched: 1, date: 14, minuteOfDay: targetMinute - HALF_DAY },
    'morning stop: the date jumps a day ahead while setting the time and the watch is twelve hours off');
  // Following the guide, both are right, and neither needs to know the half of the day.
  for (const stop of [10 * 60 + 9, 22 * 60 + 9]) {
    const r = follow({ minuteOfDay: stop, date: 10, moon: 0 }, now);
    assert.deepEqual([r.mech.date, r.mech.minuteOfDay, r.switchesAfterMidnight], [13, targetMinute, 0]);
  }
});

test('plan details', () => {
  const summary = now => { const plan = makePlan(now); const s = timeSetting(plan, now); return [s.midnightPasses, plan.parkDate, s.finalDate]; };
  // The calendar is always set one day short; the midnight pass brings today.
  assert.deepEqual(summary(new Date(2026, 10, 13, 17, 5, 0)), [1, 12, 13]);
  assert.deepEqual(summary(new Date(2026, 10, 13, 3, 10, 0)), [1, 12, 13]);
  // On the 1st, one position before it on the ring is the 31st, not the 28th or 30th.
  assert.deepEqual(summary(new Date(2026, 2, 1, 2, 0, 0)), [1, 31, 1]);
  assert.deepEqual(summary(new Date(2026, 6, 1, 15, 0, 0)), [1, 31, 1]);
  // Just before midnight the reference minute already belongs to tomorrow.
  assert.deepEqual(summary(new Date(2026, 10, 13, 23, 59, 20)), [1, 13, 14]);
  // The reference minute is a full minute at least 12 s ahead.
  const target = syncTarget(new Date(2026, 10, 13, 17, 5, 50));
  assert.equal(target.getSeconds(), 0);
  assert.ok(target.getTime() - new Date(2026, 10, 13, 17, 5, 50).getTime() >= 12_000);
  // Moon clicks: whole calendar days from the last full moon (26 October 2026) to yesterday.
  assert.equal(makePlan(new Date(2026, 10, 13, 19, 0, 0)).moonClicksAtPark, 17);
  assert.equal(makePlan(new Date(2026, 10, 13, 3, 0, 0)).moonClicksAtPark, 17, 'the time of day does not change the count');
  // On the day of a full moon (24 November 2026) yesterday was the 29th day of the old lunation …
  assert.equal(makePlan(new Date(2026, 10, 24, 9, 0, 0)).moonClicksAtPark, 28);
  // … and the day after it, yesterday was the full moon itself: stay on the centred moon.
  assert.equal(makePlan(new Date(2026, 10, 25, 9, 0, 0)).moonClicksAtPark, 0);
  // Hands within a quarter of an hour of the five stay where they are; otherwise forward to the next five.
  assert.equal(parkTarget({ minutes: 4 * 60 + 50 }), 4 * 60 + 50);
  assert.equal(parkTarget({ minutes: 17 * 60 + 15 }), 17 * 60 + 15);
  assert.equal(parkTarget({ minutes: 5 * 60 + 16 }), 17 * 60);
  assert.equal(parkTarget({ minutes: 2 * 60 }), 5 * 60);
  assert.equal(parkTarget({ minutes: 7 * 60 + 1 }), 17 * 60);
  assert.equal(parkTarget({ minutes: 22 * 60 + 9 }), DAY + 5 * 60);
});

test('the plan stands while the owner is busy: a real midnight between calendar and time setting adds a second jump', () => {
  let cases = 0;
  for (const [hour, minute] of [[6, 10], [6, 29], [17, 30], [23, 20], [23, 40], [23, 57], [23, 59], [0, 1], [12, 0]]) {
    for (let second = 0; second < 60; second += 13) {
      for (let delay = 0; delay <= 45; delay++) { // minutes spent on the date and moon steps
        const now = new Date(2026, 10, 13, hour, minute, second);
        const settingNow = new Date(now.getTime() + delay * 60_000 + 7_000);
        for (const stop of [10 * 60 + 9, 22 * 60 + 9, 3 * 60, 15 * 60 + 30, 17 * 60 + 15, 4 * 60 + 45]) {
          const r = follow({ minuteOfDay: stop, date: 9, moon: -5 }, now, settingNow);
          const where = `calendar set at ${now.toString()}, time set ${delay} min later, stopped at ${stop} min`;
          const target = r.setting.target;
          assert.equal(r.stillSafe, true, `still outside the switching window when the time is set (${where})`);
          assert.equal(r.mech.date, target.getDate(), `date (${where})`);
          assert.equal(r.mech.minuteOfDay, target.getHours() * 60 + target.getMinutes(), `24 h time (${where})`);
          assert.equal(r.switchesToMidnight + r.switchesAfterMidnight, r.setting.midnightPasses, where);
          assert.ok(r.setting.midnightPasses === 1 || r.setting.midnightPasses === 2, where);
          assertMoon(r, where);
          cases++;
        }
      }
    }
  }
  assert.ok(cases > 12_000, `${cases} cases`);
  // A plan from three days ago no longer describes the watch.
  const plan = makePlan(new Date(2026, 10, 13, 17, 0, 0));
  assert.equal(planIsCurrent(plan, new Date(2026, 10, 13, 23, 0, 0)), true);
  assert.equal(planIsCurrent(plan, new Date(2026, 10, 14, 10, 0, 0)), true);
  assert.equal(planIsCurrent(plan, new Date(2026, 10, 15, 10, 0, 0)), false);
});

test('demonstration scenarios cover both halves of the day', () => {
  const now = new Date(2026, 10, 13, 17, 5, 0);
  let seed = 1;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  let mornings = 0;
  let parkedMornings = 0;
  for (let i = 0; i < 400; i++) {
    const s = makeScenario(now, random);
    assert.ok(s.minuteOfDay >= 60 && s.minuteOfDay < DAY - 60);
    assert.ok(s.date >= 1 && s.date <= 31);
    if (s.minuteOfDay < HALF_DAY) mornings++;
    const flipped = otherHalf(s);
    assert.equal(flipped.minuteOfDay % HALF_DAY, s.minuteOfDay % HALF_DAY, 'the dial looks the same');
    assert.notEqual(flipped.minuteOfDay < HALF_DAY, s.minuteOfDay < HALF_DAY);
    const r = follow(s, now);
    if (r.parkedInMorning) parkedMornings++;
    assert.notEqual(follow(flipped, now).parkedInMorning, r.parkedInMorning, 'the other half parks on the other five');
    assert.ok(r.dateClicks >= 1 && r.dateClicks <= 4, `${r.dateClicks} date clicks`);
  }
  assert.ok(mornings > 120 && mornings < 280, `${mornings} morning stops of 400`);
  assert.ok(parkedMornings > 120 && parkedMornings < 280, `${parkedMornings} parked in the morning of 400`);
  assert.equal(parseClock('22:09'), 22 * 60 + 9);
  assert.equal(parseClock('7:05'), 7 * 60 + 5);
  assert.equal(parseClock('24:00'), null);
  assert.equal(parseClock('abc'), null);
});
