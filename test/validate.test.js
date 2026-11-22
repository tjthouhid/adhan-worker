import { describe, it, expect } from "vitest";
import { parseTimesQuery } from "../src/validate.js";
import { parseMosques } from "../src/mosques.js";

const list = parseMosques(
  '[{"id":"duwt","name":"D","city":"C","guid":"g-1","timezone":"Europe/London"}]'
);
const q = (s) => parseTimesQuery(new URLSearchParams(s), list);

describe("parseTimesQuery", () => {
  it("accepts a listed mosque with default days", () => {
    const r = q("masjid=duwt");
    expect(r.kind).toBe("mosque");
    expect(r.mosque.id).toBe("duwt");
    expect(r.days).toBe(7);
  });

  it("returns 404 for an unknown mosque", () => {
    expect(q("masjid=nope").status).toBe(404);
  });

  it("accepts a location, rounds to 2 decimals and applies defaults", () => {
    expect(q("lat=51.5406&lng=0.1475")).toEqual({
      kind: "location",
      lat: 51.54,
      lng: 0.15,
      method: 15,
      school: 1,
      days: 7,
    });
  });

  it("accepts days=14 and explicit method/school", () => {
    const r = q("lat=51&lng=0&method=3&school=0&days=14");
    expect(r).toMatchObject({ method: 3, school: 0, days: 14 });
  });

  it.each([
    "lat=abc&lng=0",
    "lat=91&lng=0",
    "lat=0&lng=181",
    "lat=51",
    "lat=51&lng=0&masjid=duwt",
    "masjid=duwt&days=0",
    "masjid=duwt&days=15",
    "masjid=duwt&days=abc",
    "lat=51&lng=0&school=2",
    "lat=51&lng=0&method=99",
    "",
  ])("rejects %j with 400 and a message", (s) => {
    const r = q(s);
    expect(r.status).toBe(400);
    expect(typeof r.error).toBe("string");
  });
});
