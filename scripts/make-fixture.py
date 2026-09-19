"""Writes fixtures/sample.parquet: 1,000 hourly rows across five Ecuadorian cities.

Run with any Python that has duckdb (`pip install duckdb`). The file is committed,
so the e2e suite needs no Python.
"""
import duckdb

duckdb.sql(
    """
    COPY (
      SELECT range::INTEGER AS id,
             ['Quito', 'Guayaquil', 'Cuenca', 'Loja', 'Manta'][(range % 5) + 1] AS city,
             TIMESTAMP '2026-01-01' + to_hours(range) AS t,
             round(sin(range / 10.0) * 10 + 20, 2) AS v
      FROM range(1000)
    ) TO 'fixtures/sample.parquet' (FORMAT parquet)
    """
)
print('wrote fixtures/sample.parquet')
