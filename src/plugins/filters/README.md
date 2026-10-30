# Chaski Filters

A panel of the [Chaski](https://github.com/ubica-ecuador/chaski) app that shows a dataset's
cross-filters and sets them, with no query to write: how many rows they leave, and a control for each
filter drawn by [Mosaic](https://idl.uw.edu/mosaic/), counted under the others and following each
other live as a brush moves. Values to pick for `in` and `equals`, a histogram to brush for `range`, a
text box for `search`; a map's area shows as set, with a ×. It writes the same variables the filters
read, so every panel follows it. Tall, it is a sidebar; low, a strip of pills.

<p align="center" style="text-align: center"><a href="https://docs.ubica.dev/img/chaski/filters-tour.mp4"><img src="https://docs.ubica.dev/img/chaski/filters-tour.jpg" alt="Play the 35-second tour of Chaski Filters" width="560"></a></p>

**▶ [Watch the 35-second tour](https://docs.ubica.dev/img/chaski/filters-tour.mp4)**: a month of USGS earthquakes
played, brushed by time and magnitude and filtered by an area on the map, with every count following.

It reads the declarations of a Chaski filters variable (the one `$__crossfilter` takes).

How to set it up: [docs/filters.md](https://github.com/ubica-ecuador/chaski/blob/main/docs/filters.md).
A live example that plays a month of earthquakes on a map:
[filters-earthquakes](https://pacha.ubica.dev/d/filters-earthquakes).
