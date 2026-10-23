// Mosaic's index re-exports its DuckDB-WASM connector, which the Mosaic panel
// never uses (it queries Chaski's engine), and whose DuckDB-WASM import needs a
// Worker that jsdom lacks. The bundle tree-shakes it away; tests get this stub.
module.exports = { wasmConnector: () => undefined, DuckDBWASMConnector: class {} };
