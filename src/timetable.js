// Trim a my-masjid.com GetMasjidTimings response to what we store in KV.

const HHMM = /^\d{2}:\d{2}$/;

export function trimTimetable(json) {
  const rows = json?.model?.salahTimings;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Bad timetable: no days");

  const days = rows.map((r) => {
    const day = {
      month: r.month,
      day: r.day,
      fajr: r.fajr,
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
