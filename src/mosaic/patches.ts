import { Grid2DMark } from '@uwdata/mosaic-plot';

/*
 * Fixes to Mosaic 0.34, applied once as the panel's module loads. Each names
 * what it fixes, so it can go when Mosaic does.
 */

type Grids = { numRows: number; columns: Record<string, unknown[]> };
type GridMark = { grids0?: Grids; aggr?: string[]; groupby?: string[] };

/**
 * A 2-D grid mark over no rows (a brush that leaves nothing) throws: its grid
 * comes back as `{ numRows: 0, columns: {} }`, and contours, heatmaps and
 * rasters read their missing density or colour column. Such a mark never
 * tells its plot it is ready, so the plot never renders again, and the
 * selection that asked for the update waits for it forever: every Mosaic
 * panel on the dashboard stops following brushes. An empty grid with its
 * columns, empty, draws nothing instead.
 */
export function patchEmptyGrids(mark: { prototype: object } = Grid2DMark) {
  const proto = mark.prototype as { convolve: (this: GridMark) => unknown; __emptyGrids?: boolean };
  if (proto.__emptyGrids) {
    return;
  }
  const convolve = proto.convolve;
  proto.convolve = function (this: GridMark) {
    if (this.grids0 && !this.grids0.numRows) {
      const names = [...(this.aggr ?? []), ...(this.groupby ?? [])];
      this.grids0 = { numRows: 0, columns: Object.fromEntries(names.map((name) => [name, []])) };
    }
    return convolve.call(this);
  };
  proto.__emptyGrids = true;
}
