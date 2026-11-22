// Adhan on Alexa — Cloudflare Worker
// Every minute: get today's prayer times (your mosque's my-masjid.com timetable,
// or the Aladhan API as a fallback), and when it's prayer time, fire your
// Voice Monkey Routine Trigger, which runs the Alexa routine that plays the adhan.

import { refreshOne, myMasjidUrl } from "./refresh.js";
import { handleMosques, handleTimes } from "./api.js";
import { kvMosqueTimings } from "./alexa-kv.js";

const PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

// In-memory cache (survives while the Worker instance stays warm)
let cache = { date: null, timings: null };

// Current date/time in your timezone (handles GMT/BST automatically)
function nowInZone(tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.day}-${parts.month}-${parts.year}`, // DD-MM-YYYY for Aladhan
    hhmm: `${parts.hour}:${parts.minute}`,
    isFriday: parts.weekday === "Fri",
  };
}

// Mosque's own timetable (my-masjid.com): whole year, local clock times
async function getMosqueTimings(env, date, isFriday) {
  const res = await fetch(myMasjidUrl(env.MASJID_GUID), { cf: { cacheTtl: 21600, cacheEverything: true } });
  if (!res.ok) throw new Error(`my-masjid API error ${res.status}`);
  const json = await res.json();

  const [d, m] = date.split("-").map(Number); // DD-MM-YYYY
  const day = json.model.salahTimings.find((t) => t.day === d && t.month === m);
  if (!day) throw new Error(`No mosque timings for ${date}`);

  const timings = {
    Fajr: day.fajr,
    Dhuhr: day.zuhr,
    Asr: day.asr,
    Maghrib: day.maghrib,
    Isha: day.isha,
  };

  // Friday: play the Dhuhr adhan at the first (earliest) Jumu'ah jamaah instead
  if (isFriday) {
    const jumuah = (json.model.jumahSalahIqamahTimings || [])
      .map((j) => j.time)
      .filter((t) => /^\d{2}:\d{2}$/.test(t))
      .sort()[0];
    if (jumuah) timings.Dhuhr = jumuah;
  }

  if (!PRAYERS.every((p) => /^\d{2}:\d{2}$/.test(timings[p]))) {
    throw new Error(`Bad mosque timings for ${date}`);
  }
  return timings;
}

async function getTimings(env, date, isFriday) {
  if (cache.date === date && cache.timings) return cache.timings;

  if (env.MASJID_GUID) {
    try {
      const timings = await getMosqueTimings(env, date, isFriday);
      cache = { date, timings, source: "mosque" };
      return timings;
    } catch (err) {
      console.log(`Mosque timings failed: ${err.message}`);
      // Backup: the app API's daily KV copy of the same mosque, if it's listed in MOSQUES
      try {
        const timings = await kvMosqueTimings(env, date, isFriday);
        if (timings) {
          cache = { date, timings, source: "mosque-kv" };
          return timings;
        }
      } catch (kvErr) {
        console.log(`KV mosque timings failed: ${kvErr.message}`);
      }
      console.log("Using Aladhan");
    }
  }

  const params = new URLSearchParams({
    latitude: env.LATITUDE,
    longitude: env.LONGITUDE,
    method: env.METHOD,                      // 15 = Moonsighting Committee
    school: env.SCHOOL,                      // 1 = Hanafi Asr, 0 = Shafi'i
    latitudeAdjustmentMethod: env.LAT_ADJ,   // 3 = Angle-based (good for UK)
    timezonestring: env.TIMEZONE,
    tune: env.TUNE,                          // minute offsets, see wrangler.toml
  });
  const url = `https://api.aladhan.com/v1/timings/${date}?${params}`;

  // Cloudflare edge-caches the response, so Aladhan isn't hit every minute
  const res = await fetch(url, { cf: { cacheTtl: 21600, cacheEverything: true } });
  if (!res.ok) throw new Error(`Aladhan API error ${res.status}`);
  const json = await res.json();

  const timings = {};
  for (const p of PRAYERS) {
    timings[p] = String(json.data.timings[p]).split(" ")[0]; // "16:02 (GMT)" -> "16:02"
  }
  cache = { date, timings, source: "aladhan" };
  return timings;
}

async function triggerMonkey(env, device) {
  const url = new URL("https://api-v3.voicemonkey.io/trigger");
  url.searchParams.set("token", env.VM_TOKEN);
  url.searchParams.set("device", device);
  const res = await fetch(url.toString());
  const body = await res.text();
  if (!res.ok) throw new Error(`Voice Monkey error ${res.status}: ${body}`);
  return body;
}

export default {
  // Runs every minute (cron in wrangler.toml)
  async scheduled(event, env, ctx) {
    // App API: refresh at most one listed mosque into KV. Runs alongside the
    // Alexa check below, so a refresh failure can never block the adhan.
    if (env.TIMES) {
      ctx.waitUntil(
        refreshOne(env, fetch, Date.now()).catch((err) => console.log(`Refresh error: ${err.message}`))
      );
    }

    const { date, hhmm, isFriday } = nowInZone(env.TIMEZONE);
    const timings = await getTimings(env, date, isFriday);

    const prayer = PRAYERS.find((p) => timings[p] === hhmm);
    if (!prayer) return;

    // Optional separate Fajr routine; falls back to the main one
    const device =
      prayer === "Fajr" && env.FAJR_DEVICE ? env.FAJR_DEVICE : env.DEVICE;

    const result = await triggerMonkey(env, device);
    console.log(`${date} ${hhmm} ${prayer} -> triggered ${device}: ${result}`);
  },

  // Visit your Worker URL in a browser to see today's times.
  // Add ?test=1&key=YOUR_TEST_KEY to fire the adhan now (uses 1 Voice Monkey request).
  async fetch(request, env) {
    const url = new URL(request.url);

    // App API (served from KV / cache; never calls my-masjid.com)
    if (url.pathname === "/mosques.json") return handleMosques(env);
    if (url.pathname === "/times.json") {
      return handleTimes(request, env, { cache: caches.default, fetchFn: fetch, now: new Date() });
    }

    const { date, hhmm, isFriday } = nowInZone(env.TIMEZONE);

    if (url.searchParams.get("test") === "1") {
      if (!env.TEST_KEY || url.searchParams.get("key") !== env.TEST_KEY) {
        return new Response("Forbidden", { status: 403 });
      }
      // Add &fajr=1 to test the Fajr routine instead
      const device =
        url.searchParams.get("fajr") === "1" && env.FAJR_DEVICE
          ? env.FAJR_DEVICE
          : env.DEVICE;
      try {
        const result = await triggerMonkey(env, device);
        return new Response(`Triggered ${device}: ${result}\n`);
      } catch (err) {
        return new Response(`Failed to trigger ${device}: ${err.message}\n`, { status: 502 });
      }
    }

    const timings = await getTimings(env, date, isFriday);
    const label = (p) =>
      p === "Dhuhr" && isFriday && cache.source?.startsWith("mosque") ? "Jumu'ah" : p;
    const lines = PRAYERS.map((p) => `${label(p).padEnd(8)} ${timings[p]}`).join("\n");
    return new Response(
      `Prayer times for ${date} (${env.TIMEZONE})\nSource: ${cache.source}\nNow: ${hhmm}\n\n${lines}\n`,
      { headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  },
};
