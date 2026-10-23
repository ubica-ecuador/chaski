import { ContourMark } from '@uwdata/mosaic-plot';

import { patchEmptyGrids } from './patches';

it('gives an empty grid its columns, so a contour over no rows draws nothing', () => {
  patchEmptyGrids();
  // What a contour mark holds after a query that returned no rows.
  const mark = Object.assign(Object.create(ContourMark.prototype), {
    grids0: { numRows: 0, columns: {} },
    aggr: ['density'],
    groupby: ['species'],
    bins: [10, 10],
    thresholds: 5,
    densityMap: {},
    plot: { getAttribute: (name: string) => ({ xDomain: [0, 1], yDomain: [0, 1] })[name] },
  });
  mark.convolve();
  expect(mark.grids0).toEqual({ numRows: 0, columns: { density: [], species: [] } });
  expect(mark.contourData).toEqual([]);
});

it('patches once', () => {
  const fake = { prototype: { convolve: jest.fn() } };
  patchEmptyGrids(fake);
  const once = (fake.prototype as { convolve: unknown }).convolve;
  patchEmptyGrids(fake);
  expect((fake.prototype as { convolve: unknown }).convolve).toBe(once);
});
