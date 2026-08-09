import type { SceneManager } from './scene';
import { Timeline } from './animator';
import { moonState } from './moon';
import { STEPS, type StepCtx } from './steps';

const AUTOPLAY_HOLD = 4; // seconds after a step's animation before advancing

export class Wizard {
  private index = 0;
  private timeline: Timeline | null = null;
  private autoplay = false;
  private autoplayWait = 0;
  private readonly ctx: StepCtx;

  private readonly dots: HTMLButtonElement[] = [];
  private readonly kickerEl = document.getElementById('step-kicker')!;
  private readonly titleEl = document.getElementById('step-title')!;
  private readonly bodyEl = document.getElementById('step-body')!;
  private readonly prevBtn = document.getElementById('btn-prev') as HTMLButtonElement;
  private readonly nextBtn = document.getElementById('btn-next') as HTMLButtonElement;
  private readonly autoBtn: HTMLButtonElement;

  constructor(
    private readonly sceneMgr: SceneManager,
    ctx: StepCtx,
  ) {
    this.ctx = ctx;

    const dotsWrap = document.getElementById('step-dots')!;
    STEPS.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'dot';
      dot.title = `Schritt ${i + 1}`;
      dot.addEventListener('click', () => this.goTo(i));
      dotsWrap.appendChild(dot);
      this.dots.push(dot);
    });

    this.prevBtn.addEventListener('click', () => this.goTo(this.index - 1));
    this.nextBtn.addEventListener('click', () => this.goTo(this.index + 1));
    document.getElementById('btn-replay')!.addEventListener('click', () => this.goTo(this.index));

    this.autoBtn = document.createElement('button');
    this.autoBtn.id = 'btn-auto';
    this.autoBtn.textContent = '▶ Auto';
    this.autoBtn.title = 'Automatisch durch alle Schritte laufen';
    this.autoBtn.addEventListener('click', () => this.toggleAutoplay());
    document.getElementById('btn-replay')!.after(this.autoBtn);

    const factsheet = document.getElementById('factsheet')!;
    document
      .getElementById('factsheet-toggle')!
      .addEventListener('click', () => factsheet.classList.toggle('open'));

    const panel = document.getElementById('panel')!;
    const collapseBtn = document.getElementById('btn-collapse')!;
    collapseBtn.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      collapseBtn.textContent = collapsed ? '▴' : '▾';
      collapseBtn.title = collapsed ? 'Anleitung ausklappen' : 'Anleitung einklappen';
    });

    // Mobile: guide toggle bottom-left mirrors the factsheet toggle bottom-right
    const guideToggle = document.getElementById('guide-toggle')!;
    guideToggle.addEventListener('click', () => {
      const hidden = panel.classList.toggle('hidden');
      guideToggle.querySelector('.arr')!.textContent = hidden ? '▴' : '▾';
    });

    startLiveStrip();
    this.goTo(0);
  }

  private toggleAutoplay(): void {
    this.autoplay = !this.autoplay;
    this.autoBtn.textContent = this.autoplay ? '⏸ Auto' : '▶ Auto';
    this.autoplayWait = 0;
  }

  goTo(i: number): void {
    if (i < 0 || i >= STEPS.length) return;
    this.index = i;
    const step = STEPS[i];

    this.dots.forEach((d, j) => {
      d.classList.toggle('active', j === i);
      d.classList.toggle('done', j < i);
    });
    this.kickerEl.textContent = step.kicker;
    this.titleEl.textContent = step.title;
    this.bodyEl.innerHTML = step.body(this.ctx);
    this.prevBtn.disabled = i === 0;
    this.nextBtn.textContent = i === STEPS.length - 1 ? 'Fertig ✓' : 'Weiter →';
    this.nextBtn.disabled = i === STEPS.length - 1;

    step.setup(this.ctx);
    this.timeline = step.build(this.ctx);
    this.autoplayWait = 0;
    this.sceneMgr.flyTo(step.camera);
  }

  update(dt: number): void {
    this.timeline?.update(dt);
    if (this.autoplay && this.timeline?.done) {
      this.autoplayWait += dt;
      if (this.autoplayWait >= AUTOPLAY_HOLD) {
        if (this.index < STEPS.length - 1) {
          this.goTo(this.index + 1);
        } else {
          this.toggleAutoplay();
        }
      }
    }
  }
}

function startLiveStrip(): void {
  const timeEl = document.getElementById('live-time');
  const moonEl = document.getElementById('live-moon');
  const tick = () => {
    const now = new Date();
    if (timeEl) timeEl.textContent = now.toLocaleTimeString('de-DE');
    if (moonEl) {
      const m = moonState(now);
      moonEl.textContent = `${m.name} · ${(m.illumination * 100).toFixed(0)} %`;
    }
  };
  tick();
  setInterval(tick, 1000);
}

/** Text-only fallback when WebGL is unavailable. */
export function renderFallback(ctx: StepCtx): void {
  const wrap = document.getElementById('webgl-fallback')!;
  const content = document.getElementById('webgl-fallback-content')!;
  wrap.style.display = 'block';
  const sections = STEPS.map(
    (s, i) => `
    <section>
      <h3>${i + 1}. ${s.title}</h3>
      ${s.body(ctx)}
    </section>`,
  ).join('');
  content.innerHTML = `
    <h2>Luna Guide — Tudor 1926 Luna einstellen</h2>
    <p class="muted">3D-Ansicht nicht verfügbar (WebGL deaktiviert). Hier die komplette
    Anleitung als Text:</p>
    ${sections}`;
}
