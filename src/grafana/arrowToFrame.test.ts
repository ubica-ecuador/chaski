/** @jest-environment jsdom */
import { FieldType } from '@grafana/data';

import { createNodeRunner } from '../engine/testing/nodeRunner';
import { arrowToDataFrame } from './arrowToFrame';

describe('arrowToDataFrame', () => {
  it('maps every DuckDB type a panel may meet to a Grafana field', async () => {
    const runner = await createNodeRunner();
    const table = await runner.query(`
      SELECT TIMESTAMP '2026-09-19 05:00:00.123' AS ts, DATE '2026-09-19' AS d, 42::INTEGER AS i, 7::BIGINT AS b,
             1.5::DOUBLE AS f, true AS bo, 'x' AS s, 'a'::ENUM('a', 'b') AS e, [1, 2] AS l, {'a': 1} AS st,
             '\\x01\\xAB'::BLOB AS bl, NULL::VARCHAR AS n`);
    const frame = arrowToDataFrame(table, 'A');
    expect(frame.refId).toBe('A');
    expect(frame.length).toBe(1);
    const byName = Object.fromEntries(frame.fields.map((f) => [f.name, { type: f.type, value: f.values[0] }]));
    expect(byName).toEqual({
      ts: { type: FieldType.time, value: Date.UTC(2026, 8, 19, 5, 0, 0, 123) },
      d: { type: FieldType.time, value: Date.UTC(2026, 8, 19) },
      i: { type: FieldType.number, value: 42 },
      b: { type: FieldType.number, value: 7 },
      f: { type: FieldType.number, value: 1.5 },
      bo: { type: FieldType.boolean, value: true },
      s: { type: FieldType.string, value: 'x' },
      e: { type: FieldType.string, value: 'a' },
      l: { type: FieldType.other, value: '[1,2]' },
      st: { type: FieldType.other, value: '{"a":1}' },
      bl: { type: FieldType.string, value: '01ab' },
      n: { type: FieldType.string, value: null },
    });
  });
});
