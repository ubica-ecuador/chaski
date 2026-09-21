# Changelog

## 1.0.0 (Unreleased)

Initial release.

- A dataset that reloads on time-range change keeps its table when the new range fits inside the
  loaded one (a zoom-in, or presets that end at `now`). Refreshing still reloads.
- The datasource announces when it starts and finishes answering queries (`ubica-duckdbwasm-activity`
  on Grafana's app event bus), for panels that pace themselves on it.
