// Alexa fallback: today's times from the KV copy of the mosque timetable,
// used only when the direct my-masjid fetch fails.

import { parseMosques, findMosqueByGuid } from "./mosques.js";
import { buildMosqueDays } from "./days.js";

const hhmm = (iso) => iso.slice(11, 16); // "2026-11-22T06:02:00+00:00" -> "06:02"

// date is "DD-MM-YYYY" in the Alexa timezone. Returns {Fajr..Isha} or null.
export async function kvMosqueTimings(env, date, isFriday) {
  if (!env.TIMES) return null;
  const mosque = findMosqueByGuid(parseMosques(env.MOSQUES), env.MASJID_GUID);
  if (!mosque) return null;
  const stored = await env.TIMES.get(`mosque:${mosque.id}`, "json");
  if (!stored) return null;

  const [d, m, y] = date.split("-").map(Number);
  const [day] = buildMosqueDays(stored, mosque.timezone, { y, m, d }, 1);
  return {
    Fajr: hhmm(day.fajr),
    Dhuhr: isFriday && day.jumuah ? hhmm(day.jumuah) : hhmm(day.dhuhr),
    Asr: hhmm(day.asr),
    Maghrib: hhmm(day.maghrib),
    Isha: hhmm(day.isha),
  };
}
