// Daily refresh of the listed mosques' timetables into KV, one mosque per cron tick.
// This is the only code that calls my-masjid.com for the app API.

import { parseMosques } from "./mosques.js";
import { trimTimetable, isCompleteYear } from "./timetable.js";

const HOUR = 3600_000;
const FRESH_FOR = 24 * HOUR; // refresh each mosque once a day
const RETRY_AFTER = HOUR; // after a failure, wait before trying again

export const myMasjidUrl = (guid) =>
  `https://time.my-masjid.com/api/TimingsInfoScreen/GetMasjidTimings?GuidId=${encodeURIComponent(guid)}`;

// state: { [id]: { ok: ms|null, tried: ms } }
export function pickNextToRefresh(mosques, state, nowMs) {
  return (
    mosques.find((m) => {
      const s = state[m.id];
      if (!s) return true;
      const stale = s.ok == null || nowMs - s.ok > FRESH_FOR;
      return stale && nowMs - s.tried > RETRY_AFTER;
    }) ?? null
  );
}

export async function refreshOne(env, fetchFn, nowMs) {
  const state = (await env.TIMES.get("refresh-state", "json")) || {};
  const mosque = pickNextToRefresh(parseMosques(env.MOSQUES), state, nowMs);
  if (!mosque) return null;

  const prev = state[mosque.id];
  try {
    const res = await fetchFn(myMasjidUrl(mosque.guid));
    if (!res.ok) throw new Error(`my-masjid API error ${res.status}`);
    const { days, jumuah } = trimTimetable(await res.json());
    // A partial response must never replace a good full-year copy.
    if (!isCompleteYear(days)) throw new Error(`Bad timetable: only ${days.length} days`);
    await env.TIMES.put(
      `mosque:${mosque.id}`,
      JSON.stringify({ fetchedAt: nowMs, guid: mosque.guid, name: mosque.name, timezone: mosque.timezone, days, jumuah })
    );
    state[mosque.id] = { ok: nowMs, tried: nowMs };
    await env.TIMES.put("refresh-state", JSON.stringify(state));
    console.log(`Refreshed mosque ${mosque.id}: ${days.length} days`);
    return { id: mosque.id, ok: true };
  } catch (err) {
    console.log(`Refresh failed for mosque ${mosque.id}, keeping old copy: ${err.message}`);
    state[mosque.id] = { ok: prev?.ok ?? null, tried: nowMs };
    await env.TIMES.put("refresh-state", JSON.stringify(state));
    return { id: mosque.id, ok: false };
  }
}
