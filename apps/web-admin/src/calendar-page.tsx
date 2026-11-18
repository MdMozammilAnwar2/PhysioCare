// Console calendar: every physio's week — PhysioCare visits, time blocked by their own calendars, and leave.
import { useEffect, useMemo, useState } from 'react';
import { ApiError, calendarApi, type CalVisit, type CalWeek } from './api';
import { Header } from './pages';

const IST = 'Asia/Kolkata';
const ymd = (d: Date) => new Date(d.getTime() + 5.5 * 36e5).toISOString().slice(0, 10);
const istDay = (iso: string) => ymd(new Date(iso));
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' });
const noon = (day: string) => new Date(`${day}T12:00:00+05:30`);
const STATUS: Record<string, string> = {
  booked: 'bg-brand/10 border-brand/40', on_the_way: 'bg-warning/15 border-warning/50', checked_in: 'bg-success/15 border-success/50',
  completed: 'bg-canvas border-line text-sub', cancelled: 'bg-white border-line text-sub line-through', late_cancelled: 'bg-white border-line text-sub line-through', no_show: 'bg-danger/10 border-danger/40',
};
const MODE: Record<string, string> = { home: '🏠', video: '📹', clinic: '🏥' };

export function CalendarPage() {
  const [from, setFrom] = useState(ymd(new Date()));
  const [data, setData] = useState<CalWeek | null>(null);
  const [physio, setPhysio] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setData(null); calendarApi.week(from, 7).then(setData).catch(e => setErr(e instanceof ApiError ? e.message : 'Couldn’t load the calendar.')); }, [from]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => ymd(new Date(noon(from).getTime() + i * 864e5))), [from]);
  const physios = useMemo(() => {
    const m = new Map<string, string>();
    data?.visits.forEach(v => m.set(v.therapist_id, v.therapist_name));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);
  const shown = physios.filter(([id]) => !physio || id === physio);
  const shift = (n: number) => setFrom(ymd(new Date(noon(from).getTime() + n * 864e5)));
  const today = ymd(new Date());

  const cell = (week: CalWeek, tid: string, day: string) => {
    const vs = week.visits.filter(v => v.therapist_id === tid && istDay(v.starts_at) === day);
    const busy = week.busy.filter(b => b.therapist_id === tid && istDay(b.starts_at) === day);
    const off = week.leave.some(l => l.therapist_id === tid && istDay(l.starts_at) <= day && istDay(l.ends_at) >= day);
    return (
      <td key={day} className={`align-top p-1.5 border-l border-line min-w-[130px] ${off ? 'bg-canvas' : ''}`}>
        {off && <p className="text-xs font-bold text-sub px-1">On leave</p>}
        <div className="flex flex-col gap-1">
          {vs.map((v: CalVisit) => (
            <div key={v.id} title={`${v.status}${v.zone_name ? ` · ${v.zone_name}` : ''}`} className={`rounded-lg border px-2 py-1 text-xs ${STATUS[v.status] ?? 'bg-white border-line'}`}>
              <b>{time(v.starts_at)}</b> {MODE[v.mode] ?? ''} {v.patient_first ?? ''}
              {v.physio_consent === 'pending' && <span className="block text-warning-ink font-semibold">consent pending</span>}
            </div>
          ))}
          {busy.map((b, i) => <div key={i} className="rounded-lg border border-dashed border-line px-2 py-1 text-xs text-sub">{time(b.starts_at)}–{time(b.ends_at)} busy ({b.provider})</div>)}
        </div>
      </td>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Operations" title="Calendar" right={
        <div className="flex gap-2 items-center flex-wrap">
          <button onClick={() => shift(-7)} className="h-10 px-3 rounded-xl border border-line bg-white font-bold" aria-label="Previous week">‹</button>
          <input type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} className="h-10 rounded-xl border border-line px-2 bg-white" aria-label="Week starting" />
          <button onClick={() => shift(7)} className="h-10 px-3 rounded-xl border border-line bg-white font-bold" aria-label="Next week">›</button>
          <button onClick={() => setFrom(today)} className="h-10 px-4 rounded-xl border border-line bg-white font-bold text-sm">Today</button>
          <select value={physio} onChange={e => setPhysio(e.target.value)} className="h-10 rounded-xl border border-line px-2 bg-white" aria-label="Physio">
            <option value="">All physios</option>{physios.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </div>} />
      <p className="text-sm text-sub">🏠 home · 📹 video · dashed = time blocked by the physio’s own Google Calendar or Calendly. Patients are shown by first name only.</p>
      {err && <p role="alert" className="text-sm font-semibold text-danger-ink">{err}</p>}
      <div className="rounded-card bg-white border border-line overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-canvas text-sub text-left">
            <tr>
              <th className="px-3 py-3 font-semibold sticky left-0 bg-canvas">Physio</th>
              {days.map(d => <th key={d} className={`px-3 py-3 font-semibold border-l border-line ${d === today ? 'text-brand' : ''}`}>{noon(d).toLocaleDateString('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short' })}</th>)}
            </tr>
          </thead>
          <tbody>
            {data === null && <tr><td colSpan={8} className="px-4 py-6 text-sub">Loading…</td></tr>}
            {data && shown.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-sub">No visits this week.</td></tr>}
            {data && shown.map(([id, name]) => (
              <tr key={id} className="border-t border-line">
                <td className="px-3 py-2 font-bold align-top sticky left-0 bg-white">{name}<div className="text-xs text-sub font-normal">{data.visits.filter(v => v.therapist_id === id && !['cancelled', 'late_cancelled'].includes(v.status)).length} visits</div></td>
                {days.map(d => cell(data, id, d))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
