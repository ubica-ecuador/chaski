import { clauseInterval, clausePoints, Selection } from '@uwdata/mosaic-core';
import { column } from '@uwdata/mosaic-sql';

import {
  applyRange,
  binAt,
  brushColumn,
  clearColumn,
  linkBrush,
  applyValues,
  heldElsewhere,
  type IntervalInteractor,
  pixelOf,
  rangeMatches,
  searchClause,
  timeClause,
  type ToggleInteractor,
  valuesMatch,
} from './sync';

function interval(selection: Selection): IntervalInteractor & { moves: unknown[] } {
  const moves: unknown[] = [];
  const self: IntervalInteractor & { moves: unknown[] } = {
    moves,
    value: undefined,
    selection,
    scale: { type: 'linear', domain: [0, 10], range: [0, 100], apply: (v) => Number(v) * 10 },
    g: { call: (_fn, extent) => moves.push(extent) },
    brush: { moveSilent: 'move' },
    reset() {
      self.value = undefined;
    },
    clause: (value) => clauseInterval('mag', value as never, { source: self }),
  };
  return self;
}

function toggle(selection: Selection): ToggleInteractor {
  const self: ToggleInteractor = {
    value: null,
    selection,
    clause: (value) => clausePoints(['type'], value as never, { source: self }),
  };
  return self;
}

describe('applyRange', () => {
  it('sets the brush and the clause, open ends at the axis’s', async () => {
    const selection = Selection.crossfilter();
    const brush = interval(selection);
    expect(applyRange(brush, [2, undefined])).toBe(true);
    expect(brush.value).toEqual([2, 10]);
    expect(brush.moves).toEqual([[20, 100]]);
    expect(selection.clauses[0].value).toEqual([2, 10]);
  });

  it('leaves alone a range it holds within a pixel: its own write coming back', () => {
    const brush = interval(Selection.crossfilter());
    brush.value = [2.04, 5];
    expect(pixelOf(brush)).toBe(0.1);
    expect(applyRange(brush, [2, 5])).toBe(false);
  });

  it('clears the brush and its clause', () => {
    const selection = Selection.crossfilter();
    const brush = interval(selection);
    applyRange(brush, [2, 5]);
    expect(applyRange(brush, [undefined, undefined])).toBe(true);
    expect(brush.value).toBeUndefined();
    expect(selection.clauses).toHaveLength(0);
  });
});

describe('applyValues', () => {
  it('sets the picks in every toggle, and leaves the same picks alone', () => {
    const selection = Selection.crossfilter();
    const picks = Selection.single();
    const toggles = [toggle(selection), toggle(picks)];
    expect(applyValues(toggles, ['a', 'b'])).toBe(true);
    expect(toggles[1].value).toEqual([['a'], ['b']]);
    expect(selection.clauses[0].value).toEqual([['a'], ['b']]);
    expect(applyValues(toggles, ['b', 'a'])).toBe(false);
    expect(applyValues(toggles, [])).toBe(true);
    expect(toggles[0].value).toBeNull();
  });
});

describe('heldElsewhere', () => {
  it('finds a clause another source holds on the column with the same value', () => {
    const selection = Selection.crossfilter();
    const other = {};
    selection.update(clauseInterval('mag', [2, 5], { source: other }));
    expect(heldElsewhere(selection, new Set(), 'mag', (v) => rangeMatches(v, [2, 5], 10))).toBe(true);
    expect(heldElsewhere(selection, new Set([other]), 'mag', () => true)).toBe(false);
    expect(heldElsewhere(selection, new Set(), 'depth', () => true)).toBe(false);
    expect(heldElsewhere(selection, new Set(), 'mag', (v) => rangeMatches(v, [3, 5], 10))).toBe(false);
  });

  it('ignores a clause read from a variable', () => {
    const selection = Selection.crossfilter();
    selection.update(timeClause({}, 'mag', 0, 1));
    expect(heldElsewhere(selection, new Set(), 'mag', () => true)).toBe(false);
  });
});

describe('matching values', () => {
  it('matches a range within a hundredth of the axis, an open end anything', () => {
    expect(rangeMatches([2.05, 5], [2, 5], 10)).toBe(true);
    expect(rangeMatches([2.2, 5], [2, 5], 10)).toBe(false);
    expect(rangeMatches([new Date(1000), new Date(9000)], [1000, undefined], 8000)).toBe(true);
  });

  it('matches points in any order', () => {
    expect(valuesMatch([['a'], ['b']], ['b', 'a'])).toBe(true);
    expect(valuesMatch([['a']], ['a', 'b'])).toBe(false);
    expect(valuesMatch(null, [])).toBe(false);
  });
});

describe('clauses the panel makes itself', () => {
  it('searches case-insensitively, as Chaski’s search filter does', () => {
    const clause = searchClause({}, 'place', ' Zone ');
    expect(String(clause.predicate)).toBe(`contains(lower(CAST("place" AS VARCHAR)), 'zone')`);
    expect(clause.value).toBe('Zone');
    expect(searchClause({}, 'place', '').predicate).toBeNull();
  });

  it('keeps every count to the time range, as a clause no control writes back', () => {
    const clause = timeClause({}, 'time', 0, 86_400_000);
    expect(String(clause.predicate)).toBe(
      `"time" >= '1970-01-01T00:00:00.000Z' AND "time" < '1970-01-02T00:00:00.000Z'`
    );
    expect(clause.meta).toEqual({ type: 'variable' });
    expect(clause.fields.map(String)).toEqual([String(column('time'))]);
  });
});

describe('binAt', () => {
  const mark = {
    channels: [
      { channel: 'x1', as: 'x1' },
      { channel: 'x2', as: 'x2' },
      { channel: 'y', as: 'y' },
    ],
    data: { numRows: 2, columns: { x1: [0, 0.5], x2: [0.5, 1], y: [10, 3] } },
  };
  it('finds the bin under a value of the axis, from the result the mark drew', () => {
    expect(binAt(mark, 0.7)).toEqual({ lo: 0.5, hi: 1, count: 3 });
    expect(binAt(mark, 2)).toBeUndefined();
    expect(binAt({ channels: [] }, 0)).toBeUndefined();
  });
});

describe('linkBrush', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** A brush on `mag` in a plot of its own, as a filters panel's or a Mosaic panel's histogram. */
  function brushOn(selection: Selection) {
    const mark = {};
    const self = interval(selection);
    Object.assign(self, { mark: { plot: { markSet: new Set([mark]) } } });
    self.clause = (value) => clauseInterval('mag', value as never, { source: self, clients: new Set([mark]) as never });
    return { brush: self, mark };
  }

  it('leaves every histogram brushing the column out of a clause on it, and the last brush wins', async () => {
    const selection = Selection.crossfilter();
    const a = brushOn(selection);
    const b = brushOn(selection);
    expect(brushColumn(a.brush)).toBe('mag');
    const stopA = linkBrush(selection, a.brush, 'mag');
    const stopB = linkBrush(selection, b.brush, 'mag');

    selection.update(a.brush.clause([2, 4]));
    await settle();
    expect([...selection.clauses[0].clients!]).toEqual(expect.arrayContaining([a.mark, b.mark]));
    // The other brush shows the range, and makes no clause of its own.
    expect(b.brush.value).toEqual([2, 4]);
    expect(b.brush.moves).toEqual([[20, 40]]);

    // Brushing the other one replaces the first one's clause.
    a.brush.value = [2, 4];
    selection.update(b.brush.clause([5, 6]));
    await settle();
    expect(selection.clauses.map((c) => c.source)).toEqual([b.brush]);
    expect(a.brush.value).toEqual([5, 6]);

    // Clearing the column clears every brush on it.
    clearColumn(selection, 'mag');
    await settle();
    expect(selection.clauses).toHaveLength(0);
    expect(a.brush.value).toBeUndefined();
    stopA();
    stopB();
  });
});
