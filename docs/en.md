# TEC — buses, trams and metro of Wallonia

This integration shows in Gladys the **next departures** of the TEC buses,
the Liège tram and the Charleroi metro, with **delays**, **cancellations** and
**disruptions** (works, detours, strikes) in real time.

## What you get

One device per monitored stop, with:

| Feature                     | Example                                              |
| --------------------------- | ---------------------------------------------------- |
| Next departure              | `8` minutes                                          |
| Next bus                    | `M2 → ANDERLUES Monument · 08:03 (+3 min)`           |
| Delay of the next departure | `3` minutes                                          |
| Following departure         | `22` minutes                                         |
| Next departures             | `M2 8 min (+3 min) · 52 08:05 cancelled · M4 25 min` |
| Disruptions                 | `1` (alerts in force on the lines)                   |

At night, "Next departure" counts the minutes to the first departure of the
morning.

## Configuration

1. **API key (optional, recommended).** Delays come from the
   [Belgian Mobility](https://data.belgianmobility.io) open data portal.
   Without a key it only accepts 100 requests a day, so the real-time data is
   refreshed every 20 minutes. With a free key, every minute:
   - create an account on the
     [developer portal](https://api-management-opendata-production.developer.azure-api.net/signup);
   - subscribe to the free (Standard) product;
   - copy the **primary key** of your subscription into the "API key" field.
2. **Find your stops.** Every stop has **one code per direction** (e.g.
   `CMpa1` and `CMpa2` for the two platforms of the Palais metro station). Two
   buttons help:
   - **Search for a stop**: type part of the name ("charleroi gare"), the
     codes are listed with the lines serving them;
   - **Stops near my home**: the stops nearest to your Gladys houses (the
     location of the house must be set).
     The first load of the timetable takes a minute or two.
3. **Stops**: list the codes, separated by commas. To keep only some lines of
   a stop, add them after a colon, separated by `+`: `CMpa1:M2+M4, Ctrrpla2:82`.
   Twenty stops at most.
4. Save, then add the devices from the **Discover** tab.

Other settings:

- **Language of the texts**: language of the device names and of the texts
  written in the states (next bus, departures list).
- **Real-time refresh**: with a key, how often the real-time feed is read
  (60 s by default).
- **Departures shown**: how far ahead the lists look (90 minutes by default).
- **Delay alert from**: the delay that fires "TEC departure delayed" (5
  minutes by default).

## Actions

- **Search for a stop** and **Stops near my home** — see above.
- **Test the connection** — reads the real-time feed live and shows the
  timetable version, the trips tracked and the requests used.
- **Update the timetable now** — TEC publishes a new timetable every night;
  the integration checks by itself every 6 hours.

## Scenes

Triggers (category **Integrations** of the scene editor):

- **TEC departure soon** — a departure leaves in N minutes. Pick the stop, the
  line and one or several values of N (1 to 30 minutes). Perfect for "The bus
  leaves in 5 minutes, time to go!".
- **TEC departure delayed** — a departure within the hour is late by at least
  the configured delay.
- **TEC departure cancelled** — a departure within the hour is cancelled or no
  longer serves the stop.
- **New TEC disruption** — a new alert concerns a line of a monitored stop.

The following actions read the details, e.g. `{{triggerEvent.data.line}}`,
`{{triggerEvent.data.destination}}`, `{{triggerEvent.data.expected_time}}`,
`{{triggerEvent.data.delay_minutes}}` or `{{triggerEvent.data.title}}`.

Actions:

- **Get the next TEC departure** — line, destination, minutes, expected time,
  delay and a summary of the next departures, for a message ("The next metro
  leaves in … minutes").
- **Check a TEC line** — whether a line is disrupted, with the number of
  alerts and their summary: use it in a condition before warning anyone.

## Widgets

- **TEC departures** — the departure board of a stop: live next departure,
  delay and disruptions, the next departures colored by their delay, the data
  source and a "Refresh" button.
- **TEC disruptions** — the alerts in force on the lines of your stops (or of
  one stop, or one line), with a link to the details on letec.be.

## Data and privacy

- Timetable: TEC open data (CC0), downloaded from `opendata.tec-wl.be` (about
  80 MB) and indexed locally in `/data`.
- Real-time: Belgian Mobility open data portal (CC BY 4.0) — "Source: LETEC –
  Open Data".
- The location of your houses is only read by the "Stops near my home"
  button, and never leaves your Gladys.

## Troubleshooting

- **"Ignored (unknown stop…)"**: the code is not in the timetable; use the
  stop search (codes are case-sensitive: `CMpa1`).
- **Orange cloud badge**: no API key (real-time every 20 minutes) or real-time
  data temporarily unavailable; the timetable times stay displayed.
- **The portal refused the API key**: check that the subscription is active and
  that you copied the primary key.
