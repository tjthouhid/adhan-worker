// The owner's mosque list, from the MOSQUES var in wrangler.toml (a JSON array).

export function parseMosques(raw) {
  let list;
  try {
    list = JSON.parse(raw ?? "");
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.filter(
    (m) =>
      m &&
      typeof m.id === "string" && m.id &&
      typeof m.guid === "string" && m.guid &&
      typeof m.timezone === "string" && m.timezone
  );
}

// What apps may see: never the my-masjid GUID.
export function publicMosque(m) {
  return { id: m.id, name: m.name, city: m.city, timezone: m.timezone };
}

export const findMosque = (list, id) => list.find((m) => m.id === id);
export const findMosqueByGuid = (list, guid) => list.find((m) => m.guid === guid);
