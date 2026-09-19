/** @jest-environment node */
import { tableFromBatches } from './arrowTable';
import { createNodeRunner } from './testing/nodeRunner';

describe('tableFromBatches', () => {
  it('returns the rows of the given batches', async () => {
    const runner = await createNodeRunner();
    const result = await runner.query('SELECT 1 AS a, 2 AS b');
    const table = tableFromBatches(result.schema, result.batches);
    expect(table.numRows).toBe(1);
    expect(table.get(0)?.a).toBe(1);
    expect(table.get(0)?.b).toBe(2);
  });

  it('keeps the schema when there are no batches', async () => {
    const runner = await createNodeRunner();
    const result = await runner.query('SELECT 1 AS a, 2 AS b WHERE false');
    const table = tableFromBatches(result.schema, result.batches);
    expect(table.numRows).toBe(0);
    expect(table.schema.fields.map((f) => f.name)).toEqual(result.schema.fields.map((f) => f.name));
  });
});
