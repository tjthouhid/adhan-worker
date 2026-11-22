// App API: /mosques.json and /times.json.
// Mosque times come only from KV (filled by the cron). No request here calls my-masjid.com.

import { parseMosques, publicMosque } from "./mosques.js";
import { parseTimesQuery } from "./validate.js";
import { buildMosqueDays, todayInZone, secondsToMidnight } from "./days.js";

export function json(body, status = 200, maxAge = 3600) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": `public, max-age=${maxAge}`,
    },
  });
}

const error = (message, status) => json({ error: message }, status, 60);

export function handleMosques(env) {
  return json({ mosques: parseMosques(env.MOSQUES).map(publicMosque) });
}

// Same query in any order, or with unrounded coordinates, shares one cache entry.
function cacheKey(origin, q) {
  const p =
    q.kind === "mosque"
      ? { days: q.days, masjid: q.mosque.id }
      : { days: q.days, lat: q.lat, lng: q.lng, method: q.method, school: q.school };
  const search = new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)]));
  return new Request(`${origin}/times.json?${search}`);
}

const maxAgeFor = (tz, now) => Math.max(1, Math.min(3600, secondsToMidnight(tz, now)));

async function mosqueTimes(q, env, now) {
  if (!env.TIMES) return error("timetable not ready", 503);
  const stored = await env.TIMES.get(`mosque:${q.mosque.id}`, "json");
  if (!stored) return error("timetable not ready", 503);

  const tz = q.mosque.timezone;
  let days;
  try {
    days = buildMosqueDays(stored, tz, todayInZone(tz, now), q.days);
  } catch (err) {
    console.log(`Times build failed for ${q.mosque.id}: ${err.message}`);
    return error("timetable not ready", 503);
  }
  return json(
    {
      source: "mosque",
      mosque: { id: q.mosque.id, name: q.mosque.name },
      location: null,
      timezone: tz,
      generatedAt: now.toISOString(),
      days,
    },
    200,
    maxAgeFor(tz, now)
  );
}

export async function handleTimes(request, env, { cache, fetchFn, now }) {
  const url = new URL(request.url);
  const q = parseTimesQuery(url.searchParams, parseMosques(env.MOSQUES));
  if (q.error) return error(q.error, q.status);

  const key = cacheKey(url.origin, q);
  const hit = await cache.match(key);
  if (hit) return hit;

  const res = q.kind === "mosque" ? await mosqueTimes(q, env, now) : error("not implemented", 501);
  if (res.status === 200) await cache.put(key, res.clone());
  return res;
}
