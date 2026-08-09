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
// The moon disc ALSO advances whenever the hands pass midnight, which is why the
// moon phase is set LAST (after date and time) — same order as the manual.

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
const SAFE_TIME = 6 * 60 + 30; // 6:30 — safely outside the lock-out window
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

/** True while the real clock is inside the quick-set lock-out window. */
function inLockout(now: Date = new Date()): boolean {
  const h = now.getHours();
  return h >= 20 || h < 3;
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
    title: 'Sperrzone: erst auf sichere Zeit stellen',
    camera: { pos: [0, 48, 13], target: [0, 0, 1] },
    body: () => `
      <p>Zwischen ca. <b>20:00 und 03:00 Uhr</b> (rot markiert) greift das Kalender­räderwerk
      in die Datums- und Mondscheibe ein. <span class="hl">Schnellkorrekturen in diesem
      Fenster können das Werk beschädigen.</span></p>
      <p>Deshalb: Krone ganz heraus in <code>Position 3</code> ziehen und die Zeiger erst auf
      eine <b>sichere Zeit</b> stellen — bewährt: <b>6:30</b>. Egal ob die Uhr das als morgens
      oder abends „versteht“, beide Lesarten liegen außerhalb der Sperrzone.</p>
      <p class="muted">Danach die Krone eine Raste zurück auf <code>Position 2</code> —
      dort sitzt der Doppelkorrektor: <b>Richtung 12 Uhr = Datum</b>,
      <b>Richtung 6 Uhr = Mondphase</b>.</p>`,
    setup: (ctx) => {
      STEPS[1].setup(ctx);
      ctx.watch.crownSpin = 0;
      ctx.watch.running = true;
      ctx.watch.displayMinutes = START_TIME + 1.5;
    },
    build: ({ watch }) => {
      const tl = new Timeline();
      tl.tween(0.6, 0.9, (v) => (watch.crownPull = 1 + v * 2), easeOut); // to pos. 3
      tl.call(1.5, () => (watch.running = false)); // stop-second
      tl.tween(1.2, 1.2, (v) => (watch.dangerOpacity = v * 0.55));
      tl.tween(2.8, 2.6, (v) => (watch.displayMinutes = START_TIME + 1.5 - v * (START_TIME + 1.5 - SAFE_TIME)));
      tl.tween(6.0, 0.8, (v) => (watch.crownPull = 3 - v), easeOut); // back to pos. 2
      tl.tween(6.8, 0.8, (v) => (watch.dangerOpacity = 0.55 - v * 0.35));
      return tl;
    },
  },
  // ------------------------------------------------------------- 4
  {
    kicker: 'Schritt 4 · Kalender',
    title: 'Datum auf GESTERN stellen',
    camera: { pos: [26, 22, 13], target: [12.5, 1, 0] },
    body: ({ today }) => `
      <p>In <code>Position 2</code> die Krone <b>im Uhrzeigersinn (Richtung 12 Uhr)</b>
      drehen: Jetzt springt das Datum im Fenster bei 3 Uhr — jede Raste ein Tag.</p>
      <p>Stelle es bewusst auf <span class="hl">gestern (${dayShift(today, -1)}.)</span> —
      nicht auf heute! Im nächsten Schritt drehst du die Zeiger über Mitternacht: Das Datum
      springt dabei auf <b>heute (${today.getDate()}.)</b>, und du weißt dadurch
      hundertprozentig, dass die Uhr auf die <b>richtige Tageshälfte</b> (AM/PM) steht.</p>
      <p class="muted">Die Mondphase kommt bewusst <b>erst zum Schluss</b> (Schritt 6): Die
      Mondscheibe schaltet nämlich auch beim Zeigerdurchgang über Mitternacht einen Tag
      weiter — würden wir sie jetzt stellen, wäre sie danach wieder falsch.</p>`,
    setup: (ctx) => {
      STEPS[2].setup(ctx);
      ctx.watch.running = true;
      ctx.watch.displayMinutes = SAFE_TIME;
      ctx.watch.crownPull = 2;
      ctx.watch.dangerOpacity = 0.2;
    },
    build: ({ watch, today }) => {
      const tl = new Timeline();
      tl.call(1.4, () => {
        watch.setDate(dayShift(today, -2));
        watch.crownSpin -= 0.5; // clockwise click (towards 12)
      });
      tl.call(2.6, () => {
        watch.setDate(dayShift(today, -1));
        watch.crownSpin -= 0.5;
      });
      return tl;
    },
  },
  // ------------------------------------------------------------- 5
  {
    kicker: 'Schritt 5 · Standard-Routine: Atomzeit',
    title: 'Zeit sekundengenau stellen',
    camera: { pos: [0, 44, 21], target: [0, 0, 0] },
    body: () => `
      <p><b>Warte, bis der Sekundenzeiger auf 12 steht</b>, und ziehe die Krone dann ganz
      heraus in <code>Position 3</code> → <span class="hl">Sekundenstopp</span>, das Werk hält an.</p>
      <ol>
        <li>Zeiger <b>im Uhrzeigersinn</b> über Mitternacht drehen, bis das Datum auf
        <b>heute</b> springt — jetzt stimmt die Tageshälfte sicher.
        <span class="muted">(Dabei schaltet auch die Mondscheibe einen Tag weiter — deshalb
        kommt sie erst im nächsten Schritt.)</span></li>
        <li>Weiter bis kurz <b>vor</b> die Zielminute, den Minutenzeiger zuletzt
        <b>von hinten anfahren</b> (nimmt das Zahnspiel heraus, der Zeiger steht exakt).</li>
        <li>Als Ziel die <b>nächste volle Minute</b> der Referenzzeit wählen
        (oben rechts läuft sie live mit — Abgleich z. B. mit <code>time.is</code>).</li>
        <li>Genau beim Sekundensprung auf <b>:00</b> die Krone auf
        <code>Position 1</code> zurückdrücken — das Werk startet synchron.</li>
      </ol>`,
    setup: (ctx) => {
      STEPS[3].setup(ctx);
      ctx.watch.setDate(dayShift(ctx.today, -1));
      ctx.watch.dangerOpacity = 0;
    },
    build: ({ watch, today }) => {
      const tl = new Timeline();
      const now = new Date();
      const targetMin = (now.getHours() % 12) * 60 + now.getMinutes() + 1;
      const sweepTarget = 720 + targetMin; // one pass through 12 to flip the date
      const from = SAFE_TIME;
      const backOff = Math.min(4, targetMin); // approach the final minutes from behind
      let flipped = false;
      const setMin = (v: number) => {
        if (!flipped && watch.displayMinutes < 720 && v >= 720) {
          flipped = true;
          watch.setDate(today.getDate()); // midnight passed — date jumps to today
          watch.moonDays += 1; // ...and the moon disc advances one day too
        }
        watch.displayMinutes = v;
      };
      tl.call(0.8, () => {
        watch.running = false;
        watch.displaySeconds = 0; // pulled exactly when the second hand hit 12
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
  // ------------------------------------------------------------- 6
  {
    kicker: 'Schritt 6 · Standard-Routine: Mond taggenau',
    title: 'Mondphase zuletzt einstellen',
    camera: { pos: [0, 24, 32], target: [0, 1, 8] },
    body: ({ moon }) => {
      const n = moon.clicksFromFullMoon;
      const clickLine =
        n === 0
          ? `Heute steht der Mond <b>exakt auf Vollmond</b> — die Vollmond-Position ist
             bereits das Ziel, keine weiteren Klicks nötig.`
          : `Dann <span class="hl">${n} Klick${n === 1 ? '' : 's'} weiter</span> —
             ein Klick = ein Tag. Die Schaltung kennt nur <b>vorwärts</b>; verpasst du die
             Position, einmal ganz herum.`;
      const lockoutBox = inLockout()
        ? `<div class="warnbox">⛔ <b>Achtung:</b> Es ist gerade zwischen 20:00 und 03:00 Uhr —
           die Uhr zeigt jetzt die echte Zeit, du bist also <b>in der Sperrzone</b>.
           Mondkorrektur erst nach 03:00 Uhr durchführen!</div>`
        : `<div class="okbox">✅ Aktuell außerhalb der Sperrzone (20:00–03:00 Uhr) —
           Mondkorrektur jetzt gefahrlos möglich.</div>`;
      return `
      <p>Krone von <code>Position 1</code> eine Raste heraus in <code>Position 2</code>
      ziehen und <b>gegen den Uhrzeigersinn (Richtung 6 Uhr)</b> drehen:</p>
      <ol>
        <li>Scheibe weiterschalten, bis der goldene Mond <b>exakt mittig</b> in der runden
        Öffnung bei 6 Uhr steht → das ist die <b>Vollmond-Referenz</b>.</li>
        <li>${clickLine}</li>
      </ol>
      ${lockoutBox}
      <div class="okbox">🌙 Aktuell: <b>${moon.name}</b>, ${(moon.illumination * 100).toFixed(0)} %
      beleuchtet · letzter Vollmond: <b>${fmtDate(moon.lastFullMoon)}</b>
      (vor ${moon.daysSinceFullMoon.toFixed(1)} Tagen)</div>`;
    },
    setup: (ctx) => {
      ctx.watch.crownPull = 1;
      ctx.watch.crownSpin = 0;
      ctx.watch.liveSync = true;
      ctx.watch.running = true;
      ctx.watch.dangerOpacity = 0;
      ctx.watch.setDate(ctx.today.getDate());
      // Moon has drifted MOON_START_OFFSET days, minus the midnight pass of step 5
      ctx.watch.moonDays = moonTarget(ctx.moon) - MOON_START_OFFSET + 1;
    },
    build: ({ watch, moon }) => {
      const tl = new Timeline();
      const target = moonTarget(moon);
      const n = moon.clicksFromFullMoon;
      const start = target - MOON_START_OFFSET + 1;
      // Quick-set only advances: crank forward to the next full-moon pose.
      const fullPose = start <= 0 ? 0 : SYNODIC_MONTH;
      tl.tween(0.5, 0.8, (v) => (watch.crownPull = 1 + v), easeOut); // out to pos. 2
      tl.tween(1.6, 2.8, (v) => (watch.moonDays = start + v * (fullPose - start)));
      for (let i = 1; i <= n; i++) {
        tl.call(5.0 + i * 0.45, () => {
          watch.moonDays = fullPose + i;
          watch.crownSpin += 0.5; // counterclockwise click (towards 6)
        });
      }
      tl.call(5.0 + n * 0.45 + 0.4, () => (watch.moonDays = fullPose + target));
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
