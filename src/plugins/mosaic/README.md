# Chaski Mosaic

A panel of the [Chaski](https://github.com/ubica-ecuador/chaski) app that draws a
[Mosaic](https://idl.uw.edu/mosaic/) spec (YAML or JSON) over the dashboard's Chaski datasets, by
name. Panels that share a selection filter each other in the browser, and Mosaic pre-aggregates what a
brush reads, so it keeps up on millions of rows. A selection can also write dashboard variables once
the brush rests, so panels on other datasources, and the kepler map, follow it.

<p align="center" style="text-align: center"><a href="https://docs.ubica.dev/img/chaski/mosaic-tour.mp4"><img src="https://docs.ubica.dev/img/chaski/mosaic-tour.jpg" alt="Play the 40-second tour of Chaski Mosaic" width="560"></a></p>

**▶ [Watch the 40-second tour](https://docs.ubica.dev/img/chaski/mosaic-tour.mp4)**: penguins, flights, Gaia's
stars and 3,600 stocks brushed in Mosaic, New York taxi rides driving a kepler map, and a typhoon's eyewall
picked in 3D.

It has no queries of its own: it needs at least one Chaski dataset on the dashboard.

How to write one: [docs/mosaic.md](https://github.com/ubica-ecuador/chaski/blob/main/docs/mosaic.md).
Live examples: [the dashboards tagged `chaski`](https://pacha.ubica.dev/dashboards?tag=chaski) on
pacha.ubica.dev, open with no account.
