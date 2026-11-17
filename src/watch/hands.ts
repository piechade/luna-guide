import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { skin, type P3 } from './crown';
import { DIAL_Y } from './dimensions';
import type { WatchMaterials } from './materials';

export interface HandParts {
  /** All three hands and the arbor cap. */
  group: THREE.Group;
  /** Each hand turns about +Y at the dial centre: rotation.y = -angle. */
  hour: THREE.Group;
  minute: THREE.Group;
  second: THREE.Group;
}

// Stacking heights above the dial, bottom to top. The applied numerals end at
// about 0.25 mm and the crystal starts at about 1.3 mm, so the whole stack
// lives between 0.34 mm and 1.12 mm.
const HOUR_Y = 0.34;
const HOUR_HUB_H = 0.24;
const MINUTE_Y = 0.68;
const MINUTE_HUB_H = 0.2;
const SECOND_Y = 0.94;
const SECOND_HUB_H = 0.075;
/** Convexity of the hand facets: 0 is flat, 0.25 makes the edge 5/3 as steep as the ridge. */
const FACET_CURVE = 0.25;

/** Outline and section of a faceted leaf hand; all lengths from the centre. */
interface Blade {
  /** Distance of the tip from the dial centre. */
  reach: number;
  /** The blade starts here, hidden inside the hub. */
  root: number;
  /** Half-width at the root, at the belly, and where the belly sits. */
  waist: number;
  belly: number;
  bellyAt: number;
  /** Exponent of the taper: 1 is a straight sword, larger is a rounder leaf. */
  taper: number;
  /** Height of the vertical edge, and mean rise of the facets per millimetre of half-width. */
  edge: number;
  slope: number;
}

export function makeHands(m: WatchMaterials): HandParts {
  const group = new THREE.Group();
  group.name = 'Hands';
  const hour = new THREE.Group();
  const minute = new THREE.Group();
  const second = new THREE.Group();
  hour.name = 'Hour hand';
  minute.name = 'Minute hand';
  second.name = 'Seconds hand';

  // The hour tip stops short of the applied numerals, the minute tip reaches
  // the minute track (radius 14.35).
  hour.add(new THREE.Mesh(mergeGeometries([
    leafBlade({ reach: 9.25, root: 0.5, waist: 0.27, belly: 0.64, bellyAt: 2.65, taper: 1.22, edge: 0.05, slope: 0.36 }),
    hub(0.88, HOUR_HUB_H, 0.045),
  ]), m.steel));
  minute.add(new THREE.Mesh(mergeGeometries([
    leafBlade({ reach: 13.9, root: 0.4, waist: 0.21, belly: 0.49, bellyAt: 3.05, taper: 1.18, edge: 0.05, slope: 0.34 }),
    hub(0.68, MINUTE_HUB_H, 0.04),
  ]), m.steel));
  second.add(new THREE.Mesh(mergeGeometries([sweepNeedle(), secondsHub()]), m.steel));
  hour.position.y = DIAL_Y + HOUR_Y;
  minute.position.y = DIAL_Y + MINUTE_Y;
  second.position.y = DIAL_Y + SECOND_Y;

  // The concentric pipes the hands are pressed onto: hour wheel, cannon pinion
  // and seconds arbor. Only the short sections between the hubs are visible.
  const arbor = new THREE.Mesh(turned([
    [0, 0], [0.58, 0], [0.58, 0.035], [0.5, 0.07], [0.5, HOUR_Y + 0.03],
    [0.42, HOUR_Y + 0.03], [0.42, MINUTE_Y + 0.03],
    [0.17, MINUTE_Y + 0.03], [0.17, SECOND_Y + 0.02], [0, SECOND_Y + 0.02],
  ], 48), m.steel);
  arbor.name = 'Hand arbor';
  arbor.position.y = DIAL_Y;
  group.add(hour, minute, second, arbor);
  return { group, hour, minute, second };
}

/** Half-width of a leaf blade at distance `s` from the centre. */
function bladeHalfWidth(b: Blade, s: number): number {
  if (s <= b.bellyAt) {
    const u = (s - b.root) / (b.bellyAt - b.root);
    return b.waist + (b.belly - b.waist) * (1 - (1 - u) ** 2);
  }
  const v = (s - b.bellyAt) / (b.reach - b.bellyAt);
  return b.belly * (1 - v ** b.taper);
}

/** Two polished facets meeting in a crisp ridge over a thin vertical edge. The
 * ridge height follows the width, so the facets keep their tilt from the belly
 * to the tip. Each facet is slightly convex, steeper towards its edge, which
 * spreads its reflection into a gradient. Points to -Z, underside at y = 0. */
function leafBlade(b: Blade): THREE.BufferGeometry {
  const stations = 44;
  // Points across the top, in half-widths from the ridge.
  const across = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1];
  const rings: P3[][] = [];
  for (let j = 0; j <= stations; j++) {
    const s = b.root + (b.reach - b.root) * (j / stations);
    const w = Math.max(0.012, bladeHalfWidth(b, s));
    const ring: P3[] = across.map(v => [v * w, b.edge + b.slope * w * (1 - Math.abs(v)) * (1 + FACET_CURVE * Math.abs(v)), -s]);
    ring.push([w, 0, -s], [-w, 0, -s]);
    rings.push(ring);
  }
  return skin(rings, 14, { capEnd: true });
}

/** Polished disc with a chamfered rim that carries a blade. */
function hub(radius: number, height: number, chamfer: number): THREE.BufferGeometry {
  return turned([
    [0, 0], [radius - chamfer * 0.6, 0], [radius, chamfer * 0.6], [radius, height - chamfer],
    [radius - chamfer, height], [0, height],
  ], 72);
}

/** Slender sweep-seconds needle with a teardrop counterweight. Flat top with
 * chamfered edges, so one of its three planes always catches a light. */
function sweepNeedle(): THREE.BufferGeometry {
  const reach = 14.7;
  const tail = 4.3;
  const side = 0.03;
  const top = 0.062;
  const halfWidth = (s: number): number => {
    if (s >= 0) return 0.09 - 0.05 * (s / reach);
    const q = -s;
    // Counterweight: swells towards its far end and closes in a round nose.
    if (q <= 3.35) return 0.09 + 0.13 * THREE.MathUtils.smootherstep(q, 0.55, 3.35);
    return 0.22 * Math.sqrt(Math.max(0, 1 - ((q - 3.35) / (tail - 3.35)) ** 2));
  };
  const stops: number[] = [];
  for (let i = 0; i <= 10; i++) stops.push(-tail + (tail - 3.35) * (1 - Math.cos(i / 10 * Math.PI / 2)));
  for (let i = 1; i <= 14; i++) stops.push(-3.35 + 3.35 * (i / 14));
  for (let i = 1; i <= 8; i++) stops.push(reach * (i / 8));
  const rings: P3[][] = stops.map(s => {
    const w = Math.max(0.012, halfWidth(s));
    const inset = Math.min(0.032, w * 0.5);
    return [[-w, side, -s], [inset - w, top, -s], [w - inset, top, -s], [w, side, -s], [w, 0, -s], [-w, 0, -s]];
  });
  return skin(rings, 20, { capStart: true, capEnd: true });
}

/** Seconds hub: a thin collet under the domed, polished end of the pipe. */
function secondsHub(): THREE.BufferGeometry {
  const h = SECOND_HUB_H;
  const profile: [number, number][] = [[0, 0], [0.39, 0], [0.42, 0.025], [0.42, h - 0.02], [0.4, h], [0.29, h], [0.29, h + 0.02]];
  // Quarter-ellipse dome, 0.29 wide and 0.085 tall.
  for (let i = 1; i <= 8; i++) {
    const a = i / 8 * Math.PI / 2;
    profile.push([0.29 * Math.cos(a), h + 0.02 + 0.085 * Math.sin(a)]);
  }
  return turned(profile, 48);
}

/** Lathe about +Y. The profile is [radius, y] and runs from the bottom centre
 * outwards, up the outside and back in, which makes the faces point outwards. */
function turned(profile: [number, number][], segments: number): THREE.BufferGeometry {
  return skin(profile.map(([r, y]) => {
    const ring: P3[] = [];
    // Clockwise seen from above, so that (around the ring) x (along the profile) points outwards.
    for (let i = 0; i < segments; i++) {
      const a = -i / segments * Math.PI * 2;
      ring.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    return ring;
  }), 28);
}
