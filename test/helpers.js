// A full-year my-masjid response (366 days, including 29 Feb).
export function fullYearMyMasjid() {
  const pad = (n) => String(n).padStart(2, "0");
  const salahTimings = [];
  for (let t = Date.UTC(2028, 0, 1); t < Date.UTC(2029, 0, 1); t += 86400000) {
    const d = new Date(t);
    salahTimings.push({
      day: d.getUTCDate(), month: d.getUTCMonth() + 1,
      fajr: "06:00", shouruq: "07:30", zuhr: "12:05", asr: "14:00", maghrib: "16:00", isha: "17:40",
    });
  }
  return { model: { salahTimings, jumahSalahIqamahTimings: [{ time: "13:00" }, { time: "13:30" }] } };
}
