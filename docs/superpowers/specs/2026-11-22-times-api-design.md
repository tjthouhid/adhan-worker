# Times API for the adhan app — design

Date: 2026-11-22
Status: draft, awaiting approval

## Why

An iPhone app (built next, separate repo) will ring the full adhan with AlarmKit at each prayer time. AlarmKit was tested on an iPhone 15 Pro Max on iOS 27.2: a 120-second custom alarm sound played in full on silent and locked, five alarms 2 minutes apart all rang, and the alarm's secondary button opened the app.

The app needs prayer times from somewhere. If every phone called my-masjid.com directly, the upstream API would see traffic proportional to the number of users, and could rate-limit or block it. This Worker becomes the only thing that talks to the upstream APIs. Phones only talk to the Worker, and the Worker serves them from its own stored copy.

## Goals

- `GET /times.json` returns 7 days (configurable up to 14) of prayer times for either:
  - a mosque from a list the owner controls, or
  - a location (latitude/longitude) calculated through Aladhan.
- `GET /mosques.json` returns the mosque list for the app's picker.
- my-masjid.com is called about **once a day per listed mosque**, no matter how many users (the owner asked for "one request to the API a day").
- Aladhan is called at most about once per area per month in each Cloudflare data centre.
- The existing Alexa flow keeps working exactly as today.
- Stays on the Cloudflare free plan.

## Non-goals

- The iOS app itself (next project).
- Push notifications.
- Mosque search across all of my-masjid.com (no public search API is known).
- Other mosque timetable providers.
- User accounts, auth, analytics.
- Android.

## Anti-goals (a failure even if it technically works)

- The Alexa adhan stops firing, fires at the wrong time, or uses more Voice Monkey requests.
- Any user request triggers a call to my-masjid.com.
- The endpoint can be used to make the Worker fetch arbitrary mosque GUIDs or URLs.
- Secrets (`VM_TOKEN`, `TEST_KEY`) or the Voice Monkey device IDs appear in any public response.

## Constraints

- Cloudflare Workers free plan: 100,000 requests/day, 10 ms CPU per request, KV 100,000 reads/day and 1,000 writes/day.
- The current cron runs every minute (about 1,440 invocations a day) and must keep doing so.
- The my-masjid API returns the mosque's whole-year timetable in one response (`model.salahTimings[]` with `day`, `month`, `fajr`, `zuhr`, `asr`, `maghrib`, `isha`), plus `model.jumahSalahIqamahTimings[]`. The current code matches only on day and month and ignores the year.
- No test framework exists in the repo today. It's plain JavaScript (`src/index.js`), deployed with `npx wrangler deploy`.

## Approaches considered

| | How | Upstream calls | Trade-off |
|---|---|---|---|
| **1. KV for mosques, edge cache for location (chosen)** | A daily refresh saves each listed mosque's trimmed yearly timetable to KV. Location requests fetch Aladhan's monthly calendar with Cloudflare's edge cache. | my-masjid: 1 a day per mosque. Aladhan: about 1 per area per month per data centre. | Mosque traffic is fully controlled. Location traffic is small without filling KV writes. |
| 2. Edge cache only | Fetch on a cache miss, cache for a few hours. | my-masjid called per data centre every few hours. | Simplest, but not one call, and an upstream outage reaches users. |
| 3. KV for everything | Location results stored in KV too. | Lowest | Risks the 1,000 writes/day limit as new areas appear. More work for little gain. |

**Chosen by the owner:** approach 1, and mosque scope "C": the owner's list plus "use my location".

## Design

### Mosque list

`MOSQUES` in `[vars]` in `wrangler.toml`, a JSON array:

```toml
MOSQUES = '[{"id":"duwt","name":"Dagenham United Welfare Trust","city":"Dagenham","guid":"7a036d31-b4ac-44f6-a68e-2dbb1f7a7994","timezone":"Europe/London"}]'
```

- `id` is a short slug used in URLs. The GUID is never accepted from a request.
- Adding a mosque means editing this list and running `npx wrangler deploy`.
- `MASJID_GUID` stays as it is for the Alexa flow. *(Builder's call: the Alexa flow may look its mosque up in `MOSQUES` by GUID to share the KV copy.)*

### KV storage

- One namespace, bound as `TIMES`.
- Key `mosque:<id>` holds `{ fetchedAt, guid, name, timezone, days: [{month, day, fajr, dhuhr, asr, maghrib, isha}], jumuah: ["13:15", ...] }`, a trimmed copy of the yearly timetable (no unused fields), so the value stays small.
- It's written only by the refresh step (below). **No user request ever calls my-masjid.com or writes KV.**

### Refresh (daily, one mosque per cron tick)

- Done inside the existing every-minute cron. No new cron is needed.
- On each tick, refresh **at most one** mosque: the first one in `MOSQUES` whose KV entry is missing or has a `fetchedAt` older than 24 hours. This keeps each cron run well inside the free plan's CPU and subrequest limits, however long the list gets (up to 1,440 mosques a day in theory).
- Track this with one small KV key, `refresh-state`, holding `{ "<id>": fetchedAt, ... }`. That's 1 KV read per tick (about 1,440 a day) plus 2 writes per refresh. *(Builder's call: keep it in memory between ticks when the instance stays warm, to save reads.)*
- A refresh fetches my-masjid, validates it (every day has five `HH:MM` times), trims it, and writes `mosque:<id>`.
- If the fetch or validation fails, **keep the existing KV value**, log the failure, and record the attempt time, so the mosque is retried after 1 hour rather than on every tick.
- Right after a deploy, or after adding a mosque, the entry fills within a few minutes on the next ticks. Until then, `/times.json` for that mosque returns `503`.
- Writes: about 1 per mosque per day (plus `refresh-state`). That's well under the 1,000 a day allowed for a small list.

### `GET /mosques.json`

```json
{ "mosques": [ { "id": "duwt", "name": "Dagenham United Welfare Trust", "city": "Dagenham", "timezone": "Europe/London" } ] }
```

No GUIDs. Cached at the edge for 1 hour.

### `GET /times.json`

Query, exactly one of these forms:

- `?masjid=<id>&days=7`
- `?lat=51.54&lng=0.15&method=15&school=1&days=7`

Validation (otherwise `400` with a JSON `{ "error": "..." }`):

- `masjid` must be an `id` in `MOSQUES`, otherwise `404`.
- `lat` from -90 to 90, `lng` from -180 to 180, **rounded to 2 decimal places** (about 1 km) before use, so nearby users share cache entries.
- `method` must be one of Aladhan's method numbers. Default `15`.
- `school` is `0` or `1`. Default `1`.
- `days` from 1 to 14. Default 7.

Response:

```json
{
  "source": "mosque",
  "mosque": { "id": "duwt", "name": "Dagenham United Welfare Trust" },
  "location": null,
  "timezone": "Europe/London",
  "generatedAt": "2026-11-22T10:00:00Z",
  "days": [
    {
      "date": "2026-11-22",
      "weekday": "Sun",
      "fajr":    "2026-11-22T06:02:00+00:00",
      "sunrise": null,
      "dhuhr":   "2026-11-22T12:05:00+00:00",
      "asr":     "2026-11-22T14:00:00+00:00",
      "maghrib": "2026-11-22T16:00:00+00:00",
      "isha":    "2026-11-22T17:40:00+00:00",
      "jumuah":  null
    }
  ]
}
```

- Every time is a full ISO 8601 timestamp **with the UTC offset for that date**, so the app never has to work out BST or GMT itself and clock changes inside the 7 days are handled correctly.
- `jumuah` is set only on Fridays, and only for mosque sources: the earliest valid Jumu'ah time. `dhuhr` stays the normal Dhuhr time. The app decides which one to ring.
- `sunrise` is filled for Aladhan sources and is `null` for mosques unless my-masjid provides it *(builder's call if it does)*.
- `days` starts at "today" in the source's timezone.
- For location sources, `location` is `{ "lat": 51.54, "lng": 0.15, "method": 15, "school": 1 }` and `timezone` comes from Aladhan's `meta.timezone`.

Request flow, mosque:

1. Cache API lookup on the full normalised URL. On a hit, return it.
2. Read `mosque:<id>` from KV.
3. If the entry is missing, return `503 { "error": "timetable not ready" }`. Never fetch upstream here.
4. Build the days, store the response in the Cache API until the next midnight in the mosque's timezone (capped at 1 hour, so the "today" boundary is never stale for long), and return it.

Request flow, location:

1. Cache API lookup on the normalised URL. On a hit, return it.
2. Fetch Aladhan `GET /v1/calendar/{year}/{month}` for the current month, and the next month too if the requested days cross the month boundary. Use `latitude`, `longitude`, `method`, `school`, `latitudeAdjustmentMethod=3` and `iso8601=true`, with `cf: { cacheTtl: 86400, cacheEverything: true }`.
3. Build the days, cache them like the mosque flow, and return.

Headers: `content-type: application/json`, `access-control-allow-origin: *`, and `cache-control: public, max-age=3600`.

### Alexa flow (existing cron, every minute)

**Unchanged.** It keeps its current order: in-memory cache, then a direct my-masjid fetch (edge-cached for 6 hours), then Aladhan. The only addition is a new last-resort step **before** Aladhan: if the direct my-masjid fetch fails, use the KV copy for the mosque whose GUID equals `MASJID_GUID`, if that mosque is in `MOSQUES`.

Why it isn't KV-first: Alexa then never runs on a copy older than it does today, so a mid-week timetable change by the mosque (Ramadan, a new Jumu'ah time) reaches Alexa just as fast as now. The extra my-masjid traffic is the single existing Alexa call, which you already have today.

Friday Jumu'ah replacement, `TUNE`, Voice Monkey calls, the `?test=1` link and the plain-text times page at `/` all stay the same.

### Dates without a year

The stored timetable has month and day but no year, which is how the current code already works. When the requested days run past 31 December, the January days use the same month and day from the stored timetable, and the response marks those days with `"estimated": true`. Mosque begin times barely change from one year to the next, and the next day's refresh corrects it once my-masjid serves the new year. If a date isn't in the timetable (29 February in a non-leap timetable), use 28 February and mark it `estimated`.

### Errors

- Upstream failure on a location request with nothing cached returns `503 { "error": "upstream unavailable" }`. The app keeps its previously downloaded days.
- A KV entry that's missing and can't be filled returns `503`.

### Ops (owner, once)

- `npx wrangler kv namespace create TIMES`, then add the binding to `wrangler.toml`.
- Optional: a Cloudflare free rate-limiting rule on `/times.json`, set up in the dashboard, not in code.
- README: document `/mosques.json`, `/times.json` and how to add a mosque.

## Left to the builder

- Code structure. Splitting `src/index.js` into modules is fine.
- The testing approach. Pure functions (validation, rounding, building days with offsets, Jumu'ah selection, trimming) should get unit tests. Adding a dev dependency such as Vitest is fine.
- The exact Aladhan method list used for validation.
- Logging wording.

## Calls made by Claude (owner can override)

- Coordinates rounded to 2 decimal places (about 1 km).
- Daily refresh, one mosque per cron tick, instead of a separate weekly cron.
- Alexa keeps its current fetch order. KV is only an extra fallback for it.
- No user request ever fetches my-masjid. A missing entry returns `503` until the cron fills it.
- Days after 31 December use the same month and day, marked `estimated`.
- ISO timestamps with offset rather than bare `HH:MM`.
- Jumu'ah returned as a separate field rather than replacing Dhuhr.
- Mosque list kept in `wrangler.toml` rather than in KV.
