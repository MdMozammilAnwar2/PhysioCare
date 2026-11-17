import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { lastCodeSentTo } from '../src/services/sms.js';
import { checkinCode } from '../src/services/visits.js';
import { addDays, fromIst, istDate } from '../src/lib/time.js';
import { User, sequelize } from '../src/models/index.js';

const app = createApp();
let n = 0;
const phone = () => `96${String(10000000 + ++n).padStart(8, '0')}`;
const q = (sql, r) => sequelize.query(sql, { replacements: r });
const auth = t => ({ authorization: `Bearer ${t}` });
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000050001a5f645400000000049454e44ae426082', 'hex');
const DOCS = ['aadhaar_pan', 'selfie', 'degree', 'council_registration', 'police_verification', 'bank_proof'];

async function signUp(gender, extra = {}) {
  const p = phone();
  await request(app).post('/api/v1/auth/otp/send').send({ phone: p }).expect(200);
  const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone: p, code: lastCodeSentTo(`+91${p}`), ...extra }).expect(201);
  await User.update({ gender }, { where: { id: res.body.user.id } });
  return { id: res.body.user.id, token: res.body.tokens.accessToken };
}
async function admin() {
  const a = await signUp('female');
  await q(`INSERT INTO user_roles (user_id, role) VALUES (:u, 'ops_admin')`, { u: a.id });
  return a;
}
async function verifiedPhysio(gender) {
  const t = await signUp(gender, { role: 'therapist' });
  await q(`INSERT INTO therapist_profiles (user_id, qualification, home_lat, home_lng, service_radius_km, verification_status) VALUES (:u, 'MPT', 25.596, 85.150, 10, 'verified')`, { u: t.id });
  await q(`INSERT INTO therapist_prices (therapist_id, mode, price_paise) VALUES (:u, 'home', 80000)`, { u: t.id });
  for (let wd = 0; wd < 7; wd++) await q(`INSERT INTO availability_rules (therapist_id, weekday, start_time, end_time, modes) VALUES (:u, :wd, '07:00', '21:00', '{home}')`, { u: t.id, wd });
  return t;
}
// A visit that starts now (today in IST), already booked, so visit-day actions can be tested at any time.
async function bookedVisitNow(therapist, patient, extra = {}) {
  const [[v]] = await q(`INSERT INTO visits (therapist_id, patient_id, mode, status, during, physio_consent, family_member)
    VALUES (:t, :p, 'home', 'booked', tstzrange(now(), now() + interval '45 minutes'), :pc, :fm) RETURNING id`,
  { t: therapist.id, p: patient.id, pc: extra.physioConsent ?? 'not_needed', fm: extra.familyMember ? JSON.stringify(extra.familyMember) : null });
  return v.id;
}

afterAll(async () => { await sequelize.close(); });

describe('therapist onboarding and verification', () => {
  it('profile → documents → agreement → submit → admin reviews documents → verified', async () => {
    const t = await signUp('female', { role: 'therapist' });
    await request(app).post('/api/v1/therapist/submit').set(auth(t.token)).expect(409); // no profile yet
    await request(app).put('/api/v1/therapist/profile').set(auth(t.token)).send({
      qualification: 'BPT', yearsExperience: 4, specialisations: ['after_surgery'], languages: ['hi', 'en'], homeLat: 25.6, homeLng: 85.12, serviceRadiusKm: 6,
    }).expect(200);
    const docIds = {};
    for (const type of DOCS.slice(0, 5)) {
      const f = await request(app).post('/api/v1/files').set(auth(t.token)).field('purpose', 'document').attach('file', PNG, { filename: `${type}.png`, contentType: 'image/png' }).expect(201);
      docIds[type] = (await request(app).post('/api/v1/therapist/documents').set(auth(t.token)).send({ type, fileId: f.body.file.id }).expect(201)).body.document.id;
    }
    const missing = await request(app).post('/api/v1/therapist/submit').set(auth(t.token)).expect(409);
    expect(missing.body.error.details.missing).toEqual(['bank_proof']);
    const f = await request(app).post('/api/v1/files').set(auth(t.token)).attach('file', PNG, { filename: 'bank.png', contentType: 'image/png' }).expect(201);
    docIds.bank_proof = (await request(app).post('/api/v1/therapist/documents').set(auth(t.token)).send({ type: 'bank_proof', fileId: f.body.file.id }).expect(201)).body.document.id;
    expect((await request(app).post('/api/v1/therapist/submit').set(auth(t.token)).expect(409)).body.error.code).toBe('agreement_missing');
    await request(app).post('/api/v1/therapist/agreement').set(auth(t.token)).send({ version: '2.1', accepted: true, signedName: 'Anjali Kumari' }).expect(201);
    expect((await request(app).post('/api/v1/therapist/submit').set(auth(t.token)).expect(200)).body.status).toBe('under_review');

    const a = await admin();
    const queue = await request(app).get('/api/v1/admin/verification').set(auth(a.token)).expect(200);
    expect(queue.body.therapists.some(x => x.id === t.id)).toBe(true);
    const detail = await request(app).get(`/api/v1/admin/therapists/${t.id}`).set(auth(a.token)).expect(200);
    expect(detail.body.documents).toHaveLength(6);
    expect(detail.body.agreement.version).toBe('2.1');

    // Can't verify until every document is approved; rejecting needs a note.
    expect((await request(app).post(`/api/v1/admin/therapists/${t.id}/verify`).set(auth(a.token)).send({ approve: true }).expect(409)).body.error.code).toBe('documents_not_approved');
    await request(app).post(`/api/v1/admin/documents/${docIds.police_verification}/review`).set(auth(a.token)).send({ approve: false }).expect(400);
    await request(app).post(`/api/v1/admin/documents/${docIds.police_verification}/review`).set(auth(a.token)).send({ approve: false, note: 'Photo is blurry — upload again' }).expect(200);
    for (const type of DOCS.filter(x => x !== 'police_verification')) await request(app).post(`/api/v1/admin/documents/${docIds[type]}/review`).set(auth(a.token)).send({ approve: true }).expect(200);
    const f2 = await request(app).post('/api/v1/files').set(auth(t.token)).attach('file', PNG, { filename: 'police-2.png', contentType: 'image/png' }).expect(201);
    const reup = (await request(app).post('/api/v1/therapist/documents').set(auth(t.token)).send({ type: 'police_verification', fileId: f2.body.file.id }).expect(201)).body.document.id;
    await request(app).post(`/api/v1/admin/documents/${reup}/review`).set(auth(a.token)).send({ approve: true }).expect(200);
    expect((await request(app).post(`/api/v1/admin/therapists/${t.id}/verify`).set(auth(a.token)).send({ approve: true }).expect(200)).body.status).toBe('verified');
    const me = await request(app).get('/api/v1/therapist/profile').set(auth(t.token)).expect(200);
    expect(me.body.profile.verification_status).toBe('verified');
    // A patient can't use admin routes.
    await request(app).get('/api/v1/admin/verification').set(auth(t.token)).expect(403);
  });

  it('sets weekly hours and prices', async () => {
    const t = await verifiedPhysio('female');
    await request(app).put('/api/v1/therapist/availability').set(auth(t.token)).send({ rules: [{ weekday: 1, start: '08:00', end: '13:00', modes: ['home'] }, { weekday: 1, start: '16:00', end: '19:00', modes: ['home', 'video'] }] }).expect(200);
    expect((await request(app).get('/api/v1/therapist/availability').set(auth(t.token)).expect(200)).body.rules).toHaveLength(2);
    await request(app).put('/api/v1/therapist/availability').set(auth(t.token)).send({ rules: [{ weekday: 1, start: '13:00', end: '08:00', modes: ['home'] }] }).expect(400);
    await request(app).put('/api/v1/therapist/prices').set(auth(t.token)).send({ prices: [{ mode: 'home', pricePaise: 90000 }] }).expect(200);
  });
});

describe('visit day', () => {
  it('on the way → check-in with the patient’s code → location → complete with notes', async () => {
    const t = await verifiedPhysio('female'), p = await signUp('male');
    const visitId = await bookedVisitNow(t, p);
    await request(app).post(`/api/v1/therapist/visits/${visitId}/location`).set(auth(t.token)).send({ lat: 25.6, lng: 85.15 }).expect(409); // not started
    await request(app).post(`/api/v1/therapist/visits/${visitId}/on-the-way`).set(auth(t.token)).expect(200);
    const { body: { code } } = await request(app).get(`/api/v1/bookings/${visitId}/checkin-code`).set(auth(p.token)).expect(200);
    expect(code).toBe(checkinCode(visitId));
    expect(code).toMatch(/^\d{4}$/);
    await request(app).post(`/api/v1/therapist/visits/${visitId}/location`).set(auth(t.token)).send({ lat: 25.6, lng: 85.15 }).expect(200);
    await request(app).post(`/api/v1/therapist/visits/${visitId}/check-in`).set(auth(t.token)).send({ code }).expect(200);
    await request(app).post(`/api/v1/therapist/visits/${visitId}/complete`).set(auth(t.token)).send({
      painScore: 3, measurements: { knee_flexion: 95 }, exercises: [{ name: 'Mini squats', dose: '3 x 12' }], notes: 'Good quad control.', homePlan: 'Heel slides twice a day.',
    }).expect(200);
    const notes = await request(app).get(`/api/v1/bookings/${visitId}/notes`).set(auth(p.token)).expect(200);
    expect(notes.body.notes).toMatchObject({ pain_score: 3, measurements: { knee_flexion: 95 } });
    // Another physio can't touch this visit.
    const other = await verifiedPhysio('female');
    await request(app).post(`/api/v1/therapist/visits/${visitId}/complete`).set(auth(other.token)).send({}).expect(404);
  });

  it('locks check-in after 5 wrong codes', async () => {
    const t = await verifiedPhysio('female'), p = await signUp('male');
    const visitId = await bookedVisitNow(t, p);
    const wrong = checkinCode(visitId) === '0000' ? '1111' : '0000';
    for (let i = 0; i < 4; i++) await request(app).post(`/api/v1/therapist/visits/${visitId}/check-in`).set(auth(t.token)).send({ code: wrong }).expect(400);
    expect((await request(app).post(`/api/v1/therapist/visits/${visitId}/check-in`).set(auth(t.token)).send({ code: wrong }).expect(423)).body.error.code).toBe('checkin_locked');
    await request(app).post(`/api/v1/therapist/visits/${visitId}/check-in`).set(auth(t.token)).send({ code: checkinCode(visitId) }).expect(423);
  });

  it('shows the check-in code only on the visit day', async () => {
    const t = await verifiedPhysio('female'), p = await signUp('male');
    const later = fromIst(addDays(istDate(new Date()), 2), 10 * 60).toISOString();
    const [[v]] = await q(`INSERT INTO visits (therapist_id, patient_id, mode, status, during) VALUES (:t, :p, 'home', 'booked', tstzrange(:s, :s::timestamptz + interval '45 minutes')) RETURNING id`, { t: t.id, p: p.id, s: later });
    expect((await request(app).get(`/api/v1/bookings/${v.id}/checkin-code`).set(auth(p.token)).expect(409)).body.error.code).toBe('not_today');
  });
});

describe('gender safety consent', () => {
  it('male physio must accept before visiting, and must confirm family present at check-in', async () => {
    const t = await verifiedPhysio('male'), p = await signUp('female');
    const visitId = await bookedVisitNow(t, p, { physioConsent: 'pending', familyMember: { name: 'Sunil', relation: 'Husband' } });
    const list = await request(app).get('/api/v1/therapist/visits').set(auth(t.token)).expect(200);
    const row = list.body.visits.find(v => v.id === visitId);
    expect(row).toMatchObject({ physio_consent: 'pending', patient_name: null, line1: null }); // details hidden until he agrees
    expect((await request(app).post(`/api/v1/therapist/visits/${visitId}/on-the-way`).set(auth(t.token)).expect(409)).body.error.code).toBe('consent_pending');
    await request(app).post(`/api/v1/therapist/visits/${visitId}/consent`).set(auth(t.token)).send({ accept: true }).expect(200);
    const code = checkinCode(visitId);
    expect((await request(app).post(`/api/v1/therapist/visits/${visitId}/check-in`).set(auth(t.token)).send({ code }).expect(409)).body.error.code).toBe('family_required');
    await request(app).post(`/api/v1/therapist/visits/${visitId}/check-in`).set(auth(t.token)).send({ code, familyPresent: true }).expect(200);
    const [[{ c }]] = await q(`SELECT count(*)::int AS c FROM consents WHERE user_id = :t AND document = 'gender_safety'`, { t: t.id });
    expect(c).toBe(1);
  });

  it('declining cancels the visit and frees the patient to choose a female physio', async () => {
    const t = await verifiedPhysio('male'), p = await signUp('female');
    const visitId = await bookedVisitNow(t, p, { physioConsent: 'pending', familyMember: { name: 'Sunil', relation: 'Husband' } });
    await request(app).post(`/api/v1/therapist/visits/${visitId}/consent`).set(auth(t.token)).send({ accept: false }).expect(200);
    const [[v]] = await q(`SELECT status, cancel_reason FROM visits WHERE id = :id`, { id: visitId });
    expect(v).toMatchObject({ status: 'cancelled', cancel_reason: 'physio_declined_consent' });
    const notes = await request(app).get('/api/v1/notifications').set(auth(p.token)).expect(200);
    expect(notes.body.notifications[0].type).toBe('physio_declined');
  });

  it('nobody present: physio leaves, visit moved free', async () => {
    const t = await verifiedPhysio('male'), p = await signUp('female');
    const visitId = await bookedVisitNow(t, p, { physioConsent: 'accepted', familyMember: { name: 'Sunil', relation: 'Husband' } });
    await request(app).post(`/api/v1/therapist/visits/${visitId}/nobody-present`).set(auth(t.token)).expect(200);
    const [[v]] = await q(`SELECT status, cancel_reason, family_present_confirmed FROM visits WHERE id = :id`, { id: visitId });
    expect(v).toMatchObject({ status: 'cancelled', cancel_reason: 'nobody_present', family_present_confirmed: false });
  });
});

describe('SOS and live visits', () => {
  it('physio raises SOS → ops sees it live → acknowledge → resolve', async () => {
    const t = await verifiedPhysio('female'), p = await signUp('male');
    const visitId = await bookedVisitNow(t, p);
    await request(app).post(`/api/v1/therapist/visits/${visitId}/on-the-way`).set(auth(t.token)).expect(200);
    await request(app).post(`/api/v1/therapist/visits/${visitId}/check-in`).set(auth(t.token)).send({ code: checkinCode(visitId) }).expect(200);
    const sos = await request(app).post('/api/v1/therapist/sos').set(auth(t.token)).send({ visitId, lat: 25.616, lng: 85.115 }).expect(201);
    const a = await admin();
    const live = await request(app).get('/api/v1/admin/live-visits').set(auth(a.token)).expect(200);
    expect(live.body.sos.find(s => s.id === sos.body.sosId)).toMatchObject({ status: 'open', lat: 25.616 });
    expect(live.body.visits.find(v => v.id === visitId)).toMatchObject({ status: 'checked_in', lat: 25.616 });
    await request(app).post(`/api/v1/admin/sos/${sos.body.sosId}/acknowledge`).set(auth(a.token)).expect(200);
    await request(app).post(`/api/v1/admin/sos/${sos.body.sosId}/acknowledge`).set(auth(a.token)).expect(409);
    await request(app).post(`/api/v1/admin/sos/${sos.body.sosId}/resolve`).set(auth(a.token)).send({ note: 'Called physio; patient’s relative was aggressive. Physio left safely.' }).expect(200);
    const after = await request(app).get('/api/v1/admin/live-visits').set(auth(a.token)).expect(200);
    expect(after.body.sos.find(s => s.id === sos.body.sosId)).toBeUndefined();
  });
});
