import type { CameraPose } from './scene';
import { Timeline, easeOut, linear } from './animator';
import { SYNODIC_MONTH, type MoonState } from './moon';
import type { WatchModel } from './watch/model';

// Crown directions per the official SW280-1 manual (Mühle Teutonia IV Mondphase,
// same caliber family as the Tudor T607-9):
//   unscrew           -> towards 6 o'clock  (counterclockwise)
//   wind (pos. 1)     -> towards 12 o'clock (clockwise)
//   date (pos. 2)     -> towards 12 o'clock (clockwise)
//   moon (pos. 2)     -> towards 6 o'clock  (counterclockwise), 1-day steps
//
// Step order: all quick-set corrections (date AND moon) happen while the watch
// is parked at 6:30 AM — established by turning the hands forward past the date
// flip (= midnight), so AM/PM is known. The quick-set lock-out (20:00–03:00)
// depends on the WATCH's own calendar-wheel position, not on the wall clock, so
// parking at 6:30 makes the corrections safe at any real time of day. The exact
// time is set LAST; from 6:30 AM forward the hands only ever cross noon (which
// switches nothing). Only if the real time is between 0:00 and 6:30 does the
// final time-set pass midnight once more — then date and moon are each set one
// step short beforehand, and the midnight pass carries them to the final value.

export interface StepCtx {
  watch: WatchModel;
  moon: MoonState;
  today: Date;
}

export interface Step {
  kicker: string;
  title: string;
  body(ctx: StepCtx): string;
  camera: CameraPose;
  /** Snap the watch to this step's deterministic entry state. */
  setup(ctx: StepCtx): void;
  /** Build the step's animation timeline (assumes setup() ran). */
  build(ctx: StepCtx): Timeline;
}

const START_TIME = 10 * 60 + 9; // watch found stopped at 10:09
const SAFE_TIME = 6 * 60 + 30; // 6:30 AM — safely outside the lock-out window
const MOON_START_OFFSET = 6; // demo: moon starts 6 days behind its target pose

const fmtDate = (d: Date) =>
  d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

function dayShift(today: Date, shift: number): number {
  const d = new Date(today);
  d.setDate(d.getDate() + shift);
  return d.getDate();
}

/** Moon-disc pose the watch should finally show (days past full-moon pose). */
function moonTarget(moon: MoonState): number {
  return moon.daysSinceFullMoon;
}

/**
 * True while the real time is between 0:00 and 6:30. Then the final time-set
 * (step 6) has to sweep the hands from the parked 6:30 AM past midnight once
 * more, advancing date and moon disc by one — so both are set one step short
 * in steps 4 and 5.
 */
function extraMidnightPass(now: Date = new Date()): boolean {
  return now.getHours() * 60 + now.getMinutes() < SAFE_TIME;
}

export const STEPS: Step[] = [
  // ------------------------------------------------------------- 1
  {
    kicker: 'Schritt 1 · Vorbereitung',
    title: 'Krone aufschrauben',
    camera: { pos: [42, 21, 9], target: [21.5, 0, 0] },
    body: () => `
      <p>Die Krone der 1926 Luna ist <span class="hl">verschraubt</span> — sie dichtet das
      Gehäuse bis <b>100 m</b> ab. Drehe sie <b>gegen den Uhrzeigersinn (Richtung 6 Uhr)</b>,
      bis sich das Gewinde löst und die Krone mit einem kleinen Sprung in
      <code>Position 1</code> (Aufzugsstellung) springt.</p>
      <div class="warnbox">⚠️ Solange die Krone offen ist, ist die Uhr <b>nicht</b> wasserdicht.
      Niemals mit geöffneter Krone ans Wasser — und am Ende immer wieder festschrauben
      (Schritt 7).</div>`,
    setup: ({ watch, moon, today }) => {
      watch.crownPull = 0;
      watch.crownSpin = 0;
      watch.running = false;
      watch.liveSync = false;
      watch.displayMinutes = START_TIME;
      watch.displaySeconds = 34;
      watch.dangerOpacity = 0;
      watch.moonDays = moonTarget(moon) - MOON_START_OFFSET;
      watch.setDate(dayShift(today, -3));
    },
    build: ({ watch }) => {
      const tl = new Timeline();
      tl.tween(0.6, 2.6, (v) => (watch.crownSpin = v * Math.PI * 8)); // unscrew CCW (towards 6)
      tl.tween(3.1, 1.0, (v) => (watch.crownPull = v), easeOut); // pops to pos. 1
      return tl;
    },
  },
  // ------------------------------------------------------------- 2
  {
    kicker: 'Schritt 2 · Standard-Routine: erst aufziehen',
    title: 'Handaufzug — ca. 27 Umdrehungen',
    camera: { pos: [38, 24, 19], target: [19, 0, 0] },
    body: () => `
      <p>Eine stehende Automatik wird <b>zuerst von Hand vollgezogen</b>: in
      <code>Position 1</code> die Krone <b>im Uhrzeigersinn (Richtung 12 Uhr)</b> drehen —
      laut Sellita-Werksdokumentation braucht das Kaliber aus dem Stand
      <span class="hl">mindestens 27 Umdrehungen</span> bis zum Vollaufzug
      (Gangreserve ca. 38 h).</p>
      <p style="font-size:1.4rem; font-variant-numeric: tabular-nums;">
        🔄 <b><span id="wind-count">0</span> / 27</b> Umdrehungen</p>
      <div class="okbox">✅ Überdrehen unmöglich: Die Rutschkupplung des Automatikwerks
      schützt die Zugfeder. Nach wenigen Umdrehungen springt der Sekundenzeiger an.</div>`,
    setup: (ctx) => {
      STEPS[0].setup(ctx);
      ctx.watch.crownPull = 1;
    },
    build: ({ watch }) => {
      const tl = new Timeline();
      const counter = () => document.getElementById('wind-count');
      tl.tween(
        0.8,
        6.0,
        (v) => {
          watch.crownSpin = -v * 27 * Math.PI * 2; // clockwise (towards 12)
          const el = counter();
          if (el) el.textContent = String(Math.floor(v * 27));
        },
        linear,
      );
      tl.call(2.6, () => (watch.running = true)); // balance starts after a few turns
      return tl;
    },
  },
  // ------------------------------------------------------------- 3
  {
    kicker: 'Schritt 3 · Sicherheit',
    title: 'Mitternacht finden & auf 6:30 Uhr parken',
    camera: { pos: [0, 48, 13], target: [0, 0, 1] },
    body: () => `
      <p>Zwischen ca. <b>20:00 und 03:00 Uhr</b> (rot markiert) greift das Kalender­räderwerk
      in die Datums- und Mondscheibe ein. <span class="hl">Schnellkorrekturen in diesem
      Fenster können das Werk beschädigen.</span> Entscheidend ist dabei die Zeit, auf der
      die <b>Uhr selbst</b> steht — nicht die echte Uhrzeit.</p>
      <p>Deshalb: Krone ganz heraus in <code>Position 3</code> ziehen und die Zeiger
      <b>vorwärts</b> drehen, bis das <b>Datum springt</b> — dieser Sprung ist
      <b>Mitternacht</b>, jetzt ist die Tageshälfte (AM/PM) sicher bekannt. Dann weiter bis
      <b>6:30 Uhr morgens</b> drehen und dort parken.</p>
      <p class="muted">Springt das Datum beim ersten 12-Uhr-Durchgang nicht, war das nur
      die Mittagsposition — einfach weiterdrehen bis zum Sprung. Auf 6:30 Uhr geparkt sind
      alle Schnellkorrekturen der nächsten Schritte <b>zu jeder echten Tageszeit</b>
      gefahrlos möglich.</p>`,
    setup: (ctx) => {
      STEPS[1].setup(ctx);
      ctx.watch.crownSpin = 0;
      ctx.watch.running = true;
      ctx.watch.displayMinutes = START_TIME + 1.5;
    },
    build: ({ watch, moon, today }) => {
      const tl = new Timeline();
      const from = START_TIME + 1.5;
      const flipAt = 720; // first 12-o'clock pass — shown as the midnight flip
      const parkAt = 720 + SAFE_TIME; // continue to 6:30 AM
      let flipped = false;
      const setMin = (v: number) => {
        if (!flipped && v >= flipAt) {
          flipped = true;
          watch.setDate(dayShift(today, -2)); // date jumps — that was midnight
          watch.moonDays = moonTarget(moon) - MOON_START_OFFSET + 1; // moon disc advances too
        }
        watch.displayMinutes = v;
      };
      tl.tween(0.6, 0.9, (v) => (watch.crownPull = 1 + v * 2), easeOut); // to pos. 3
      tl.call(1.5, () => (watch.running = false)); // stop-second
      tl.tween(1.2, 1.2, (v) => (watch.dangerOpacity = v * 0.55));
      tl.tween(2.8, 3.4, (v) => setMin(from + v * (parkAt - from)));
      tl.tween(6.6, 0.8, (v) => (watch.crownPull = 3 - v), easeOut); // back to pos. 2
      tl.tween(7.4, 0.8, (v) => (watch.dangerOpacity = 0.55 - v * 0.35));
      return tl;
    },
  },
  // ------------------------------------------------------------- 4
  {
    kicker: 'Schritt 4 · Kalender',
    title: 'Datum stellen',
    camera: { pos: [26, 22, 13], target: [12.5, 1, 0] },
    body: ({ today }) => {
      const edge = extraMidnightPass();
      const dateLine = edge
        ? `<p>Sonderfall: Es ist gerade zwischen <b>0:00 und 6:30 Uhr</b>. Beim Zeitstellen
           (Schritt 6) laufen die Zeiger deshalb noch einmal über Mitternacht — das Datum
           schaltet dabei einen Tag weiter. Stelle es darum auf
           <span class="hl">gestern (${dayShift(today, -1)}.)</span>; der Mitternachts-Durchgang
           bringt es dann automatisch auf <b>heute (${today.getDate()}.)</b>.</p>`
        : `<p>Stelle es auf <span class="hl">heute (${today.getDate()}.)</span>. Die
           Tageshälfte stimmt bereits — das hat der Datumssprung in Schritt 3 sichergestellt —
           und beim Zeitstellen in Schritt 6 laufen die Zeiger höchstens über die
           <b>Mittags</b>-Zwölf, dabei schaltet nichts.</p>`;
      return `
      <p>In <code>Position 2</code> die Krone <b>im Uhrzeigersinn (Richtung 12 Uhr)</b>
      drehen: Jetzt springt das Datum im Fenster bei 3 Uhr — jede Raste ein Tag.</p>
      ${dateLine}
      <div class="okbox">✅ Die Uhr steht auf 6:30 Uhr morgens — weit außerhalb der
      Sperrzone. Die Schnellkorrektur ist deshalb jetzt gefahrlos, egal wie spät es
      wirklich ist.</div>`;
    },
    setup: (ctx) => {
      STEPS[2].setup(ctx);
      ctx.watch.running = true; // pos. 2: the movement keeps running
      ctx.watch.displayMinutes = 720 + SAFE_TIME;
      ctx.watch.crownPull = 2;
      ctx.watch.dangerOpacity = 0.2;
      ctx.watch.moonDays = moonTarget(ctx.moon) - MOON_START_OFFSET + 1;
      ctx.watch.setDate(dayShift(ctx.today, -2));
    },
    build: ({ watch, today }) => {
      const tl = new Timeline();
      const finalShift = extraMidnightPass() ? -1 : 0; // edge case: park on yesterday
      tl.call(1.4, () => {
        watch.setDate(dayShift(today, -1));
        watch.crownSpin -= 0.5; // clockwise click (towards 12)
      });
      if (finalShift === 0) {
        tl.call(2.6, () => {
          watch.setDate(today.getDate());
          watch.crownSpin -= 0.5;
        });
      }
      return tl;
    },
  },
  // ------------------------------------------------------------- 5
  {
    kicker: 'Schritt 5 · Kalender',
    title: 'Mondphase einstellen',
    camera: { pos: [0, 24, 32], target: [0, 1, 8] },
    body: ({ moon }) => {
      const edge = extraMidnightPass();
      const n = edge ? (moon.clicksFromFullMoon + 29) % 30 : moon.clicksFromFullMoon;
      const clickLine =
        n === 0
          ? edge
            ? `Bei der Vollmond-Referenz <b>stehen bleiben</b> — den letzten Tag schaltet
               der Mitternachts-Durchgang beim Zeitstellen (Schritt 6) automatisch nach.`
            : `Heute steht der Mond <b>exakt auf Vollmond</b> — die Vollmond-Position ist
               bereits das Ziel, keine weiteren Klicks nötig.`
          : `Dann <span class="hl">${n} Klick${n === 1 ? '' : 's'} weiter</span> —
             ein Klick = ein Tag. Die Schaltung kennt nur <b>vorwärts</b>; verpasst du die
             Position, einmal ganz herum.`;
      const edgeNote = edge
        ? `<div class="warnbox">🌙 Sonderfall 0:00–6:30 Uhr: Beim Zeitstellen (Schritt 6)
           schaltet der Mitternachts-Durchgang die Mondscheibe noch <b>einen Tag weiter</b> —
           die Klickzahl oben ist deshalb bereits um eins reduziert.</div>`
        : '';
      return `
      <p>Krone bleibt in <code>Position 2</code>, jetzt <b>gegen den Uhrzeigersinn
      (Richtung 6 Uhr)</b> drehen:</p>
      <ol>
        <li>Scheibe weiterschalten, bis der goldene Mond <b>exakt mittig</b> in der runden
        Öffnung bei 6 Uhr steht → das ist die <b>Vollmond-Referenz</b>.</li>
        <li>${clickLine}</li>
      </ol>
      ${edgeNote}
      <div class="okbox">✅ Keine Wartezeit nötig: Die Uhr steht weiterhin auf 6:30 Uhr
      morgens, also außerhalb der Sperrzone (20:00–03:00 Uhr der <b>Uhrzeit auf dem
      Zifferblatt</b>) — die Mondkorrektur ist zu jeder echten Tageszeit gefahrlos.</div>
      <div class="okbox">🌙 Aktuell: <b>${moon.name}</b>, ${(moon.illumination * 100).toFixed(0)} %
      beleuchtet · letzter Vollmond: <b>${fmtDate(moon.lastFullMoon)}</b>
      (vor ${moon.daysSinceFullMoon.toFixed(1)} Tagen)</div>`;
    },
    setup: (ctx) => {
      STEPS[3].setup(ctx);
      ctx.watch.setDate(dayShift(ctx.today, extraMidnightPass() ? -1 : 0));
      ctx.watch.dangerOpacity = 0;
    },
    build: ({ watch, moon }) => {
      const tl = new Timeline();
      const edge = extraMidnightPass();
      const target = moonTarget(moon) - (edge ? 1 : 0);
      const n = edge ? (moon.clicksFromFullMoon + 29) % 30 : moon.clicksFromFullMoon;
      const start = moonTarget(moon) - MOON_START_OFFSET + 1;
      // Quick-set only advances: crank forward to the next full-moon pose.
      const fullPose = start <= 0 ? 0 : SYNODIC_MONTH;
      tl.tween(1.0, 2.8, (v) => (watch.moonDays = start + v * (fullPose - start)));
      for (let i = 1; i <= n; i++) {
        tl.call(4.4 + i * 0.45, () => {
          watch.moonDays = fullPose + i;
          watch.crownSpin += 0.5; // counterclockwise click (towards 6)
        });
      }
      tl.call(4.4 + n * 0.45 + 0.4, () => (watch.moonDays = fullPose + target));
      return tl;
    },
  },
  // ------------------------------------------------------------- 6
  {
    kicker: 'Schritt 6 · Standard-Routine: Atomzeit',
    title: 'Zeit sekundengenau stellen',
    camera: { pos: [0, 44, 21], target: [0, 0, 0] },
    body: () => {
      const edge = extraMidnightPass();
      const sweepNote = edge
        ? `<li>Zeiger <b>im Uhrzeigersinn</b> vorwärts drehen — über Mittag und noch einmal
           über <b>Mitternacht</b>: Das Datum springt dabei auf <b>heute</b> und die
           Mondscheibe rückt auf ihre Zielposition (dafür wurden beide einen Schritt
           knapper gestellt).</li>`
        : `<li>Zeiger <b>im Uhrzeigersinn</b> von 6:30 Uhr vorwärts drehen. Liegt die
           Zielzeit am Nachmittag oder Abend, laufen sie dabei über die <b>Mittags</b>-Zwölf —
           dort schaltet weder Datum noch Mond, alles bleibt korrekt.</li>`;
      return `
      <p><b>Warte, bis der Sekundenzeiger auf 12 steht</b>, und ziehe die Krone dann ganz
      heraus in <code>Position 3</code> → <span class="hl">Sekundenstopp</span>, das Werk hält an.</p>
      <ol>
        ${sweepNote}
        <li>Weiter bis kurz <b>vor</b> die Zielminute, den Minutenzeiger zuletzt
        <b>von hinten anfahren</b> (nimmt das Zahnspiel heraus, der Zeiger steht exakt).</li>
        <li>Als Ziel die <b>nächste volle Minute</b> der Referenzzeit wählen
        (oben rechts läuft sie live mit — Abgleich z. B. mit <code>time.is</code>).</li>
        <li>Genau beim Sekundensprung auf <b>:00</b> die Krone auf
        <code>Position 1</code> zurückdrücken — das Werk startet synchron.</li>
      </ol>`;
    },
    setup: (ctx) => {
      STEPS[4].setup(ctx);
      ctx.watch.moonDays = moonTarget(ctx.moon) - (extraMidnightPass() ? 1 : 0);
      ctx.watch.crownPull = 2;
    },
    build: ({ watch, today }) => {
      const tl = new Timeline();
      const now = new Date();
      const edge = extraMidnightPass(now);
      const targetMin = (now.getHours() % 12) * 60 + now.getMinutes() + 1;
      // From 6:30 AM: PM targets cross noon (one 12-pass), the 0:00–6:30 edge case
      // crosses noon AND midnight (two 12-passes), morning targets cross nothing.
      const passes = edge ? 2 : now.getHours() >= 12 ? 1 : 0;
      const from = 720 + SAFE_TIME; // parked at 6:30 AM (display continues from step 3)
      const sweepTarget = 720 + passes * 720 + targetMin;
      const backOff = Math.min(4, sweepTarget - from);
      const midnightAt = 720 + 1440; // second 12-pass after the park position
      let flipped = false;
      const setMin = (v: number) => {
        if (edge && !flipped && watch.displayMinutes < midnightAt && v >= midnightAt) {
          flipped = true;
          watch.setDate(today.getDate()); // midnight passed — date jumps to today
          watch.moonDays += 1; // ...and the moon disc advances one day too
        }
        watch.displayMinutes = v;
      };
      tl.call(0.8, () => {
        watch.running = false;
        watch.displaySeconds = 0; // stop-second: hands halt for the sync
      });
      tl.tween(0.5, 0.9, (v) => (watch.crownPull = 2 + v), easeOut);
      tl.tween(2.2, 4.2, (v) => setMin(from + v * (sweepTarget - backOff - from)));
      tl.tween(7.0, 1.8, (v) => setMin(sweepTarget - backOff + v * backOff), linear);
      tl.call(10.4, () => {
        watch.liveSync = true; // pushed back at :00 — running in sync from here
        watch.running = true;
      });
      tl.tween(10.4, 0.7, (v) => (watch.crownPull = 3 - v * 2), easeOut);
      return tl;
    },
  },
  // ------------------------------------------------------------- 7
  {
    kicker: 'Schritt 7 · Abschluss',
    title: 'Krone festschrauben & Endkontrolle',
    camera: { pos: [28, 34, 38], target: [0, 0, 0] },
    body: ({ moon, today }) => `
      <p>Krone in <code>Position 1</code> zurückdrücken, dann leicht <b>hineindrücken und im
      Uhrzeigersinn (Richtung 12 Uhr) festschrauben</b>, bis spürbarer Widerstand kommt —
      erst dann sind die 100 m Wasserdichtigkeit wieder gewährleistet.</p>
      <div class="okbox">✅ <b>Endkontrolle</b><br>
      · Datum zeigt <b>${today.getDate()}.</b> (${fmtDate(today)})<br>
      · Mondphase: <b>${moon.name}</b> — Scheibe steht ${moon.clicksFromFullMoon} Klick${
        moon.clicksFromFullMoon === 1 ? '' : 's'
      } nach Vollmond<br>
      · Sekundenzeiger läuft <b>synchron zur Referenzzeit</b><br>
      · Krone <b>verschraubt</b></div>
      <p class="muted">Gangreserve nach Vollaufzug: ca. 38 h. Wird die Uhr täglich getragen,
      hält die Automatik sie am Laufen — sonst beim nächsten Stillstand einfach wieder bei
      Schritt 1 beginnen.</p>`,
    setup: (ctx) => {
      ctx.watch.crownPull = 2;
      ctx.watch.crownSpin = 0;
      ctx.watch.liveSync = true;
      ctx.watch.running = true;
      ctx.watch.dangerOpacity = 0;
      ctx.watch.moonDays = moonTarget(ctx.moon);
      ctx.watch.setDate(ctx.today.getDate());
    },
    build: ({ watch }) => {
      const tl = new Timeline();
      tl.tween(0.6, 1.0, (v) => (watch.crownPull = 2 - v * 2), easeOut); // push all the way in
      tl.tween(1.8, 2.2, (v) => (watch.crownSpin = -v * Math.PI * 6)); // screw down CW
      return tl;
    },
  },
];
