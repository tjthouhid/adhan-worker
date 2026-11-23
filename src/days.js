// Date helpers that work in a given IANA timezone, and building the
// /times.json "days" list from a stored mosque timetable.

const pad = (n) => String(n).padStart(2, "0");
const ymd = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;

function parts(tz, date, extra = {}) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      ...extra,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
}

// Offset of tz at an instant, in minutes ("GMT+01:00" -> 60).
function offsetMinutes(tz, ms) {
  const name = parts(tz, new Date(ms), { timeZoneName: "longOffset" }).timeZoneName;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0; // plain "GMT"
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

const fmtOffset = (min) =>
  `${min < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`;

export function todayInZone(tz, now) {
  const p = parts(tz, now);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

export function addDays({ y, m, d }, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// Local wall-clock time in tz on a date -> ISO 8601 with that date's offset.
export function zonedIso(date, hhmm, tz) {
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(date.y, date.m - 1, date.d, h, mi);
  let off = offsetMinutes(tz, guess);
  const second = offsetMinutes(tz, guess - off * 60000);
  if (second !== off) off = second;
  return `${ymd(date)}T${pad(h)}:${pad(mi)}:00${fmtOffset(off)}`;
}

export function secondsToMidnight(tz, now) {
  const p = parts(tz, now);
  const elapsed = Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
  return 86400 - elapsed;
}

const weekday = ({ y, m, d }) =>
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];

// stored = { days: [{month, day, fajr, dhuhr, asr, maghrib, isha}], jumuah: ["13:00", ...] }
export function buildMosqueDays(stored, tz, start, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(start, i);
    let estimated = date.y > start.y;
    let row = stored.days.find((r) => r.month === date.m && r.day === date.d);
    if (!row && date.m === 2 && date.d === 29) {
      row = stored.days.find((r) => r.month === 2 && r.day === 28);
      estimated = true;
    }
    if (!row) throw new Error(`No timetable entry for ${ymd(date)}`);

    const wd = weekday(date);
    const at = (hhmm) => zonedIso(date, hhmm, tz);
    out.push({
      date: ymd(date),
      weekday: wd,
      fajr: at(row.fajr),
      sunrise: row.sunrise ? at(row.sunrise) : null,
      dhuhr: at(row.dhuhr),
      asr: at(row.asr),
      maghrib: at(row.maghrib),
      isha: at(row.isha),
      jumuah: wd === "Fri" && stored.jumuah?.length ? at(stored.jumuah[0]) : null,
      // Copies stored before jamaat existed have none: null rather than a guess.
      jamaat: row.jamaat
        ? Object.fromEntries(["fajr", "dhuhr", "asr", "maghrib", "isha"].map((p) => [p, row.jamaat[p] ? at(row.jamaat[p]) : null]))
        : null,
      ...(estimated ? { estimated: true } : {}),
    });
  }
  return out;
}
