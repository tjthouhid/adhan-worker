import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { aladhanCalendarUrl, buildLocationDays } from "../src/aladhan.js";
import { handleTimes } from "../src/api.js";

const CAL = JSON.parse(
  readFileSync(new URL("./fixtures/aladhan-calendar-sample.json", import.meta.url))
);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/;
const LOC = { lat: 51.54, lng: 0.15, method: 15, school: 1 };

function fakeCache() {
  const store = new Map();
  return { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => void store.set(r.url, res) };
}
// Serves the fixture month named in the URL path /v1/calendar/YYYY/M
const calendarFetch = () =>
  vi.fn(async (url) => {
    const [, y, m] = /\/v1\/calendar\/(\d{4})\/(\d{1,2})/.exec(url);
    const body = CAL[`${y}-${String(m).padStart(2, "0")}`];
    return body ? new Response(JSON.stringify(body)) : new Response("{}", { status: 404 });
  });
const req = (q) => new Request(`https://w.example/times.json?${q}`);

describe("aladhanCalendarUrl", () => {
  it("builds the calendar URL with ISO times and the UK high-latitude rule", () => {
    const u = new URL(aladhanCalendarUrl(LOC, 2026, 11));
    expect(u.origin + u.pathname).toBe("https://api.aladhan.com/v1/calendar/2026/11");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      latitude: "51.54",
      longitude: "0.15",
      method: "15",
      school: "1",
      latitudeAdjustmentMethod: "3",
      iso8601: "true",
    });
  });
});

describe("buildLocationDays", () => {
  it("joins two months into the requested days, in order", () => {
    const { timezone, days } = buildLocationDays(
      [CAL["2026-11"], CAL["2026-12"]],
      { y: 2026, m: 11, d: 28 },
      7
    );
    expect(timezone).toBe("Europe/London");
    expect(days.map((d) => d.date)).toEqual([
      "2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04",
    ]);
    for (const d of days) {
      for (const k of ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"]) expect(d[k]).toMatch(ISO);
      expect(d.jumuah).toBeNull();
    }
    expect(days[0].weekday).toBe("Sat");
  });

  it("cuts anything after a space (e.g. ' (GMT)')", () => {
    const { days } = buildLocationDays([CAL["2026-11"]], { y: 2026, m: 11, d: 22 }, 1);
    expect(days[0].isha).toBe("2026-11-22T17:40:00+00:00");
  });

  it("throws when a requested day is missing", () => {
    expect(() => buildLocationDays([CAL["2026-11"]], { y: 2026, m: 11, d: 29 }, 5)).toThrow();
  });
});

describe("handleTimes (location)", () => {
  it("returns Aladhan days with location info and edge-caches upstream", async () => {
    const fetchFn = calendarFetch();
    const res = await handleTimes(req("lat=51.5406&lng=0.1475&days=7"), {}, {
      cache: fakeCache(),
      fetchFn,
      now: new Date("2026-11-28T10:00:00Z"),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      source: "aladhan",
      mosque: null,
      location: { lat: 51.54, lng: 0.15, method: 15, school: 1 },
      timezone: "Europe/London",
    });
    expect(body.days).toHaveLength(7);
    expect(fetchFn).toHaveBeenCalledTimes(2); // November + December
    expect(fetchFn.mock.calls[0][1]).toEqual({ cf: { cacheTtl: 86400, cacheEverything: true } });
  });

  it("fetches one month when the days stay inside it", async () => {
    const fetchFn = calendarFetch();
    await handleTimes(req("lat=51.54&lng=0.15&days=3"), {}, {
      cache: fakeCache(),
      fetchFn,
      now: new Date("2026-11-22T10:00:00Z"),
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns 503 'upstream unavailable' when Aladhan fails", async () => {
    const fetchFn = vi.fn(async () => new Response("down", { status: 500 }));
    const res = await handleTimes(req("lat=51.54&lng=0.15"), {}, {
      cache: fakeCache(),
      fetchFn,
      now: new Date("2026-11-22T10:00:00Z"),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "upstream unavailable" });
  });

  it("returns 503 when fetch itself throws", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network");
    });
    const res = await handleTimes(req("lat=51.54&lng=0.15"), {}, {
      cache: fakeCache(),
      fetchFn,
      now: new Date("2026-11-22T10:00:00Z"),
    });
    expect(res.status).toBe(503);
  });
});
