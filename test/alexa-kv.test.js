import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { kvMosqueTimings } from "../src/alexa-kv.js";
import { trimTimetable } from "../src/timetable.js";

const GUID = "g-1";
const MOSQUES = JSON.stringify([
  { id: "duwt", name: "DUWT", city: "Dagenham", guid: GUID, timezone: "Europe/London" },
]);
const stored = {
  fetchedAt: 1,
  guid: GUID,
  ...trimTimetable(JSON.parse(readFileSync(new URL("./fixtures/mymasjid-sample.json", import.meta.url)))),
};
const kv = (value) => ({ get: async (k, t) => (k === "mosque:duwt" && value ? value : null) });

describe("kvMosqueTimings (Alexa fallback)", () => {
  it("returns today's HH:MM times from the KV copy", async () => {
    const env = { MOSQUES, MASJID_GUID: GUID, TIMES: kv(stored) };
    expect(await kvMosqueTimings(env, "22-11-2026", false)).toEqual({
      Fajr: "06:03", Dhuhr: "12:05", Asr: "14:00", Maghrib: "16:03", Isha: "17:40",
    });
  });

  it("uses the earliest Jumu'ah time for Dhuhr on Fridays", async () => {
    const env = { MOSQUES, MASJID_GUID: GUID, TIMES: kv(stored) };
    expect((await kvMosqueTimings(env, "27-11-2026", true)).Dhuhr).toBe("13:00");
  });

  it("returns null when there's no binding, no listed mosque or no copy", async () => {
    expect(await kvMosqueTimings({ MOSQUES, MASJID_GUID: GUID }, "22-11-2026", false)).toBeNull();
    expect(await kvMosqueTimings({ MOSQUES, MASJID_GUID: "other", TIMES: kv(stored) }, "22-11-2026", false)).toBeNull();
    expect(await kvMosqueTimings({ MOSQUES, MASJID_GUID: GUID, TIMES: kv(null) }, "22-11-2026", false)).toBeNull();
  });
});
