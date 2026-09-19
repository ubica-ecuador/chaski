import { type DataFrame, FieldType } from '@grafana/data';
import { Bool, type DataType, Float64, Table, TimestampMillisecond, Utf8, type Vector, vectorFromArray } from 'apache-arrow';

/**
 * One Arrow table from the frames another datasource returned, to be
 * materialized as a dataset. Frames are stacked by field name. A field missing
 * from a frame is null in that frame's rows. Each field keeps the type of the
 * first frame that has it.
 */
export function dataFramesToArrow(frames: DataFrame[]): Table {
  const names: string[] = [];
  const types = new Map<string, FieldType>();
  for (const frame of frames) {
    for (const field of frame.fields) {
      if (!types.has(field.name)) {
        names.push(field.name);
        types.set(field.name, field.type);
      }
    }
  }
  const columns: Record<string, Vector> = {};
  for (const name of names) {
    const type = types.get(name)!;
    const values: unknown[] = [];
    for (const frame of frames) {
      const field = frame.fields.find((f) => f.name === name);
      for (let row = 0; row < frame.length; row++) {
        const value = field?.values[row];
        values.push(value === null || value === undefined ? null : convert(value, type));
      }
    }
    columns[name] = vectorFromArray(values, arrowType(type));
  }
  return new Table(columns);
}

function arrowType(type: FieldType): DataType {
  switch (type) {
    case FieldType.time:
      return new TimestampMillisecond();
    case FieldType.number:
      return new Float64();
    case FieldType.boolean:
      return new Bool();
    default:
      return new Utf8();
  }
}

function convert(value: unknown, type: FieldType): unknown {
  switch (type) {
    case FieldType.time:
      return typeof value === 'number' ? value : new Date(value as string).getTime();
    case FieldType.number:
      return Number(value);
    case FieldType.boolean:
      return Boolean(value);
    default:
      return typeof value === 'string' ? value : JSON.stringify(value);
  }
}
