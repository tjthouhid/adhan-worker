import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { trimTimetable, isCompleteYear } from "../src/timetable.js";
import { fullYearMyMasjid } from "./helpers.js";

const fixture = () =>
  JSON.parse(readFileSync(new URL("./fixtures/mymasjid-sample.json", import.meta.url)));

describe("trimTimetable", () => {
  it("keeps only the fields we use and maps zuhr to dhuhr", () => {
    const t = trimTimetable(fixture());
    expect(t.days[0]).toEqual({
      month: 10, day: 24, fajr: "06:00", sunrise: "07:30", dhuhr: "12:05", asr: "14:00", maghrib: "16:00", isha: "17:40",
      jamaat: { fajr: "06:30", dhuhr: null, asr: null, maghrib: null, isha: null },
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

  it("rejects impossible clock times", () => {
    const f = fixture();
    f.model.salahTimings[2].asr = "25:61";
    expect(() => trimTimetable(f)).toThrow("Bad timetable");
  });

  it("drops impossible Jumu'ah times", () => {
    const f = fixture();
    f.model.jumahSalahIqamahTimings = [{ time: "24:00" }, { time: "13:15" }];
    expect(trimTimetable(f).jumuah).toEqual(["13:15"]);
  });

  it("keeps valid iqamah (jamaat) times and nulls bad ones without rejecting the day", () => {
    const f = fixture();
    Object.assign(f.model.salahTimings[0], { iqamah_Zuhr: "13:15", iqamah_Asr: "", iqamah_Maghrib: "16:05", iqamah_Isha: "25:00" });
    const j = trimTimetable(f).days[0].jamaat;
    expect(j).toEqual({ fajr: "06:30", dhuhr: "13:15", asr: null, maghrib: "16:05", isha: null });
  });

  it("rejects an empty or missing timetable", () => {
    expect(() => trimTimetable({ model: { salahTimings: [] } })).toThrow("Bad timetable");
    expect(() => trimTimetable({})).toThrow("Bad timetable");
  });
});

describe("isCompleteYear", () => {
  it("accepts a full year, with or without 29 Feb", () => {
    const days = trimTimetable(fullYearMyMasjid()).days;
    expect(isCompleteYear(days)).toBe(true);
    expect(isCompleteYear(days.filter((d) => !(d.month === 2 && d.day === 29)))).toBe(true);
  });
  it("rejects a partial year", () => {
    expect(isCompleteYear(trimTimetable(fixture()).days)).toBe(false);
    const days = trimTimetable(fullYearMyMasjid()).days.filter((d) => !(d.month === 7 && d.day === 4));
    expect(isCompleteYear(days)).toBe(false);
  });
});
