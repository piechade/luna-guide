// End-to-end check of the setting guide against `npm run dev`: the animated
// model must do what the pure procedure in tests/plan.test.mjs proves correct,
// for stops in either half of the day and at awkward wall-clock times.
// Requires Playwright; see tests/accessibility.browser.mjs for the env variables.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.LUNA_URL || 'http://127.0.0.1:5173';

const WALL_CLOCKS = [
  '2026-11-13T17:05:00', // afternoon: the hands only pass noon
  '2026-11-13T09:15:00', // morning: they pass nothing
  '2026-11-13T03:10:00', // deep in the night
  '2026-11-13T04:58:10', // the reference minute is the parking time
  '2026-11-13T12:00:10', // noon
  '2026-11-13T23:59:20', // the reference minute already belongs to tomorrow
  '2026-03-01T02:00:00', // on the 1st: the number before it on the ring is 31
  '2026-03-01T14:00:00', // after a 28-day month
];
const STOPS = ['10:09', '22:09', '01:30', '13:45']; // the first two look identical on the dial

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let runs = 0;
try {
  for (const wall of WALL_CLOCKS) for (const stop of STOPS) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    await context.addInitScript(target => {
      // A shiftable wall clock, and the app's render loop is driven by the test.
      const RealDate = Date;
      window.__shift = new RealDate(target).getTime() - RealDate.now();
      window.Date = class extends RealDate {
        constructor(...a) { if (a.length === 0) super(RealDate.now() + window.__shift); else super(...a); }
        static now() { return RealDate.now() + window.__shift; }
      };
      const nativeRAF = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = cb => cb.toString().includes('wizard.update(dt)') ? 1 : nativeRAF(cb);
    }, wall);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${url}/?stop=${stop}`);
    await page.waitForFunction(() => window.__luna);
    const result = await page.evaluate(() => {
      const { wizard, watch } = window.__luna;
      const mech = watch.mech;
      const snapshot = () => ({ minuteOfDay: mech.minuteOfDay, date: mech.date, moon: mech.moon, crown: Math.round(watch.crownPull) });
      const steps = [];
      const total = document.querySelectorAll('#step-dots button').length;
      for (let i = 0; i < total; i++) {
        wizard.goTo(i, false);
        const entry = snapshot();
        const dateChanges = [];
        let referenceArrived = false;
        let shown = mech.date;
        for (let frame = 0; frame < 900; frame++) {
          const before = mech.minuteOfDay;
          wizard.update(0.05);
          // `overMidnight`: in this frame the hands arrived at or passed 24:00.
          if (mech.date !== shown) { shown = mech.date; dateChanges.push({ to: shown, minuteOfDay: mech.minuteOfDay, overMidnight: mech.minuteOfDay < before, crown: watch.crownPull }); }
          if (i === 5 && !referenceArrived && /^Bereit/.test(document.getElementById('sync-status')?.textContent ?? '')) {
            // The hands are set and the guide waits for a real full minute: let it arrive.
            const reference = Math.floor((window.__luna.ctx.now.getTime() + 12_000) / 60_000) * 60_000 + 60_000;
            window.__shift += reference - Date.now() + 50;
            referenceArrived = true;
          }
        }
        steps.push({ entry, end: snapshot(), dateChanges, done: document.getElementById('animation-label').textContent, text: document.getElementById('step-body').textContent });
      }
      // With the watch set and running, jump the wall clock: the date must follow at midnight only.
      const wallMinute = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
      const afterGuide = { minuteOfDay: mech.minuteOfDay, wallMinute: wallMinute(), date: mech.date, wallDate: new Date().getDate(), locked: watch.lockedToClock };
      const untilNoon = ((12 * 60 - wallMinute() + 1440) % 1440 + 1) * 60_000;
      const dateBeforeNoon = mech.date;
      const beforeNoonIsToday = wallMinute() < 12 * 60;
      window.__shift += untilNoon; wizard.update(0.05);
      const overNoon = { before: dateBeforeNoon, after: mech.date, sameDay: beforeNoonIsToday };
      const dateBeforeMidnight = mech.date;
      window.__shift += 12 * 3600_000; wizard.update(0.05);
      const overMidnight = { before: dateBeforeMidnight, after: mech.date, wallDate: new Date().getDate() };
      return { steps, afterGuide, overNoon, overMidnight };
    });
    const where = `wall clock ${wall}, stopped at ${stop}`;
    const [stopH, stopM] = stop.split(':').map(Number);
    const stopMinute = stopH * 60 + stopM;
    const target = new Date(Math.floor((new Date(wall).getTime() + 12_000) / 60_000) * 60_000 + 60_000);
    const { steps } = result;
    assert.equal(steps.length, 7, where);
    steps.forEach((s, i) => assert.equal(s.done, 'Animation abgeschlossen', `step ${i + 1} finishes (${where})`));
    const dial = minute => minute % 720;

    // Every step starts exactly where the previous animation ended (the watch keeps running in between).
    for (let i = 1; i < steps.length - 1; i++) {
      const [end, entry] = [steps[i - 1].end, steps[i].entry];
      assert.equal(entry.date, end.date, `date carries over into step ${i + 1} (${where})`);
      assert.equal(entry.moon, end.moon, `moon carries over into step ${i + 1} (${where})`);
      assert.equal(entry.crown, end.crown, `crown carries over into step ${i + 1} (${where})`);
      assert.ok(Math.abs(entry.minuteOfDay - end.minuteOfDay) < 1.5, `hands carry over into step ${i + 1}: ${end.minuteOfDay} → ${entry.minuteOfDay} (${where})`);
    }

    // Steps 1 and 2 never touch the calendar.
    assert.deepEqual([steps[0].dateChanges, steps[1].dateChanges], [[], []], where);
    // Step 3: hands onto the five — whichever five comes first. The date may jump on the way, only at midnight.
    const parking = steps[2];
    assert.ok(parking.dateChanges.length <= 1, where);
    for (const change of parking.dateChanges) assert.ok(change.overMidnight, `a jump while parking is a midnight (${where})`);
    assert.ok(Math.abs(dial(parking.end.minuteOfDay) - 300) < 17, `parked on the five: ${parking.end.minuteOfDay} (${where})`);
    const stays = Math.abs(dial(stopMinute) - 300) <= 15;
    const parkedMinute = stays ? stopMinute : (stopMinute - dial(stopMinute) + (dial(stopMinute) < 300 ? 300 : 1020)) % 1440;
    assert.equal(parking.end.minuteOfDay < 720, parkedMinute < 720, `parked in the expected half of the day (${where})`);
    // Step 4: quick-set in position 2, on the five, to the number before today's on the ring.
    for (const change of steps[3].dateChanges) {
      assert.ok(Math.abs(change.crown - 2) < 0.01 && Math.abs(dial(change.minuteOfDay) - 300) < 20, where);
    }
    assert.equal(steps[3].end.date, (target.getDate() + 29) % 31 + 1, `date one short while parked (${where})`);
    assert.equal(steps[4].dateChanges.length, 0, where);

    // Step 6 — the reported fault turned into the check: the date jumps exactly
    // once, as the hands reach midnight, to today — and never again on the way to the time.
    const setting = steps[5];
    assert.equal(setting.dateChanges.length, 1, `date changes while setting the time (${where})`);
    assert.ok(setting.dateChanges[0].overMidnight, `…as the hands pass midnight (${where})`);
    assert.equal(setting.dateChanges[0].to, target.getDate(), `…to today (${where})`);
    assert.equal(/über den Mittag/.test(setting.text), parkedMinute < 720, `the model note names the right half of the day (${where})`);

    const { afterGuide, overNoon, overMidnight } = result;
    assert.equal(afterGuide.locked, true, where);
    assert.ok(Math.abs(afterGuide.minuteOfDay - afterGuide.wallMinute) < 0.05, `24 h time ${afterGuide.minuteOfDay} vs wall ${afterGuide.wallMinute} (${where})`);
    assert.equal(afterGuide.date, afterGuide.wallDate, `date after the guide (${where})`);
    assert.equal(overNoon.after, overNoon.sameDay ? overNoon.before : overNoon.before % 31 + 1, `noon never switches the date (${where})`);
    assert.equal(overMidnight.after, overMidnight.before % 31 + 1, `midnight switches it (${where})`);
    assert.deepEqual(errors, [], where);
    runs++;
    await context.close();
  }
  console.log(`${runs} guide runs passed: ${WALL_CLOCKS.length} wall-clock times × ${STOPS.length} stop times.`);

  // Explore mode: the same mechanism behind the crown lab.
  const lab = async (wall, script) => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    await context.addInitScript(target => {
      const RealDate = Date;
      const shift = new RealDate(target).getTime() - RealDate.now();
      window.Date = class extends RealDate {
        constructor(...a) { if (a.length === 0) super(RealDate.now() + shift); else super(...a); }
        static now() { return RealDate.now() + shift; }
      };
      const nativeRAF = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = cb => cb.toString().includes('wizard.update(dt)') ? 1 : nativeRAF(cb);
    }, wall);
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(() => window.__luna);
    await page.evaluate(() => window.__luna.wizard.update(0.05));
    const press = async selector => {
      await page.locator(selector).click();
      await page.evaluate(() => { for (let i = 0; i < 40; i++) window.__luna.wizard.update(0.05); });
    };
    const state = () => page.evaluate(() => {
      const { mech } = window.__luna.watch;
      return { minute: Math.round(mech.minuteOfDay), date: mech.date, moon: mech.moon, text: document.getElementById('crown-description').textContent, zone: !document.getElementById('ms-zone').hidden };
    });
    await script(press, state, page);
    await context.close();
  };

  // In position 2 the crown turns towards twelve for the date and towards six for the moon.
  // In position 3 the hands run forward when it turns towards six.
  const DATE = '#turn-forward', MOON = '#turn-back', HANDS_ON = '#turn-back', HANDS_BACK = '#turn-forward';
  await lab('2026-11-13T22:30:00', async (press, state, page) => {
    const start = await state();
    assert.deepEqual([start.minute, start.date, start.zone], [22 * 60 + 30, 13, true], 'explore mode shows the device time');
    await press('[data-crown="2"]');
    const spin = () => page.evaluate(() => window.__luna.watch.crownSpin);
    const spinBefore = await spin();
    await press(DATE);
    let now = await state();
    assert.equal(now.date, 13, 'no quick-set inside the switching window');
    assert.match(now.text, /Gesperrt – Schaltfenster: Das Modell läuft mit deiner Uhrzeit und zeigt 22:30 Uhr\./);
    assert.match(now.text, /Krone auf Position 3 und 6× Richtung 6 Uhr: Dann stehen die Zeiger auf 04:30 Uhr/, 'the way out, counted in turns');
    assert.ok(Math.abs(await spin() - spinBefore) < 1e-9, 'the refused crown nudges and settles back');
    await press(MOON);
    assert.equal((await state()).moon, start.moon, 'nor for the moon');
    await press('[data-crown="3"]');
    await press(HANDS_ON); // 23:30
    assert.equal((await state()).date, 13);
    await press(HANDS_ON); // 00:30 — over midnight
    now = await state();
    assert.deepEqual([now.minute, now.date, now.moon], [30, 14, start.moon + 1], 'the hands passing midnight switch date and moon');
    assert.match(now.text, /Mitternacht passiert/);
    await press(HANDS_BACK); // 23:30 again
    assert.equal((await state()).date, 14, 'turning back does not switch back');
    await press(HANDS_ON);
    assert.equal((await state()).date, 14, 'and the same midnight does not switch twice');
    for (let i = 0; i < 12; i++) await press(HANDS_ON); // 12:30 — over noon
    now = await state();
    assert.deepEqual([now.minute, now.date, now.zone], [12 * 60 + 30, 14, false], 'noon switches nothing');
    await press('[data-crown="2"]');
    await press(DATE);
    assert.equal((await state()).date, 15, 'outside the switching window the quick-set works');
    await press(MOON);
    assert.equal((await state()).moon, start.moon + 2);
    // Quick presses while the crown is still turning are kept, not dropped.
    for (let i = 0; i < 5; i++) await page.locator(DATE).click();
    await page.evaluate(() => { for (let i = 0; i < 120; i++) window.__luna.wizard.update(0.05); });
    assert.equal((await state()).date, 20, 'five quick clicks are five days');
  });
  console.log('Explore-mode crown lab passed: lock-out refusal, midnight switching, no switching at noon or backwards.');

  // The watch can be opened at any moment of any step, from the front and from the back; the step's
  // animation runs on in the opened watch, and the next step closes it again.
  await (async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    await context.addInitScript(() => {
      const nativeRAF = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = cb => cb.toString().includes('wizard.update(dt)') ? 1 : nativeRAF(cb);
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${url}/?stop=22:09`);
    await page.waitForFunction(() => window.__luna);
    await page.evaluate(() => window.__luna.wizard.setOpened('front'));
    await page.waitForFunction(() => window.__luna.watch.movementReady && !document.getElementById('btn-explode').hasAttribute('aria-busy'), null, { timeout: 180000 });
    const result = await page.evaluate(() => {
      const { wizard, watch } = window.__luna;
      const frames = n => { for (let i = 0; i < n; i++) wizard.update(0.05); };
      const pressed = id => document.getElementById(id).getAttribute('aria-pressed');
      const steps = [];
      const total = document.querySelectorAll('#step-dots button').length;
      for (let i = 0; i < total; i++) {
        wizard.goTo(i, false);
        frames(40); // the previous step's opened watch closes within two seconds
        const closedOnEntry = watch.explode === 0 && watch.openBack === 0 && pressed('btn-explode') === 'false' && pressed('btn-back') === 'false';
        const pulls = new Set();
        wizard.setOpened('front');
        for (let f = 0; f < 60; f++) { frames(1); pulls.add(Math.round(watch.crownPull * 4)); }
        const front = { explode: watch.explode, openBack: watch.openBack, label: document.getElementById('view-description').textContent };
        wizard.setOpened('back');
        for (let f = 0; f < 60; f++) { frames(1); pulls.add(Math.round(watch.crownPull * 4)); }
        const back = { explode: watch.explode, openBack: watch.openBack, label: document.getElementById('view-description').textContent, front: pressed('btn-explode'), back: pressed('btn-back') };
        steps.push({ closedOnEntry, front, back, pulls: pulls.size, done: document.getElementById('animation-label').textContent });
      }
      wizard.goTo(0, false);
      frames(40);
      return { steps, closed: { explode: watch.explode, openBack: watch.openBack, inScene: watch.group.children.length } };
    });
    result.steps.forEach((step, i) => {
      const where = `step ${i + 1}`;
      assert.ok(step.closedOnEntry, `${where} starts with the watch closed`);
      assert.deepEqual([step.front.explode, step.front.openBack], [1, 0], `${where}: opened from the front`);
      assert.match(step.front.label, /^Werk von vorn/);
      assert.deepEqual([step.back.explode, step.back.openBack, step.back.front, step.back.back], [0, 1, 'false', 'true'], `${where}: opened from the back, front closed`);
      assert.match(step.back.label, /^Werk von hinten/);
    });
    assert.ok(result.steps.some(step => step.pulls > 1), 'the steps animate the crown while the watch is open');
    assert.deepEqual([result.closed.explode, result.closed.openBack], [0, 0], 'the next step closes the watch');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Opened watch: front and back open at every one of ${result.steps.length} steps while the step animates; the next step closes it.`);
  })();
} finally {
  await browser.close();
}
