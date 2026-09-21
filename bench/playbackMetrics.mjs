// Pure arithmetic over what bench/playback.mjs records, kept apart so it can be tested:
//   node --test bench/playbackMetrics.test.mjs

/** A frame counts as dropped when it took longer than two 60 Hz frames. */
export const DROPPED_FRAME_MS = 33.4;

/** Nearest-rank percentile; null for no values. */
export function percentile(values, p) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))];
}

/**
 * For each publish, whether the panels it re-ran all answered before the next
 * publish, and how long the last of them took. `answers` are { at, key, ok }:
 * `key` tells answers apart (a panel id on the server, a running index locally,
 * where one panel request answers each of its targets). A publish lands when
 * `expected` distinct keys answered ok in (publish, next publish]; the last
 * publish is measured up to `end`.
 */
export function landing(publishes, answers, expected, end) {
  const ordered = [...answers].sort((a, b) => a.at - b.at);
  return publishes.map((at, i) => {
    const until = i + 1 < publishes.length ? publishes[i + 1] : end;
    const seen = new Set();
    let completedAt = null;
    for (const answer of ordered) {
      if (!answer.ok || answer.at <= at || answer.at > until) {
        continue;
      }
      seen.add(answer.key);
      if (seen.size === expected) {
        completedAt = answer.at;
        break;
      }
    }
    return { at, landed: completedAt !== null, latencyMs: completedAt === null ? null : completedAt - at };
  });
}

/**
 * `landing()` and its landing ratio/percentiles, judged separately per panel: `answers` carry a
 * `panel`, and each panel in `expectedByPanel` is judged only on its own answers, against its own
 * expected count. This is how the bench tells the map's own re-query latency apart from the panels
 * that merely read the window it publishes.
 */
export function summarizeByPanel({ publishes, answers, expectedByPanel, end }) {
  return Object.fromEntries(
    Object.entries(expectedByPanel).map(([panel, expected]) => {
      const panelAnswers = answers.filter((answer) => String(answer.panel) === panel);
      const latencies = landing(publishes, panelAnswers, expected, end)
        .filter((step) => step.landed)
        .map((step) => step.latencyMs);
      return [
        panel,
        {
          landed: latencies.length,
          landingRatio: publishes.length ? latencies.length / publishes.length : null,
          latencyP50Ms: percentile(latencies, 50),
          latencyP95Ms: percentile(latencies, 95),
        },
      ];
    })
  );
}

/** Frame intervals from requestAnimationFrame timestamps. */
export function frameStats(frameTimes) {
  const deltas = frameTimes.slice(1).map((t, i) => t - frameTimes[i]);
  const dropped = deltas.filter((d) => d > DROPPED_FRAME_MS).length;
  return {
    frames: deltas.length,
    dropped,
    droppedPct: deltas.length ? (100 * dropped) / deltas.length : 0,
    p95FrameMs: percentile(deltas, 95),
  };
}

export function summarize({ publishes, answers, expected, end, frameTimes, longTasks }) {
  const latencies = landing(publishes, answers, expected, end)
    .filter((step) => step.landed)
    .map((step) => step.latencyMs);
  return {
    publishes: publishes.length,
    landed: latencies.length,
    landingRatio: publishes.length ? latencies.length / publishes.length : null,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    ...frameStats(frameTimes),
    longTaskMs: longTasks.reduce((sum, task) => sum + task.duration, 0),
  };
}
