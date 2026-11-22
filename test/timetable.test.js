import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { trimTimetable } from "../src/timetable.js";

const fixture = () =>
  JSON.parse(readFileSync(new URL("./fixtures/mymasjid-sample.json", import.meta.url)));

describe("trimTimetable", () => {
  it("keeps only the fields we use and maps zuhr to dhuhr", () => {
    const t = trimTimetable(fixture());
    expect(t.days[0]).toEqual({
      month: 10, day: 24, fajr: "06:00", sunrise: "07:30", dhuhr: "12:05", asr: "14:00", maghrib: "16:00", isha: "17:40",
    });
    expect(t.days).toHaveLength(13);
  });

  it("keeps only valid Jumu'ah times, sorted", () => {
    expect(trimTimetable(fixture()).jumuah).toEqual(["13:00", "13:30"]);
  });

  it("returns an empty Jumu'ah list when the mosque has none", () => {
    const f = fixture();
    delete f.model.jumahSalahIqamahTimings;
    expect(trimTimetable(f).jumuah).toEqual([]);
  });

  it("rejects a timetable where any day has a malformed time", () => {
    const f = fixture();
    f.model.salahTimings[5].isha = "";
    expect(() => trimTimetable(f)).toThrow("Bad timetable");
  });

  it("stores sunrise as null when shouruq is missing or malformed", () => {
    const f = fixture();
    delete f.model.salahTimings[0].shouruq;
    f.model.salahTimings[1].shouruq = "--";
    const t = trimTimetable(f);
    expect(t.days[0].sunrise).toBeNull();
    expect(t.days[1].sunrise).toBeNull();
  });

  it("rejects an empty or missing timetable", () => {
    expect(() => trimTimetable({ model: { salahTimings: [] } })).toThrow("Bad timetable");
    expect(() => trimTimetable({})).toThrow("Bad timetable");
  });
});
