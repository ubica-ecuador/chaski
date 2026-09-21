import assert from 'node:assert/strict';
import { test } from 'node:test';

import { frameStats, landing, percentile, summarize } from './playbackMetrics.mjs';

test('percentile picks the nearest rank', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([30, 10, 20], 50), 20);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
});

test('a publish lands when every expected answer arrives before the next publish', () => {
  const answers = [
    { at: 110, key: 1, ok: true },
    { at: 150, key: 2, ok: true },
    { at: 260, key: 1, ok: true },
    { at: 320, key: 2, ok: true },
  ];
  assert.deepEqual(landing([100, 200, 300], answers, 2, 400), [
    { at: 100, landed: true, latencyMs: 50 },
    { at: 200, landed: false, latencyMs: null },
    { at: 300, landed: false, latencyMs: null },
  ]);
});

test('failed and cancelled answers do not count', () => {
  const answers = [
    { at: 110, key: 1, ok: false },
    { at: 120, key: 2, ok: true },
  ];
  assert.equal(landing([100], answers, 2, 500)[0].landed, false);
});

test('frames over two 60 Hz frames count as dropped', () => {
  assert.deepEqual(frameStats([0, 16, 33, 83, 100]), { frames: 4, dropped: 1, droppedPct: 25, p95FrameMs: 50 });
});

test('summarize puts it together', () => {
  const summary = summarize({
    publishes: [100],
    answers: [{ at: 140, key: 1, ok: true }],
    expected: 1,
    end: 500,
    frameTimes: [0, 16],
    longTasks: [{ duration: 70 }],
  });
  assert.deepEqual(summary, {
    publishes: 1,
    landed: 1,
    landingRatio: 1,
    latencyP50Ms: 40,
    latencyP95Ms: 40,
    frames: 1,
    dropped: 0,
    droppedPct: 0,
    p95FrameMs: 16,
    longTaskMs: 70,
  });
});
