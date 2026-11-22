import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { handleMosques, handleTimes } from "../src/api.js";
import { trimTimetable } from "../src/timetable.js";

const GUID = "7a036d31-guid";
const MOSQUES = JSON.stringify([
  { id: "duwt", name: "DUWT", city: "Dagenham", guid: GUID, timezone: "Europe/London" },
]);
const NOW = new Date("2026-11-22T10:00:00Z");
const stored = () => ({
  fetchedAt: 1,
  guid: GUID,
  name: "DUWT",
  timezone: "Europe/London",
  ...trimTimetable(JSON.parse(readFileSync(new URL("./fixtures/mymasjid-sample.json", import.meta.url)))),
});

// Fixture covers 22 Nov only around NOW, so ask for 1 day unless a test needs more.
function fakeKV(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    get: vi.fn(async (k, type) => {
      const v = map.get(k);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    }),
    put: vi.fn(async (k, v) => map.set(k, v)),
  };
}
function fakeCache() {
  const store = new Map();
  return {
    store,
    match: async (req) => store.get(req.url)?.clone(),
    put: async (req, res) => void store.set(req.url, res),
  };
}
const req = (q) => new Request(`https://w.example/times.json?${q}`);
const deps = (extra = {}) => ({ cache: fakeCache(), fetchFn: vi.fn(), now: NOW, ...extra });

describe("handleMosques", () => {
  it("lists mosques without GUIDs", async () => {
    const res = handleMosques({ MOSQUES });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).mosques[0].id).toBe("duwt");
    expect(text).not.toContain(GUID);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("handleTimes (mosque)", () => {
  it("serves days from KV with the spec's shape and no GUID", async () => {
    const env = { MOSQUES, TIMES: fakeKV({ "mosque:duwt": stored() }) };
    const res = await handleTimes(req("masjid=duwt&days=1"), env, deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const text = await res.text();
    expect(text).not.toContain(GUID);
    expect(text).not.toContain('"guid"');
    const body = JSON.parse(text);
    expect(body).toMatchObject({
      source: "mosque",
      mosque: { id: "duwt", name: "DUWT" },
      location: null,
      timezone: "Europe/London",
      generatedAt: NOW.toISOString(),
    });
    expect(body.days).toHaveLength(1);
    expect(body.days[0].date).toBe("2026-11-22");
  });

  it("serves the second identical request from the cache", async () => {
    const env = { MOSQUES, TIMES: fakeKV({ "mosque:duwt": stored() }) };
    const d = deps();
    await handleTimes(req("masjid=duwt&days=1"), env, d);
    const res2 = await handleTimes(req("days=1&masjid=duwt"), env, d);
    expect(res2.status).toBe(200);
    expect(env.TIMES.get).toHaveBeenCalledTimes(1);
  });

  it("returns 503 'timetable not ready' when KV is empty and never fetches upstream", async () => {
    const env = { MOSQUES, TIMES: fakeKV() };
    const d = deps();
    const res = await handleTimes(req("masjid=duwt"), env, d);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "timetable not ready" });
    expect(d.fetchFn).not.toHaveBeenCalled();
  });

  it("returns 503 when the KV binding is missing", async () => {
    const res = await handleTimes(req("masjid=duwt"), { MOSQUES }, deps());
    expect(res.status).toBe(503);
  });

  it("returns a JSON 400 for a bad query", async () => {
    const res = await handleTimes(req("lat=abc&lng=0"), { MOSQUES }, deps());
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
  });

  it("caps cache max-age at 3600 seconds", async () => {
    const env = { MOSQUES, TIMES: fakeKV({ "mosque:duwt": stored() }) };
    const res = await handleTimes(req("masjid=duwt&days=1"), env, deps());
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control"))[1]);
    expect(maxAge).toBeLessThanOrEqual(3600);
    expect(maxAge).toBeGreaterThan(0);
  });

  it("uses a shorter max-age just before local midnight", async () => {
    const env = { MOSQUES, TIMES: fakeKV({ "mosque:duwt": stored() }) };
    const res = await handleTimes(
      req("masjid=duwt&days=1"),
      env,
      deps({ now: new Date("2026-11-22T23:50:00Z") })
    );
    expect(res.headers.get("cache-control")).toContain("max-age=600");
  });
});
