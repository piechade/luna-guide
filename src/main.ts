// The 3D application. boot.ts (the entry, which also imports the stylesheets)
// loads this module with import() after the first paint, so three.js and the
// model build never block the shell. If it fails to load or throws while
// starting, boot.ts shows the text guide instead.
import { SceneManager } from './scene';
import { WatchModel } from './watch/model';
import { Wizard, createContext, hideFallback, renderFallback } from './ui';

/** Settles when the first 3D frame is on the canvas; boot.ts then fades the loading state out. */
let firstFrameDrawn = (): void => {};
export const firstFrame = new Promise<void>(resolve => { firstFrameDrawn = resolve; });

const canvas = document.getElementById('scene') as HTMLCanvasElement;
let sceneMgr: SceneManager | undefined;
try { sceneMgr = new SceneManager(canvas); }
catch (err) { console.warn('3D unavailable; showing the complete text guide.', err); renderFallback(); }

if (sceneMgr) {
  const scene = sceneMgr;
  // Built only once WebGL is known to work; a failure here reaches boot.ts, which shows the text guide.
  const ctx = createContext(new WatchModel());
  scene.scene.add(ctx.watch.group);
  ctx.watch.viewer = scene.camera;
  const wizard = new Wizard(scene, ctx);
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__luna = { watch: ctx.watch, wizard, ctx, sceneMgr: scene };
  let last = performance.now();
  let rendering = true;
  function frame(now: number): void {
    if (!rendering) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (!document.hidden) { wizard.update(dt); scene.update(dt); scene.render(); firstFrameDrawn(); }
    requestAnimationFrame(frame);
  }
  // A lost context (tab in the background on a phone, GPU restart) shows the
  // text guide at once; preventDefault asks the browser to restore the context,
  // and when it does the 3D view comes back where the reader left it.
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); rendering = false; renderFallback(wizard.textContext()); });
  canvas.addEventListener('webglcontextrestored', () => {
    if (rendering) return;
    scene.restore();
    hideFallback();
    wizard.resume();
    rendering = true;
    last = performance.now();
    requestAnimationFrame(frame);
  });
  // The Wizard has just filled the text panel. Give the browser one frame to
  // paint it before the first 3D frame, which compiles every shader and is the
  // longest single block of the start-up.
  // prepare() compiles the shaders off the main thread where the browser can; it never rejects.
  requestAnimationFrame(() => { void scene.prepare().then(() => requestAnimationFrame(frame)); });
}
