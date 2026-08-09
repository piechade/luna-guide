# Luna Guide

Interactive 3D setting guide for the **Tudor 1926 Luna** (ref. M91560) moon-phase
watch — live at [luna.dpiecha.de](https://luna.dpiecha.de).

A procedurally modeled watch (Three.js, no external 3D assets) walks through the
complete setting routine in seven animated steps, in German:

1. Unscrew the crown (screw-down, 100 m water resistance)
2. Hand-wind ~27 crown turns (Sellita factory spec for a full wind from standstill)
3. Respect the quick-set lock-out window (~20:00–03:00) — park the hands at a
   safe time first
4. Quick-set the date to *yesterday* (position 2, towards 12 o'clock / clockwise)
5. Advance the hands through midnight (date flips → AM/PM confirmed) and sync to
   reference time using the stop-second
6. Set the moon phase LAST, day-accurate (position 2, towards 6 o'clock /
   counterclockwise): turn to the full-moon reference, then advance one click per
   day since the last full moon (computed live, astronomically). Last because the
   moon disc also advances whenever the hands pass midnight.
7. Screw the crown back down + final checklist

Crown directions verified against the official manual of the Mühle Glashütte
Teutonia IV Mondphase, which uses the same SW280-1 base caliber.

## Technical background

- Caliber T607-9, base **Sellita SW280-1** (SW28x moon-phase family)
- Winding-stem positions per Sellita technical documentation:
  P1 winding · P2 double corrector (date one direction, moon phase the other) ·
  P3 time setting with stop-second
- Moon phase computed from the mean synodic month (29.530588853 d) against the
  2000-01-06 18:14 UTC new-moon epoch; day-accurate, which matches the
  1-day-per-click resolution of the movement's moon disc

## Stack

Vanilla TypeScript + Three.js + Vite. No backend, no external assets, no
tracking. Falls back to a text-only guide when WebGL is unavailable.

## Development

```bash
npm install
npm run dev      # dev server
npm run build    # typecheck + production bundle in dist/
```

## Deployment

`./deploy.sh` rsyncs the project to the VPS and rebuilds the Docker container
(multi-stage build → nginx:alpine, routed by Traefik with automatic TLS).

## Disclaimer

Not affiliated with, sponsored, or endorsed by TUDOR or Sellita. Model names are
used descriptively; always follow the official user guide that came with your
watch.
