// Minimal keyframe timeline: absolute-time tweens plus one-shot callbacks.

export type Ease = (t: number) => number;

export const linear: Ease = (t) => t;
export const easeInOut: Ease = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
export const easeOut: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeIn: Ease = (t) => t * t * t;

interface Segment {
  at: number;
  dur: number;
  ease: Ease;
  update: (v: number) => void;
  finished: boolean;
}

interface OneShot {
  at: number;
  fn: () => void;
  fired: boolean;
}

export class Timeline {
  private segments: Segment[] = [];
  private calls: OneShot[] = [];
  time = 0;
  duration = 0;

  /** Tween from 0..1 over [at, at+dur]; `update` receives the eased value. */
  tween(at: number, dur: number, update: (v: number) => void, ease: Ease = easeInOut): this {
    this.segments.push({ at, dur, ease, update, finished: false });
    this.duration = Math.max(this.duration, at + dur);
    return this;
  }

  call(at: number, fn: () => void): this {
    this.calls.push({ at, fn, fired: false });
    this.duration = Math.max(this.duration, at);
    return this;
  }

  get done(): boolean {
    return this.time >= this.duration;
  }

  update(dt: number): void {
    this.time += dt;
    for (const s of this.segments) {
      if (s.finished || this.time < s.at) continue;
      const raw = s.dur <= 0 ? 1 : (this.time - s.at) / s.dur;
      const v = Math.min(1, Math.max(0, raw));
      s.update(s.ease(v));
      if (v >= 1) s.finished = true;
    }
    for (const c of this.calls) {
      if (!c.fired && this.time >= c.at) {
        c.fired = true;
        c.fn();
      }
    }
  }
}
