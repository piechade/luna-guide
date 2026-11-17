// Camera poses: every one stands outside the watch, respects its own limits and
// keeps its subject inside the free part of the stage, whatever shape that has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load.mjs';

const {
  VIEWS, STEP_VIEWS, WORKS_VIEW, WORKS_VIEW_PORTRAIT, BACK_VIEW, BACK_VIEW_PORTRAIT, clearDistance, fitOf, lensFor, viewpoint,
} = await loadModule('../../src/views.ts');

const POSES = {
  ...Object.fromEntries(Object.entries(VIEWS).map(([name, pose]) => [`view ${name}`, pose])),
  ...Object.fromEntries(Object.entries(STEP_VIEWS).map(([name, pose]) => [`step ${name}`, pose])),
  works: WORKS_VIEW,
  'works portrait': WORKS_VIEW_PORTRAIT,
  back: BACK_VIEW,
  'back portrait': BACK_VIEW_PORTRAIT,
};
/** The poses of the opened back must also hold with the narrower keep-out of the opened back. */
const keepOutOf = name => (name.startsWith('back') ? 'back' : 'closed');

// Canvas size and the free rectangle on it, from a 320 x 200 window to an ultrawide screen.
const STAGES = [
  [1010, 796, { x: 28, y: 150, width: 954, height: 456 }],
  [674, 546, { x: 24, y: 118, width: 626, height: 278 }],
  [390, 440, { x: 10, y: 40, width: 370, height: 334 }],
  [494, 286, { x: 20, y: 30, width: 454, height: 190 }],
  [320, 200, { x: 8, y: 20, width: 304, height: 120 }],
  [420, 900, { x: 12, y: 150, width: 396, height: 560 }],
  [3000, 1300, { x: 40, y: 160, width: 2920, height: 950 }],
  [1010, 476, { x: 0, y: 0, width: 1010, height: 476 }],
];

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => a.map(v => v / Math.hypot(...a));

/** Bounding rectangle of the pose's subject on the canvas, in pixels. */
function project(pose, width, height, safe) {
  const { pos, target } = viewpoint(pose, safe.width < safe.height);
  const lens = lensFor(fitOf(pose, pos, target), { width, height }, safe);
  const scale = height / 2 / Math.tan(lens.fov * Math.PI / 360);
  const back = unit(sub(pos, target));
  const right = unit(cross([0, 1, 0], back));
  const up = cross(back, right);
  const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const point of pose.subject) {
    const v = sub(point, pos);
    const depth = -dot(v, back);
    const x = width / 2 + lens.offsetX + scale * dot(v, right) / depth;
    const y = height / 2 + lens.offsetY - scale * dot(v, up) / depth;
    box.left = Math.min(box.left, x); box.right = Math.max(box.right, x);
    box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y);
  }
  return box;
}

test('every pose stands outside the watch and inside its own orbit limits', () => {
  for (const [name, pose] of Object.entries(POSES)) {
    for (const { pos, target } of [pose, pose.portrait ?? pose]) {
      const offset = sub(pos, target);
      const distance = Math.hypot(...offset);
      const dir = unit(offset);
      assert.equal(clearDistance(target, dir, distance, keepOutOf(name)), distance, `${name} stands inside the keep-out volume`);
      const azimuth = Math.atan2(dir[0], dir[2]) * 180 / Math.PI;
      const polar = Math.acos(dir[1]) * 180 / Math.PI;
      if (pose.limits?.azimuth) assert.ok(azimuth > pose.limits.azimuth[0] && azimuth < pose.limits.azimuth[1], `${name}: azimuth ${azimuth}`);
      if (pose.limits?.polar) assert.ok(polar > pose.limits.polar[0] && polar < pose.limits.polar[1], `${name}: polar ${polar}`);
    }
  }
});

test('the subject of every pose fits the free rectangle of any stage and fills it in one direction', () => {
  for (const [name, pose] of Object.entries(POSES)) {
    for (const [width, height, safe] of STAGES) {
      const box = project(pose, width, height, safe);
      const where = `${name} on ${width}x${height}`;
      assert.ok(box.left >= safe.x - 0.5 && box.right <= safe.x + safe.width + 0.5, `${where}: leaves the free rectangle sideways`);
      assert.ok(box.top >= safe.y - 0.5 && box.bottom <= safe.y + safe.height + 0.5, `${where}: leaves the free rectangle vertically`);
      const fill = Math.max((box.right - box.left) / safe.width, (box.bottom - box.top) / safe.height);
      assert.ok(fill > 0.8, `${where}: fills only ${(fill * 100).toFixed(0)} % of the free rectangle`);
    }
  }
});

test('the optical centre lies in the middle of the free rectangle', () => {
  const lens = lensFor(fitOf(VIEWS.overview), { width: 1000, height: 800 }, { x: 100, y: 120, width: 600, height: 400 });
  assert.equal(lens.offsetX, 100 + 300 - 500);
  assert.equal(lens.offsetY, 120 + 200 - 400);
});

test('the opened back is seen from below; then the camera may also look up from inside the bracelet loop', () => {
  for (const pose of [BACK_VIEW, BACK_VIEW_PORTRAIT]) assert.ok(pose.pos[1] < pose.target[1] - 100, 'the camera looks up at the rotor side');
  const below = [0, -1, 0];
  const target = BACK_VIEW.target;
  assert.ok(clearDistance(target, below, 30, 'closed') > 55, 'closed, the loop counts as solid');
  assert.equal(clearDistance(target, below, 30, 'back'), 30, 'opened, the camera may stand inside the loop');
  // There the links still keep it out: the clasp below, a strap at six.
  assert.ok(clearDistance([0, -30, 0], below, 24, 'back') > 28, 'in the clasp');
  assert.ok(clearDistance([0, -30, 0], [0, 0, 1], 31, 'back') > 35, 'in the strap at six');
  assert.equal(clearDistance([0, -30, 0], [0, 0, 1], 10, 'back'), 10, 'inside the loop');
});

test('a camera inside the watch is moved out along its line of sight', () => {
  // From the dial centre: sideways through the case wall, down through the bracelet loop.
  assert.ok(clearDistance([0, 2.25, 0], [1, 0, 0], 5) > 22.5, 'inside the case');
  assert.ok(clearDistance([0, 2.25, 0], [0, -1, 0], 10) > 58, 'between case and clasp');
  assert.equal(clearDistance([0, 2.25, 0], [0, 1, 0], 30), 30, 'above the crystal');
  // Around the crown: towards the case the camera ends beyond its far side, away from it nothing changes.
  const crown = VIEWS.crown.target;
  assert.ok(clearDistance(crown, [-1, 0, 0], 20) > 45, 'through the case from the crown');
  assert.equal(clearDistance(crown, [1, 0, 0], 20), 20, 'outside the crown');
});
