# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

**TEC**, a Gladys Assistant **external integration**: a Node.js service (Node
22+, ESM, no build step) that runs in its own sandboxed Docker container and
talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template
(`GladysAssistant/integration-template-js`).

It shows the next departures of the TEC network of Wallonia (buses, Liège
tram, Charleroi metro) with real-time delays, cancellations and disruptions.
Two data sources, both open data:

- **Timetable** — GTFS static, `https://opendata.tec-wl.be/Current%20GTFS/TEC-GTFS.zip`
  (CC0, ~80 MB, refreshed nightly, no quota). Downloaded to `/data` with a
  conditional request, indexed by `src/gtfs/timetable.js`, cached as
  `/data/timetable.json`.
- **Real-time** — GTFS-RT in JSON from the Belgian Mobility portal
  (`api-management-opendata-production.azure-api.net/api/gtfs/feed/tec/rt/{trip-update,alert}?format=json`,
  CC BY 4.0). **Quota: 100 requests/day anonymous, 12 000/day with the free
  key** (header `Ocp-Apim-Subscription-Key`). `src/realtime.js` owns that
  budget: never add a call path that bypasses `RealtimeClient.get()`.

TEC publishes every cancelled trip as an alert too ("Annulations", hundreds a
day, `tripLevel` in `parseAlerts()`): they cancel departures
(`cancelledTrips()`), they are never counted as disruptions of a line.

Real-time ids carry a `gt:tec:` / `gs:tec:` / `gr:tec:` prefix; trip and stop
ids then match the static feed, but **route ids do not** (other numbered
suffix): match routes on `routeBase()` (`C00M2-23368` → `C00M2`).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/service.test.js          # one file
node --test --test-name-pattern "widget"  # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                SDK wiring only: handlers registered before connect()
src/service.js          TecService: config, timetable loading, 30 s refresh loop,
                        states, scene events, status, transports
src/config.js           DEFAULT_CONFIG (mirrors the manifest) + parseStops()
src/gtfs/zip.js         streaming ZIP reader (the archive is never loaded in memory)
src/gtfs/csv.js         streaming CSV reader
src/gtfs/timetable.js   buildTimetable() (index) + Timetable (queries, stop search)
src/gtfs/feed.js        archive download (conditional) + index cache in /data
src/realtime.js         RealtimeClient (quota, back-off, cache) + feed parsers
src/departures.js       pure: timetable + real-time -> departures, alerts per stop
src/stopDevice.js       device payload and states of a monitored stop
src/triggers.js         TriggerTracker: one scene event per transition
src/scenes.js           scene actions (manifest `scene_actions`)
src/widgets.js          dashboard widgets (manifest `widgets`)
src/actions.js          Configuration-screen actions (manifest `actions`)
src/i18n.js             every text in en / fr / de / es
src/format.js           departure texts
src/time.js             Europe/Brussels helpers, GTFS service-day arithmetic
docs/{en,fr,de,es}.md   user documentation, re-hosted by Gladys (en + fr mandatory)
test/                   node --test, SDK fake Gladys + in-memory GTFS fixture
```

## Rules

- **External ids are forever.** Devices are `gladys.externalIds('stop', key)`
  where `key` comes from `parseStops()` (stop id, plus the sorted line filter).
  Never change how the key is built, nor the feature keys of
  `src/stopDevice.js`, nor any manifest key (`config_schema`, `actions`,
  `scene_triggers`, `scene_actions`, `widgets`, their fields): scenes,
  dashboards and history are keyed on them.
- **One event per transition.** Scene events come from `TriggerTracker` only;
  never fire one as a consequence of a scene action (loops). Event `data`
  keys must be declared in the trigger's `fields` / `variables`
  (`test/service.test.js` checks it).
- **The container rootfs is read-only.** Write only under `/data`
  (`TEC_DATA_DIR`). Never log the API key.
- **Time.** All network times are Europe/Brussels; a GTFS departure is (service
  date, seconds since noon − 12 h), times may exceed 24:00. Use `src/time.js`,
  never `new Date().getHours()`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Four languages.** Every user-facing text exists in English, French, German
  and Spanish: manifest texts (`label`, `description`, `placeholder` — always
  multi-language objects), `src/i18n.js` (action messages, statuses, widgets,
  device texts) and `docs/*.md`. `test/manifest.test.js` and
  `test/config.test.js` fail on a missing language.
- **Manifest.** Capability fields require `gladys_version >= 5.1.0`. The
  catalog `description` holds 10 to 100 characters per language. The
  integration is cloud-only: `"transports": ["cloud"]`.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network: use `test/fixtures.js`.
