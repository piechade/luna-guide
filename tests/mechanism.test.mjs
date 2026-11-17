import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load.mjs';

const { Mechanism, DAY, nextMidnight, passes } = await loadModule('../../src/watch/mechanism.ts');

const at = (hours, minutes = 0) => hours * 60 + minutes;
const stopped = (minuteOfDay, date = 10, moon = 0) => {
  const mech = new Mechanism();
  mech.set({ minuteOfDay, date, moon });
  return mech;
};

test('the date and the moon disc switch at midnight, never at noon', () => {
  const mech = stopped(at(10, 9));
  assert.equal(mech.turnTo(at(12)), 0, 'passing noon switches nothing');
  assert.equal(mech.date, 10);
  assert.equal(mech.turnTo(at(23, 59)), 0);
  assert.equal(mech.turnTo(at(24)), 1, 'arriving exactly at midnight switches');
  assert.equal(mech.date, 11);
  assert.equal(mech.moon, 1);
  assert.equal(mech.turnTo(at(36)), 0, 'the next noon switches nothing');
  assert.equal(mech.date, 11);
});

test('the same dial position behaves differently in the two halves of the day', () => {
  const morning = stopped(at(10, 9));
  const evening = stopped(at(22, 9));
  assert.equal(morning.dialMinutes, evening.dialMinutes, 'both show 10:09');
  // Turning both to the next 12 on the dial:
  assert.equal(morning.turn(111), 0);
  assert.equal(evening.turn(111), 1);
  assert.equal(morning.date, 10);
  assert.equal(evening.date, 11);
  assert.equal(morning.isAfternoon, true);
  assert.equal(evening.minuteOfDay, 0);
});

test('a sweep over several days switches once per midnight', () => {
  const mech = stopped(at(15), 29);
  assert.equal(mech.turn(3 * DAY), 3);
  assert.equal(mech.date, 1, 'the ring runs 29 → 30 → 31 → 1');
  assert.equal(mech.moon, 3);
});

test('the date ring has 31 positions regardless of the month', () => {
  const mech = stopped(at(6, 30), 28);
  assert.equal(mech.clicksToDate(1), 4, 'from the 28th to the 1st: 29, 30, 31, 1');
  for (let i = 0; i < 4; i++) mech.quickDate();
  assert.equal(mech.date, 1);
  assert.equal(mech.clicksToDate(1), 0);
});

test('turning the hands backwards does not switch the date back', () => {
  const mech = stopped(at(23), 10);
  mech.turnTo(at(24, 30));
  assert.equal(mech.date, 11);
  assert.equal(mech.turnTo(at(23, 30)), 0);
  assert.equal(mech.date, 11, 'the finger slips back past the tooth');
  assert.equal(mech.turnTo(at(24, 30)), 0, 'and does not push the same tooth again');
  assert.equal(mech.date, 11);
});

test('going back out of the engagement zone lets the finger switch again', () => {
  const mech = stopped(at(23), 10);
  mech.turnTo(at(24, 30));
  mech.turnTo(at(19, 30)); // back before 20:00
  assert.equal(mech.turnTo(at(24, 30)), 1);
  assert.equal(mech.date, 12);
});

test('armed tells whether the coming midnight will switch', () => {
  const mech = stopped(at(23), 10);
  assert.equal(mech.armed, true);
  mech.turnTo(at(24, 30));
  assert.equal(mech.armed, true, 'the next midnight is pending again');
  mech.turnTo(at(23, 30));
  assert.equal(mech.armed, false, 'back across the midnight just switched');
  mech.turnTo(at(24, 10));
  assert.equal(mech.date, 11, 'and indeed nothing switches');
  mech.turnTo(at(19, 30));
  assert.equal(mech.armed, true, 'back out of the engagement zone it is armed again');
});

test('a watch that stopped just after midnight switches at the next midnight', () => {
  const mech = stopped(at(1), 10);
  assert.equal(mech.turnTo(at(12)), 0);
  assert.equal(mech.turnTo(at(24)), 1);
  assert.equal(mech.date, 11);
});

test('a running movement switches exactly when its time reaches midnight', () => {
  const mech = stopped(at(23, 59), 31);
  let switches = 0;
  for (let i = 0; i < 120 * 60; i++) switches += mech.turn(1 / 3600); // two minutes in 60 fps frames
  assert.equal(switches, 1);
  assert.equal(mech.date, 1);
  assert.ok(mech.minuteOfDay < 2);
});

test('the switching window is 20:00–04:00 movement time', () => {
  for (const [time, locked] of [[at(19, 59), false], [at(20), true], [at(23, 59), true], [at(0), true], [at(3, 59), true], [at(4), false], [at(6, 30), false], [at(12), false], [at(18, 30), false]]) {
    assert.equal(stopped(time).inLockout, locked, `at ${time} min`);
  }
});

test('forward minutes until the switching window is over: 0 outside it', () => {
  for (const [time, minutes] of [[at(20), 8 * 60], [at(21, 1), 6 * 60 + 59], [at(23, 59), 4 * 60 + 1], [at(0), 4 * 60], [at(3, 59), 1], [at(4), 0], [at(19, 59), 0], [at(12), 0]]) {
    assert.equal(stopped(time).minutesToLockoutEnd, minutes, `at ${time} min`);
  }
});

test('clicks to the centred moon follow the 59-tooth disc', () => {
  assert.equal(stopped(0, 1, -7).clicksToFullMoonPose(), 7);
  assert.equal(stopped(0, 1, 0).clicksToFullMoonPose(), 0);
  assert.equal(stopped(0, 1, 59).clicksToFullMoonPose(), 0);
  assert.equal(stopped(0, 1, 1).clicksToFullMoonPose(), 29, 'on to the second moon');
  assert.equal(stopped(0, 1, 30).clicksToFullMoonPose(), 0);
  assert.equal(stopped(0, 1, 31).clicksToFullMoonPose(), 28, 'on to the first moon again');
});

test('helpers', () => {
  assert.equal(nextMidnight(0), DAY);
  assert.equal(nextMidnight(1), DAY);
  assert.equal(nextMidnight(DAY), 2 * DAY);
  assert.equal(passes(at(10), at(13), at(12)), true);
  assert.equal(passes(at(12), at(13), at(12)), false, 'starting on the mark is not passing it');
  assert.equal(passes(at(10), at(12), at(12)), true, 'arriving on the mark is');
  assert.equal(passes(at(13), at(10), at(12)), false);
});
