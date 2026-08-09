import { SceneManager } from './scene';
import { WatchModel } from './watch/model';
import { moonState } from './moon';
import { Wizard, renderFallback } from './ui';
import type { StepCtx } from './steps';

const canvas = document.getElementById('scene') as HTMLCanvasElement;

const ctx: StepCtx = {
  watch: new WatchModel(),
  moon: moonState(),
  today: new Date(),
};

let sceneMgr: SceneManager;
try {
  sceneMgr = new SceneManager(canvas);
} catch (err) {
  console.error('WebGL init failed, falling back to text guide:', err);
  renderFallback(ctx);
  document.getElementById('panel')!.style.display = 'none';
  throw err;
}

sceneMgr.scene.add(ctx.watch.group);

const wizard = new Wizard(sceneMgr, ctx);
// Debug/verification hook (harmless in production)
(window as unknown as Record<string, unknown>).__luna = { watch: ctx.watch, wizard, moon: ctx.moon, sceneMgr };

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  wizard.update(dt);
  ctx.watch.tick(dt);
  sceneMgr.update(dt);
  sceneMgr.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
