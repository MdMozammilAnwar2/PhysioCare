// India has one time zone and no daylight saving: IST = UTC+05:30.
export const IST_OFFSET_MIN = 330;
const MS = 60 * 1000;

// Date in IST as 'YYYY-MM-DD' for a JS Date.
export const istDate = d => new Date(d.getTime() + IST_OFFSET_MIN * MS).toISOString().slice(0, 10);
// Weekday (0 = Sunday) in IST.
export const istWeekday = d => new Date(d.getTime() + IST_OFFSET_MIN * MS).getUTCDay();
// Minutes since IST midnight.
export const istMinutes = d => { const x = new Date(d.getTime() + IST_OFFSET_MIN * MS); return x.getUTCHours() * 60 + x.getUTCMinutes(); };
// JS Date for an IST calendar date + minutes since midnight.
export const fromIst = (ymd, minutes) => new Date(Date.parse(`${ymd}T00:00:00Z`) + (minutes - IST_OFFSET_MIN) * MS);
export const hhmmToMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
export const addMin = (d, m) => new Date(d.getTime() + m * MS);
export const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
