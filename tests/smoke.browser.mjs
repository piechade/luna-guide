// Smoke test of a production build, which has no development hooks: run it
// against `npm run build && npm run preview` or against the container.
//   LUNA_URL=http://127.0.0.1:4173 PLAYWRIGHT_MODULE=… node tests/smoke.browser.mjs
// It checks what only the shipped bundle can show: the split start-up, the
// Content-Security-Policy (when the server sends one), and both text fallbacks.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.LUNA_URL || 'http://127.0.0.1:4173';
const timezoneId = Intl.DateTimeFormat().resolvedOptions().timeZone;

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const check = text => console.log(`PASS ${text}`);

/** A page that records everything a visitor's console would show, including CSP violations. */
async function open(setup) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'de-DE', timezoneId });
  await context.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', e => window.__violations.push(`${e.violatedDirective}: ${e.blockedURI || e.sourceFile}`));
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  if (setup) await setup(page, context);
  const response = await page.goto(url, { waitUntil: 'load' });
  return { page, context, problems, response };
}

try {
  // 1. The 3D application starts, shows the device time, and the guide ends on today's date.
  {
    const { page, context, problems, response } = await open();
    assert.equal(response.status(), 200);
    const csp = response.headers()['content-security-policy'];
    await page.waitForFunction(() => document.documentElement.classList.contains('stage-ready'), null, { timeout: 240_000 });
    // The loading state hands over to the model; production builds fade it out first.
    await page.waitForFunction(() => !document.getElementById('stage-loader'), null, { timeout: 15_000 });
    const now = new Date();
    const two = n => String(n).padStart(2, '0');
    const shown = await page.locator('#ms-time').textContent();
    const minutes = text => { const [h, m] = text.split(':').map(Number); return h * 60 + m; };
    assert.ok(Math.abs(minutes(shown) - (now.getHours() * 60 + now.getMinutes())) <= 2 || Math.abs(minutes(shown) - (now.getHours() * 60 + now.getMinutes())) >= 1438, `explore mode shows the device time: ${shown} vs ${two(now.getHours())}:${two(now.getMinutes())}`);
    assert.equal(await page.locator('#ms-date').textContent(), `Datum ${now.getDate()}`);
    check('production build starts, the model is drawn, and explore mode shows the device time and date');

    await page.locator('#start-guide').click();
    const dots = page.locator('#step-dots button');
    assert.equal(await dots.count(), 7);
    assert.equal(await page.locator('#step-title').textContent(), 'Krone aufschrauben');
    // Opening a later step applies all earlier ones on the simulated watch.
    await dots.nth(3).click();
    const before = (now.getDate() + 29) % 31 + 1;
    assert.match(await page.locator('#step-body').innerText(), new RegExp(`die ${before}\\b`), 'step 4 names the number before today');
    await dots.nth(6).click();
    await page.waitForFunction(day => document.getElementById('ms-date').textContent === `Datum ${day}`, new Date().getDate(), { timeout: 60_000 });
    assert.match(await page.locator('#step-body').innerText(), /Endkontrolle/);
    assert.equal(await page.evaluate(() => location.hash), '#schritt-7');
    check('the guide has seven steps; after step 6 the simulated watch shows today\'s date');

    // The movement is a chunk of its own, loaded on the first opening; both sides open without errors.
    const chunks = [];
    page.on('response', response => { if (/\/assets\/movement-[^/]+\.js$/.test(response.url())) chunks.push(response.status()); });
    for (const id of ['btn-explode', 'btn-back']) {
      await page.locator(`#${id}`).click();
      await page.waitForFunction(button => document.getElementById(button)?.getAttribute('aria-pressed') === 'true', id, { timeout: 120_000 });
      await page.waitForTimeout(1500);
    }
    await page.locator('#btn-back').click();
    await page.waitForFunction(() => document.getElementById('btn-back')?.getAttribute('aria-pressed') === 'false', null, { timeout: 30_000 });
    assert.deepEqual(chunks, [200], 'the movement chunk is fetched once, on the first opening');
    check('both sides of the movement open and close; its chunk is loaded once, on demand');

    assert.deepEqual(await page.evaluate(() => window.__violations), [], 'Content-Security-Policy violations');
    assert.deepEqual(problems, [], 'console errors');
    check(csp ? `no console errors and no violations of the policy the server sends (${csp.slice(0, 40)}…)` : 'no console errors (this server sends no Content-Security-Policy)');
    await context.close();
  }

  // 2. The three.js chunk does not arrive: the guide is readable as text.
  {
    const { page, context } = await open(page => page.route(/\/assets\/three-[^/]+\.js$/, route => route.abort()));
    await page.waitForSelector('#webgl-fallback:not([hidden])', { timeout: 120_000 });
    assert.equal(await page.getByRole('heading', { level: 2 }).count(), 7);
    assert.match(await page.locator('#webgl-fallback').innerText(), /Datum eine Zahl vor heute stellen/);
    assert.equal(await page.locator('#app').evaluate(el => el.hidden), true);
    check('a failed 3D chunk shows the complete text guide');
    await context.close();
  }

  // 3. No WebGL on this device: the same text guide.
  {
    const { page, context, problems } = await open((page, ctx) => ctx.addInitScript(() => {
      const native = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) { return String(type).startsWith('webgl') ? null : native.call(this, type, ...args); };
    }));
    await page.waitForSelector('#webgl-fallback:not([hidden])', { timeout: 120_000 });
    assert.equal(await page.getByRole('heading', { level: 2 }).count(), 7);
    assert.deepEqual(problems.filter(text => !/WebGL/i.test(text)), []);
    check('a device without WebGL gets the text guide');
    await context.close();
  }
  console.log('Production smoke test passed.');
} finally {
  await browser.close();
}
