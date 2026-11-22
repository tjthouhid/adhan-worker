// Location-based times from Aladhan's monthly calendar (iso8601=true gives
// times with the right UTC offset for each date).

import { addDays, todayInZone } from "./days.js";

const pad = (n) => String(n).padStart(2, "0");
const FIELDS = { fajr: "Fajr", sunrise: "Sunrise", dhuhr: "Dhuhr", asr: "Asr", maghrib: "Maghrib", isha: "Isha" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const ALADHAN_FETCH_OPTIONS = { cf: { cacheTtl: 86400, cacheEverything: true } };

export function aladhanCalendarUrl({ lat, lng, method, school }, y, m) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    method: String(method),
    school: String(school),
    latitudeAdjustmentMethod: "3",
    iso8601: "true",
  });
  return `https://api.aladhan.com/v1/calendar/${y}/${m}?${params}`;
}

export function buildLocationDays(calendars, start, n) {
  const byDate = new Map();
  for (const cal of calendars) for (const e of cal.data) byDate.set(e.date.gregorian.date, e);

  const days = [];
  for (let i = 0; i < n; i++) {
    const { y, m, d } = addDays(start, i);
    const e = byDate.get(`${pad(d)}-${pad(m)}-${y}`);
    if (!e) throw new Error(`Aladhan has no entry for ${y}-${pad(m)}-${pad(d)}`);
    const day = {
      date: `${y}-${pad(m)}-${pad(d)}`,
      weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()],
    };
    for (const [key, name] of Object.entries(FIELDS)) day[key] = String(e.timings[name]).split(" ")[0];
    day.jumuah = null;
    days.push(day);
  }
  return { timezone: calendars[0].data[0].meta.timezone, days };
}

// Fetch the month(s) covering n days from "today" at the location.
export async function fetchLocationDays(loc, n, fetchFn, now) {
  const cache = new Map();
  const month = async (y, m) => {
    const k = `${y}-${m}`;
    if (!cache.has(k)) {
      const res = await fetchFn(aladhanCalendarUrl(loc, y, m), ALADHAN_FETCH_OPTIONS);
      if (!res.ok) throw new Error(`Aladhan API error ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body?.data) || body.data.length === 0) throw new Error("Aladhan: empty calendar");
      cache.set(k, body);
    }
    return cache.get(k);
  };

  // The timezone comes from Aladhan, so start from the UTC month to learn it.
  const first = await month(now.getUTCFullYear(), now.getUTCMonth() + 1);
  const tz = first.data[0].meta.timezone;
  const start = todayInZone(tz, now);
  const end = addDays(start, n - 1);
  await month(start.y, start.m);
  await month(end.y, end.m);
  return buildLocationDays([...cache.values()], start, n);
}
