/** @jest-environment jsdom */
import { createDataFrame, FieldType } from '@grafana/data';

import { createNodeRunner } from '../engine/testing/nodeRunner';
import { dataFramesToArrow } from './frameToArrow';

describe('dataFramesToArrow', () => {
  it('unions frames by field name and keeps Grafana types', async () => {
    const first = createDataFrame({
      fields: [
        { name: 'time', type: FieldType.time, values: [Date.UTC(2026, 8, 19)] },
        { name: 'value', type: FieldType.number, values: [1.5] },
        { name: 'label', type: FieldType.string, values: ['a'] },
      ],
    });
    const second = createDataFrame({
      fields: [
        { name: 'value', type: FieldType.number, values: [2] },
        { name: 'ok', type: FieldType.boolean, values: [true] },
        { name: 'meta', type: FieldType.other, values: [{ k: 1 }] },
      ],
    });
    const table = dataFramesToArrow([first, second]);
    expect(table.numRows).toBe(2);

    const runner = await createNodeRunner();
    await runner.insertArrow('t', table);
    const types = (await runner.query('SELECT column_name, column_type FROM (DESCRIBE t)')).toArray().map((r) => [
      r.column_name,
      r.column_type,
    ]);
    expect(types).toEqual([
      ['time', 'TIMESTAMP_MS'],
      ['value', 'DOUBLE'],
      ['label', 'VARCHAR'],
      ['ok', 'BOOLEAN'],
      ['meta', 'VARCHAR'],
    ]);
    const rows = (await runner.query('SELECT * FROM t')).toArray().map((r) => r.toJSON());
    expect(rows).toEqual([
      { time: Date.UTC(2026, 8, 19), value: 1.5, label: 'a', ok: null, meta: null },
      { time: null, value: 2, label: null, ok: true, meta: '{"k":1}' },
    ]);
  });

  it('turns an empty response into an empty table', () => {
    expect(dataFramesToArrow([]).numRows).toBe(0);
  });
});
