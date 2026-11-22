import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { trimTimetable } from "../src/timetable.js";
import { zonedIso, todayInZone, addDays, buildMosqueDays, secondsToMidnight } from "../src/days.js";

const TZ = "Europe/London";
const stored = () =>
  trimTimetable(JSON.parse(readFileSync(new URL("./fixtures/mymasjid-sample.json", import.meta.url))));

describe("zonedIso", () => {
  it("uses +00:00 in winter (GMT)", () => {
    expect(zonedIso({ y: 2026, m: 11, d: 22 }, "06:02", TZ)).toBe("2026-11-22T06:02:00+00:00");
  });
  it("uses +01:00 in summer (BST)", () => {
    expect(zonedIso({ y: 2026, m: 7, d: 1 }, "13:00", TZ)).toBe("2026-07-01T13:00:00+01:00");
  });
  it("handles a negative-offset zone", () => {
    expect(zonedIso({ y: 2026, m: 1, d: 15 }, "05:30", "America/New_York")).toBe(
      "2026-01-15T05:30:00-05:00"
    );
  });
});

describe("todayInZone / addDays", () => {
  it("returns the local date in the zone", () => {
    // 23:30 UTC on 30 June is already 1 July in London (BST)
    expect(todayInZone(TZ, new Date("2026-06-30T23:30:00Z"))).toEqual({ y: 2026, m: 7, d: 1 });
  });
  it("adds days across month and year ends", () => {
    expect(addDays({ y: 2026, m: 12, d: 30 }, 3)).toEqual({ y: 2027, m: 1, d: 2 });
  });
});

describe("buildMosqueDays", () => {
  it("gives each day its own offset across the October clock change", () => {
    const days = buildMosqueDays(stored(), TZ, { y: 2026, m: 10, d: 24 }, 3);
    expect(days.map((d) => d.date)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    expect(days[0].fajr.endsWith("+01:00")).toBe(true);
    expect(days[2].fajr.endsWith("+00:00")).toBe(true);
  });

  it("returns the day shape with weekday and null sunrise", () => {
    const [d] = buildMosqueDays(stored(), TZ, { y: 2026, m: 11, d: 22 }, 1);
    expect(d).toMatchObject({
      date: "2026-11-22",
      weekday: "Sun",
      sunrise: null,
      dhuhr: "2026-11-22T12:05:00+00:00",
      jumuah: null,
    });
    expect("estimated" in d).toBe(false);
  });

  it("sets Jumu'ah on Fridays to the earliest time", () => {
    const [d] = buildMosqueDays(stored(), TZ, { y: 2026, m: 11, d: 27 }, 1);
    expect(d.weekday).toBe("Fri");
    expect(d.jumuah).toBe("2026-11-27T13:00:00+00:00");
    expect(d.dhuhr).toBe("2026-11-27T12:05:00+00:00");
  });

  it("sets Jumu'ah to null on a Friday when the mosque has none", () => {
    const s = stored();
    s.jumuah = [];
    const [d] = buildMosqueDays(s, TZ, { y: 2026, m: 11, d: 27 }, 1);
    expect(d.jumuah).toBeNull();
  });

  it("marks days in the next year as estimated", () => {
    const days = buildMosqueDays(stored(), TZ, { y: 2026, m: 12, d: 28 }, 7);
    expect(days).toHaveLength(7);
    expect(days.slice(0, 4).every((d) => !("estimated" in d))).toBe(true);
    expect(days.slice(4).every((d) => d.estimated === true)).toBe(true);
    expect(days[4].date).toBe("2027-01-01");
  });

  it("falls back from 29 Feb to 28 Feb, marked estimated", () => {
    const [d] = buildMosqueDays(stored(), TZ, { y: 2028, m: 2, d: 29 }, 1);
    expect(d.date).toBe("2028-02-29");
    expect(d.estimated).toBe(true);
    expect(d.isha).toBe("2028-02-29T17:40:00+00:00");
  });

  it("throws when another date is missing from the timetable", () => {
    expect(() => buildMosqueDays(stored(), TZ, { y: 2026, m: 5, d: 5 }, 1)).toThrow();
  });
});

describe("secondsToMidnight", () => {
  it("counts to the next local midnight", () => {
    expect(secondsToMidnight(TZ, new Date("2026-11-22T23:30:00Z"))).toBe(1800);
    // 21:30 UTC in summer is 22:30 BST: 90 minutes to go
    expect(secondsToMidnight(TZ, new Date("2026-07-01T21:30:00Z"))).toBe(5400);
  });
});
