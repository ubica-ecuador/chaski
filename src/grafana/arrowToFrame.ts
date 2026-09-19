import { createDataFrame, type DataFrame, FieldType } from '@grafana/data';
import { DataType, type Table } from 'apache-arrow';

type Converter = (value: unknown) => unknown;

/**
 * One DataFrame from one Arrow result. Binary columns become hex text: that is
 * how geometry reaches panels (the engine turns GEOMETRY into WKB), and hex WKB
 * is what the kepler panel decodes. Nested values become JSON text.
 */
export function arrowToDataFrame(table: Table, refId: string): DataFrame {
  const fields = table.schema.fields.map((field, index) => {
    const vector = table.getChildAt(index);
    const [type, convert] = converterFor(field.type);
    const values: unknown[] = new Array(table.numRows);
    for (let row = 0; row < table.numRows; row++) {
      const value = vector?.get(row);
      values[row] = value === null || value === undefined ? null : convert(value);
    }
    return { name: field.name, type, values };
  });
  return createDataFrame({ refId, fields });
}

function converterFor(type: DataType): [FieldType, Converter] {
  if (DataType.isTimestamp(type) || DataType.isDate(type)) {
    return [FieldType.time, (v) => (v instanceof Date ? v.getTime() : Number(v))];
  }
  if (DataType.isInt(type) || DataType.isFloat(type)) {
    return [FieldType.number, (v) => Number(v)];
  }
  if (DataType.isBool(type)) {
    return [FieldType.boolean, (v) => Boolean(v)];
  }
  if (DataType.isUtf8(type) || DataType.isLargeUtf8(type) || DataType.isDictionary(type)) {
    return [FieldType.string, (v) => String(v)];
  }
  if (DataType.isBinary(type) || DataType.isLargeBinary(type) || DataType.isFixedSizeBinary(type)) {
    return [FieldType.string, (v) => toHex(v as Uint8Array)];
  }
  return [FieldType.other, (v) => JSON.stringify(toPlain(v), bigintAsString)];
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function toPlain(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return (value as { toJSON(): unknown }).toJSON();
  }
  return value;
}

function bigintAsString(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
