import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { pickNextToRefresh, refreshOne, myMasjidUrl } from "../src/refresh.js";
import { parseMosques } from "../src/mosques.js";

const H = 3600_000;
const NOW = Date.UTC(2026, 10, 22, 3, 0);
const MOSQUES = JSON.stringify([
  { id: "duwt", name: "DUWT", city: "Dagenham", guid: "g-1", timezone: "Europe/London" },
  { id: "two", name: "Two", city: "X", guid: "g-2", timezone: "Europe/London" },
]);
const fixtureText = () =>
  readFileSync(new URL("./fixtures/mymasjid-sample.json", import.meta.url), "utf8");

function fakeKV(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    map,
    async get(k, type) {
      const v = map.get(k);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(k, v) {
      map.set(k, v);
    },
  };
}
const okFetch = (body = fixtureText()) =>
  vi.fn(async () => new Response(body, { status: 200 }));

describe("pickNextToRefresh", () => {
  const list = parseMosques(MOSQUES);
  it("picks the first mosque with no state", () => {
    expect(pickNextToRefresh(list, {}, NOW).id).toBe("duwt");
  });
  it("returns null when every mosque is fresh", () => {
    const s = { duwt: { ok: NOW - 2 * H, tried: NOW - 2 * H }, two: { ok: NOW - H, tried: NOW - H } };
    expect(pickNextToRefresh(list, s, NOW)).toBeNull();
  });
  it("picks a mosque older than 24 h whose last try is over 1 h ago", () => {
    const s = { duwt: { ok: NOW - 25 * H, tried: NOW - 2 * H }, two: { ok: NOW, tried: NOW } };
    expect(pickNextToRefresh(list, s, NOW).id).toBe("duwt");
  });
  it("waits 1 h after a failed try", () => {
    const s = { duwt: { ok: NOW - 25 * H, tried: NOW - 10 * 60_000 }, two: { ok: NOW, tried: NOW } };
    expect(pickNextToRefresh(list, s, NOW)).toBeNull();
  });
});

describe("refreshOne", () => {
  it("fetches the mosque timetable and stores it in KV", async () => {
    const env = { MOSQUES, TIMES: fakeKV() };
    const fetchFn = okFetch();
    const r = await refreshOne(env, fetchFn, NOW);
    expect(r).toEqual({ id: "duwt", ok: true });
    expect(fetchFn.mock.calls[0][0]).toBe(myMasjidUrl("g-1"));
    const stored = await env.TIMES.get("mosque:duwt", "json");
    expect(stored).toMatchObject({ fetchedAt: NOW, guid: "g-1", name: "DUWT", timezone: "Europe/London" });
    expect(stored.days.length).toBeGreaterThan(0);
    expect(stored.jumuah).toEqual(["13:00", "13:30"]);
    expect((await env.TIMES.get("refresh-state", "json")).duwt).toEqual({ ok: NOW, tried: NOW });
  });

  it("keeps the old copy and records only the try when the fetch fails", async () => {
    const old = { fetchedAt: 1, days: [{ month: 1, day: 1 }] };
    const env = {
      MOSQUES,
      TIMES: fakeKV({ "mosque:duwt": old, "refresh-state": { duwt: { ok: NOW - 25 * H, tried: NOW - 2 * H } } }),
    };
    const fetchFn = vi.fn(async () => new Response("nope", { status: 500 }));
    const r = await refreshOne(env, fetchFn, NOW);
    expect(r).toEqual({ id: "duwt", ok: false });
    expect(await env.TIMES.get("mosque:duwt", "json")).toEqual(old);
    expect((await env.TIMES.get("refresh-state", "json")).duwt).toEqual({ ok: NOW - 25 * H, tried: NOW });
  });

  it("keeps the old copy when the timetable has a malformed time", async () => {
    const bad = JSON.parse(fixtureText());
    bad.model.salahTimings[3].fajr = "6am";
    const old = { fetchedAt: 1, days: [] };
    const env = { MOSQUES, TIMES: fakeKV({ "mosque:duwt": old }) };
    const r = await refreshOne(env, okFetch(JSON.stringify(bad)), NOW);
    expect(r.ok).toBe(false);
    expect(await env.TIMES.get("mosque:duwt", "json")).toEqual(old);
    expect((await env.TIMES.get("refresh-state", "json")).duwt).toEqual({ ok: null, tried: NOW });
  });

  it("does nothing when every mosque is fresh", async () => {
    const env = {
      MOSQUES,
      TIMES: fakeKV({ "refresh-state": { duwt: { ok: NOW, tried: NOW }, two: { ok: NOW, tried: NOW } } }),
    };
    const fetchFn = okFetch();
    expect(await refreshOne(env, fetchFn, NOW)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
