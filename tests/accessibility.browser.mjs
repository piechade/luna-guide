// Run against `npm run dev`. Requires Playwright; PLAYWRIGHT_MODULE may point
// to an existing installation, and CHROMIUM_EXECUTABLE to a system browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const passed = [];
const check = text => { passed.push(text); console.log(`PASS ${text}`); };
const url = process.env.LUNA_URL || 'http://127.0.0.1:5173';

// Drive only the app's animation explicitly. Native RAF still handles browser
// focus/scrolling, so keyboard checks do not depend on GPU rendering speed.
const holdAnimation = () => {
  const nativeRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => callback.toString().includes('wizard.update(dt)') ? 1 : nativeRAF(callback);
};

// Measurements shared by the checks below; installed in every page as window.__a11y.
const installProbes = () => {
  const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const parse = value => {
    const match = /rgba?\(([^)]+)\)/.exec(value);
    if (!match) return null;
    const p = match[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const luminance = c => {
    const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  // Every colour that can lie behind an element: its own fill over its
  // ancestors'. A gradient contributes each of its stops, so the result is
  // judged by its worst case.
  const backgrounds = el => {
    if (!el || el.nodeType !== 1) return [{ r: 255, g: 255, b: 255, a: 1 }];
    const style = getComputedStyle(el);
    const fill = parse(style.backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0 };
    const below = fill.a >= 1 ? [fill] : backgrounds(el.parentElement).map(under => fill.a > 0 ? over(fill, under) : under);
    if (!style.backgroundImage.includes('gradient')) return below;
    const stops = [...style.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(m => parse(m[0]));
    return stops.flatMap(stop => stop.a >= 1 ? [stop] : below.map(under => over(stop, under)));
  };
  const describe = el => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].join('.')}` : ''}`;

  window.__a11y = {
    /** Visible text below 4.5:1 (3:1 for large text) or below 12 px, within `root`. */
    textIssues(root = document.body) {
      const issues = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.data.trim()) continue;
        const el = node.parentElement;
        if (!shown(el) || el.closest('[hidden], .sr-only, :disabled, noscript, script, style')) continue;
        const style = getComputedStyle(el);
        const size = parseFloat(style.fontSize);
        if (size === 0) continue; // text replaced by a drawn sign (#btn-pause)
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
        if (!rects.length) continue; // clipped away (visually hidden headline)
        if (rects.every(r => r.bottom < 0)) continue; // the skip link, parked above the window
        let alpha = 1;
        for (let a = el; a; a = a.parentElement) alpha *= parseFloat(getComputedStyle(a).opacity);
        if (alpha === 0) continue; // faded out (the loader, once the model is on screen)
        const color = parse(style.color);
        const worst = Math.min(...backgrounds(el).map(bg => ratio(over({ ...color, a: color.a * alpha }, bg), bg)));
        const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
        const where = `${describe(el)} "${node.data.trim().slice(0, 28)}"`;
        if (worst < (large ? 3 : 4.5)) issues.push(`${where}: ${worst.toFixed(2)}:1 at ${size}px`);
        if (size < 11.99) issues.push(`${where}: ${size}px`);
      }
      return issues;
    },
    /** Contrast of a state indicator against what surrounds it. */
    indicator(el, pseudo, property) {
      const paint = parse(getComputedStyle(el, pseudo ?? undefined)[property]);
      return Math.min(...backgrounds(pseudo ? el : el.parentElement).map(bg => ratio(over(paint, bg), bg)));
    },
    /** Controls whose visible label is not part of their accessible name, or whose name carries a decorative glyph. */
    nameIssues() {
      const glyph = /[Ⅰ-↏←-⇿■-◿☀-➿⬀-⯿]|\s\+$/u;
      const norm = text => text.replace(/\s+/g, ' ').trim().toLowerCase();
      const read = (node, visual) => {
        if (node.nodeType === 3) return node.data;
        if (node.nodeType !== 1) return '';
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return '';
        if (visual ? parseFloat(style.fontSize) === 0 || style.clipPath !== 'none' : node.getAttribute('aria-hidden') === 'true') return '';
        return [...node.childNodes].map(child => read(child, visual)).join('');
      };
      const issues = [];
      for (const el of document.querySelectorAll('button, a[href], summary, [role=tab]')) {
        if (!shown(el)) continue;
        const name = norm(el.getAttribute('aria-label') ?? read(el, false));
        const label = norm(read(el, true));
        if (!name) issues.push(`${describe(el)}: no accessible name`);
        if (label && !name.includes(label)) issues.push(`${describe(el)}: label "${label}" is not in the name "${name}"`);
        if (glyph.test(name)) issues.push(`${describe(el)}: glyph in the name "${name}"`);
      }
      return issues;
    },
    /** Interactive elements smaller than `min` px in either direction. */
    smallTargets(min) {
      return [...document.querySelectorAll('button, a[href], summary, [role=tab]')].filter(shown)
        .map(el => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.bottom > 0 && (r.width < min - 0.5 || r.height < min - 0.5))
        .map(({ el, r }) => `${describe(el)}: ${Math.round(r.width)}×${Math.round(r.height)}`);
    },
    /** The stage: canvas size, the free rectangle and everything that floats above the model. */
    stage() {
      const stage = box(document.getElementById('stage'));
      const safeEl = document.getElementById('stage-safe');
      const safe = box(safeEl);
      const caption = document.getElementById('stage-caption');
      const hadCaption = !caption.hidden;
      if (!hadCaption) { caption.hidden = false; caption.textContent = 'Das Datum springt auf 13: Mitternacht – die Tageshälfte ist jetzt bekannt.'; }
      const covering = [];
      for (const selector of ['.stage-heading', '#movement-state', '#stage-caption', '#detail-tag', '.stage-bottom', '.orbit-hint', '.view-controls', '#btn-rotate', '#btn-explode', '#btn-back']) {
        const el = document.querySelector(selector);
        if (!el || getComputedStyle(el).display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 2 || r.height <= 2) continue; // visually hidden
        if (Math.min(r.right, safe.right) - Math.max(r.left, safe.left) > 0.5 && Math.min(r.bottom, safe.bottom) - Math.max(r.top, safe.top) > 0.5) covering.push(selector);
      }
      const captionBox = box(caption);
      if (!hadCaption) { caption.hidden = true; caption.textContent = ''; }
      const centre = document.elementFromPoint(safe.left + safe.width / 2, safe.top + safe.height / 2);
      const loader = document.getElementById('stage-loader');
      return {
        stage, safe, covering, captionBox,
        canvas: box(document.getElementById('scene')),
        safeStyle: { hidden: safeEl.getAttribute('aria-hidden'), events: getComputedStyle(safeEl).pointerEvents, empty: safeEl.childNodes.length === 0, visibility: getComputedStyle(safeEl).visibility },
        centreIsCanvas: centre?.id === 'scene',
        hud: box(document.getElementById('movement-state')),
        loader: loader ? box(loader) : null,
      };
    },
    /** The guide's reading window and its navigation. */
    guide(scroll) {
      const next = document.getElementById('btn-next');
      const prev = document.getElementById('btn-prev');
      if (scroll) next.scrollIntoView({ block: 'nearest' });
      const reachable = el => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5 && (hit === el || el.contains(hit));
      };
      const panel = document.getElementById('panel');
      const reading = panel.clientHeight - document.querySelector('.guide-footer').offsetHeight;
      return { next: reachable(next), prev: reachable(prev), reading, share: reading / document.getElementById('inspector').clientHeight, scrolls: panel.scrollHeight > panel.clientHeight };
    },
    /** Focusable elements whose focus ring would be cut by their scrolling panel. */
    clippedRings() {
      const issues = [];
      for (const scroller of [document.getElementById('explore-panel'), document.getElementById('panel')]) {
        if (!shown(scroller)) continue;
        const frame = scroller.getBoundingClientRect();
        for (const el of scroller.querySelectorAll('button, a[href], summary, [tabindex="0"]')) {
          if (!shown(el)) continue;
          const r = el.getBoundingClientRect();
          const reach = parseFloat(getComputedStyle(el).outlineOffset) + 2;
          if (r.left - reach < frame.left - 0.5 || r.right + reach > frame.right + 0.5) issues.push(describe(el));
          else if (scroller.scrollTop === 0 && r.top - reach < frame.top - 0.5) issues.push(`${describe(el)} (top)`);
        }
      }
      return issues;
    },
  };
};

try {
  // The shell must satisfy the CSP without the build's help: no inline style or script.
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<style|\sstyle=|\son[a-z]+=/i);
  assert.deepEqual(html.match(/<script[^>]*>[^<]*/g), ['<script type="module" src="/src/boot.ts">']);
  // The one glyph left in the markup is the day/night sign in #ms-icon, which the script writes.
  assert.doesNotMatch(html.replace('<span id="ms-icon" class="ms-icon">☀</span>', ''), /[\u2160-\u218f\u2190-\u21ff\u25a0-\u25ff\u2600-\u27bf\u2b00-\u2bff]/u, 'icons come from the SVG sprite, not from Unicode glyphs');
  for (const [, id] of html.matchAll(/<use href="#([^"]+)"/g)) assert.ok(html.includes(`<symbol id="${id}"`), `sprite symbol ${id}`);
  check('index.html: no inline style or script, every icon resolves to a sprite symbol');

  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  await context.addInitScript(holdAnimation);
  await context.addInitScript(installProbes);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const focused = async id => assert.equal(await page.evaluate(() => document.activeElement?.id), id);
  await page.goto(url);
  await page.waitForFunction(() => window.__luna);
  await focused(''); // Loading the app must not take keyboard focus.

  // The loading state sits where the watch will appear, and the read-out waits for the model.
  const loading = await page.evaluate(() => ({ ...window.__a11y.stage(), hudVisibility: getComputedStyle(document.getElementById('movement-state')).visibility, label: document.querySelector('.loader-label').textContent }));
  assert.ok(loading.loader, 'the loader stays until the first frame');
  assert.ok(loading.loader.left >= loading.safe.left && loading.loader.right <= loading.safe.right && loading.loader.top >= loading.safe.top && loading.loader.bottom <= loading.safe.bottom, 'loader inside the free rectangle');
  assert.ok(Math.abs((loading.loader.left + loading.loader.right) - (loading.safe.left + loading.safe.right)) < 2, 'loader centred');
  assert.equal(loading.hudVisibility, 'hidden');
  assert.match(loading.label, /geladen/);
  check('Loading state is centred in the free rectangle of the stage');

  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true);
  assert.ok((await page.locator('.skip-link').boundingBox()).y >= 0);
  await page.keyboard.press('Enter');
  await focused('mode-explore');
  check('Skip link reaches the active mode without scrolling the document');

  await page.keyboard.press('ArrowRight');
  await focused('mode-guide');
  assert.equal(await page.locator('#mode-explore').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Tab');
  await focused('explore-panel');
  await page.keyboard.press('Shift+Tab');
  await focused('mode-explore');
  await page.keyboard.press('ArrowLeft');
  await focused('mode-guide');
  await page.keyboard.press('Home');
  await focused('mode-explore');
  await page.keyboard.press('End');
  await focused('mode-guide');
  await page.keyboard.press('Enter');
  await focused('mode-guide');
  assert.equal(await page.locator('#mode-guide').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('[role=tab][tabindex="0"]').count(), 1);
  assert.equal(await page.getByRole('tabpanel').count(), 1);
  await page.keyboard.press('Tab');
  await focused('panel');
  await page.keyboard.press('Shift+Tab');
  await focused('mode-guide');
  await page.keyboard.press('Shift+Tab');
  await focused('btn-back');
  await page.keyboard.press('Tab');
  await focused('mode-guide');
  const stepCount = await page.locator('#step-dots button').count();
  assert.ok(stepCount >= 2);
  const tabs = await page.locator('.mode-switch').ariaSnapshot();
  assert.match(tabs, /tablist "Modus"/);
  // The tab's second line (the number of steps, filled in by the script) is part of its name.
  assert.match(tabs, new RegExp(`tab "Einstellen ${stepCount} Schritte" \\[selected\\]`));
  for (const [tab, panel] of [['mode-guide', 'panel'], ['mode-explore', 'explore-panel']]) {
    assert.equal(await page.locator(`#${tab}`).getAttribute('aria-controls'), panel);
    assert.equal(await page.locator(`#${panel}`).getAttribute('aria-labelledby'), tab);
  }
  check('Tab semantics, selected state, arrow wrapping, Home/End and both Tab exits');

  await page.locator('#btn-pause').click();
  assert.equal(await page.locator('#btn-pause').getAttribute('aria-label'), 'Animation fortsetzen');
  await page.locator('#mode-guide').click();
  assert.equal(await page.locator('#btn-pause').getAttribute('aria-label'), 'Animation fortsetzen');
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await focused('mode-explore');
  await page.locator('#start-guide').focus();
  await page.keyboard.press('Enter');
  await focused('step-title');
  assert.match(await page.locator('#step-title').getAttribute('aria-label'), new RegExp(`^Schritt 1 von ${stepCount}:`));
  assert.equal(await page.locator('#step-count').textContent(), `01 / ${String(stepCount).padStart(2, '0')}`);
  await page.keyboard.press('Tab');
  await focused('step-body');
  await page.locator('#btn-next').focus();
  await page.keyboard.press('Enter');
  await focused('step-title');
  await page.locator('#btn-prev').focus();
  await page.keyboard.press('Enter');
  await focused('step-title');
  assert.equal(await page.locator('#btn-prev').isDisabled(), true);
  await page.locator('#btn-replay').focus();
  await page.keyboard.press('Enter');
  await focused('btn-replay');
  await page.locator('#step-dots button').last().focus();
  await page.keyboard.press('Enter');
  await focused('step-title');
  await page.locator('#btn-next').focus();
  await page.keyboard.press('Enter');
  await focused('mode-explore');
  assert.equal(await page.locator('#panel').isHidden(), true);
  check('Start, next, previous, step selection and finish preserve useful focus; replay retains its button');

  const changes = await page.evaluate(async () => {
    const { wizard } = window.__luna;
    wizard.goTo(1);
    const counts = { announcements: 0, labels: 0, crown: 0 };
    const observers = [];
    for (const [selector, key, config] of [
      ['#assistive-status', 'announcements', { childList: true, subtree: true, characterData: true }],
      ['#animation-label', 'labels', { childList: true, subtree: true, characterData: true }],
      ['.crown-diagram', 'crown', { attributes: true, attributeFilter: ['aria-label'] }],
    ]) {
      const observer = new MutationObserver(records => { counts[key] += records.length; });
      observer.observe(document.querySelector(selector), config);
      observers.push(observer);
    }
    for (let i = 0; i < 150; i++) wizard.update(.1);
    await Promise.resolve();
    observers.forEach(observer => observer.disconnect());
    return { counts, liveAncestor: !!document.getElementById('wind-count').closest('[aria-live="polite"], [aria-live="assertive"], [role="status"]') };
  });
  assert.equal(changes.counts.announcements, 1);
  assert.ok(changes.counts.labels <= 2);
  assert.ok(changes.counts.crown <= 1);
  assert.equal(changes.liveAncestor, false);
  assert.equal(await page.locator('#step-body').getAttribute('aria-live'), null);
  check('One completion announcement across 150 animation frames; counters are outside live regions');

  // Names: with the pause sign drawn by CSS, what is visible is always part of the name.
  for (const paused of [false, true]) {
    assert.deepEqual(await page.evaluate(() => window.__a11y.nameIssues()), []);
    const sign = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('btn-pause'), '::before'); return { bars: s.borderRightWidth, wedge: s.borderLeftWidth, font: getComputedStyle(document.getElementById('btn-pause')).fontSize }; });
    assert.equal(sign.font, '0px');
    assert.equal(sign.bars, paused ? '0px' : '4px', 'two bars while running, a wedge while paused');
    if (!paused) await page.locator('#btn-pause').click();
  }
  await page.locator('#mode-explore').click();
  await page.locator('#factsheet summary').click();
  assert.deepEqual(await page.evaluate(() => window.__a11y.nameIssues()), []);
  await page.locator('#factsheet summary').click();
  check('Label in name: visible labels are part of the accessible names, which carry no decorative glyphs');

  // Opening the watch: two toggle buttons, one side at a time, also on keys 4 and 5 of the stage.
  const opened = () => page.evaluate(() => ({
    front: document.getElementById('btn-explode').getAttribute('aria-pressed'),
    back: document.getElementById('btn-back').getAttribute('aria-pressed'),
    busy: document.getElementById('btn-back').getAttribute('aria-busy'),
    view: document.getElementById('view-description').textContent,
    names: ['btn-explode', 'btn-back'].map(id => [document.getElementById(id).getAttribute('aria-label'), document.getElementById(id).title]),
  }));
  let open = await opened();
  assert.deepEqual([open.front, open.back], ['false', 'false']);
  assert.match(open.names[0][0], /^Werk von vorn/);
  assert.match(open.names[1][0], /^Werk von hinten/);
  for (const [label, title] of open.names) assert.equal(label, title, 'the tooltip says what the name says');
  await page.locator('#btn-back').click();
  open = await opened();
  assert.deepEqual([open.front, open.back], ['false', 'true']);
  await page.waitForFunction(() => window.__luna.watch.movementReady && !document.getElementById('btn-back').hasAttribute('aria-busy'), null, { timeout: 180000 });
  assert.match((await opened()).view, /^Werk von hinten/);
  await page.locator('#btn-explode').click();
  open = await opened();
  assert.deepEqual([open.front, open.back], ['true', 'false'], 'opening the front closes the back');
  assert.match(open.view, /^Werk von vorn/);
  await page.locator('#scene').focus();
  for (const [key, expected] of [['5', ['false', 'true']], ['5', ['false', 'false']], ['4', ['true', 'false']], ['5', ['false', 'true']], ['4', ['true', 'false']], ['4', ['false', 'false']]]) {
    await page.keyboard.press(key);
    open = await opened();
    assert.deepEqual([open.front, open.back], expected, `key ${key}`);
  }
  assert.match(await page.locator('#scene').getAttribute('aria-keyshortcuts'), /\b4 5\b/);
  assert.match(await page.locator('#scene-keyboard-help').textContent(), /5: Werk von hinten/);
  assert.deepEqual(await page.evaluate(() => window.__a11y.nameIssues()), []);
  check('Opening the watch: front and back are exclusive toggles (aria-pressed), by button and by keys 4 and 5; names carry the label');

  // Contrast and type size, for every step and both panels. A stop inside the
  // switching window shows the read-out's alert state as well.
  const walk = await context.newPage();
  await walk.goto(`${url}/?stop=22:09`);
  await walk.waitForFunction(() => window.__luna);
  const colours = await walk.evaluate(() => {
    const { wizard, ctx } = window.__luna;
    const a11y = window.__a11y;
    document.documentElement.classList.add('stage-ready'); // the first frame never comes here
    const issues = [];
    const steps = document.querySelectorAll('#step-dots button').length;
    for (let i = 0; i < steps; i++) {
      wizard.goTo(i, false);
      wizard.update(0.05);
      if (i === 0) {
        issues.push(...(document.getElementById('ms-zone').hidden ? ['read-out: no alert at 22:09'] : []));
        ctx.caption('Das Datum springt auf 13: Mitternacht – die Tageshälfte ist jetzt bekannt.');
      }
      issues.push(...a11y.textIssues().map(issue => `step ${i + 1}: ${issue}`));
    }
    wizard.goTo(2, false);
    const dots = [...document.querySelectorAll('#step-dots button')];
    const bar = el => getComputedStyle(el, '::after');
    const indicators = {
      doneDot: a11y.indicator(dots[0], '::after', 'backgroundColor'),
      activeDot: a11y.indicator(dots[2], '::after', 'backgroundColor'),
      idleDot: a11y.indicator(dots[4], '::after', 'backgroundColor'),
      heights: [bar(dots[0]).height, bar(dots[2]).height, bar(dots[4]).height],
      colours: [bar(dots[0]).backgroundColor, bar(dots[2]).backgroundColor, bar(dots[4]).backgroundColor],
      zone: a11y.indicator(document.getElementById('ms-zone'), null, 'backgroundColor'),
      selectedTab: getComputedStyle(document.getElementById('mode-guide')).boxShadow,
      idleTab: getComputedStyle(document.getElementById('mode-explore')).boxShadow,
    };
    wizard.explore();
    document.querySelector('[data-crown="2"]').click();
    document.getElementById('factsheet').open = true;
    wizard.update(0.05);
    issues.push(...a11y.textIssues().map(issue => `explore: ${issue}`));
    const pressed = document.querySelector('[data-crown="2"]'), idle = document.querySelector('[data-crown="1"]');
    Object.assign(indicators, {
      pressedCrown: a11y.indicator(pressed, null, 'borderTopColor'),
      crownBorders: [getComputedStyle(pressed).borderTopColor, getComputedStyle(idle).borderTopColor],
      pressedView: a11y.indicator(document.querySelector('[data-view][aria-pressed=true]') ?? document.querySelector('[data-view]'), null, 'backgroundColor'),
      turnDisabled: document.getElementById('turn-back').disabled,
    });
    return { issues, indicators, steps };
  });
  assert.deepEqual(colours.issues, []);
  const marks = colours.indicators;
  for (const key of ['doneDot', 'activeDot', 'idleDot', 'zone', 'pressedCrown']) assert.ok(marks[key] >= 3, `${key}: ${marks[key].toFixed(2)}:1`);
  assert.equal(new Set(marks.colours).size, 3, 'done, current and coming steps differ in colour');
  assert.ok(parseFloat(marks.heights[1]) > parseFloat(marks.heights[0]), 'the current step also differs in shape');
  assert.match(marks.selectedTab, /inset/);
  assert.notEqual(marks.selectedTab, marks.idleTab);
  assert.notEqual(marks.crownBorders[0], marks.crownBorders[1]);
  assert.equal(marks.turnDisabled, false, 'the walk covered the enabled turn buttons');
  check(`Contrast: all text of ${colours.steps} steps, the explore panel, the caption and the read-out at 4.5:1 or better and 12 px or larger; state indicators at 3:1`);

  // Without WebGL the same text is set on the plain page.
  await walk.evaluate(() => document.getElementById('scene').dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  assert.deepEqual(await walk.evaluate(() => window.__a11y.textIssues(document.getElementById('webgl-fallback'))), []);
  await walk.close();
  check('Contrast: text guide without 3D');

  // Sheet layout: below 600 px width and up to 520 px height the document itself scrolls (400 % zoom of a 1280 × 1024 window).
  const isSheet = size => size.width < 600 && size.height <= 520;
  const SIZES = [
    { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1024, height: 650 }, { width: 800, height: 600 },
    { width: 390, height: 844 }, { width: 390, height: 664 }, { width: 375, height: 553 }, { width: 360, height: 640 }, { width: 320, height: 568 },
    { width: 844, height: 390 }, { width: 740, height: 360 }, { width: 667, height: 375 }, { width: 640, height: 360 },
    { width: 720, height: 450 }, // 1440 × 900 at 200 %
    { width: 320, height: 256 }, // 1280 × 1024 at 400 %
  ];
  for (const size of SIZES) {
    const sheet = isSheet(size);
    const compact = size.width <= 760 || size.height <= 520;
    await page.setViewportSize(size);
    await page.reload();
    await page.waitForFunction(() => window.__luna);
    await focused('');
    const initial = size.width <= 760 ? 'mode-guide' : 'mode-explore';
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await focused(initial);
    await page.locator('#mode-guide').click();
    await page.locator('#step-dots button').nth(2).focus();
    await page.keyboard.press('Enter');
    await focused('step-title');

    // "Weiter" and "Zurück" are on screen without scrolling; in the sheet layout they stick to the window's edge.
    const guide = await page.evaluate(scroll => window.__a11y.guide(scroll), sheet);
    assert.ok(guide.next && guide.prev, `step navigation reachable: ${JSON.stringify(guide)}`);
    if (!sheet) {
      assert.ok(guide.reading >= 130, `reading window ${guide.reading}px`);
      if (compact) assert.ok(guide.share > 0.5, `the text gets the majority of the panel: ${guide.share.toFixed(2)}`);
    }

    await page.keyboard.press('Tab');
    await focused('step-body');
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => document.getElementById('step-body').scrollTop > 0 || document.getElementById('panel').scrollTop > 0 || scrollY > 0);
    assert.equal(await page.locator('#inspector').evaluate(el => el.scrollTop), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), size.width);
    if (!sheet) {
      assert.equal(await page.evaluate(() => scrollY), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), size.height);
    }
    const afterScroll = await page.evaluate(scroll => window.__a11y.guide(scroll), sheet);
    assert.ok(afterScroll.next && afterScroll.prev, 'step navigation still reachable after scrolling');

    // The canvas fills the stage, and nothing floats over the free rectangle, in either mode.
    for (const mode of ['guide', 'explore']) {
      if (mode === 'explore') await page.locator('#mode-explore').click();
      const stage = await page.evaluate(() => { scrollTo(0, 0); return window.__a11y.stage(); });
      const where = `${size.width}×${size.height} ${mode}`;
      for (const edge of ['left', 'top', 'right', 'bottom']) assert.ok(Math.abs(stage.canvas[edge] - stage.stage[edge]) < 1, `canvas fills the stage (${where})`);
      assert.deepEqual(stage.safeStyle, { hidden: 'true', events: 'none', empty: true, visibility: 'hidden' });
      assert.deepEqual(stage.covering, [], `nothing covers the free rectangle (${where})`);
      assert.ok(stage.safe.width >= 200 && stage.safe.height >= 80, `free rectangle ${Math.round(stage.safe.width)}×${Math.round(stage.safe.height)} (${where})`);
      assert.ok(Math.abs((stage.safe.left + stage.safe.right) - (stage.stage.left + stage.stage.right)) < 1, `free rectangle centred on the stage (${where})`);
      assert.ok(stage.centreIsCanvas, `the model can be dragged there (${where})`);
      assert.ok(stage.hud.left >= stage.stage.left && stage.hud.right <= stage.stage.right + 0.5, `read-out inside the stage (${where})`);
      assert.ok(stage.captionBox.left >= stage.stage.left && stage.captionBox.right <= stage.stage.right + 0.5 && stage.captionBox.bottom <= stage.stage.bottom, `caption inside the stage (${where})`);
      assert.deepEqual(await page.evaluate(() => window.__a11y.clippedRings()), [], `focus rings (${where})`);
      assert.deepEqual(await page.evaluate(() => { document.documentElement.classList.add('stage-ready'); window.__luna.wizard.update(0.05); return window.__a11y.textIssues(); }), [], `contrast (${where})`);
    }

    // Traverse the explore panel, checking that hidden controls never enter
    // the actual keyboard focus order (including the collapsed factsheet links).
    for (let i = 0; i < 13; i++) {
      await page.keyboard.press('Tab');
      const current = await page.evaluate(() => {
        const el = document.activeElement;
        if (el === document.body) return null;
        const rect = el.getBoundingClientRect();
        return { hidden: !!el.closest('[hidden], [inert]'), top: rect.top, bottom: rect.bottom, height: innerHeight };
      });
      if (current) { assert.equal(current.hidden, false); assert.ok(current.bottom > 0 && current.top < current.height, JSON.stringify(current)); }
    }
    check(`${size.width}×${size.height}: step navigation on screen${sheet ? ' (sheet layout)' : `, ${Math.round(guide.reading)} px reading window`}; canvas fills the stage; keyboard scroll stays in the reader; focus remains visible`);
  }

  // The read-out keeps its size when the alert appears, so the free rectangle never moves under the model.
  for (const size of [{ width: 1366, height: 768 }, { width: 1024, height: 650 }, { width: 390, height: 844 }, { width: 360, height: 640 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(size);
    await page.reload();
    await page.waitForFunction(() => window.__luna);
    const readout = await page.evaluate(() => {
      document.documentElement.classList.add('stage-ready');
      window.__luna.wizard.goTo(2, false);
      window.__luna.wizard.update(0.05);
      const zone = document.getElementById('ms-zone');
      const measure = () => { const s = window.__a11y.stage(); return [s.hud.width, s.hud.height, s.safe.top, s.safe.height].map(Math.round).join(' '); };
      const sizes = [];
      for (const part of ['nachts', 'nachmittags']) for (const date of ['Datum 1', 'Datum 31']) for (const hidden of [true, false]) {
        zone.hidden = hidden;
        document.getElementById('ms-part').textContent = part;
        document.getElementById('ms-date').textContent = date;
        sizes.push(measure());
      }
      zone.hidden = false;
      const visible = el => getComputedStyle(el).visibility === 'visible' && el.getClientRects().length > 0;
      // The chip must never run into the label; its note may drop out where there is no room, but not be cut.
      const edges = selector => document.querySelector(selector).getBoundingClientRect();
      const row = edges('.ms-status'), chip = edges('#ms-zone'), note = edges('.ms-zone-note'), label = edges('.ms-label');
      const alert = {
        chip: visible(zone), idle: visible(document.querySelector('.ms-idle')),
        fits: chip.left >= row.left - 0.5 && chip.right <= row.right + 0.5 && (note.top >= row.bottom || note.right <= row.right + 0.5)
          && !(label.right > chip.left && label.bottom > chip.top && label.top < chip.bottom)
          && document.getElementById('movement-state').scrollWidth <= document.getElementById('movement-state').clientWidth + 1,
      };
      zone.hidden = true;
      const quiet = { chip: visible(zone), idle: visible(document.querySelector('.ms-idle')) };
      return { sizes, alert, quiet, time: parseFloat(getComputedStyle(document.getElementById('ms-time')).fontSize), label: visible(document.querySelector('.ms-label')), text: zone.textContent };
    });
    const narrow = size.width <= 760 || size.height <= 520;
    // On a phone the read-out spans the stage, so it cannot change at all; on a desktop only its height matters to the bands.
    assert.equal(new Set(narrow ? readout.sizes : readout.sizes.map(s => s.split(' ').slice(1).join(' '))).size, 1, `read-out size is stable: ${[...new Set(readout.sizes)].join(' | ')}`);
    assert.deepEqual([readout.alert, readout.quiet], [{ chip: true, idle: false, fits: true }, { chip: false, idle: true }]);
    assert.ok(readout.time >= 18 && readout.label);
    assert.equal(readout.text, 'Schaltfenster');
    check(`${size.width}×${size.height}: movement read-out is labelled, shows "Schaltfenster" in place of "Kalender ruht" and keeps its size`);
  }

  // Touch: 44 px targets on a coarse pointer.
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await touch.addInitScript(holdAnimation);
  await touch.addInitScript(installProbes);
  const phone = await touch.newPage();
  await phone.goto(url);
  await phone.waitForFunction(() => window.__luna);
  assert.equal(await phone.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
  const targets = await phone.evaluate(() => {
    const { wizard } = window.__luna;
    const small = [];
    for (const step of [0, 2, 5]) { wizard.goTo(step, false); small.push(...window.__a11y.smallTargets(44).map(t => `step ${step + 1}: ${t}`)); }
    wizard.explore();
    document.getElementById('factsheet').open = true;
    document.querySelector('[data-crown="2"]').click();
    small.push(...window.__a11y.smallTargets(44).map(t => `explore: ${t}`));
    return small;
  });
  assert.deepEqual(targets, []);
  await touch.close();
  check('Touch: every control is at least 44 × 44 px on a coarse pointer (guide steps 1, 3, 6 and the explore panel)');

  // Forced colours: progress and pressed states must not depend on the page's own palette.
  const forced = await browser.newContext({ viewport: { width: 1366, height: 768 }, forcedColors: 'active', reducedMotion: 'reduce' });
  await forced.addInitScript(holdAnimation);
  const high = await forced.newPage();
  await high.goto(url);
  await high.waitForFunction(() => window.__luna);
  const system = await high.evaluate(() => {
    const { wizard } = window.__luna;
    const view = () => { const pressed = document.querySelector('[data-view][aria-pressed=true]'), idle = document.querySelector('[data-view][aria-pressed=false]'); return [getComputedStyle(pressed).backgroundColor, getComputedStyle(idle).backgroundColor]; };
    const views = view();
    document.querySelector('[data-crown="2"]').click();
    const crown = [getComputedStyle(document.querySelector('[data-crown="2"]')).backgroundColor, getComputedStyle(document.querySelector('[data-crown="1"]')).backgroundColor];
    wizard.goTo(2, false);
    const dots = [...document.querySelectorAll('#step-dots button')].map(dot => { const s = getComputedStyle(dot, '::after'); return { fill: s.backgroundColor, border: s.borderTopWidth, height: parseFloat(s.height) }; });
    const tab = getComputedStyle(document.getElementById('mode-guide'));
    return { active: matchMedia('(forced-colors: active)').matches, views, crown, dots, tabBar: tab.borderBottomWidth, canvas: getComputedStyle(document.body).backgroundColor };
  });
  assert.equal(system.active, true);
  assert.notEqual(system.views[0], system.views[1], 'pressed view button');
  assert.notEqual(system.crown[0], system.crown[1], 'pressed crown position');
  assert.equal(system.tabBar, '3px');
  for (const dot of system.dots) assert.ok(dot.border === '1px' && dot.height >= 5, 'every step has a visible box');
  assert.equal(new Set([system.dots[0].fill, system.dots[2].fill, system.dots[4].fill]).size, 3, 'done, current and coming steps differ');
  await forced.close();
  check('Forced colours: step progress stays visible; pressed and selected states are distinguishable');

  await page.setViewportSize({ width: 844, height: 390 });
  await page.reload();
  await page.waitForFunction(() => window.__luna);
  await page.locator('#mode-guide').click();
  await page.locator('#step-dots button').nth(1).click();
  await page.evaluate(() => document.getElementById('scene').dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await focused('fallback-title');
  assert.equal(await page.getByRole('tab').count(), 0);
  assert.equal(await page.getByRole('button').count(), 0);
  assert.equal(await page.getByRole('main').count(), 1);
  assert.equal(await page.getByRole('heading', { level: 2 }).count(), stepCount);
  assert.equal(await page.locator('#app').evaluate(el => el.inert && el.hidden), true);
  assert.equal(await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(el => el.id); return new Set(ids).size === ids.length; }), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.closest('#webgl-fallback') !== null), true);
  check('WebGL loss focuses the text guide and removes background controls from focus and the accessibility tree');

  const fallback = await context.newPage();
  await fallback.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return String(type).startsWith('webgl') ? null : native.call(this, type, ...args); };
  });
  await fallback.goto(url);
  await fallback.waitForSelector('#webgl-fallback:not([hidden])');
  assert.equal(await fallback.evaluate(() => document.activeElement.id), 'fallback-title');
  assert.equal(await fallback.getByRole('tab').count(), 0);
  check('Initial WebGL failure also opens an accessible text guide');
  assert.deepEqual(errors, []);
  console.log(`${passed.length} accessibility checks passed; no browser JavaScript errors.`);
} finally {
  await browser.close();
}
