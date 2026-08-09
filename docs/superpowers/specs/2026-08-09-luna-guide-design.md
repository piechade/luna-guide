# Luna Guide — Design Spec

Date: 2026-08-09
Status: approved (dial: blue, subdomain: luna.dpiecha.de, repo: public)

## Purpose

An interactive 3D web tool that teaches, step by step and as detailed as possible,
how to set a **Tudor 1926 Luna** (ref. M91560-0002, blue dial) following a fixed
standard routine:

1. Always hand-wind first (~27 crown turns).
2. Moon phase set day-accurate (tool computes the current phase live).
3. Time set to exact atomic time (hacking seconds, minute hand approached
   from behind).

## Watch facts (grounding)

- Tudor 1926 Luna, 39 mm steel, domed sapphire, 100 m WR, screw-down crown
  and caseback. Moon phase in a round "sky aperture" at 6 o'clock, date at 3.
- Caliber T607-9, base **Sellita SW280-1** (moon-phase family SW28x),
  28,800 A/h, 26 jewels, ~38 h power reserve, hacking seconds, hand-winding.
- Winding-stem positions (Sellita technical documentation, SW28x family):
  - P1: running position / manual winding (min. 27 turns from standstill)
  - P2: quick correction — **double corrector**: one rotation direction sets
    the date, the other the moon phase
  - P3: time setting with stop-second
  - Plus P0 in the case: crown screwed down (Tudor).
- Correction lock-out: no quick correction while the calendar train is engaged
  (approx. 20:00–03:00 shown conservatively in the tool).
- Moon disc advances one step per day; day-accurate setting method: rotate to
  full moon, then advance one click per day since the last full moon.

## Approach (chosen: A)

Vanilla TypeScript + Three.js + Vite. The watch is modeled procedurally in
code (no external 3D assets, no backend). Rejected: React Three Fiber
(unneeded deps), pre-rendered video (not interactive, no live moon phase).

## Architecture

```
luna-guide/
  index.html          UI shell (German product UI)
  src/main.ts         bootstrap, render loop
  src/scene.ts        renderer, camera, lights, orbit controls
  src/watch/          procedural model (case, dial, hands, moon disc, crown)
  src/moon.ts         astronomy: phase fraction, days since full moon
  src/steps.ts        the 7 wizard steps (German copy + animation targets)
  src/animator.ts     tweening of crown/hands/discs/camera per step
  src/ui.ts           wizard panel, prev/next/autoplay, live clock, warnings
  Dockerfile          node build stage -> nginx:alpine
  docker-compose.yml  Traefik labels (luna.dpiecha.de), proxy network, limits
  deploy.sh           rsync -> compose up -d --build -> curl verification
```

Code and docs in English; the product UI text is German (house rule).

## The 7 steps

1. **Krone aufschrauben** — unscrew animation, water-resistance warning.
2. **Handaufzug** — ~27 turns in P1, animated turn counter.
3. **Sperrzone prüfen** — live check of the displayed watch time; warning band
   on the dial for ~20:00–03:00 (no quick corrections there).
4. **Mondphase stellen (P2, direction A)** — live computed target phase,
   instruction "turn to full moon, then N clicks", animated moon disc.
5. **Datum stellen (P2, direction B)** — set to *yesterday* if the time will
   subsequently be advanced through midnight, else today.
6. **Zeit stellen (P3)** — stop-second at a full minute, live reference clock
   (device time, link to time.is), approach minute from behind, verify the
   date flip at midnight to confirm AM/PM.
7. **Krone festschrauben** — final checklist (date, moon, seconds in sync).

Free orbit view at all times; camera flies to the relevant detail per step.

## Error handling

- Moon phase pure function of `Date.now()`; no network calls, nothing to fail.
- WebGL unavailable → plain-text fallback of all 7 steps (the guide remains
  usable without 3D).

## Testing / verification

- `tsc --noEmit` clean; `vite build` clean.
- Moon engine sanity-checked against known new/full moon dates.
- Browser verification of all 7 steps + console before deploy.

## Deployment

- VPS conventions per SERVER.md: external `proxy` network, Traefik labels
  (`Host(\`luna.dpiecha.de\`)`, https entrypoint, leresolver), resource limits.
  Wildcard DNS `*.dpiecha.de` already points at the VPS (verified).
- Landing page: add one `<a class="service">` card (🌙 "Luna Guide",
  desc "3D-Anleitung Tudor 1926 Luna") to the Applications grid in
  `~/netcup-services/nginx/html/index.html` on the server (bind mount → live).
- GitHub: public repo `luna-guide`.
