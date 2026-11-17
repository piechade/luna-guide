import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CASE_R, CROWN_BASE_X, CROWN_Y } from './dimensions';
import type { WatchMaterials } from './materials';

export interface CrownParts {
  /** Slides along +X with the crown position (model.ts sets its position). */
  carriage: THREE.Group;
  /** Child of the carriage; turns about X when the crown is rotated. */
  spinner: THREE.Group;
  /** Fixed case tube; stays on the case while the crown slides out. */
  tube: THREE.Group;
}

// All x values below are relative to the carriage origin, which rests at
// CROWN_BASE_X when the crown is screwed down.
/** Widest point of the case flank. The flank is convex: at the height of the
 * crown axis it has fallen away by a few hundredths, at the rim of the crown
 * by about 0.2 mm above and at the sides, by more underneath. */
const FLANK_X = CASE_R - CROWN_BASE_X;
/** Where the nose of the case tube leaves the case. */
const SEAT_X = FLANK_X - 0.06;
/** Back face of the crown head. Screwed down it lies inside the widest point
 * of the flank: the head nestles into the case, its rim a hairline above the
 * flank at the top and at the sides, and no collar shows in between. */
const HEAD_X = FLANK_X - 0.35;
/** The head is hollow at the back and closes over the nose of the tube. */
const RECESS_R = 1.4;
const RECESS_DEPTH = 0.92;
/** The tube is as slim as the bore for the threaded neck allows. */
const NOSE_R = 1.22;
const NOSE_LENGTH = 0.5;

// Scallops. Every one is the same channel, half an ellipse in section, cut
// parallel to the axis; between two of them a narrow ridge of the turned blank
// is left standing. Where the blank is narrower than RIM_R the channel is cut
// less deep and therefore narrower; it closes where the blank meets FLOOR_R,
// which gives every scallop a pointed run-out at the back and at the front.
const SCALLOPS = 25;
const RIM_R = 2.8;
const FLOOR_R = 2.52;
/** Share of the pitch taken by the ridge at RIM_R. */
const RIDGE_SHARE = 0.16;
/** Segments across one scallop. */
const GROOVE_STEPS = 8;

const NECK_R = 1;
const STEM_R = 0.46;
/** The stem ends at the movement holder (r 15.9), where the keyless works take over. */
const STEM_END_X = 15.92 - CROWN_BASE_X;
/** End of the head: a low dome inside a conical shoulder. Heights are measured from the back face. */
const END_R = 1.95;
const END_FROM = 2.3;
const END_RISE = 0.2;
const MEDALLION_R = 1.7;

export type P3 = [number, number, number];
/** Turning profile point: [radius, x]. */
type P2 = [number, number];

export interface SkinOptions {
  /** Rings are closed loops (default) or open strips. */
  closed?: boolean;
  /** Close the first or the last ring with a flat cap. */
  capStart?: boolean;
  capEnd?: boolean;
  /** Build only these quads, selected by ring and column. */
  keep?: (ring: number, column: number) => boolean;
}

/** Screw-down crown of the study model: a short scalloped head with a faceted
 * crescent on its end, threaded neck and stem as one moving assembly, and the
 * fixed case tube. */
export function makeCrown(m: WatchMaterials): CrownParts {
  const carriage = new THREE.Group();
  carriage.name = 'Crown carriage';
  const spinner = new THREE.Group();
  spinner.name = 'Crown spindle';
  carriage.add(spinner);

  // Recesses get no ambient occlusion from the studio lighting, so their
  // linings and the rubber gasket use one matt, nearly black material without
  // any specular term: grazing reflections would make a bore glow.
  const shadow = new THREE.MeshLambertMaterial({ color: 0x1d2025 });

  // The head is polished all over, scallops included. Only the medallion is
  // bead-blasted: it sets the crescent apart under any lighting.
  const polished = new THREE.Mesh(mergeGeometries([
    skin(scallopRings(headProfile()), 30),
    crescentRelief(),
    turned(neckProfile(), 48, 30),
    threadRidge(),
  ]), m.steel);
  polished.name = 'Scalloped crown head and threaded neck';

  // Frosted surfaces of the moving assembly: medallion and stem.
  const medallion: P2[] = [];
  for (let i = 0; i <= 10; i++) {
    const r = MEDALLION_R * (1 - i / 10);
    medallion.push([r, HEAD_X + medallionHeight(r)]);
  }
  const matt = new THREE.Mesh(mergeGeometries([
    turned(medallion, 72, 30),
    turned([[STEM_R, STEM_END_X], [STEM_R, HEAD_X - 1.92]], 32, 30),
  ]), m.frosted);
  matt.name = 'Medallion and winding stem';

  const cavity = new THREE.Mesh(turned([
    [NECK_R, HEAD_X + RECESS_DEPTH], [RECESS_R, HEAD_X + RECESS_DEPTH], [RECESS_R, HEAD_X + 0.05],
  ], 64, 30), shadow);
  cavity.name = 'Hollow underside of the crown';
  spinner.add(polished, matt, cavity);

  // The tube stays on the case. Its nose carries the gasket that seals against
  // the inside of the head; the thread belongs to the moving neck, never to the tube.
  const tube = new THREE.Group();
  tube.name = 'Fixed crown tube';
  tube.position.set(CROWN_BASE_X, CROWN_Y, 0);
  const groove = SEAT_X + 0.17;
  const mouth = SEAT_X + NOSE_LENGTH;
  const sleeve = new THREE.Mesh(turned([
    [NOSE_R, SEAT_X - 1.2],
    [NOSE_R, groove], [NOSE_R - 0.1, groove], [NOSE_R - 0.1, groove + 0.22], [NOSE_R, groove + 0.22],
    [NOSE_R, mouth - 0.07], [NOSE_R - 0.07, mouth], [1.1, mouth], [1.06, mouth - 0.04],
  ], 96, 30), m.steel);
  sleeve.name = 'Case tube';
  const ring = new THREE.TorusGeometry(NOSE_R - 0.07, 0.1, 12, 72);
  ring.rotateY(Math.PI / 2);
  ring.translate(groove + 0.11, 0, 0);
  ring.deleteAttribute('uv');
  const seal = new THREE.Mesh(mergeGeometries([
    ring,
    turned([[1.06, mouth - 0.04], [1.06, SEAT_X + 0.12], [0, SEAT_X + 0.12]], 48, 30),
  ]), shadow);
  seal.name = 'Crown gasket and tube bore';
  tube.add(sleeve, seal);
  return { carriage, spinner, tube };
}

/** Turned blank of the head, from the rim of the recess round the outside to
 * the edge of the medallion: flat back, a chamfer up to the rim, a short
 * cylinder, the conical shoulder and the low dome of the end. Chamfer and
 * shoulder cross FLOOR_R, so the scallops run out through them; the extra
 * points there shape the ends of the scallops. */
function headProfile(): P2[] {
  const profile: P2[] = [
    [RECESS_R, 0.05], [RECESS_R + 0.05, 0], [2.44, 0],
    [FLOOR_R, 0.09], [2.55, 0.125], [2.585, 0.166], [2.63, 0.218], [2.68, 0.277], [2.73, 0.335], [2.77, 0.385], [2.793, 0.44], [RIM_R, 0.52],
    [RIM_R, 1.46], [2.79, 1.53], [2.765, 1.585], [2.73, 1.63], [2.68, 1.68], [2.63, 1.728], [2.585, 1.771], [2.55, 1.804], [FLOOR_R, 1.833],
    [2.36, 1.985], [2.16, 2.172], [2.04, 2.268],
  ];
  // Polished end: the dome, sampled finely where it turns away from the shoulder.
  const rim = MEDALLION_R + 0.03;
  for (let i = 0; i <= 6; i++) {
    const r = END_R - (END_R - rim) * (i / 6) ** 1.5;
    profile.push([r, endHeight(r)]);
  }
  profile.push([MEDALLION_R, medallionHeight(MEDALLION_R)]);
  return profile.map(([r, u]) => [r, HEAD_X + u]);
}

/** The end of the head is a low dome. Heights are measured from the back of the head. */
function endHeight(r: number): number {
  return END_FROM + END_RISE * (1 - (r / END_R) ** 2);
}

/** The frosted medallion lies a step below the polished dome. */
function medallionHeight(r: number): number {
  return endHeight(r) - 0.045;
}

/** Rings of the scalloped head. Each scallop contributes the start and middle
 * of its ridge and the points across its channel; the columns follow the edges
 * of the channels, so the ridges keep crisp outlines down to the run-out. */
function scallopRings(profile: P2[]): P3[][] {
  const halfGroove = (1 - RIDGE_SHARE) / 2;
  const depth = RIM_R - FLOOR_R;
  return profile.map(([r, x]) => {
    const cut = r >= FLOOR_R;
    // Open share of the channel width at this radius of the blank (round sections keep the spacing).
    const open = cut ? Math.sqrt(Math.max(0, 1 - ((RIM_R - r) / depth) ** 2)) : 1;
    const rise = Math.sqrt(1 - open ** 2);
    const ring: P3[] = [];
    const add = (pitchFraction: number, radius: number): void => {
      const a = (pitchFraction < 0 ? pitchFraction + SCALLOPS : pitchFraction) / SCALLOPS * Math.PI * 2;
      ring.push([x, Math.cos(a) * radius, Math.sin(a) * radius]);
    };
    // Scallop f is centred on its channel at f + 1 - halfGroove. Where a channel
    // closes (open = 0) its points and the neighbouring ridge edges coincide
    // exactly, which keeps the collapsed triangles out of the shading.
    for (let f = 0; f < SCALLOPS; f++) {
      add(f - halfGroove * (1 - open), r);
      add(f + 0.5 - halfGroove, r);
      for (let k = 0; k < GROOVE_STEPS; k++) {
        const across = -open * Math.cos(k / GROOVE_STEPS * Math.PI);
        add(f + 1 - halfGroove * (1 - across), cut ? r - depth * (Math.sqrt(1 - across ** 2) - rise) : r);
      }
    }
    return ring;
  });
}

/** Crescent moon in relief on the medallion: two facets meet in a ridge, like
 * the hands, and its foot follows the dome. Drawn for Luna Guide; no
 * manufacturer emblem. */
function crescentRelief(): THREE.BufferGeometry {
  const size = 1.2;
  const outerR = size;
  const innerR = 0.82 * size;
  const offset = 0.42 * size;
  // The two circles meet at the horn tips, 53.13 deg (outer) and 77.32 deg (inner).
  const outerFrom = Math.atan2(0.8, 0.6);
  const innerFrom = Math.atan2(0.8, 0.6 - 0.42);
  // Moves the horns as far from the axis as the back of the crescent.
  const shift = 0.2 * size;
  const surface = (y: number, z: number): number => HEAD_X + medallionHeight(Math.hypot(y, z));
  const steps = 48;
  const rings: P3[][] = [];
  for (let j = 0; j <= steps; j++) {
    const t = j / steps;
    const ao = outerFrom + t * (Math.PI * 2 - 2 * outerFrom);
    const ai = innerFrom + t * (Math.PI * 2 - 2 * innerFrom);
    const oy = Math.cos(ao) * outerR + shift;
    const oz = Math.sin(ao) * outerR;
    const iy = Math.cos(ai) * innerR + offset + shift;
    const iz = Math.sin(ai) * innerR;
    const my = (oy + iy) / 2;
    const mz = (oz + iz) / 2;
    const halfWidth = Math.hypot(oy - iy, oz - iz) / 2;
    rings.push([
      [surface(iy, iz) + 0.045, iy, iz], [surface(my, mz) + 0.045 + 0.3 * halfWidth, my, mz], [surface(oy, oz) + 0.045, oy, oz],
      [surface(oy, oz) - 0.04, oy, oz], [surface(iy, iz) - 0.04, iy, iz],
    ]);
  }
  // At rest the horns point up and away from the dial side, like a waxing moon.
  return skin(rings, 24).rotateX(THREE.MathUtils.degToRad(-35));
}

/** Neck of the moving assembly, from the stem up into the recess of the head. */
function neckProfile(): P2[] {
  return [
    [STEM_R, HEAD_X - 1.92], [NECK_R - 0.16, HEAD_X - 1.75], [NECK_R - 0.16, HEAD_X - 0.27],
    [NECK_R, HEAD_X - 0.2], [NECK_R, HEAD_X + RECESS_DEPTH],
  ];
}

/** One continuous V-shaped ridge wound round the neck. The grid follows the
 * helix, so root and crest stay crisp lines; the crest fades out at both ends. */
function threadRidge(): THREE.BufferGeometry {
  const from = HEAD_X - 1.72;
  const to = HEAD_X - 0.3;
  const pitch = 0.27;
  const rootR = NECK_R - 0.145;
  const turns = (to - from - pitch) / pitch;
  const perTurn = 48;
  const count = Math.ceil(turns * perTurn);
  const rings: P3[][] = [];
  for (let j = 0; j <= count; j++) {
    const t = j / count;
    const a = t * turns * Math.PI * 2;
    const fade = THREE.MathUtils.smoothstep(Math.min(t, 1 - t) * turns, 0, 0.2);
    const crestR = rootR + (NECK_R - rootR) * fade;
    const x = from + pitch * t * turns;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // Open strip root - crest - root; the next winding continues where this one ends.
    rings.push([[x + pitch, cos * rootR, sin * rootR], [x + pitch / 2, cos * crestR, sin * crestR], [x, cos * rootR, sin * rootR]]);
  }
  return skin(rings, 30, { closed: false });
}

/** Lathe about +X. The profile is [radius, x]; faces point to the left of the
 * direction of travel (x to the right, radius up), i.e. outwards for a profile
 * that runs up the back, along the outside and down the front. */
function turned(profile: P2[], segments: number, crease: number): THREE.BufferGeometry {
  return skin(profile.map(([r, x]) => {
    const ring: P3[] = [];
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2;
      ring.push([x, Math.cos(a) * r, Math.sin(a) * r]);
    }
    return ring;
  }), crease);
}

/** Skins consecutive rings of equal point count into one indexed surface.
 * Faces point along (next point in the ring) x (next ring). Shading is smooth
 * where neighbouring faces meet at less than `crease` degrees and hard
 * elsewhere, so one grid can carry polished facets and rounded parts alike.
 * Shared with hands.ts. */
export function skin(rings: P3[][], crease: number, options: SkinOptions = {}): THREE.BufferGeometry {
  const { closed = true, capStart = false, capEnd = false, keep } = options;
  const n = rings[0].length;
  const positions = new Float64Array(rings.length * n * 3);
  // Coincident neighbours in a ring (a pole, a closed groove, a pointed tip)
  // act as one corner, so the shading stays smooth around them.
  const corner = new Int32Array(rings.length * n);
  const same = (u: number, v: number): boolean =>
    Math.abs(positions[u * 3] - positions[v * 3]) + Math.abs(positions[u * 3 + 1] - positions[v * 3 + 1])
      + Math.abs(positions[u * 3 + 2] - positions[v * 3 + 2]) < 1e-7;
  for (let j = 0; j < rings.length; j++) {
    const first = j * n;
    for (let i = 0; i < n; i++) {
      positions.set(rings[j][i], (first + i) * 3);
      corner[first + i] = i > 0 && same(first + i, first + i - 1) ? corner[first + i - 1] : first + i;
    }
    if (closed && same(first, first + n - 1)) {
      const last = corner[first + n - 1];
      for (let i = 0; i < n && corner[first + i] === first; i++) corner[first + i] = last;
    }
  }

  // Triangles as corner triples; collapsed ones are dropped.
  const faces: number[] = [];
  const addFace = (a: number, b: number, c: number): void => {
    if (corner[a] !== corner[b] && corner[b] !== corner[c] && corner[c] !== corner[a]) faces.push(corner[a], corner[b], corner[c]);
  };
  const columns = closed ? n : n - 1;
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < columns; i++) {
      if (keep && !keep(j, i)) continue;
      const a = j * n + i;
      const b = j * n + (i + 1) % n;
      addFace(a, b, b + n);
      addFace(a, b + n, a + n);
    }
  }
  const last = (rings.length - 1) * n;
  for (let i = 1; i < n - 1; i++) {
    if (capStart) addFace(0, i + 1, i);
    if (capEnd) addFace(last, last + i, last + i + 1);
  }

  // Unit normal of every face and the angle it spans at each of its corners.
  const faceCount = faces.length / 3;
  const faceNormals = new Float64Array(faceCount * 3);
  const angles = new Float64Array(faceCount * 3);
  const around: number[][] = [];
  const edge = (from: number, to: number, out: THREE.Vector3): THREE.Vector3 =>
    out.set(positions[to * 3] - positions[from * 3], positions[to * 3 + 1] - positions[from * 3 + 1], positions[to * 3 + 2] - positions[from * 3 + 2]);
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let f = 0; f < faceCount; f++) {
    normal.crossVectors(edge(faces[f * 3], faces[f * 3 + 1], e1), edge(faces[f * 3], faces[f * 3 + 2], e2));
    // Slivers keep a zero normal and take no part in the shading.
    if (normal.lengthSq() < 1e-20) continue;
    normal.normalize().toArray(faceNormals, f * 3);
    for (let k = 0; k < 3; k++) {
      const at = faces[f * 3 + k];
      angles[f * 3 + k] = edge(at, faces[f * 3 + (k + 1) % 3], e1).angleTo(edge(at, faces[f * 3 + (k + 2) % 3], e2));
      (around[at] ??= []).push(f * 3 + k);
    }
  }

  // Each corner of a face averages the faces around it that lie within the
  // crease angle; corners that end up with the same normal share a vertex.
  const cosCrease = Math.cos(THREE.MathUtils.degToRad(crease));
  const outPositions: number[] = [];
  const outNormals: number[] = [];
  const index: number[] = [];
  const emitted: number[][] = [];
  for (let f = 0; f < faceCount; f++) {
    const fx = faceNormals[f * 3];
    const fy = faceNormals[f * 3 + 1];
    const fz = faceNormals[f * 3 + 2];
    if (fx === 0 && fy === 0 && fz === 0) continue;
    for (let k = 0; k < 3; k++) {
      const at = faces[f * 3 + k];
      normal.set(0, 0, 0);
      for (const slot of around[at]) {
        const g = slot - slot % 3;
        if (fx * faceNormals[g] + fy * faceNormals[g + 1] + fz * faceNormals[g + 2] < cosCrease) continue;
        normal.x += faceNormals[g] * angles[slot];
        normal.y += faceNormals[g + 1] * angles[slot];
        normal.z += faceNormals[g + 2] * angles[slot];
      }
      normal.normalize();
      const candidates = (emitted[at] ??= []);
      let vertex = candidates.find(v =>
        Math.abs(outNormals[v * 3] - normal.x) + Math.abs(outNormals[v * 3 + 1] - normal.y) + Math.abs(outNormals[v * 3 + 2] - normal.z) < 1e-4);
      if (vertex === undefined) {
        vertex = outPositions.length / 3;
        outPositions.push(positions[at * 3], positions[at * 3 + 1], positions[at * 3 + 2]);
        outNormals.push(normal.x, normal.y, normal.z);
        candidates.push(vertex);
      }
      index.push(vertex);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(outPositions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(outNormals, 3));
  geo.setIndex(index);
  return geo;
}
