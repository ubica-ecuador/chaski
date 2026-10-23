export interface MosaicOptions {
  /** A Mosaic spec, YAML or JSON, over the dashboard's Chaski datasets. */
  spec: string;
  /** Which of the spec's Selections and Params write dashboard variables, YAML or JSON. */
  variables: string;
  /** Dashboard variables that become clauses of the spec's Selections, YAML or JSON. */
  reads?: string;
  /** Pre-aggregate the tables brushes read, for large data. */
  preaggregate: boolean;
}
