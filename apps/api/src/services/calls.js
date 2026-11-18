// Masked calling: patient and physio talk through PhysioCare's virtual number; neither sees the other's number.
// Exotel calls the person who tapped "Call" first, then connects them to the other side.
import { config } from '../config/index.js';
import { sequelize } from '../db/index.js';
import { HttpError, maskPhone } from '../lib/util.js';

const C = config.calls;
const q = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0];
const one = async (sql, replacements) => (await q(sql, replacements))[0];

export const callProviders = {
  async console({ from, to }) { console.log(`[call:console] connecting ${maskPhone(from)} → ${maskPhone(to)}`); return { ref: 'console', status: 'ringing' }; },
  async exotel({ from, to, statusUrl }) {
    if (!C.exotelSid || !C.exotelApiKey || !C.exotelApiToken || !C.exotelCallerId) throw new HttpError(503, 'calls_not_configured', 'Calling isn’t set up yet.');
    const url = `https://${C.exotelSubdomain}/v1/Accounts/${C.exotelSid}/Calls/connect.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${C.exotelApiKey}:${C.exotelApiToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: from.replace('+91', '0'), To: to.replace('+91', '0'), CallerId: C.exotelCallerId, CallType: 'trans', TimeLimit: '1800', StatusCallback: statusUrl, 'StatusCallbackEvents[0]': 'terminal' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, 'call_failed', body.RestException?.Message ?? 'The call couldn’t be connected. Try again in a minute.');
    return { ref: body.Call?.Sid ?? null, status: 'ringing' };
  },
  async none() { throw new HttpError(503, 'calls_off', 'Calling is switched off.'); },
};

/** Patient or physio of a visit calls the other side, around the visit time only. */
export async function callForVisit({ userId, visitId }) {
  const v = await one(`SELECT v.id, v.status, v.patient_id, v.therapist_id, v.physio_consent, lower(v.during) AS starts_at, upper(v.during) AS ends_at, pu.phone AS patient_phone, tu.phone AS physio_phone
    FROM visits v JOIN users pu ON pu.id = v.patient_id JOIN users tu ON tu.id = v.therapist_id WHERE v.id = :id AND (v.patient_id = :u OR v.therapist_id = :u)`, { id: visitId, u: userId });
  if (!v) throw new HttpError(404, 'not_found', 'Visit not found.');
  if (['cancelled', 'late_cancelled', 'held'].includes(v.status)) throw new HttpError(409, 'not_active', 'This visit isn’t active.');
  if (v.physio_consent === 'pending' || v.physio_consent === 'declined') throw new HttpError(409, 'consent_pending', 'Calling opens once the physiotherapist confirms the visit.');
  const opens = new Date(new Date(v.starts_at).getTime() - C.windowBeforeHours * 36e5);
  const closes = new Date(new Date(v.ends_at).getTime() + C.windowAfterHours * 36e5);
  if (Date.now() < opens.getTime() || Date.now() > closes.getTime()) {
    throw new HttpError(409, 'outside_window', `Calling is open from ${C.windowBeforeHours} hours before the visit until ${C.windowAfterHours} hours after it. For anything else, message in the app${C.supportNumber ? ` or call us on ${C.supportNumber}` : ''}.`);
  }
  const n = (await one(`SELECT count(*)::int AS n FROM call_logs WHERE visit_id = :v`, { v: v.id })).n;
  if (n >= C.maxPerVisit) throw new HttpError(429, 'too_many_calls', 'Too many calls for this visit. Please message in the app instead.');
  const isPatient = v.patient_id === userId;
  const callee = isPatient ? v.therapist_id : v.patient_id;
  const log = await one(`INSERT INTO call_logs (visit_id, caller_id, callee_id, provider) VALUES (:v, :a, :b, :p) RETURNING id`, { v: v.id, a: userId, b: callee, p: C.provider });
  try {
    const fn = callProviders[C.provider] ?? callProviders.none;
    const r = await fn({ from: isPatient ? v.patient_phone : v.physio_phone, to: isPatient ? v.physio_phone : v.patient_phone, statusUrl: `${config.publicApiUrl}/api/v1/webhooks/calls/${log.id}` });
    await q(`UPDATE call_logs SET provider_ref = :r, status = :s, updated_at = now() WHERE id = :id`, { r: r.ref, s: r.status, id: log.id });
    return { callId: log.id, status: r.status, message: 'We’re calling you now. Pick up and we’ll connect you. Your number stays private.' };
  } catch (e) {
    await q(`UPDATE call_logs SET status = 'failed', error = :e, updated_at = now() WHERE id = :id`, { e: String(e.message).slice(0, 300), id: log.id });
    throw e;
  }
}

/** Exotel status callback (form fields): Status, DialCallDuration / ConversationDuration. */
export async function callStatus(callId, body) {
  const map = { completed: 'completed', 'no-answer': 'no_answer', busy: 'no_answer', failed: 'failed', canceled: 'failed' };
  const status = map[String(body.Status ?? body.CallStatus ?? '').toLowerCase()];
  if (!status) return { ignored: true };
  await q(`UPDATE call_logs SET status = :s, duration_seconds = :d, updated_at = now() WHERE id = :id AND (:sid::text IS NULL OR provider_ref IS NULL OR provider_ref = :sid)`,
    { s: status, d: Number(body.ConversationDuration ?? body.DialCallDuration ?? 0) || null, id: callId, sid: body.CallSid ?? null });
  return { ok: true };
}
