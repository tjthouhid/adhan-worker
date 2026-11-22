// Trim a my-masjid.com GetMasjidTimings response to what we store in KV.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// True when every calendar day is present (29 Feb optional).
export function isCompleteYear(days) {
  const have = new Set(days.map((d) => `${d.month}-${d.day}`));
  for (let t = Date.UTC(2027, 0, 1); t < Date.UTC(2028, 0, 1); t += 86400000) {
    const d = new Date(t);
    if (!have.has(`${d.getUTCMonth() + 1}-${d.getUTCDate()}`)) return false;
  }
  return true;
}

export function trimTimetable(json) {
  const rows = json?.model?.salahTimings;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Bad timetable: no days");

  const days = rows.map((r) => {
    const day = {
      month: r.month,
      day: r.day,
      fajr: r.fajr,
      sunrise: HHMM.test(r.shouruq ?? "") ? r.shouruq : null,
      dhuhr: r.zuhr,
      asr: r.asr,
      maghrib: r.maghrib,
      isha: r.isha,
    };
    const ok =
      Number.isInteger(day.month) &&
      Number.isInteger(day.day) &&
      ["fajr", "dhuhr", "asr", "maghrib", "isha"].every((k) => HHMM.test(day[k] ?? ""));
    if (!ok) throw new Error(`Bad timetable: ${r.day}/${r.month}`);
    return day;
  });

  const jumuah = (json.model.jumahSalahIqamahTimings || [])
    .map((j) => j?.time)
    .filter((t) => typeof t === "string" && HHMM.test(t))
    .sort();

  return { days, jumuah };
}
