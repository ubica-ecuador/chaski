import { CustomVariableSupport, type DataQueryRequest, type DataQueryResponse } from '@grafana/data';
import type { Observable } from 'rxjs';

import { VariableQueryEditor } from '../components/VariableQueryEditor';
import type { DataSource } from '../datasource';
import type { DuckOptions, DuckQuery, DuckVariableQuery } from '../types';

/** Dataset and values variables, answered by the datasource itself. */
export class DuckVariableSupport extends CustomVariableSupport<DataSource, DuckVariableQuery, DuckQuery, DuckOptions> {
  editor = VariableQueryEditor;

  constructor(private readonly datasource: DataSource) {
    super();
  }

  query(request: DataQueryRequest<DuckVariableQuery>): Observable<DataQueryResponse> {
    return this.datasource.variableQuery(request);
  }
}
