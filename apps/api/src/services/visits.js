// Visit lifecycle: physio consent → on the way → check-in (code) → in progress (location, SOS) → completed with notes.
import { config } from '../config/index.js';
import { sequelize } from '../db/index.js';
import { HttpError, hmac } from '../lib/util.js';
import { istDate } from '../lib/time.js';
import { audit } from './audit.js';
import { accrueForPlan } from './money.js';
import { returnCoinsForPlan } from './growth.js';

const one = async (sql, replacements, transaction) => (await sequelize.query(sql, { replacements, transaction }))[0][0];
const notify = (userId, type, title, body, data, transaction) => sequelize.query(
  `INSERT INTO notifications (user_id, type, title, body, data) VALUES (:u, :type, :title, :body, :data)`,
  { replacements: { u: userId, type, title, body, data: JSON.stringify(data ?? {}) }, transaction });
const MAX_CHECKIN_ATTEMPTS = config.visit.checkinMaxAttempts;

// The 4-digit check-in code is derived from a server secret and the visit id: nothing to store or leak.
export const checkinCode = visitId => String(parseInt(hmac(config.otpSecret, `checkin:${visitId}`).slice(0, 8), 16) % 10000).padStart(4, '0');

async function physioVisit(therapistId, visitId, transaction) {
  const v = await one(`SELECT v.*, lower(v.during) AS starts_at, upper(v.during) AS ends_at FROM visits v WHERE v.id = :id AND v.therapist_id = :t ${transaction ? 'FOR UPDATE' : ''}`, { id: visitId, t: therapistId }, transaction);
  if (!v) throw new HttpError(404, 'not_found', 'Visit not found.');
  return v;
}
const needConsent = v => {
  if (v.physio_consent === 'pending') throw new HttpError(409, 'consent_pending', 'Accept or decline this patient first.');
  if (v.physio_consent === 'declined') throw new HttpError(409, 'consent_declined', 'You declined this visit.');
};

// Gender rule: male physio agrees (or not) to visit a woman patient with her family member present.
export async function respondConsent({ therapistId, visitId, accept, ip }) {
  return sequelize.transaction(async t => {
    const v = await physioVisit(therapistId, visitId, t);
    if (v.physio_consent !== 'pending') throw new HttpError(409, 'not_pending', 'Nothing to answer for this visit.');
    if (accept) {
      await sequelize.query(`UPDATE visits SET physio_consent = 'accepted', physio_consent_at = now(), updated_at = now() WHERE id = :id`, { replacements: { id: v.id }, transaction: t });
      await sequelize.query(`INSERT INTO consents (user_id, document, version, accepted, method, subject_id, meta, ip) VALUES (:t, 'gender_safety', '1.0', true, 'app_otp', :p, :meta, :ip)`,
        { replacements: { t: therapistId, p: v.patient_id, meta: JSON.stringify({ visitId: v.id, familyMember: v.family_member }), ip: ip ?? null }, transaction: t });
      await notify(v.patient_id, 'physio_consented', 'Your physio confirmed', 'Your visit is confirmed with your family member present.', { visitId: v.id }, t);
    } else {
      // Declining frees the slot; the patient is offered female physios. No effect on the physio's ranking.
      await sequelize.query(`UPDATE visits SET physio_consent = 'declined', physio_consent_at = now(), status = 'cancelled', cancel_reason = 'physio_declined_consent', updated_at = now() WHERE id = :id`, { replacements: { id: v.id }, transaction: t });
      await sequelize.query(`UPDATE payments SET status = 'rejected', review_note = 'Visit cancelled before it happened; nothing to pay.', updated_at = now() WHERE plan_id = :p AND status IN ('pending', 'submitted')`, { replacements: { p: v.plan_id }, transaction: t });
      await returnCoinsForPlan(v.plan_id, t);
      await notify(v.patient_id, 'physio_declined', 'Please choose another physio', 'This physio can’t take the visit. Choose a female physio at the same time; nothing to pay for the cancelled visit.', { visitId: v.id }, t);
    }
    return { physioConsent: accept ? 'accepted' : 'declined' };
  });
}

export async function onTheWay({ therapistId, visitId }) {
  return sequelize.transaction(async t => {
    const v = await physioVisit(therapistId, visitId, t);
    needConsent(v);
    if (v.mode === 'video') throw new HttpError(409, 'video_visit', 'This is a video session. Start the video session instead.');
    if (v.status !== 'booked') throw new HttpError(409, 'wrong_state', 'This visit can’t start now.');
    await sequelize.query(`UPDATE visits SET status = 'on_the_way', on_the_way_at = now(), updated_at = now() WHERE id = :id`, { replacements: { id: v.id }, transaction: t });
    await notify(v.patient_id, 'physio_on_the_way', 'Your physio is on the way', 'Keep your check-in code ready. Share it only when your physio arrives.', { visitId: v.id }, t);
    return { status: 'on_the_way' };
  });
}

// Physio enters the patient's code. Wrong 5 times → locked, ops alerted.
export async function checkIn({ therapistId, visitId, code, familyPresent, ip }) {
  const result = await sequelize.transaction(async t => {
    const v = await physioVisit(therapistId, visitId, t);
    needConsent(v);
    if (!['booked', 'on_the_way'].includes(v.status)) throw new HttpError(409, 'wrong_state', 'This visit can’t be checked in.');
    if (istDate(new Date(v.starts_at)) !== istDate(new Date())) throw new HttpError(409, 'not_today', 'Check in on the day of the visit.');
    if (v.checkin_attempts >= MAX_CHECKIN_ATTEMPTS) throw new HttpError(423, 'checkin_locked', 'Check-in is locked. Our team will call you.');
    if (v.physio_consent === 'accepted' && familyPresent !== true) throw new HttpError(409, 'family_required', 'Confirm the family member is at home, or report that nobody is present.');
    if (String(code) !== checkinCode(v.id)) {
      const attempts = v.checkin_attempts + 1;
      await sequelize.query(`UPDATE visits SET checkin_attempts = :a, updated_at = now() WHERE id = :id`, { replacements: { a: attempts, id: v.id }, transaction: t });
      return { wrong: true, locked: attempts >= MAX_CHECKIN_ATTEMPTS, left: MAX_CHECKIN_ATTEMPTS - attempts, visit: v };
    }
    await sequelize.query(`UPDATE visits SET status = 'checked_in', checked_in_at = now(), family_present_confirmed = :fp, updated_at = now() WHERE id = :id`,
      { replacements: { fp: v.physio_consent === 'accepted' ? true : null, id: v.id }, transaction: t });
    await audit({ actor: { id: therapistId, primaryRole: 'therapist' }, action: 'visit.checked_in', targetType: 'visit', targetId: v.id, ip }, t);
    return { status: 'checked_in' };
  });
  if (result.wrong) {
    if (result.locked) {
      await audit({ actor: { id: therapistId, primaryRole: 'therapist' }, action: 'visit.checkin_locked', targetType: 'visit', targetId: result.visit.id, ip });
    }
    throw new HttpError(result.locked ? 423 : 400, result.locked ? 'checkin_locked' : 'code_wrong',
      result.locked ? 'Too many wrong codes. Check-in is locked and our team has been alerted.' : `Wrong code. ${result.left} tries left.`);
  }
  return result;
}

// ---------- video visits ----------
// Room names come from a server secret and the visit id: private, unguessable, nothing to store.
export const videoRoom = visitId => `${config.video.roomPrefix}-${hmac(config.otpSecret, `video:${visitId}`).slice(0, 20)}`;
function videoWindow(v) {
  const opens = new Date(new Date(v.starts_at).getTime() - config.video.joinEarlyMinutes * 60_000);
  const closes = new Date(new Date(v.ends_at).getTime() + config.video.joinLateMinutes * 60_000);
  return { opens, closes, open: Date.now() >= opens.getTime() && Date.now() <= closes.getTime() };
}
const istTime = d => d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });

/** Patient or physio of a video visit gets the meeting link, only inside the join window. */
export async function joinVideo({ userId, visitId }) {
  const v = await one(`SELECT v.*, lower(v.during) AS starts_at, upper(v.during) AS ends_at, pu.name AS patient_name, tu.name AS physio_name
    FROM visits v JOIN users pu ON pu.id = v.patient_id JOIN users tu ON tu.id = v.therapist_id WHERE v.id = :id AND (v.patient_id = :u OR v.therapist_id = :u)`, { id: visitId, u: userId });
  if (!v) throw new HttpError(404, 'not_found', 'Visit not found.');
  if (v.mode !== 'video') throw new HttpError(409, 'not_video', 'This is not a video session.');
  if (!['booked', 'checked_in'].includes(v.status)) throw new HttpError(409, 'wrong_state', 'This session is not open.');
  if (v.physio_consent === 'pending' || v.physio_consent === 'declined') throw new HttpError(409, 'consent_pending', 'The physiotherapist hasn’t confirmed this session yet.');
  const w = videoWindow(v);
  if (!w.open) {
    const early = Date.now() < w.opens.getTime();
    throw new HttpError(409, early ? 'too_early' : 'too_late', early ? `The call opens at ${istTime(w.opens)}.` : 'This session has ended.', { opensAt: w.opens, closesAt: w.closes });
  }
  const isPhysio = v.therapist_id === userId;
  const col = isPhysio ? 'physio_joined_at' : 'patient_joined_at';
  await sequelize.query(`UPDATE visits SET ${col} = COALESCE(${col}, now()) WHERE id = :id`, { replacements: { id: v.id } });
  const name = isPhysio ? v.physio_name : String(v.patient_name ?? 'Patient').split(' ')[0];
  const room = videoRoom(v.id);
  // Jitsi Meet: open the room straight away with the person's name filled in.
  const url = `${config.video.baseUrl}/${room}#userInfo.displayName=%22${encodeURIComponent(name ?? '')}%22&config.prejoinConfig.enabled=false`;
  return { provider: config.video.provider, room, url, opensAt: w.opens, closesAt: w.closes, role: isPhysio ? 'therapist' : 'patient' };
}

/** Physio starts the video session: it counts as checked in (there's no door code on a video call). */
export async function startVideo({ therapistId, visitId, ip }) {
  return sequelize.transaction(async t => {
    const v = await physioVisit(therapistId, visitId, t);
    needConsent(v);
    if (v.mode !== 'video') throw new HttpError(409, 'not_video', 'This is not a video session.');
    if (v.status !== 'booked') throw new HttpError(409, 'wrong_state', 'This session can’t start now.');
    if (!videoWindow(v).open) throw new HttpError(409, 'too_early', `You can start from ${config.video.joinEarlyMinutes} minutes before the session.`);
    await sequelize.query(`UPDATE visits SET status = 'checked_in', checked_in_at = now(), video_started_at = now(), updated_at = now() WHERE id = :id`, { replacements: { id: v.id }, transaction: t });
    await notify(v.patient_id, 'video_started', 'Your physio is waiting on video', 'Open My bookings and tap “Join video call”.', { visitId: v.id }, t);
    await audit({ actor: { id: therapistId, primaryRole: 'therapist' }, action: 'visit.video_started', targetType: 'visit', targetId: v.id, ip }, t);
    return { status: 'checked_in' };
  });
}

// Gender-rule visit and no adult family member at home: the physio leaves; the visit is moved free for the patient.
export async function nobodyPresent({ therapistId, visitId }) {
  return sequelize.transaction(async t => {
    const v = await physioVisit(therapistId, visitId, t);
    if (!['booked', 'on_the_way'].includes(v.status)) throw new HttpError(409, 'wrong_state', 'This visit can’t be changed now.');
    await sequelize.query(`UPDATE visits SET status = 'cancelled', cancel_reason = 'nobody_present', family_present_confirmed = false, updated_at = now() WHERE id = :id`, { replacements: { id: v.id }, transaction: t });
    await notify(v.patient_id, 'visit_moved', 'Your visit needs a new time', 'Your physio couldn’t start because no family member was at home. Pick a new time; no extra charge.', { visitId: v.id }, t);
    return { status: 'cancelled', reason: 'nobody_present' };
  });
}

export async function recordLocation({ therapistId, visitId, lat, lng }) {
  const v = await physioVisit(therapistId, visitId);
  if (!['on_the_way', 'checked_in'].includes(v.status)) throw new HttpError(409, 'not_in_progress', 'Location is shared only during a visit.');
  await sequelize.query(`INSERT INTO visit_locations (visit_id, lat, lng) VALUES (:v, :lat, :lng)`, { replacements: { v: v.id, lat, lng } });
  return { recorded: true };
}

// SOS can be raised any time by a physio (visit optional). Ops sees it at the top of the live screen.
export async function raiseSos({ userId, visitId, lat, lng, ip }) {
  if (visitId) await physioVisit(userId, visitId);
  const sos = await one(`INSERT INTO sos_events (visit_id, raised_by, lat, lng) VALUES (:v, :u, :lat, :lng) RETURNING id, created_at`, { v: visitId ?? null, u: userId, lat: lat ?? null, lng: lng ?? null });
  if (visitId && lat != null) await sequelize.query(`INSERT INTO visit_locations (visit_id, lat, lng) VALUES (:v, :lat, :lng)`, { replacements: { v: visitId, lat, lng } });
  await audit({ actor: { id: userId, primaryRole: 'therapist' }, action: 'sos.raised', targetType: 'sos', targetId: sos.id, after: { visitId, lat, lng }, ip });
  return { sosId: sos.id, status: 'open', message: 'Our safety team has been alerted and will call you now.' };
}

export async function completeVisit({ therapistId, visitId, painScore, measurements, exercises, notes, homePlan }) {
  return sequelize.transaction(async t => {
    const v = await physioVisit(therapistId, visitId, t);
    if (v.status !== 'checked_in') throw new HttpError(409, 'wrong_state', 'Check in before ending the visit.');
    await sequelize.query(`UPDATE visits SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = :id`, { replacements: { id: v.id }, transaction: t });
    await sequelize.query(`INSERT INTO session_notes (visit_id, therapist_id, pain_score, measurements, exercises, notes, home_plan) VALUES (:v, :t, :p, :m, :e, :n, :h)`,
      { replacements: { v: v.id, t: therapistId, p: painScore ?? null, m: JSON.stringify(measurements ?? {}), e: JSON.stringify(exercises ?? []), n: notes ?? null, h: homePlan ?? null }, transaction: t });
    if (v.plan_id) await accrueForPlan(v.plan_id, t); // earning appears once the payment is confirmed
    await notify(v.patient_id, 'visit_completed', 'How was today’s visit?', 'Your session notes and home exercises are ready.', { visitId: v.id }, t);
    return { status: 'completed' };
  });
}
