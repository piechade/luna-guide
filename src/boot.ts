// Entry module. It has to stay tiny and free of three.js (vite.config.ts fails
// the build otherwise): the HTML shell and the stylesheets below are the first
// paint, and the 3D application (main.ts → scene, watch model, three.js) follows
// as a separate chunk that index.html already preloads.
import './style.css';
import './boot.css';

const root = document.documentElement;
const loader = document.getElementById('stage-loader');

// Screenshot tools run against the dev server and must never catch a half-faded
// stage, so the cross-fade from loader to model exists in production builds only.
const fade = import.meta.env.PROD;
if (fade) root.classList.add('stage-fade');

// A button pressed before the application listens is pressed again once it does,
// so an early tap on "Einstellen" or a view button is delayed, not lost.
let earlyPress: HTMLButtonElement | null = null;
const rememberPress = (event: MouseEvent): void => {
  const button = (event.target as Element).closest('button');
  if (button) earlyPress = button;
};
document.addEventListener('click', rememberPress, true);

async function start(): Promise<void> {
  let app: typeof import('./main');
  try {
    app = await import('./main');
  } catch (error) {
    // A chunk did not arrive or the 3D start-up threw: the guide is still readable as text.
    console.warn('3D application failed to start; showing the text guide.', error);
    await showTextGuide();
    return;
  } finally {
    document.removeEventListener('click', rememberPress, true);
  }
  if (earlyPress?.isConnected && !earlyPress.closest('[hidden]')) earlyPress.click();
  // Never settles when main.ts fell back to the text guide; the stage is hidden then.
  await app.firstFrame;
  root.classList.add('stage-ready');
  performance.mark('luna:model-ready');
  if (fade) setTimeout(() => loader?.remove(), 700); // after the fade-out in boot.css
  else loader?.remove();
}

async function showTextGuide(): Promise<void> {
  try {
    const { renderFallback } = await import('./ui');
    renderFallback();
  } catch {
    // Nothing but the shell arrived (offline, blocked scripts): say so and offer a retry.
    if (!loader) return;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'text-button';
    retry.textContent = 'Neu laden';
    retry.addEventListener('click', () => location.reload());
    loader.querySelector('.loader-label')!.textContent = 'Das 3D-Modell konnte nicht geladen werden.';
    loader.append(retry);
    root.classList.add('stage-failed');
  }
}

// Paint the shell before starting: on a repeat visit the chunks come from the
// cache at once, and building the model would otherwise block the first frame.
// Hidden tabs get no animation frames, hence the timer as a second trigger.
let started = false;
const startOnce = (): void => {
  if (started) return;
  started = true;
  void start();
};
requestAnimationFrame(() => setTimeout(startOnce, 0));
setTimeout(startOnce, 250);
