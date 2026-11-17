// Entry of the movement chunk: WatchModel loads it with import() the first time
// the watch is opened, so nothing of the movement is downloaded, built or
// drawn before that.
import type * as THREE from 'three';
import type { WatchMaterials } from '../materials';
import { createMovementState, type MovementState } from './data';
import { buildDialSide, type DialSideWorks } from './dial-side';
import { makeKeyless, type Keyless } from './keyless';
import { buildBackSide, type BackSide } from './back-side';

export type { MovementState } from './data';

export interface Movement {
  /** Calendar works, motion works and quick-set correctors under the dial. */
  dialSide: DialSideWorks;
  /** Stem, keyless and setting works on both faces of the plate, crown wheel, ratchet and click. */
  keyless: Keyless;
  /** Main plate and holder ring, and everything seen from the back. */
  backSide: BackSide;
  /** Filled by WatchModel once a frame and passed to the three update() calls. */
  state: MovementState;
  /** The three groups, in the watch frame. */
  groups: readonly THREE.Group[];
}

/**
 * Builds the movement in slices; `pause` is awaited between them so the page
 * keeps drawing frames while it is built.
 */
export async function buildMovement(m: WatchMaterials, pause: () => Promise<void>): Promise<Movement> {
  const sliced = async <T>(build: Generator<void, T, void>): Promise<T> => {
    let slice = build.next();
    while (!slice.done) {
      await pause();
      slice = build.next();
    }
    return slice.value;
  };
  const dialSide = await sliced(buildDialSide(m));
  await pause();
  const keyless = makeKeyless(m);
  await pause();
  const backSide = await sliced(buildBackSide(m));
  const groups = [dialSide.group, keyless.group, backSide.group];
  // No part of the movement casts into or takes from the key light's shadow map: it lies under the
  // dial or faces the caseback, and its metal shows reflections, not shadows.
  for (const group of groups) group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.lunaShadow = false; });
  return { dialSide, keyless, backSide, state: createMovementState(), groups };
}
