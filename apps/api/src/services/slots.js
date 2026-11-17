// The scheduling engine: the only place free slots are calculated.
import { sequelize } from '../db/index.js';
import { addDays, addMin, fromIst, hhmmToMin, istDate, istWeekday } from '../lib/time.js';
import { distanceKm, travelMinutes } from '../lib/geo.js';
import { schedulingRules, zoneRules } from './rules.js';

const STEP_MIN = 15;

// Busy intervals for a physio between two instants: live visits (expired holds ignored), leave, external calendars.
async function busyIntervals(therapistId, from, to) {
  const [rows] = await sequelize.query(`
    SELECT lower(v.during) AS s, upper(v.during) AS e, a.lat, a.lng, v.mode::text AS mode FROM visits v
      LEFT JOIN addresses a ON a.id = v.address_id
      WHERE v.therapist_id = :t AND v.during && tstzrange(:from, :to)
        AND (v.status IN ('booked', 'on_the_way', 'checked_in') OR (v.status = 'held' AND v.hold_expires_at > now()))
    UNION ALL SELECT lower(during), upper(during), NULL, NULL, 'leave' FROM leave_periods WHERE therapist_id = :t AND during && tstzrange(:from, :to)
    UNION ALL SELECT lower(during), upper(during), NULL, NULL, 'external' FROM external_busy_blocks WHERE therapist_id = :t AND during && tstzrange(:from, :to)
  `, { replacements: { t: therapistId, from: from.toISOString(), to: to.toISOString() } });
  return rows.map(r => ({ s: new Date(r.s), e: new Date(r.e), lat: r.lat, lng: r.lng, mode: r.mode }));
}

/**
 * Free start times for one physio.
 * @param {object} p { therapistId, mode, fromDate 'YYYY-MM-DD' (IST), days, address {lat,lng} for home, zone {color} for home }
 */
export async function freeSlots({ therapistId, mode, fromDate, days = 7, address, zone, now = new Date() }) {
  const rules = await schedulingRules();
  const length = rules.visitMinutes[mode];
  const buffer = rules.travelBufferMinutes;
  const zr = mode === 'home' ? zoneRules(zone?.color) : null;
  if (mode === 'home' && (!zr.newBookings || !zr.home)) return [];

  const lastDate = addDays(istDate(now), rules.bookingWindowDays);
  const toDate = addDays(fromDate, days) < lastDate ? addDays(fromDate, days) : lastDate;
  const earliest = addMin(now, rules.minNoticeHours * 60);

  const [ruleRows] = await sequelize.query(`SELECT weekday, start_time, end_time, modes FROM availability_rules WHERE therapist_id = :t`, { replacements: { t: therapistId } });
  const busy = await busyIntervals(therapistId, fromIst(fromDate, 0), fromIst(toDate, 24 * 60));
  const [[{ home_lat: hLat, home_lng: hLng } = {}]] = await sequelize.query(`SELECT home_lat, home_lng FROM therapist_profiles WHERE user_id = :t`, { replacements: { t: therapistId } });

  // Minutes of travel needed between a busy block and the new visit (home visits only).
  const gap = b => {
    if (mode !== 'home' || b.mode !== 'home' || b.lat == null) return mode === 'home' && b.mode === 'home' ? buffer : 0;
    return travelMinutes(distanceKm(b.lat, b.lng, address.lat, address.lng)) + buffer;
  };

  const out = [];
  for (let ymd = fromDate; ymd < toDate; ymd = addDays(ymd, 1)) {
    const wd = istWeekday(fromIst(ymd, 12 * 60));
    let dayVisits = busy.filter(b => b.mode !== 'leave' && b.mode !== 'external' && istDate(b.s) === ymd).length;
    if (dayVisits >= rules.maxVisitsPerDay) continue;
    for (const r of ruleRows.filter(r => r.weekday === wd && r.modes.includes(mode))) {
      let startMin = hhmmToMin(r.start_time), endMin = hhmmToMin(r.end_time);
      if (zr) { startMin = Math.max(startMin, zr.home[0]); endMin = Math.min(endMin, zr.home[1]); }
      for (let m = startMin; m + length <= endMin; m += STEP_MIN) {
        const s = fromIst(ymd, m), e = addMin(s, length);
        if (s < earliest) continue;
        const clash = busy.some(b => s < addMin(b.e, gap(b)) && addMin(e, gap(b)) > b.s);
        if (!clash) out.push(s.toISOString());
      }
    }
  }
  return [...new Set(out)].sort();
}
