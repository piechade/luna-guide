import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Exercise the actual TypeScript source without adding a test runner dependency.
const source = await readFile(new URL('../src/animator.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { Timeline, linear } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('a slow frame preserves chronological state at each callback', () => {
  let hand = 0;
  const observed = [];
  const timeline = new Timeline()
    .tween(0, 4, v => { hand = v * 240; }, linear)
    .call(3, () => observed.push(hand))
    .call(1, () => observed.push(hand));
  timeline.update(5);
  assert.deepEqual(observed, [60, 180]);
  assert.equal(hand, 240);
  timeline.update(1);
  assert.deepEqual(observed, [60, 180]);
  assert.equal(timeline.done, true);
});

test('reference hold keeps the second hand stopped until an external :00', () => {
  let referenceReady = false;
  let running = false;
  let crown = 3;
  const timeline = new Timeline()
    .hold(2, () => referenceReady)
    .call(2, () => { running = true; })
    .tween(2, 1, v => { crown = 3 - v * 2; }, linear);
  timeline.update(50);
  assert.equal(timeline.time, 2);
  assert.equal(running, false);
  assert.equal(crown, 3);
  assert.equal(timeline.done, false);
  timeline.update(.1);
  assert.equal(timeline.time, 2);
  referenceReady = true;
  timeline.update(.5);
  assert.equal(running, true);
  assert.equal(crown, 2);
  timeline.update(.5);
  assert.equal(crown, 1);
  assert.equal(timeline.done, true);
});

test('multiple holds block all later callbacks independently', () => {
  const events = [];
  let first = false;
  let second = false;
  const timeline = new Timeline()
    .call(0, () => events.push('prepare'))
    .hold(1, () => first)
    .call(1, () => events.push('first'))
    .hold(3, () => second)
    .call(3, () => events.push('second'));
  timeline.update(8);
  assert.deepEqual(events, ['prepare']);
  first = true;
  timeline.update(8);
  assert.deepEqual(events, ['prepare', 'first']);
  second = true;
  timeline.update(0);
  assert.deepEqual(events, ['prepare', 'first', 'second']);
  assert.equal(timeline.done, true);
});
