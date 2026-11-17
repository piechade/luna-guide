import { STEP_VIEWS, type CameraPose } from './views';
import { Timeline, easeInOut, easeOut, linear, type Ease } from './animator';
import { calendarDaysBetween, daysSinceFullMoonDate, fullMoonOnOrBefore, type MoonState } from './moon';
import { minuteOfDay, parkTarget, timeSetting, timeTarget, type Plan, type Scenario } from './plan';
import { DATE_POSITIONS, DAY, HALF_DAY, mod, nextMidnight, passes } from './watch/mechanism';
import type { WatchModel } from './watch/model';

// Crown directions per Mühle's manual for the SW280-1 (Teutonia IV Mondphase,
// the calibre the T607-9 is based on); Sellita's and Tudor's documents name the
// functions but no directions:
//   unscrew           -> towards 6 o'clock  (counterclockwise)
//   wind (pos. 1)     -> towards 12 o'clock (clockwise)
//   date (pos. 2)     -> towards 12 o'clock (clockwise)
//   moon (pos. 2)     -> towards 6 o'clock  (counterclockwise), 1-day steps
//   hands (pos. 3)    -> towards 6 o'clock moves them forward (SW200 keyless works)
//
// The crown direction that moves the hands forward is not documented by any of
// the three; it follows from the SW200 keyless works and is shown, not instructed.
//
// The watch may have stopped at any point of the day, and a twelve-hour dial
// does not show in which half. The procedure (see plan.ts) never assumes it:
// the hands are parked on the five, where quick corrections are safe in either
// half; date and moon are set one day short; and the time is set by turning
// forward until the date jumps to today. That jump is the movement's midnight,
// so from there the half of the day is known.
//
// Nothing here writes a date or a moon position directly. Every step moves the
// hands or clicks the quick-set on `watch.mech`, and the calendar follows from
// the mechanism — in the animation and when a later step is opened directly.

/** What the instructions depend on. Needs no 3D model, so the text guide can be shown without one. */
export interface TextCtx {
  /** Wall-clock snapshot taken when the step was opened; text, entry state and animation share it. */
  now: Date;
  moon: MoonState;
  /** What the calendar is set to. Decided once per run, when the calendar steps are reached. */
  plan: Plan;
}

export interface StepCtx extends TextCtx {
  watch: WatchModel;
  /** The stopped watch this run of the guide starts from. */
  scenario: Scenario;
  /** Receives short captions for events in the animation (noon passed, date jumped …). */
  caption?: (text: string) => void;
}

export interface Step {
  kicker: string;
  title: string;
  camera: CameraPose;
  /** Instructions for the real watch. */
  body(ctx: TextCtx): string;
  /** What the model shows in this run; only rendered next to the 3D model. */
  sim?(ctx: StepCtx): string;
  /** The finished step's effect on the watch, applied at once (to open later steps). */
  apply(ctx: StepCtx): void;
  /** The step's animation, starting from the state the previous steps left. */
  build(ctx: StepCtx): Timeline;
}

/** Index of the first step that depends on the plan (date, moon, time, final check). */
export const CALENDAR_STEP = 3;
/** Crown rotation per hour of forward hand travel: one turn towards six o'clock. */
const HAND_SETTING_SPIN = Math.PI * 2;
/** Duration of one quick-set click (one crown turn); the clicks of a step follow each other at least this far apart. */
const CLICK_SECONDS = 0.2;

const WIND_TURNS = 27;

const fmtDate = (d: Date) =>
  d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDay = (d: Date) => d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
const two = (n: number) => String(n).padStart(2, '0');
/** The movement's own time on a 24-hour scale. */
export const clock24 = (minuteOfDay: number): string =>
  `${two(Math.floor(minuteOfDay / 60) % 24)}:${two(Math.floor(minuteOfDay % 60))}`;
/** What the twelve-hour dial shows for it. */
export const dialTime = (minuteOfDay: number): string =>
  `${Math.floor((minuteOfDay % HALF_DAY) / 60) || 12}:${two(Math.floor(minuteOfDay % 60))}`;
export function dayPart(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60) % 24;
  if (hour < 5) return 'nachts';
  if (hour < 10) return 'morgens';
  if (hour < 12) return 'vormittags';
  if (hour < 14) return 'mittags';
  if (hour < 18) return 'nachmittags';
  if (hour < 22) return 'abends';
  return 'nachts';
}
/** A point on the movement's time axis as a time of day. */
const timeOfDay = (minutes: number): number => ((minutes % 1440) + 1440) % 1440;
const clicks = (n: number) => `${n} Klick${n === 1 ? '' : 's'}`;
const days = (n: number) => `${n} Tag${n === 1 ? '' : 'e'}`;

/** Longer turns take longer, but never tediously long. */
const sweepSeconds = (minutes: number) => Math.min(7.5, Math.max(2.6, 2.2 + Math.abs(minutes) / 60 * 0.26));

interface SweepEvents { noon?: () => void; switched?: () => void }

/** Turn the hands by the crown to `target` (movement time). The calendar follows by itself. */
function sweep(tl: Timeline, at: number, dur: number, ctx: StepCtx, target: number, ease: Ease = easeInOut, events: SweepEvents = {}): void {
  const { watch } = ctx;
  let from = NaN;
  let spin = 0;
  tl.tween(at, dur, v => {
    if (Number.isNaN(from)) { from = watch.mech.minutes; spin = watch.crownSpin; }
    const before = watch.mech.minutes;
    const next = v >= 1 ? target : from + (target - from) * v;
    const switched = watch.mech.turnTo(next);
    watch.crownSpin = spin + (next - from) / 60 * HAND_SETTING_SPIN;
    if (events.noon && passes(before, next, HALF_DAY)) events.noon();
    if (switched && events.switched) events.switched();
  }, ease);
}

/** One quick-set click: a full turn of the crown, as in the explore mode; the corrector meets the date
 * tab or the day corrector meets the star half-way through, when the mechanism advances. */
function click(tl: Timeline, at: number, watch: WatchModel, direction: 1 | -1, effect: () => void): void {
  let base = NaN;
  tl.tween(at, CLICK_SECONDS, v => {
    if (Number.isNaN(base)) base = watch.crownSpin;
    watch.crownSpin = base + direction * Math.PI * 2 * v;
  }, linear);
  tl.call(at + CLICK_SECONDS / 2, effect);
}

/** Put the watch into the state in which `index` begins: the stopped watch plus all earlier steps. */
export function enterStep(ctx: StepCtx, index: number): void {
  const { watch } = ctx;
  watch.releaseClock();
  watch.running = false;
  watch.crownPull = 0;
  watch.crownSpin = 0;
  watch.zone = 0;
  watch.displaySeconds = 34;
  watch.mech.set(ctx.scenario);
  for (let i = 0; i < index; i++) STEPS[i].apply(ctx);
  watch.snap();
}


const ring = (position: number): number => mod(position - 1, DATE_POSITIONS) + 1;
const addDays = (day: Date, n: number): Date => new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
/** The day the watch is being set to: the one after the day the calendar is quick-set to. */
const settingDay = (plan: Plan): Date => addDays(plan.parkDay, 1);
/** What the date window shows after the first midnight pass. */
const firstJump = (plan: Plan): number => ring(plan.parkDate + 1);

function moonLine(plan: Plan): string {
  const n = plan.moonClicksAtPark;
  const fullMoon = fmtDay(fullMoonOnOrBefore(plan.parkDay));
  const count = n > 0
    ? `Dann <span class="hl">${clicks(n)} weiter</span> – einen für jeden Tag vom letzten Vollmond am
       <b>${fullMoon}</b> bis zum <b>${fmtDay(plan.parkDay)}</b> (${days(n)}).`
    : `Am ${fullMoon} war Vollmond: bei der Vollmond-Stellung <b>stehen bleiben</b>, keine weiteren Klicks.`;
  return `${count} Der <b>${n + 1}. Tag</b> – der ${fmtDay(settingDay(plan))} – kommt in Schritt 6 von selbst
    dazu, wenn die Zeiger über Mitternacht laufen.`;
}

/** The maker's manual counts straight to the day being set; say that it ends where this guide does. */
function moonDirectNote(plan: Plan): string {
  const target = settingDay(plan);
  const direct = daysSinceFullMoonDate(target);
  if (direct === 0) return ''; // full moon on that day: the maker just centres a moon, see the note below
  return ` Die Herstelleranleitung zählt direkt bis zum ${fmtDay(target)}, also ${clicks(direct)} – nach
    Schritt 6 steht die Scheibe hier genauso. Nur nicht mischen: ${clicks(direct)} <b>und</b> danach Schritt 6
    stellen den Mond einen Tag zu weit.`;
}

const PARKED_NOTE = `<div class="okbox"><b>Voraussetzung:</b> Die Uhr zeigt etwa 5 Uhr (Schritt 3) – dort ist
  die Schnellkorrektur in beiden Tageshälften gefahrlos. Das Werk läuft weiter, also zügig stellen: Steht
  der Stundenzeiger schon hinter der 7, zurück zu Schritt 3.</div>`;

export const STEPS: Step[] = [
  // ------------------------------------------------------------- 1
  {
    kicker: 'Schritt 1 · Vorbereitung',
    title: 'Krone aufschrauben',
    camera: STEP_VIEWS.crown,
    body: () => `
      <p>Die Krone ist <span class="hl">verschraubt</span> – sie dichtet das Gehäuse bis <b>100 m</b> ab.
      Drehe sie <b>gegen den Uhrzeigersinn (Richtung 6 Uhr)</b>, bis sich das Gewinde löst und die Krone in
      <code>Position 1</code> (Aufzug) herausfedert.</p>
      <p>Von dort lässt sie sich zwei Rasten herausziehen: <code>Position 2</code> (erste Raste) stellt Datum
      und Mond, <code>Position 3</code> (ganz herausgezogen) die Zeiger. „Richtung 12 Uhr“ heißt in dieser
      Anleitung: Die Oberseite der Krone wandert zur 12 hin; „Richtung 6 Uhr“ ist die Gegenrichtung.</p>
      <div class="warnbox"><b>Achtung:</b> Solange die Krone offen ist, ist die Uhr <b>nicht</b> wasserdicht.
      Nie mit geöffneter Krone ans Wasser – und am Ende immer wieder festschrauben (Schritt 7).</div>`,
    sim: ({ scenario }) => `
      Die Uhr im Modell ist vor einigen Tagen stehen geblieben: Das Zifferblatt zeigt
      <b>${dialTime(scenario.minuteOfDay)} Uhr</b>. Ob das in der ersten oder zweiten Tageshälfte war, zeigt
      ein Zwölf-Stunden-Zifferblatt nicht – nur die 24-Stunden-Anzeige am Modell verrät es.
      <button type="button" class="text-button" data-action="reroll">Anderen Stillstand würfeln</button>`,
    apply: ({ watch }) => { watch.crownPull = 1; },
    build: ({ watch }) => {
      const tl = new Timeline();
      tl.tween(0.6, 2.6, (v) => (watch.crownSpin = v * Math.PI * 8)); // unscrew CCW (towards 6)
      tl.tween(3.1, 1.0, (v) => (watch.crownPull = v), easeOut); // pops to pos. 1
      return tl;
    },
  },
  // ------------------------------------------------------------- 2
  {
    kicker: 'Schritt 2 · Erst aufziehen',
    title: 'Die Uhr von Hand aufziehen',
    camera: STEP_VIEWS.crown,
    body: () => `
      <p>Eine stehende Automatik wird <b>zuerst von Hand aufgezogen</b>: in <code>Position 1</code> die Krone
      <b>im Uhrzeigersinn (Richtung 12 Uhr)</b> drehen – ruhig und ohne Kraft, etwa eine Umdrehung pro
      Sekunde. <span class="hl">Rund ${WIND_TURNS} Umdrehungen</span> genügen als Richtwert; maßgeblich ist
      die Herstelleranleitung.</p>
      <div class="okbox">Die Rutschkupplung schützt die Zugfeder vor dem Überdrehen. Sobald das Werk läuft,
      bewegt sich der Sekundenzeiger. Die Gangreserve der Referenzuhr beträgt laut Hersteller etwa
      38 Stunden.</div>`,
    sim: () => `<span class="counter"><b><span id="wind-count">0</span> / ${WIND_TURNS}</b> Umdrehungen</span>`,
    apply: ({ watch }) => { watch.running = true; },
    build: ({ watch }) => {
      const tl = new Timeline();
      const counter = () => document.getElementById('wind-count');
      tl.tween(
        0.8,
        6.0,
        (v) => {
          watch.crownSpin = -v * WIND_TURNS * Math.PI * 2; // clockwise (towards 12)
          const el = counter();
          const count = String(Math.floor(v * WIND_TURNS));
          if (el && el.textContent !== count) el.textContent = count;
        },
        linear,
      );
      tl.call(2.6, () => (watch.running = true)); // balance starts after a few turns
      return tl;
    },
  },
  // ------------------------------------------------------------- 3
  {
    kicker: 'Schritt 3 · Sichere Stellung',
    title: 'Zeiger auf 5 Uhr stellen',
    camera: STEP_VIEWS.dial,
    body: () => `
      <p>Die Uhr kann zu <b>jeder Tageszeit</b> stehen geblieben sein – und das Zifferblatt zeigt nicht, in
      welcher Tageshälfte. Zwischen ca. <b>20 und 4 Uhr</b> schaltet das Kalenderwerk Datum und Mondscheibe
      weiter; <span class="hl">eine Schnellkorrektur in diesem Fenster kann das Werk beschädigen.</span>
      Deshalb zuerst in eine Stellung, die in <b>beiden</b> Tageshälften sicher ist:</p>
      <ol>
        <li>Krone ganz heraus in <code>Position 3</code> ziehen – der Sekundenzeiger stoppt.</li>
        <li>Die Krone so drehen, dass die Zeiger <b>vorwärts</b> laufen (rechtsherum über das Zifferblatt),
        bis die Uhr <b>5:00 Uhr</b> zeigt. Laufen sie rückwärts, die Krone andersherum drehen. Eine
        Viertelstunde davor oder danach schadet nicht.</li>
        <li>Die Krone eine Raste hineindrücken, in <code>Position 2</code> – gerade drücken, nicht drehen.</li>
      </ol>
      <div class="okbox">5 Uhr morgens und 5 Uhr nachmittags liegen <b>beide</b> außerhalb des
      Schaltfensters, und der Stundenzeiger verdeckt dort das Mondfenster nicht. In welcher Tageshälfte das
      Werk steht, musst du hier noch nicht wissen – das klärt sich in Schritt 6 von selbst.</div>
      <p class="muted">Springt beim Drehen das Datum, war das die Mitternacht des Werks; für diesen Schritt
      spielt es keine Rolle. Für diese Uhr nennt der Hersteller kein Schaltfenster. Für die Kaliberfamilie
      werden 20–2, 21–3 und 20–4 Uhr genannt; diese Anleitung meidet das größte.</p>`,
    sim: ({ watch, scenario }) => {
      const stopped = `<b>${clock24(scenario.minuteOfDay)} Uhr</b> (${dayPart(scenario.minuteOfDay)})`;
      const parked = timeOfDay(parkTarget(watch.mech));
      const other = clock24(timeOfDay(scenario.minuteOfDay + HALF_DAY));
      return `Hier blieb das Werk um ${stopped} stehen. Auf der 5 steht es dann um
        <b>${clock24(parked)} Uhr</b> – am Zifferblatt ist nicht zu sehen, ob morgens oder nachmittags.
        Das Schaltfenster ist am Modell farbig markiert.
        <button type="button" class="text-button" data-action="other-half">Stillstand um ${other} Uhr zeigen</button>`;
    },
    apply: ({ watch }) => {
      watch.mech.turnTo(parkTarget(watch.mech));
      watch.crownPull = 2;
      watch.running = true; // pos. 2: the movement keeps running
      watch.zone = 1;
    },
    build: (ctx) => {
      const { watch } = ctx;
      const tl = new Timeline();
      const park = parkTarget(watch.mech);
      const turning = park > watch.mech.minutes ? sweepSeconds(park - watch.mech.minutes) : 0;
      tl.tween(0.6, 0.9, (v) => (watch.crownPull = 1 + v * 2), easeOut); // to pos. 3
      tl.call(1.5, () => (watch.running = false)); // stop-second
      tl.tween(1.2, 1.2, (v) => (watch.zone = v));
      const events: SweepEvents = {
        switched: () => ctx.caption?.('Das Datum springt: Hier war die Mitternacht des Werks. Weiter bis zur 5.'),
      };
      if (turning) sweep(tl, 2.8, turning, ctx, park, easeInOut, events);
      const parked = 2.8 + turning;
      tl.call(parked, () => ctx.caption?.('Zeiger auf 5 Uhr: sicher, ob morgens oder nachmittags.'));
      tl.tween(parked + 0.4, 0.8, (v) => (watch.crownPull = 3 - v), easeOut); // back to pos. 2
      tl.call(parked + 1.2, () => (watch.running = true));
      return tl;
    },
  },
  // ------------------------------------------------------------- 4
  {
    kicker: 'Schritt 4 · Kalender',
    title: 'Datum eine Zahl vor heute stellen',
    camera: STEP_VIEWS.date,
    body: ({ now, plan }) => {
      const target = settingDay(plan);
      const first = firstJump(plan);
      const ringNote = plan.parkDate > first
        ? ` Die Datumsscheibe hat immer 31 Positionen – vor der 1 steht die 31, auch wenn der Vormonat
           kürzer war.`
        : '';
      // The numbers belong to the day the plan was made for, which near midnight is not the day on the wall.
      const ahead = calendarDaysBetween(now, target);
      const which = ahead === 0
        ? `Stelle <b>die Zahl vor dem heutigen Datum</b> ein: <span class="hl">die ${plan.parkDate}</span>.`
        : ahead > 0
          ? `Gleich ist Mitternacht – die Uhr wird schon auf den ${fmtDay(target)} gestellt. Stelle die Zahl
             davor ein: <span class="hl">die ${plan.parkDate}</span>.`
          : `Eingestellt wird <span class="hl">die ${plan.parkDate}</span>, die Zahl vor dem ${fmtDay(target)};
             den Tageswechsel seither rechnet Schritt 6 ein.`;
      return `
      ${PARKED_NOTE}
      <p>${which}${ringNote}</p>
      <p>Dazu in <code>Position 2</code> die Krone <b>im Uhrzeigersinn (Richtung 12 Uhr)</b> drehen: Das
      Datum im Fenster bei 3 Uhr springt – jeder Klick ein Tag, immer vorwärts. Springt nichts, steht die
      Krone noch in Position 1: eine Raste herausziehen.</p>
      <p><b>Warum eine Zahl zu wenig?</b> Der Weg zur richtigen Uhrzeit führt in Schritt 6 einmal über
      Mitternacht. Dabei schaltet die Uhr selbst auf die <b>${first}</b> weiter – und dieser Sprung beweist
      zugleich, in welcher Tageshälfte das Werk steht.</p>`;
    },
    sim: ({ watch, plan }) => {
      const n = watch.mech.clicksToDate(plan.parkDate);
      return n
        ? `Hier zeigt das Fenster die <b>${watch.mech.date}</b> – ${clicks(n)} bis zur ${plan.parkDate}.`
        : `Hier steht das Datum bereits auf der ${plan.parkDate}.`;
    },
    apply: ({ watch, plan }) => {
      for (let n = watch.mech.clicksToDate(plan.parkDate); n > 0; n--) watch.mech.quickDate();
    },
    build: (ctx) => {
      const { watch, plan } = ctx;
      const tl = new Timeline();
      const n = watch.mech.clicksToDate(plan.parkDate);
      const gap = n > 6 ? 0.28 : 0.6;
      for (let i = 0; i < n; i++) click(tl, 1.3 + i * gap, watch, -1, () => watch.mech.quickDate()); // towards 12
      tl.call(1.3 + n * gap + 0.3, () => ctx.caption?.(n
        ? `Das Datum steht auf ${watch.mech.date} – eine Zahl vor heute.`
        : `Das Datum steht bereits auf ${watch.mech.date} – eine Zahl vor heute.`));
      return tl;
    },
  },
  // ------------------------------------------------------------- 5
  {
    kicker: 'Schritt 5 · Kalender',
    title: 'Mondphase einen Tag zurück stellen',
    camera: STEP_VIEWS.moon,
    body: ({ moon, plan }) => {
      const target = settingDay(plan);
      const moonNote = daysSinceFullMoonDate(target) === 0
        ? `Am ${fmtDay(target)} ist Vollmond. Gezählt wird trotzdem vom Vollmond davor – nach dem
           Mitternachts-Durchgang in Schritt 6 steht dann wieder ein Mond mittig.`
        : `Heute: <b>${moon.name}</b>, ${(moon.illumination * 100).toFixed(0)} % beleuchtet · nächster
           Vollmond am ${fmtDay(moon.nextFullMoon)}.`;
      return `
      ${PARKED_NOTE}
      <p>Die Krone bleibt in <code>Position 2</code>. Jetzt <b>gegen den Uhrzeigersinn (Richtung 6 Uhr)</b>
      drehen – jeder Klick schaltet die Mondscheibe einen Tag weiter:</p>
      <ol>
        <li>Weiterschalten, bis ein Mond <b>möglichst mittig</b> im Mondfenster bei 6 Uhr steht, frei
        zwischen den beiden Wolken – das ist die <b>Vollmond-Stellung</b>.</li>
        <li>${moonLine(plan)}</li>
      </ol>
      <p>Wie beim Datum fehlt damit bewusst <b>ein Tag</b> – nicht von Hand nachhelfen.${moonDirectNote(plan)}</p>
      <p>Zu weit geklickt? Die Scheibe lässt sich nur <b>vorwärts</b> schalten: weiterklicken, bis der
      nächste Mond mittig steht, dann neu zählen. Von Mond zu Mond sind es 29 oder 30 Klicks.</p>
      <p class="muted">${moonNote}</p>`;
    },
    sim: ({ watch }) => `Hier fehlen der Scheibe noch ${clicks(watch.mech.clicksToFullMoonPose())}
      bis zur Vollmond-Stellung.`,
    apply: ({ watch, plan }) => {
      const n = watch.mech.clicksToFullMoonPose() + plan.moonClicksAtPark;
      for (let i = 0; i < n; i++) watch.mech.quickMoon();
    },
    build: (ctx) => {
      const { watch } = ctx;
      const tl = new Timeline();
      const toReference = watch.mech.clicksToFullMoonPose();
      const afterReference = ctx.plan.moonClicksAtPark;
      let t = 1.0;
      for (let i = 0; i < toReference; i++) click(tl, t + i * 0.22, watch, 1, () => watch.mech.quickMoon()); // towards 6
      t += toReference * 0.22 + 0.3;
      tl.call(t, () => ctx.caption?.('Vollmond-Stellung: Der Mond steht mittig im Fenster.'));
      t += 1.1;
      const gap = afterReference > 12 ? 0.24 : 0.42;
      for (let i = 0; i < afterReference; i++) click(tl, t + i * gap, watch, 1, () => watch.mech.quickMoon());
      return tl;
    },
  },
  // ------------------------------------------------------------- 6
  {
    kicker: 'Schritt 6 · Tageshälfte klären und Zeit stellen',
    title: 'Über Mitternacht zur richtigen Zeit',
    camera: STEP_VIEWS.dial,
    // Nothing in this text may depend on the time of day at which it was
    // rendered: noon or midnight can pass while the owner is turning the hands.
    body: ({ now, plan }) => {
      const setting = timeSetting(plan, now);
      const target = settingDay(plan);
      const dayAfter = addDays(target, 1);
      const first = firstJump(plan);
      const second = ring(first + 1);
      const ringGap = second === dayAfter.getDate()
        ? ''
        : ` Die Datumsscheibe kennt keine Monatslängen: nach Schritt 7 am Morgen (nach 4 Uhr) in Position 2
           von Hand auf <b>${dayAfter.getDate()}</b> weiterschalten.`;
      const twice = setting.midnightPasses > 1;
      const jump = twice
        ? `Seit dem Stellen des Kalenders ist ein neuer Tag angebrochen. Das <b>Datum springt zuerst auf
           ${first}</b>: Im Werk ist <b>Mitternacht</b>, die Tageshälfte ist jetzt sicher bekannt. Dann
           <b>einen vollen Tag weiterdrehen</b> – zweimal über die Zwölf –, bis das Datum noch einmal
           springt: auf <b>${second}</b>.${ringGap} Die Mondscheibe rückt bei jedem der beiden Sprünge
           einen Tag weiter.`
        : `Das <b>Datum springt auf ${first}</b>: Im Werk ist <b>Mitternacht</b>, die Tageshälfte ist jetzt
           sicher bekannt. Die Mondscheibe rückt bei diesem Durchgang ebenfalls einen Tag weiter.`;
      const dayChange = twice
        ? ''
        : `<li>Zeigt die Referenz inzwischen schon den <b>${fmtDay(dayAfter)}</b> (Mitternacht ist während
           des Einstellens vergangen), fehlt der Uhr ein Tag: die Zeiger <b>einen vollen Tag
           weiterdrehen</b> – zweimal über die Zwölf –, bis das Datum noch einmal springt (auf
           ${second}).${ringGap}</li>`;
      return `
      <p>Jetzt klärt sich die Tageshälfte, und Datum und Mond rücken auf den
      <b>${fmtDay(twice ? dayAfter : target)}</b>.</p>
      <div class="okbox"><b>Voraussetzung:</b> Das Datumsfenster zeigt die <b>${plan.parkDate}</b> aus
      Schritt 4, und der Stundenzeiger steht noch nahe der 5. Zeigt das Fenster eine andere Zahl oder ist
      die Uhr seit Schritt 5 länger weitergelaufen: zurück zu Schritt 3.</div>
      <p><b>Warte, bis der Sekundenzeiger auf 12 steht</b>, und ziehe die Krone dann ganz heraus in
      <code>Position 3</code> – <span class="hl">Sekundenstopp</span>, das Werk hält an.</p>
      <ol>
        <li>Die Krone wieder so drehen, dass die Zeiger <b>vorwärts</b> laufen, und das Datumsfenster
        beobachten. Läuft der Stundenzeiger über die Zwölf und das Datum bleibt stehen, war das der
        <b>Mittag</b> – weiterdrehen.</li>
        <li>${jump}</li>
        ${dayChange}
        <li>Von Mitternacht aus <b>weiter vorwärts</b> bis zur Uhrzeit der Referenz. Zeigt sie eine Zeit
        <b>vor 12:00 Uhr</b>: die Zwölf nicht noch einmal überfahren. Zeigt sie <b>12:00 Uhr oder
        später</b>: genau einmal über die Zwölf – das ist der Mittag, dort schaltet nichts.</li>
        <li>Den Minutenzeiger genau auf den Strich der <b>nächsten vollen Minute</b> stellen. Als Referenz
        dient eine genaue Uhr, z. B. <code>time.is</code>; im 3D-Modus läuft oben rechts die Gerätezeit
        mit.</li>
        <li>Genau beim Sekundensprung der Referenz auf <b>:00</b> die Krone gerade bis
        <code>Position 1</code> hineindrücken, ohne sie zu drehen – das Werk startet synchron.</li>
      </ol>
      <div class="warnbox"><b>Kontrolle:</b> Zeigt das Fenster das Datum der Referenz, darf es <b>nicht noch
      einmal</b> springen. Ist es doch weitergesprungen, hilft Zurückdrehen nicht – rückwärts schaltet der
      Kalender nicht. Dann zurück zu Schritt 3.</div>`;
    },
    sim: ({ watch }) => {
      const morning = watch.mech.minuteOfDay < HALF_DAY;
      const other = clock24(timeOfDay(watch.mech.minuteOfDay + HALF_DAY));
      return `Hier steht das Werk auf <b>${clock24(watch.mech.minuteOfDay)} Uhr</b>: ${morning
        ? 'Die Zeiger laufen erst über den <b>Mittag</b> – kein Sprung – und zwölf Stunden später über Mitternacht.'
        : 'Schon der erste Durchgang durch die Zwölf ist <b>Mitternacht</b>.'}
        <button type="button" class="text-button" data-action="other-half">Mit dem Werk auf ${other} Uhr zeigen</button>
        <span id="sync-status" class="sync-status">Das Modell wartet nach dem Zeigerstellen auf eine volle
        Minute der Gerätezeit.</span>`;
    },
    apply: ({ watch, now, plan }) => {
      const setting = timeSetting(plan, now);
      // The state "now": the hands are where they will be at the reference minute, minus the wait.
      const lead = (setting.target.getTime() - Date.now()) / 60_000;
      watch.mech.turnTo(timeTarget(watch.mech, setting) - lead);
      const current = new Date();
      watch.lockToClock(current.getTime(), current.getSeconds() + current.getMilliseconds() / 1000);
      watch.crownPull = 1;
      watch.zone = 0;
    },
    build: (ctx) => {
      const { watch } = ctx;
      const tl = new Timeline();
      const setting = timeSetting(ctx.plan, ctx.now);
      let syncEpoch = setting.target.getTime();
      const start = watch.mech.minutes;
      const midnight = nextMidnight(start);
      const noon = midnight - HALF_DAY;
      const target = timeTarget(watch.mech, setting);
      /** The movement's midnight that begins the day of the reference minute. */
      const referenceDayStart = target - setting.targetMinuteOfDay;
      const secondStart = watch.displaySeconds;
      watch.running = false;
      // Accelerate the illustrative wait to twelve, then hack the movement.
      tl.tween(0, 0.8, (v) => (watch.displaySeconds = secondStart + (60 - secondStart % 60) * v), linear);
      tl.call(0.8, () => (watch.displaySeconds = 0));
      tl.tween(0.5, 0.9, (v) => (watch.crownPull = 2 + v), easeOut);
      let t = 2.2;
      if (start < noon) {
        // Parked in the morning: the first pass of the twelve is noon and switches nothing.
        const toNoon = sweepSeconds(noon - start);
        sweep(tl, t, toNoon, ctx, noon);
        t += toNoon;
        tl.call(t, () => ctx.caption?.('Zwölf Uhr – das Datum bleibt stehen: Das war der Mittag. Weiterdrehen.'));
        t += 1.4;
      }
      const toMidnight = sweepSeconds(midnight - Math.max(start, noon));
      sweep(tl, t, toMidnight, ctx, midnight);
      t += toMidnight;
      tl.call(t, () => ctx.caption?.(`Das Datum springt auf ${watch.mech.date}: Mitternacht – die Tageshälfte ist klar.`));
      t += 1.6;
      // On to the reference minute; any further midnight is a planned one.
      const events: SweepEvents = {
        noon: () => ctx.caption?.('Zwölf Uhr mittags – nichts schaltet, das Datum bleibt stehen.'),
        switched: () => ctx.caption?.(`Noch eine Mitternacht – das Datum springt auf ${watch.mech.date}.`),
      };
      const distance = target - midnight;
      const backOff = Math.min(4, distance);
      const turning = sweepSeconds(distance);
      sweep(tl, t, turning, ctx, target - backOff, easeInOut, events);
      sweep(tl, t + turning + 0.4, 1.8, ctx, target, linear, events); // the last minutes slowly, onto the mark
      const ready = t + turning + 3.0;
      tl.hold(ready, () => {
        const current = Date.now();
        // Paused or in the background across the reference minute: take the next
        // one. The hands follow the wall clock from the start of the reference day,
        // so noon, midnight or a clock change in between come out right.
        if (current > syncEpoch + 5_000) {
          const next = new Date(Math.floor(current / 60_000) * 60_000 + 60_000);
          const dateBefore = watch.mech.date;
          watch.mech.turnTo(referenceDayStart + calendarDaysBetween(setting.target, next) * DAY + minuteOfDay(next));
          if (watch.mech.date !== dateBefore) {
            ctx.caption?.(`Inzwischen ist Mitternacht vorbei – das Datum springt auf ${watch.mech.date}.`);
          }
          syncEpoch = next.getTime();
        }
        const label = document.getElementById('sync-status');
        const status = current < syncEpoch
          ? `Bereit. Start zur vollen Minute in ${Math.ceil((syncEpoch - current) / 1000)} s.`
          : 'Das Modell läuft jetzt mit der Gerätezeit.';
        if (label && label.textContent !== status) label.textContent = status;
        return current >= syncEpoch;
      });
      tl.call(ready, () => watch.lockToClock(syncEpoch, 0));
      tl.tween(ready, 0.7, (v) => (watch.crownPull = 3 - v * 2), easeOut);
      tl.tween(ready + 0.4, 0.9, (v) => (watch.zone = 1 - v));
      return tl;
    },
  },
  // ------------------------------------------------------------- 7
  {
    kicker: 'Schritt 7 · Abschluss',
    title: 'Krone festschrauben & Endkontrolle',
    camera: STEP_VIEWS.hero,
    // The final check describes the day the watch has been set to: the day after
    // the park day, or the present day when midnight has passed since.
    body: ({ moon, now, plan }) => {
      const jumps = Math.max(1, calendarDaysBetween(plan.parkDay, now));
      const day = addDays(plan.parkDay, jumps);
      const shown = ring(plan.parkDate + jumps);
      const moonDays = daysSinceFullMoonDate(day);
      const moonLineFinal = moonDays
        ? `die Scheibe steht ${days(moonDays)} nach der Vollmond-Stellung`
        : 'ein Mond steht – bis auf höchstens einen Klick – mittig im Fenster';
      const monthNote = shown === day.getDate()
        ? ''
        : `<br>· Die Datumsscheibe kennt keine Monatslängen: am Morgen nach 4 Uhr in Position 2 von Hand
           auf <b>${day.getDate()}</b> weiterschalten`;
      return `
      <p>Die Krone steht in <code>Position 1</code>: leicht eindrücken und dabei <b>im Uhrzeigersinn
      (Richtung 12 Uhr) handfest festschrauben</b> – erst dann ist die Uhr wieder bis 100 m wasserdicht.</p>
      <div class="okbox"><b>Endkontrolle</b><br>
      · Datum zeigt <b>${shown}</b> (${fmtDate(day)})${monthNote}<br>
      · Mondphase: <b>${moon.name}</b> – ${moonLineFinal}<br>
      · Sekundenzeiger läuft <b>synchron zur Referenzzeit</b><br>
      · Krone <b>verschraubt</b></div>
      <div class="okbox"><b>Probe der Tageshälfte:</b> Das Datum wechselt von jetzt an <b>nachts</b>, um
      Mitternacht. Springt es stattdessen mittags, läuft die Uhr um zwölf Stunden versetzt – dann die
      Schritte 3 bis 6 wiederholen.</div>
      <p class="muted">Nach Monaten mit weniger als 31 Tagen das Datum am Morgen des Ersten (nach 4 Uhr)
      von Hand auf 1 weiterschalten – in Position 2 und nie im Schaltfenster (ca. 20 bis 4 Uhr). Die
      Mondscheibe rechnet mit 29,5 statt 29,53 Tagen je Mondzyklus und ist dem Mond nach etwa
      zweieinhalb Jahren einen Tag voraus; dann wie in Schritt 5 neu einstellen, denn sie schaltet nur
      vorwärts. Bleibt die Uhr stehen (Gangreserve ca. 38 h): Krone lösen und wieder bei Schritt 1
      beginnen.</p>`;
    },
    sim: ({ watch, now }) => {
      const { mech } = watch;
      const right = mech.date === now.getDate() && mech.isAfternoon === now.getHours() >= 12;
      return `Hier steht das Werk auf <b>${clock24(mech.minuteOfDay)} Uhr</b> (${dayPart(mech.minuteOfDay)}),
        Datum <b>${mech.date}</b>${right ? ' – beides stimmt mit deiner Gerätezeit überein.' : '.'}`;
    },
    apply: ({ watch }) => { watch.crownPull = 0; },
    build: ({ watch }) => {
      const tl = new Timeline();
      tl.tween(0.6, 1.0, (v) => (watch.crownPull = 1 - v), easeOut); // push all the way in
      tl.tween(1.8, 2.2, (v) => (watch.crownSpin = -v * Math.PI * 6)); // screw down CW
      return tl;
    },
  },
];
