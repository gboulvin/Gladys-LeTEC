# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-14

### Added

- First version of the TEC integration: next departures of the buses, the
  Liège tram and the Charleroi metro of Wallonia, from the TEC timetable (open
  data, CC0) corrected by the real-time feed of the Belgian Mobility open data
  portal (delays, cancellations, skipped stops).
- One device per monitored stop, with an optional line filter: next departure,
  next bus (line, destination, time, delay), delay, following departure, list
  of the next departures and number of disruptions.
- Scene triggers: departure soon (1 to 30 minutes before), departure delayed,
  departure cancelled, new disruption.
- Scene actions: get the next departure of a stop, check whether a line is
  disrupted.
- Dashboard widgets: departure board of a stop, disruptions of your lines.
- Configuration-screen actions: search for a stop by name, stops near the
  houses of Gladys, connection test, timetable update.
- Works without an API key (real-time every 20 minutes, within the anonymous
  quota); a free key refreshes it every minute. The cloud badge says when the
  real-time data is degraded.
- Texts, manifest and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/gboulvin/LeTEC/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/gboulvin/LeTEC/releases/tag/v1.0.0
