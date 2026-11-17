// The text UI. It imports three.js only as types, so the guide can be shown as
// plain text when the 3D chunk fails to load (see boot.ts).
import type { SceneManager } from './scene';
import { BACK_VIEW, STEP_VIEWS, VIEWS, WORKS_VIEW, type CameraPose, type ViewName } from './views';
import { Timeline, easeOut, linear } from './animator';
import { calendarDaysBetween, moonState } from './moon';
import { makePlan, makeScenario, otherHalf, parseClock, planIsCurrent, type Scenario } from './plan';
import { CROWN_LABELS } from './watch/labels';
import type { WatchModel } from './watch/model';
import { CALENDAR_STEP, STEPS, clock24, dayPart, dialTime, enterStep, type StepCtx, type TextCtx } from './steps';

const CROWN_DESCRIPTIONS = [
  'Die Krone liegt am Gehäuse an. Wähle eine Position, um ihre Funktion auszuprobieren.',
  'Aufziehen: Richtung 12 Uhr spannt die Zugfeder. Richtung 6 Uhr läuft der Aufzug frei.',
  'Kalender: Richtung 12 Uhr schaltet das Datum, Richtung 6 Uhr die Mondscheibe. Im Schaltfenster (ca. 20 bis 4 Uhr) sperrt die echte Uhr das nicht – dort kann die Schnellkorrektur das Werk beschädigen. Das Modell verweigert sie deshalb.',
  'Sekundenstopp: Das Werk hält an. Im Modell laufen die Zeiger Richtung 6 Uhr vorwärts und Richtung 12 Uhr rückwärts – an der eigenen Uhr kurz prüfen und möglichst nur vorwärts stellen. Laufen sie vorwärts über Mitternacht, schalten Datum und Mond.',
];
const VIEW_LABELS: Record<ViewName, string> = {
  overview: 'Edelstahl · Sonnenschliff · Mondphase',
  dial: 'Applizierte Ziffern · Facettierte Zeiger · Versenkte Mondscheibe',
  crown: 'Geriffelte Krone · Polierte Kappe · Sichtbarer Aufzugsstift',
};
/** The two ways of opening the watch: what the stage says, and what is announced once it is open. */
const OPENED = {
  front: { label: 'Werk von vorn · Kalender, Zeigerwerk und Aufzug', opened: 'Uhr von vorn geöffnet: Kalender, Zeigerwerk und Aufzug.' },
  back: { label: 'Werk von hinten · Rotor, Unruh und Räderwerk', opened: 'Gehäuseboden abgenommen: Rotor, Unruh und Räderwerk.' },
} as const;
type Side = keyof typeof OPENED;
const LOADING_LABEL = 'Werk wird geladen …';
/** Seconds an event caption stays on the stage. */
const CAPTION_SECONDS = 5;
/** Hand movement per crown turn in the explore mode, in minutes. */
const EXPLORE_TURN_MINUTES = 60;
/** Seconds one crown turn or quick-set click takes in the explore mode. */
const EXPLORE_TURN_SECONDS = 0.45;
/** Presses of the turn buttons made while the crown is still moving are kept, up to this many. */
const MAX_QUEUED_TURNS = 40;
/** A refused turn: the crown gives this far (about 30°) and springs back within this time. */
const REFUSED_NUDGE_RADIANS = Math.PI / 6;
const REFUSED_NUDGE_SECONDS = 0.35;
/**
 * How long the numbers of the calendar steps stand. The parked watch runs on:
 * after an hour and a half a watch parked at 17:00 comes close to the switching
 * window, so the owner has to park again anyway, and the plan is made anew.
 */
const PLAN_VALID_MS = 90 * 60_000;
const PLAN_STORE = 'luna-plan';

/** The stopped watch of this visit; `?stop=HH:MM` (24 h) fixes its time for demonstrations. */
function initialScenario(now: Date): Scenario {
  const scenario = makeScenario(now);
  const fixed = parseClock(new URLSearchParams(location.search).get('stop'));
  return fixed === null ? scenario : { ...scenario, minuteOfDay: fixed };
}

export function createContext(watch: WatchModel): StepCtx {
  const now = new Date();
  return { watch, ...textContext(now), scenario: initialScenario(now) };
}

/** What the instructions alone need; also used when no 3D model could be built. */
function textContext(now = new Date()): TextCtx {
  return { now, moon: moonState(now), plan: makePlan(now) };
}

export class Wizard {
  private index = 0;
  private timeline: Timeline | null = null;
  private mode: 'explore' | 'guide' = 'explore';
  private paused = false;
  private crownPosition = 0;
  /** Which side of the watch is open, if any; it shows once the movement is built. */
  private opened: Side | null = null;
  private loading = false;
  private captionLeft = 0;
  /**
   * The plan stands from the first calendar step on: looking back at earlier
   * steps, a reload or midnight passing must not change the numbers the owner
   * has already set on the watch. Epoch ms of the moment it was fixed, or null.
   */
  private plannedAt: number | null = null;
  private readonly queuedTurns: number[] = [];
  /** Crown pull the 2D diagram currently shows. */
  private drawnPull = NaN;
  private readonly dots: HTMLButtonElement[] = [];
  private readonly bodyEl = document.getElementById('step-body')!;
  private readonly prevBtn = document.getElementById('btn-prev') as HTMLButtonElement;
  private readonly nextBtn = document.getElementById('btn-next') as HTMLButtonElement;
  private readonly pauseBtn = document.getElementById('btn-pause') as HTMLButtonElement;
  private readonly openButtons: Record<Side, HTMLButtonElement> = {
    front: document.getElementById('btn-explode') as HTMLButtonElement,
    back: document.getElementById('btn-back') as HTMLButtonElement,
  };

  constructor(private readonly sceneMgr: SceneManager, private readonly ctx: StepCtx) {
    ctx.caption = text => this.showCaption(text);
    STEPS.forEach((step, i) => {
      const dot = document.createElement('button');
      dot.title = `${i + 1}. ${step.title}`;
      dot.setAttribute('aria-label', `Schritt ${i + 1} von ${STEPS.length}: ${step.title}`);
      dot.setAttribute('aria-controls', 'step-body');
      dot.addEventListener('click', () => this.goTo(i));
      document.getElementById('step-dots')!.appendChild(dot);
      this.dots.push(dot);
    });
    setText('step-total', String(STEPS.length));
    this.prevBtn.addEventListener('click', () => this.goTo(this.index - 1));
    this.nextBtn.addEventListener('click', () => this.index === STEPS.length - 1 ? this.explore(true) : this.goTo(this.index + 1));
    document.getElementById('btn-replay')!.addEventListener('click', () => {
      this.rerun();
      this.announce('Animation wird wiederholt.');
    });
    this.pauseBtn.addEventListener('click', () => {
      this.paused = !this.paused;
      this.pauseBtn.setAttribute('aria-label', this.paused ? 'Animation fortsetzen' : 'Animation pausieren');
      this.announce(this.paused ? 'Animation pausiert.' : 'Animation fortgesetzt.');
    });
    // The step text can offer another demonstration case of the stopped watch.
    this.bodyEl.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'reroll') this.ctx.scenario = makeScenario(new Date());
      else if (action === 'other-half') this.ctx.scenario = otherHalf(this.ctx.scenario);
      else return;
      this.rerun();
      this.bodyEl.querySelector<HTMLElement>(`[data-action="${action}"]`)?.focus({ preventScroll: true });
      this.announce(`Neuer Stillstand: Das Zifferblatt zeigt ${dialTime(this.ctx.scenario.minuteOfDay)} Uhr.`);
    });
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.mode-switch [role="tab"]'));
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        if (tab.getAttribute('aria-selected') !== 'true') {
          if (index === 0) this.explore();
          else this.goTo(this.index, false);
        }
        tab.focus({ preventScroll: true });
      });
      // Manual activation: arrows move focus; native Enter/Space clicks select.
      tab.addEventListener('keydown', event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        let next: number;
        switch (event.key) {
          case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
          case 'ArrowRight': next = (index + 1) % tabs.length; break;
          case 'Home': next = 0; break;
          case 'End': next = tabs.length - 1; break;
          case 'Tab':
            // Leave the tablist even when focus is on an unselected tab.
            event.preventDefault();
            document.getElementById(event.shiftKey ? 'btn-back' : this.mode === 'explore' ? 'explore-panel' : 'panel')!.focus();
            return;
          default: return;
        }
        event.preventDefault();
        tabs[next].focus();
      });
    });
    document.querySelector<HTMLAnchorElement>('.skip-link')!.addEventListener('click', event => {
      event.preventDefault();
      document.getElementById(`mode-${this.mode}`)!.focus();
    });
    document.getElementById('start-guide')!.addEventListener('click', () => { this.forgetPlan(); this.goTo(0); });
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => this.setView(button.dataset.view as ViewName)));
    document.getElementById('btn-crown-focus')!.addEventListener('click', () => this.setView('crown'));
    document.getElementById('btn-lab-reset')!.addEventListener('click', () => { this.explore(); this.announce('Das Modell zeigt wieder deine Gerätezeit.'); });
    document.querySelectorAll<HTMLButtonElement>('[data-crown]').forEach(button => button.addEventListener('click', () => this.setCrown(Number(button.dataset.crown)))) ;
    document.getElementById('turn-back')!.addEventListener('click', () => this.turnCrown(-1));
    document.getElementById('turn-forward')!.addEventListener('click', () => this.turnCrown(1));
    const rotate = document.getElementById('btn-rotate')!;
    rotate.addEventListener('click', () => {
      this.sceneMgr.controls.autoRotate = !this.sceneMgr.controls.autoRotate;
      rotate.setAttribute('aria-pressed', String(this.sceneMgr.controls.autoRotate));
    });
    this.openButtons.front.addEventListener('click', () => this.setOpened(this.opened === 'front' ? null : 'front'));
    this.openButtons.back.addEventListener('click', () => this.setOpened(this.opened === 'back' ? null : 'back'));
    document.getElementById('scene')!.addEventListener('keydown', e => {
      const event = e as KeyboardEvent;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key;
      const turn = event.shiftKey ? 2 : 8; // degrees; Shift turns in fine steps
      switch (key) {
        case 'ArrowLeft': this.sceneMgr.orbitBy(-turn, 0); break;
        case 'ArrowRight': this.sceneMgr.orbitBy(turn, 0); break;
        case 'ArrowUp': this.sceneMgr.orbitBy(0, turn); break;
        case 'ArrowDown': this.sceneMgr.orbitBy(0, -turn); break;
        case '+': case '=': this.sceneMgr.zoomBy(1.15); break;
        case '-': case '_': this.sceneMgr.zoomBy(1 / 1.15); break;
        case '1': case '2': case '3': this.setView((['overview', 'dial', 'crown'] as const)[Number(key) - 1]); break;
        case '4': this.setOpened(this.opened === 'front' ? null : 'front'); break;
        case '5': this.setOpened(this.opened === 'back' ? null : 'back'); break;
        case 'Home': this.setView('overview'); break;
        default: return;
      }
      event.preventDefault();
    });
    this.restorePlan();
    startLiveStrip();
    const linked = this.stepInAddress();
    if (linked !== null) this.goTo(linked, false);
    else if (window.matchMedia('(max-width: 760px)').matches) this.goTo(0, false);
    else this.explore();
    window.addEventListener('hashchange', () => {
      const step = this.stepInAddress();
      if (step !== null && (this.mode !== 'guide' || step !== this.index)) this.goTo(step, false);
    });
  }

  private showMode(mode: 'explore' | 'guide'): void {
    this.mode = mode;
    document.getElementById('app')!.dataset.mode = mode;
    document.getElementById('explore-panel')!.hidden = mode !== 'explore';
    document.getElementById('panel')!.hidden = mode !== 'guide';
    document.getElementById('panel')!.scrollTop = 0;
    for (const name of ['explore', 'guide']) {
      const tab = document.getElementById(`mode-${name}`)!;
      tab.setAttribute('aria-selected', String(mode === name));
      tab.tabIndex = mode === name ? 0 : -1;
    }
    this.paused = false;
    this.pauseBtn.setAttribute('aria-label', 'Animation pausieren');
    this.hideCaption();
    setText('assistive-status', '');
  }

  /** A correctly set, running watch that shows the device's time, date and moon. */
  explore(focusTab = false): void {
    this.showMode('explore');
    this.timeline = null;
    const watch = this.ctx.watch;
    const now = new Date();
    watch.showWallClock(now, moonState(now).clicksFromFullMoon);
    watch.zone = 0;
    watch.crownPull = 0;
    watch.crownSpin = 0;
    watch.snap();
    this.setCrown(0, false);
    if (this.opened) this.setOpened(null, false);
    this.setView(window.matchMedia('(max-width: 760px)').matches ? 'dial' : 'overview');
    this.syncAddress();
    if (focusTab) document.getElementById('mode-explore')!.focus();
  }

  /** Every camera flight ends the automatic rotation; its button must say so. With the caseback
   * off the camera may look up from inside the bracelet; it gives that up once it has flown out. */
  private fly(pose: CameraPose): void {
    this.sceneMgr.flyTo(pose);
    this.sceneMgr.setKeepOut(this.opened === 'back' ? 'back' : 'closed');
    document.getElementById('btn-rotate')!.setAttribute('aria-pressed', 'false');
  }

  /** What the stage says about the open watch, or null when it is closed. */
  private openedLabel(): string | null {
    if (!this.opened) return null;
    return this.loading ? LOADING_LABEL : OPENED[this.opened].label;
  }

  setView(view: ViewName): void {
    this.fly(VIEWS[view]);
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    document.getElementById('view-description')!.textContent = this.openedLabel() ?? VIEW_LABELS[view];
  }

  /** Lift crystal, hands and dial off the movement, or put them back. */
  setExploded(on: boolean, moveCamera = true): void {
    this.setOpened(on ? 'front' : this.opened === 'front' ? null : this.opened, moveCamera);
  }

  /** Open the watch from the front (dial side) or from the back (caseback off), or close it. One
   * side at a time. The movement is built on the first opening; the watch opens once it is ready. */
  setOpened(side: Side | null, moveCamera = true): void {
    this.opened = side;
    for (const key of ['front', 'back'] as const) this.openButtons[key].setAttribute('aria-pressed', String(side === key));
    if (side && !this.ctx.watch.movementReady) this.loadMovement();
    if (!moveCamera) return;
    if (side) {
      this.fly(side === 'front' ? WORKS_VIEW : BACK_VIEW);
      document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', 'false'));
      document.getElementById('view-description')!.textContent = this.openedLabel();
    } else if (this.mode === 'guide') {
      this.fly(STEPS[this.index].camera);
      document.getElementById('view-description')!.textContent = `Schritt ${this.index + 1} · ${STEPS[this.index].title}`;
    } else {
      this.setView('overview');
    }
  }

  /** Download and build the movement, compile its shaders, then let the opening go ahead. */
  private loadMovement(): void {
    if (this.loading) return;
    this.loading = true;
    const watch = this.ctx.watch;
    const busy = (on: boolean): void => {
      for (const button of Object.values(this.openButtons)) {
        if (on) button.setAttribute('aria-busy', 'true'); else button.removeAttribute('aria-busy');
      }
    };
    busy(true);
    void watch.loadMovement()
      .then(() => Promise.all(watch.movementGroups.map(group => this.sceneMgr.prepareObject(group))))
      .then(() => {
        this.loading = false;
        busy(false);
        if (!this.opened) return;
        document.getElementById('view-description')!.textContent = OPENED[this.opened].label;
        this.announce(OPENED[this.opened].opened);
      }, (error: unknown) => {
        console.warn('The movement could not be loaded.', error);
        this.loading = false;
        busy(false);
        if (this.opened) this.setOpened(null);
        this.showCaption('Das Werk konnte nicht geladen werden. Bitte später noch einmal versuchen.');
      });
  }

  private setCrown(position: number, focus = true): void {
    if (this.mode !== 'explore') return;
    const watch = this.ctx.watch;
    const from = watch.crownPull;
    const spin = watch.crownSpin;
    const moves = Math.abs(from - position) > 0.001;
    this.crownPosition = position;
    this.queuedTurns.length = 0;
    if (position === 3) {
      // Stop-second: from here on the hands belong to the crown, not to the clock.
      watch.releaseClock();
      watch.running = false;
    } else {
      watch.running = true;
    }
    watch.zone = position >= 2 ? 1 : 0;
    const screw = position === 0 || from < 0.1;
    const duration = screw ? 1.5 : 0.6;
    this.timeline = moves ? new Timeline().tween(0, duration, v => {
      watch.crownPull = from + (position - from) * v;
      if (screw) watch.crownSpin = spin + (position === 0 ? -1 : 1) * v * Math.PI * 4;
    }, easeOut) : null;
    document.querySelectorAll<HTMLButtonElement>('[data-crown]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.crown) === position)));
    setText('crown-description', position === 2 && watch.mech.inLockout ? this.lockoutNotice() : CROWN_DESCRIPTIONS[position]);
    for (const id of ['turn-back', 'turn-forward']) (document.getElementById(id) as HTMLButtonElement).disabled = position === 0;
    // With the watch open the camera stays on the movement, which shows what the crown does.
    if (!focus || this.opened) return;
    // Show what the crown does in this position: the date window, the hands, or the crown itself.
    if (position < 2) { this.setView('crown'); return; }
    this.fly(position === 2 ? STEP_VIEWS.date : STEP_VIEWS.dial);
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    document.getElementById('view-description')!.textContent = CROWN_LABELS[position as 2 | 3];
  }

  /** Why the crown is refused, and the way out counted in turns of the position-3 crown. */
  private lockoutNotice(): string {
    const { watch } = this.ctx;
    const { mech } = watch;
    const turns = Math.ceil(mech.minutesToLockoutEnd / EXPLORE_TURN_MINUTES);
    const after = mech.minuteOfDay + turns * EXPLORE_TURN_MINUTES;
    const shows = watch.lockedToClock ? 'Das Modell läuft mit deiner Uhrzeit und zeigt' : 'Das Werk zeigt';
    const midnight = after >= 24 * 60 ? ' Über Mitternacht schalten Datum und Mond dabei von selbst.' : '';
    return `Gesperrt – Schaltfenster: ${shows} ${clock24(mech.minuteOfDay)} Uhr. Zwischen ca. 20 und 4 Uhr schaltet der Kalender – Datum und Mond jetzt nicht verstellen. Krone auf Position 3 und ${turns}× Richtung 6 Uhr: Dann stehen die Zeiger auf ${clock24(after)} Uhr, außerhalb des Fensters.${midnight}`;
  }

  /** A refused turn has to be seen: the crown gives a little and springs back, the notice flashes. */
  private refuseTurn(direction: number): void {
    const watch = this.ctx.watch;
    const spin = watch.crownSpin;
    this.queuedTurns.length = 0;
    setText('crown-description', this.lockoutNotice());
    const notice = document.getElementById('crown-description')!;
    notice.classList.remove('refused');
    void notice.offsetWidth; // restart the flash on every press
    notice.classList.add('refused');
    this.timeline = new Timeline().tween(0, REFUSED_NUDGE_SECONDS, v => {
      watch.crownSpin = v >= 1 ? spin : spin - direction * Math.sin(v * Math.PI) * REFUSED_NUDGE_RADIANS;
    }, linear);
  }

  /** One press of a turn button: +1 towards twelve o'clock, -1 towards six. */
  private turnCrown(direction: number): void {
    if (this.mode !== 'explore' || this.crownPosition === 0) return;
    if (this.timeline && !this.timeline.done) {
      // Still moving: remember the press instead of dropping it.
      if (this.queuedTurns.length < MAX_QUEUED_TURNS) this.queuedTurns.push(direction);
      return;
    }
    const watch = this.ctx.watch;
    const { mech } = watch;
    const spin = watch.crownSpin;
    const position = this.crownPosition;
    if (position === 2 && mech.inLockout) {
      // The model refuses what would strain the real mechanism.
      this.refuseTurn(direction);
      return;
    }
    const from = mech.minutes;
    const dateBefore = mech.date;
    // In position 3 the hands run forward when the crown turns towards six.
    const handMinutes = -direction * EXPLORE_TURN_MINUTES;
    const timeline = new Timeline().tween(0, EXPLORE_TURN_SECONDS, v => {
      watch.crownSpin = spin - direction * v * Math.PI * 2;
      if (position === 3) mech.turnTo(from + handMinutes * (v >= 1 ? 1 : v));
    }, linear);
    if (position === 1) {
      timeline.call(EXPLORE_TURN_SECONDS, () => setText('crown-description', direction > 0
        ? 'Eine Umdrehung Richtung 12 Uhr: Die Zugfeder wird gespannt.'
        : 'Richtung 6 Uhr läuft die Krone frei – nichts wird aufgezogen.'));
    }
    if (position === 2) {
      timeline.call(EXPLORE_TURN_SECONDS / 2, () => {
        if (direction > 0) mech.quickDate(); else mech.quickMoon();
        setText('crown-description', direction > 0
          ? `Datum einen Klick weiter: ${mech.date}.`
          : 'Mondscheibe einen Tag weiter.');
      });
    }
    if (position === 3) {
      timeline.call(EXPLORE_TURN_SECONDS, () => {
        const time = `Das Werk steht auf ${clock24(mech.minuteOfDay)} Uhr (${dayPart(mech.minuteOfDay)}).`;
        setText('crown-description', mech.date !== dateBefore
          ? `Mitternacht passiert: Das Datum springt auf ${mech.date}, die Mondscheibe rückt einen Tag weiter. ${time}`
          : `${time} ${mech.inLockout ? 'Hier schaltet der Kalender – keine Schnellkorrektur.' : handMinutes < 0 ? 'Rückwärts schaltet der Kalender nicht.' : 'Das Datum schaltet erst um Mitternacht.'}`);
      });
    }
    this.timeline = timeline;
  }

  goTo(i: number, focusTitle = true): void {
    if (i < 0 || i >= STEPS.length) return;
    const now = new Date();
    // What date and moon are set to is decided once, on reaching the calendar
    // steps, and then stands: the time-setting step counts the days from it.
    // A plan that has gone stale means the parked watch has run on too far:
    // the owner is sent back to park it again, with fresh numbers.
    const stale = this.plannedAt !== null && !this.planStands(now);
    if (stale) this.forgetPlan();
    if (this.plannedAt === null) this.ctx.plan = makePlan(now);
    const sentBack = stale && i > CALENDAR_STEP;
    if (sentBack) i = CALENDAR_STEP - 1;
    if (i >= CALENDAR_STEP && this.plannedAt === null) this.fixPlan(now);
    this.showMode('guide');
    this.index = i;
    // One clock snapshot per step; text, entry state and animation use the same moment.
    this.ctx.now = now;
    this.ctx.moon = moonState(now);
    this.queuedTurns.length = 0;
    const step = STEPS[i];
    this.dots.forEach((d, j) => {
      d.classList.toggle('active', j === i);
      d.classList.toggle('done', j < i);
      d.setAttribute('aria-current', j === i ? 'step' : 'false');
    });
    const total = String(STEPS.length).padStart(2, '0');
    document.getElementById('step-count')!.textContent = `${String(i + 1).padStart(2, '0')} / ${total}`;
    document.getElementById('step-kicker')!.textContent = step.kicker;
    document.getElementById('step-title')!.textContent = step.title;
    document.getElementById('step-title')!.setAttribute('aria-label', `Schritt ${i + 1} von ${STEPS.length}: ${step.title}`);
    enterStep(this.ctx, i);
    const sim = step.sim?.(this.ctx);
    const notice = sentBack
      ? `<div class="warnbox"><b>Bitte neu parken:</b> Seit dem Stellen von Datum und Mond ist zu viel Zeit
         vergangen – die geparkte Uhr läuft weiter und kann inzwischen im Schaltfenster stehen. Stelle die
         Zeiger noch einmal auf 5 Uhr; Datum und Mond folgen mit neuen Zahlen.</div>`
      : '';
    this.bodyEl.innerHTML = notice + step.body(this.ctx) + (sim ? `<div class="simbox"><span class="simbox-label">Im Modell</span>${sim}</div>` : '');
    if (sentBack) this.announce('Zu viel Zeit vergangen: zurück zu Schritt 3, die Zeiger neu auf 5 Uhr stellen.');
    this.bodyEl.scrollTop = 0;
    this.prevBtn.disabled = i === 0;
    this.nextBtn.textContent = i === STEPS.length - 1 ? 'Zurück zum Modell' : 'Weiter';
    this.timeline = step.build(this.ctx);
    if (this.opened) this.setOpened(null, false);
    this.fly(step.camera);
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    document.getElementById('view-description')!.textContent = `Schritt ${i + 1} · ${step.title}`;
    this.syncAddress();
    if (focusTitle) document.getElementById('step-title')!.focus();
  }

  /** Run the current step again without moving the reader: the text keeps its scroll position. */
  private rerun(): void {
    const panel = document.getElementById('panel')!;
    const scroll = [panel.scrollTop, this.bodyEl.scrollTop];
    this.goTo(this.index, false);
    [panel.scrollTop, this.bodyEl.scrollTop] = scroll;
  }

  /** The open step is part of the address, so a reload or a shared link returns to it. */
  private syncAddress(): void {
    const address = location.pathname + location.search + (this.mode === 'guide' ? `#schritt-${this.index + 1}` : '');
    if (location.pathname + location.search + location.hash !== address) history.replaceState(null, '', address);
  }

  private stepInAddress(): number | null {
    const match = /^#schritt-(\d+)$/.exec(location.hash);
    const index = match ? Number(match[1]) - 1 : -1;
    return index >= 0 && index < STEPS.length ? index : null;
  }

  private planStands(now: Date): boolean {
    const age = now.getTime() - (this.plannedAt ?? 0);
    return age >= -60_000 && age <= PLAN_VALID_MS && planIsCurrent(this.ctx.plan, now);
  }

  private fixPlan(now: Date): void {
    this.plannedAt = now.getTime();
    try {
      sessionStorage.setItem(PLAN_STORE, JSON.stringify({ parkDay: this.ctx.plan.parkDay.getTime(), at: this.plannedAt }));
    } catch { /* private mode: the plan then lives as long as the page */ }
  }

  private forgetPlan(): void {
    this.plannedAt = null;
    try { sessionStorage.removeItem(PLAN_STORE); } catch { /* nothing stored */ }
  }

  /** After a reload (or a tab the phone discarded) the numbers the owner already set must come back. */
  private restorePlan(): void {
    try {
      const stored = JSON.parse(sessionStorage.getItem(PLAN_STORE) ?? 'null') as { parkDay: number; at: number } | null;
      if (!stored || typeof stored.parkDay !== 'number' || typeof stored.at !== 'number') return;
      // Noon of the day after the park day yields the same plan as when it was made.
      this.ctx.plan = makePlan(new Date(stored.parkDay + 36 * 3_600_000));
      this.plannedAt = stored.at;
      if (this.ctx.plan.parkDay.getTime() !== stored.parkDay || !this.planStands(new Date())) this.forgetPlan();
    } catch { /* unreadable: plan anew */ }
  }

  /** The instructions as they stand right now, for the text guide: fresh clock, the owner's plan if one stands. */
  textContext(): TextCtx {
    const now = new Date();
    const plan = this.plannedAt !== null && this.planStands(now) ? this.ctx.plan : makePlan(now);
    return { now, moon: moonState(now), plan };
  }

  /** Back from the text guide after a restored WebGL context: everything is as the reader left it. */
  resume(): void { this.sceneMgr.invalidate(); }

  private announce(message: string): void { setText('assistive-status', message); }

  /** An event in the animation, shown on the stage and announced once. */
  private showCaption(text: string): void {
    const caption = document.getElementById('stage-caption')!;
    caption.textContent = text;
    caption.hidden = false;
    this.captionLeft = CAPTION_SECONDS;
    this.announce(text);
  }

  private hideCaption(): void {
    this.captionLeft = 0;
    document.getElementById('stage-caption')!.hidden = true;
  }

  update(dt: number): void {
    const wasDone = this.timeline?.done;
    if (!this.paused) {
      this.timeline?.update(dt);
      if (this.mode === 'explore' && this.queuedTurns.length && (!this.timeline || this.timeline.done)) {
        this.turnCrown(this.queuedTurns.shift()!);
      }
    }
    const watch = this.ctx.watch;
    // Opening the watch and a watch that follows the device clock do not wait for the animation.
    const ready = !this.loading && watch.movementReady;
    const front = this.opened === 'front' && ready ? 1 : 0;
    const back = this.opened === 'back' && ready ? 1 : 0;
    if (watch.explode !== front) watch.explode = this.ease(watch.explode, front, dt);
    if (watch.openBack !== back) watch.openBack = this.ease(watch.openBack, back, dt);
    watch.tick(this.paused && !watch.lockedToClock ? 0 : dt);
    if (this.paused) { setText('animation-label', 'Animation pausiert'); }
    else if (this.captionLeft > 0 && (this.captionLeft -= dt) <= 0) this.hideCaption();
    this.showMovementState();
    const pull = watch.crownPull;
    if (pull !== this.drawnPull) {
      this.drawnPull = pull;
      document.getElementById('diagram-crown')!.setAttribute('transform', `translate(${pull * 10} 0)`);
      document.getElementById('diagram-thread')!.setAttribute('transform', `translate(${pull * 10} 0)`);
      document.getElementById('diagram-stem')!.setAttribute('d', `M54 42.5H${54 + pull * 10}`);
    }
    const crownLabel = CROWN_LABELS[Math.round(pull) as 0 | 1 | 2 | 3];
    const diagram = document.querySelector('.crown-diagram')!;
    const diagramLabel = `Kronenposition: ${crownLabel}`;
    if (diagram.getAttribute('aria-label') !== diagramLabel) diagram.setAttribute('aria-label', diagramLabel);
    if (this.mode === 'guide' && !this.paused) {
      setText('animation-label', this.timeline?.done ? 'Animation abgeschlossen' : 'Animation läuft');
      setText('crown-state', crownLabel);
      if (!wasDone && this.timeline?.done) this.announce('Animation abgeschlossen.');
    }
  }

  /** One frame of opening or closing the watch. */
  private ease(from: number, to: number, dt: number): number {
    const next = from + (to - from) * (this.sceneMgr.reducedMotion ? 1 : 1 - Math.exp(-dt * 5));
    return Math.abs(to - next) < 0.002 ? to : next;
  }

  /** What the dial hides: the movement's own 24-hour time and whether the calendar is engaged. */
  private showMovementState(): void {
    const { mech } = this.ctx.watch;
    const minuteOfDay = mech.minuteOfDay;
    const hour = Math.floor(minuteOfDay / 60);
    setText('ms-time', clock24(minuteOfDay));
    setText('ms-part', dayPart(minuteOfDay));
    setText('ms-date', `Datum ${mech.date}`);
    setText('ms-icon', hour >= 6 && hour < 18 ? '☀\uFE0E' : '☾\uFE0E'); // text presentation, never a colour emoji
    // Marker on the 24-hour ring: midnight at the bottom, noon at the top.
    const hand = document.getElementById('ms-hand');
    const turn = `rotate(${(minuteOfDay / 4).toFixed(1)} 22 22)`;
    if (hand && hand.getAttribute('transform') !== turn) hand.setAttribute('transform', turn);
    const state = document.getElementById('movement-state')!;
    if (state.classList.contains('engaged') !== mech.inLockout) state.classList.toggle('engaged', mech.inLockout);
    const zone = document.getElementById('ms-zone')!;
    if (zone.hidden === mech.inLockout) zone.hidden = !mech.inLockout;
  }
}

/** Avoid emitting identical text mutations on every animation frame. */
function setText(id: string, value: string): void {
  const element = document.getElementById(id)!;
  if (element.textContent !== value) element.textContent = value;
}

/** The header clock is the reference for step 7, so it changes on the second, not somewhere within it. */
function startLiveStrip(): void {
  let moonMinute = -1;
  let timer = 0;
  const tick = () => {
    clearTimeout(timer);
    const now = new Date();
    const time = document.getElementById('live-time')!;
    time.textContent = now.toLocaleTimeString('de-DE');
    time.setAttribute('datetime', now.toISOString());
    const minute = Math.floor(now.getTime() / 60_000);
    if (minute !== moonMinute) {
      moonMinute = minute;
      const moon = moonState(now);
      const days = calendarDaysBetween(now, moon.nextFullMoon);
      setText('live-moon', `${moon.name} · ${(moon.illumination * 100).toFixed(0)} %`);
      document.getElementById('moon-lit')?.setAttribute('d', moonDiscPath(moon.illumination, moon.waxing));
      setText('moon-detail', moon.clicksFromFullMoon === 0 ? 'Heute ist Vollmond'
        : days <= 1 ? 'Nächster Vollmond morgen'
          : `Nächster Vollmond in ${days} Tagen`);
    }
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 2);
  };
  tick();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

/** Lit part of the moon card's disc (centre 22/22, radius 20): the limb on the lit side, closed by the terminator ellipse. */
function moonDiscPath(illumination: number, waxing: boolean): string {
  const r = 20;
  const c = 22;
  const limb = waxing ? 1 : 0; // northern hemisphere: a waxing moon is lit on the right
  const terminator = illumination > 0.5 ? limb : 1 - limb;
  const rx = (Math.abs(1 - 2 * illumination) * r).toFixed(2);
  return `M${c} ${c - r}A${r} ${r} 0 0 ${limb} ${c} ${c + r}A${rx} ${r} 0 0 ${terminator} ${c} ${c - r}Z`;
}

/** What had the focus when the text guide took over, to give it back afterwards. */
let focusBeforeFallback: Element | null = null;

export function renderFallback(ctx: TextCtx = textContext()): void {
  const fallback = document.getElementById('webgl-fallback')!;
  if (!fallback.hidden) return;
  const app = document.getElementById('app')!;
  focusBeforeFallback = document.activeElement;
  app.inert = true;
  app.hidden = true;
  fallback.hidden = false;
  const computedFor = ctx.now.toLocaleString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  document.getElementById('webgl-fallback-content')!.innerHTML = `
    <span class="eyebrow">LUNA GUIDE · TEXTANSICHT</span>
    <h1 id="fallback-title" tabindex="-1">Deine Mondphasenuhr einstellen.</h1>
    <p>Die 3D-Ansicht ist auf diesem Gerät nicht verfügbar. Alle ${STEPS.length} Schritte sind hier als Text lesbar.</p>
    <p>Unabhängige Anleitung am Beispiel der Tudor 1926 Luna. Maßgeblich bleibt die mitgelieferte Herstelleranleitung.</p>
    <p>Die Zahlen sind berechnet für <b>${computedFor} Uhr</b>. Nach einem Tageswechsel die Seite neu laden.</p>
    ${STEPS.map((s, i) => `<section><h2>${i + 1}. ${s.title}</h2>${s.body(ctx)}</section>`).join('')}
    <p><a href="/">3D-Ansicht neu laden</a> · <a href="https://www.tudorwatch.com/de/watches/1926/m91560-0002" rel="noreferrer">Herstellerreferenz</a> · <a href="/THIRD_PARTY_NOTICES.txt">Software-Lizenzen</a></p>`;
  document.getElementById('fallback-title')!.focus();
}

/** Back from the text guide to the app, once the 3D view works again. */
export function hideFallback(): void {
  const fallback = document.getElementById('webgl-fallback')!;
  if (fallback.hidden) return;
  fallback.hidden = true;
  document.getElementById('webgl-fallback-content')!.replaceChildren();
  const app = document.getElementById('app')!;
  app.hidden = false;
  app.inert = false;
  if (focusBeforeFallback instanceof HTMLElement && focusBeforeFallback.isConnected) focusBeforeFallback.focus({ preventScroll: true });
  focusBeforeFallback = null;
}
