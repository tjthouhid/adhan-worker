import { findMosque } from "./mosques.js";

// Aladhan calculation method numbers (aladhan.com/calculation-methods). 6 is unused.
export const ALADHAN_METHODS = new Set(
  Array.from({ length: 24 }, (_, i) => i).filter((i) => i !== 6)
);

const bad = (error, status = 400) => ({ error, status });

// Whole numbers only; anything else is invalid.
function int(value, fallback) {
  if (value === null) return fallback;
  return /^-?\d+$/.test(value) ? Number(value) : NaN;
}

function coord(value, limit) {
  if (value === null || value.trim() === "") return NaN;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return NaN;
  return Math.round(n * 100) / 100;
}

// /times.json query: either ?masjid=<id> or ?lat=..&lng=.. (never both).
export function parseTimesQuery(params, mosques) {
  const days = int(params.get("days"), 7);
  if (!(days >= 1 && days <= 14)) return bad("days must be a whole number from 1 to 14");

  const masjid = params.get("masjid");
  const hasLocation = params.has("lat") || params.has("lng");

  if (masjid !== null && hasLocation) return bad("use either masjid or lat/lng, not both");

  if (masjid !== null) {
    const mosque = findMosque(mosques, masjid);
    if (!mosque) return bad("unknown masjid", 404);
    return { kind: "mosque", mosque, days };
  }

  if (!hasLocation) return bad("masjid or lat/lng is required");

  const lat = coord(params.get("lat"), 90);
  const lng = coord(params.get("lng"), 180);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return bad("lat must be -90 to 90 and lng -180 to 180");
  }

  const method = int(params.get("method"), 15);
  if (!ALADHAN_METHODS.has(method)) return bad("unknown method");

  const school = int(params.get("school"), 1);
  if (school !== 0 && school !== 1) return bad("school must be 0 or 1");

  return { kind: "location", lat, lng, method, school, days };
}
