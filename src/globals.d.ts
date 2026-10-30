/**
 * The base URL webpack resolves the plugin's own assets from. The scaffold sets
 * it at runtime from the AMD module URI, so it follows Grafana's sub-path.
 */
declare const __webpack_public_path__: string;

/**
 * True in development builds and in builds made with CHASKI_DEBUG=1 (the e2e
 * tests'): the engine then publishes window.__duckdbwasm. False in releases.
 */
declare const __CHASKI_DEBUG__: boolean;
